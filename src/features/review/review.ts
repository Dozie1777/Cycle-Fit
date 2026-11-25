import { type ExecResult, getSandbox } from "@cloudflare/sandbox";
import type { Octokit } from "octokit";
import { getPrisma } from "@/lib/db";
import { withRetry } from "@/lib/retry";
import { shellQuote } from "@/lib/shell";
import { resolveIdentityForInstallation } from "./actors";
import { CHECK_RUN_NAME } from "./checks";
import { createGitHubApp, mintInstallationToken } from "./github";
import {
	RESCUE_RESULT_SCRIPT,
	REVIEW_GH_SCRIPT,
	REVIEW_GH_WRAPPER,
	RUN_REVIEW_SCRIPT,
} from "./review-scripts";

// Everything needed to run one check-run review in a sandbox.
export type ReviewJob = {
	owner: string;
	repo: string;
	fullName: string;
	// PR reviews only. Branch reviews (daily codebase review) set `ref`
	// instead and leave these undefined.
	prNumber?: number;
	prUrl?: string;
	// Non-PR reviews only: the remote ref to check out (branch name or sha).
	// When set, the sandbox clones/fetches the repo and checks out this ref
	// instead of refs/pull/<n>/head.
	ref?: string;
	// Kimi CLI invocation for this review. Defaults to the PR check-review
	// skill with the PR URL.
	skillPrompt?: string;
	// Check-run output title. Defaults to CHECK_RUN_NAME.
	checkRunTitle?: string;
	headSha: string;
	checkRunId: number;
	rerequested?: boolean;
	attemptId?: string;
	attemptSecret?: string;
	canStart?: () => Promise<boolean>;
	canUpdate?: () => Promise<boolean>;
	onStarted?: (processId: string) => Promise<void>;
	onFailure?: () => Promise<void>;
};

// Clone the PR head into a per-review sandbox and run the check-review skill
// there. The skill submits the results to GitHub directly (gh authenticated
// with this app's installation token, which owns the check run); the wrapper's
// rescue script only completes a stranded check run.
// Setup runs in the foreground so its failures complete the check run as
// neutral here; only the review itself is backgrounded (GitHub times out
// webhook deliveries after ~10s, a review takes minutes).
export async function startCheckRunReview(
	octokit: Octokit,
	job: ReviewJob,
	origin: string,
	env: Env,
) {
	const { owner, repo, fullName, headSha, checkRunId } = job;
	const checkRunTitle = job.checkRunTitle ?? CHECK_RUN_NAME;
	const sandboxId =
		job.attemptId ?? (job.rerequested ? String(checkRunId) : headSha);
	try {
		// Fail fast: without an installation token the skill cannot submit
		// anything and the rescue cannot complete the run — the check run
		// would strand in_progress. The catch below completes the run as
		// neutral with this message instead.
		if (!env.INSTALLATION_ID) {
			throw new Error(
				"INSTALLATION_ID is not set — sandbox would have no GitHub token to submit or rescue the review",
			);
		}
		const sandbox = getSandbox(env.Sandbox, sandboxId, {
			// The review runs as a detached process with a 10-minute timeout
			// (see startProcess below) and the model can spend most of that
			// thinking with no sandbox API calls — an idle window shorter than
			// the run lets the container sleep mid-review, after which every
			// poll/log call fails with "sandbox not found" and the check run
			// strands. 15m covers the worst-case run plus clone/setup.
			sleepAfter: "15m",
			// Avoid reusing a cached default session: after a container rollout the
			// session directory in /tmp is gone, but the SDK may still reference the
			// stale session id and fail with ENOENT on watch. Run each exec in a
			// fresh process instead.
			enableDefaultSession: false,
		});

		// The review model is pinned here via the KIMI_MODEL_* env family:
		// the Kimi CLI synthesizes a temporary provider from these variables
		// at startup ("Define a model from environment variables"), which
		// takes priority over the sandbox image's config.toml default.
		// KIMI_MODEL_THINKING_EFFORT forces the thinking effort — K3.1 Pro
		// defaults to max, and low keeps thinking (and quota) short.
		const vars: Record<string, string> = {
			KIMI_MODEL_NAME: env.REVIEW_KIMI_MODEL_NAME ?? "kimi-k3.1-pro-highspeed",
			KIMI_MODEL_PROVIDER_TYPE: env.KIMI_MODEL_PROVIDER_TYPE ?? "kimi",
			KIMI_MODEL_BASE_URL:
				env.KIMI_MODEL_BASE_URL ?? "https://api.kimi.com/coding/v1",
			KIMI_MODEL_THINKING_EFFORT: env.REVIEW_KIMI_THINKING_EFFORT ?? "low",
			KIMI_SKILL_PROMPT:
				job.skillPrompt ?? `/skill:github-pr-check-review ${job.prUrl ?? ""}`,
			CHECK_RUN_TITLE: checkRunTitle,
			REVIEW_RESULT_PATH: `/workspace/${sandboxId}/review-result.json`,
			REVIEW_OUTPUT_PATH: `/workspace/${sandboxId}/review-output.log`,
			CHECK_RUN_OWNER: owner,
			CHECK_RUN_REPO: repo,
			CHECK_RUN_ID: String(checkRunId),
			GH_REAL: "/usr/bin/gh",
			PATH: `/workspace/${sandboxId}/bin:/usr/local/bin:/usr/bin:/bin`,
		};
		if (job.prUrl) vars.PR_URL = job.prUrl;
		if (job.prNumber) vars.PR_NUMBER = String(job.prNumber);
		// KIMI_MODEL_API_KEY is required whenever KIMI_MODEL_NAME is set —
		// without it the CLI fails at startup and the rescue completes the
		// check run as a failure (never letting a reviewless PR through).
		if (env.KIMI_API_KEY) {
			vars.KIMI_MODEL_API_KEY = env.KIMI_API_KEY;
		}
		if (job.attemptId) {
			vars.REVIEW_ATTEMPT_ID = job.attemptId;
			vars.REVIEW_ATTEMPT_URL = `${origin}/api/review-attempt`;
			vars.REVIEW_SUBMISSION_URL = `${origin}/api/review-submission`;
		}
		if (job.attemptSecret) vars.REVIEW_ATTEMPT_SECRET = job.attemptSecret;
		// GH_TOKEN is the token for the check run's installation (the env
		// webhook app, resolved by INSTALLATION_ID — see lib/actors.ts). The
		// skill needs it to complete the run and post annotations.
		const identity = await resolveIdentityForInstallation(
			getPrisma(env),
			env,
			env.INSTALLATION_ID as string,
		);
		const { token } = await mintInstallationToken(
			createGitHubApp(identity, env.WEBHOOK_SECRET),
			identity,
		);
		vars.GH_TOKEN = token;
		console.log(
			`[review] env prepared: GH_TOKEN=set (installation ${identity.installationId}) KIMI_KEY=${vars.KIMI_MODEL_API_KEY ? "set" : "MISSING"}`,
		);

		const workDir = `/workspace/${sandboxId}/${repo}`;
		// Idempotent setup: a retry for the same review reuses its existing clone.
		// A failed first clone leaves a non-empty dir without .git, so that
		// branch removes the leftover before re-cloning.
		// The PR head is fetched via refs/pull/<n>/head — present on the base
		// repo for same-repo AND fork PRs, unlike refs/heads/* — and checked
		// out as FETCH_HEAD (last fetch wins). Branch reviews (ref set, no
		// prNumber) check out the named ref instead.
		// Explicit type param: with the AI SDK's type surface now in the
		// program, TS no longer infers this generic reliably.
		// Branch names can legally contain shell metacharacters ($, backticks),
		// so the ref is shell-quoted. prNumber is a number — safe as-is.
		const checkout = job.ref
			? `git fetch origin && git checkout -f ${shellQuote(job.ref)}`
			: `git fetch origin pull/${job.prNumber}/head && git checkout -f FETCH_HEAD`;
		const setup = await withRetry<ExecResult>(
			() =>
				sandbox.exec(
					`gh auth setup-git &&` +
						`mkdir -p ${sandboxId} && cd ${sandboxId} && ` +
						`([ -d ${repo}/.git ] || (rm -rf ${repo} && gh repo clone ${fullName})) && ` +
						`cd ${repo} && ${checkout}`,
					{ cwd: "/workspace", env: vars },
				),
			{ label: "sandbox setup" },
		);

		if (!setup.success) {
			console.log("[review] repo setup failed:", setup.stderr);
			console.log("[review] setup stdout:", setup.stdout);
			throw new Error(`repo setup failed: ${setup.stderr}`);
		}

		await sandbox.writeFile(
			`/workspace/${sandboxId}/run-review.sh`,
			RUN_REVIEW_SCRIPT,
		);
		await sandbox.writeFile(
			`/workspace/${sandboxId}/rescue-result.mjs`,
			RESCUE_RESULT_SCRIPT,
		);
		await sandbox.writeFile(
			`/workspace/${sandboxId}/bin/gh`,
			REVIEW_GH_WRAPPER,
		);
		await sandbox.writeFile(
			`/workspace/${sandboxId}/bin/review-gh.mjs`,
			REVIEW_GH_SCRIPT,
		);
		const wrapperInstall = await sandbox.exec(
			`chmod +x /workspace/${sandboxId}/bin/gh`,
			{ cwd: workDir, env: vars },
		);
		if (!wrapperInstall.success) {
			console.log(
				"[review] wrapper installation failed:",
				wrapperInstall.stderr,
			);
			throw new Error(
				`review wrapper installation failed: ${wrapperInstall.stderr}`,
			);
		}

		if (job.canStart && !(await job.canStart())) {
			console.log(
				`[review] attempt ${job.attemptId ?? "owner"} superseded before launch`,
			);
			return;
		}
		const proc = await sandbox.startProcess(
			`bash /workspace/${sandboxId}/run-review.sh`,
			{ cwd: workDir, env: vars, timeout: 600000 },
		);
		await job.onStarted?.(proc.id);
		const logsUrl = `${origin}/process-logs?sandbox=${sandboxId}&process=${proc.id}`;
		console.log(
			`[review] started process ${proc.id} for ${job.prNumber ? `PR #${job.prNumber} ` : ""}@ ${headSha}\n` +
				`[review] logs: ${logsUrl}`,
		);

		if (job.canUpdate && !(await job.canUpdate())) {
			console.log(
				`[review] attempt ${job.attemptId ?? "owner"} superseded before status update`,
			);
			return;
		}
		await octokit.rest.checks.update({
			owner,
			repo,
			check_run_id: checkRunId,
			status: "in_progress",
			started_at: new Date().toISOString(),
			output: {
				title: checkRunTitle,
				summary: `Review running for ${headSha.slice(0, 7)}\n\nProcess logs: ${logsUrl}`,
			},
		});
	} catch (error) {
		console.error(error);
		if (job.canUpdate && !(await job.canUpdate())) {
			console.log(
				`[review] attempt ${job.attemptId ?? "owner"} superseded after failure`,
			);
			return;
		}
		// The skill and rescue both run inside the sandbox; if the review
		// never started, nothing in the sandbox will complete the run — do it
		// here so it doesn't strand in queued/in_progress.
		await octokit.rest.checks
			.update({
				owner,
				repo,
				check_run_id: checkRunId,
				status: "completed",
				conclusion: "neutral",
				completed_at: new Date().toISOString(),
				output: {
					title: checkRunTitle,
					summary: `🤖 Review infrastructure failed before the review could start: ${error instanceof Error ? error.message : String(error)}`,
				},
			})
			.catch((e) => console.error("[review] failed to mark run neutral:", e));
		await job.onFailure?.();
	}
}
