import { Octokit } from "octokit";
import { DAILY_CHECK_RUN_NAME } from "./checks";
import {
	createGitHubApp,
	getEnvIdentity,
	mintInstallationToken,
} from "./github";
import { startCheckRunReview } from "./review";
import {
	abandonReviewDeliveryClaimStart,
	claimReviewDelivery,
	isReviewDeliveryAttemptCurrent,
	markReviewDeliveryClaimStarted,
	recordReviewDeliveryClaimCheckRun,
	releaseReviewDeliveryClaim,
} from "./review-claims";

// The cron-triggered whole-codebase review: clones the default branch, runs
// the codebase-daily-review Kimi skill in a per-day sandbox, and lets the
// skill complete the "Daily Codebase Review" check run and open a GitHub
// issue when it finds problems. Mirrors the check_run.rerequested delivery
// flow (claim → create check run → startCheckRunReview) so all fencing,
// rescue, and supersede logic is reused.

/** Repo (owner/name) the daily review targets. Configure via DAILY_REVIEW_REPO. */
export const DEFAULT_DAILY_REVIEW_REPO = "Eden-Kukuana-PLC/kukuana";

/** Public origin the sandbox posts fenced submissions to. */
const DEFAULT_REVIEW_ORIGIN = "https://code-review-bot.uplanit.workers.dev";

/**
 * Delivery id for a day: one run per day per repo. claimReviewDelivery's
 * unique key on deliveryId turns any second invocation the same day (a
 * duplicate cron, a manual retry) into a no-op.
 */
export function dailyReviewDeliveryId(date = new Date()): string {
	return `daily-review-${date.toISOString().slice(0, 10)}`;
}

function parseRepo(fullName: string): { owner: string; repo: string } {
	const [owner, repo] = fullName.split("/");
	if (!owner || !repo || fullName.includes(" ") || repo.includes("/")) {
		throw new Error(
			`DAILY_REVIEW_REPO must be "owner/name" — got "${fullName}"`,
		);
	}
	return { owner, repo };
}

async function completeNeutralRun(
	octokit: Octokit,
	owner: string,
	repo: string,
	checkRunId: number,
	summary: string,
): Promise<void> {
	await octokit.rest.checks
		.update({
			owner,
			repo,
			check_run_id: checkRunId,
			status: "completed",
			conclusion: "neutral",
			completed_at: new Date().toISOString(),
			output: {
				title: DAILY_CHECK_RUN_NAME,
				summary,
			},
		})
		.catch((error) =>
			console.error("[daily-review] failed to complete run:", error),
		);
}

export async function startDailyCodebaseReview(
	env: Env,
	originOverride?: string,
): Promise<void> {
	const fullName = env.DAILY_REVIEW_REPO ?? DEFAULT_DAILY_REVIEW_REPO;
	const { owner, repo } = parseRepo(fullName);
	const origin =
		originOverride ?? env.DAILY_REVIEW_ORIGIN ?? DEFAULT_REVIEW_ORIGIN;
	const deliveryId = dailyReviewDeliveryId();

	console.log(`[daily-review] cron fired for ${fullName} (${deliveryId})`);
	if (!env.INSTALLATION_ID) {
		console.error(
			"[daily-review] INSTALLATION_ID is not set — cannot run the daily review",
		);
		return;
	}

	const identity = getEnvIdentity(env);
	const { token } = await mintInstallationToken(
		createGitHubApp(identity, env.WEBHOOK_SECRET),
		identity,
	);
	const octokit = new Octokit({ auth: token });

	await runDailyCodebaseReview(octokit, env, {
		owner,
		repo,
		fullName,
		origin,
	});
}

// The orchestration after token minting, split out so tests can drive a
// fresh claim through to startCheckRunReview with a stubbed octokit.
export async function runDailyCodebaseReview(
	octokit: Octokit,
	env: Env,
	target: { owner: string; repo: string; fullName: string; origin: string },
	deliveryId: string = dailyReviewDeliveryId(),
): Promise<void> {
	const { owner, repo, fullName, origin } = target;

	// Default branch HEAD is the review target.
	const { data: repository } = await octokit.rest.repos.get({ owner, repo });
	const { data: branch } = await octokit.rest.repos.getBranch({
		owner,
		repo,
		branch: repository.default_branch,
	});
	const headSha = branch.commit.sha;
	console.log(
		`[daily-review] reviewing ${repository.default_branch}@${headSha.slice(0, 7)}`,
	);

	// Once-per-day fence (unique deliveryId per date).
	const claim = await claimReviewDelivery(env, deliveryId);
	if (!claim.claimed || claim.claimId === null) {
		console.log("[daily-review] already run today — skipping");
		return;
	}
	const { claimId } = claim;
	if (claim.secret === null) {
		console.log("[daily-review] claim has no attempt credential — skipping");
		return;
	}
	const secret = claim.secret;

	// claim.checkRunId is set when a previous attempt already created the run
	// (recovery); otherwise create it now and keep the id in this variable —
	// the claim object is never mutated.
	let checkRunId: number | null = claim.checkRunId;
	if (checkRunId != null) {
		console.log(`[daily-review] resuming claimed check run ${checkRunId}`);
	} else {
		try {
			const { data: run } = await octokit.rest.checks.create({
				owner,
				repo,
				name: DAILY_CHECK_RUN_NAME,
				head_sha: headSha,
				status: "queued",
			});
			checkRunId = run.id;
			console.log(
				`[daily-review] created check run ${run.id} ("${DAILY_CHECK_RUN_NAME}", queued)`,
			);
		} catch (error) {
			await releaseReviewDeliveryClaim(env, deliveryId, claimId).catch(
				(releaseError) =>
					console.error(
						"[daily-review] failed to release claim:",
						releaseError,
					),
			);
			console.error("[daily-review] failed to create check run:", error);
			return;
		}
		let recorded = false;
		try {
			recorded = await recordReviewDeliveryClaimCheckRun(
				env,
				deliveryId,
				claimId,
				checkRunId,
			);
		} catch (error) {
			console.error(
				"[daily-review] failed to record claimed check run:",
				error,
			);
		}
		if (!recorded) {
			await completeNeutralRun(
				octokit,
				owner,
				repo,
				checkRunId,
				"🤖 Daily review could not claim the check run — another attempt took it over",
			);
			return;
		}
	}
	if (checkRunId === null) {
		// Unreachable (every path above either assigns or returns), but the
		// type guard keeps the launch pipeline from ever seeing a null id.
		console.error("[daily-review] no check run id after claim — skipping");
		return;
	}

	// Reuse the PR review pipeline with a branch checkout and the daily
	// skill. attemptId keys the sandbox (one fresh sandbox per day) and
	// authenticates the skill's fenced check-run submissions; the rescue
	// script completes the run if the skill dies.
	await startCheckRunReview(
		octokit,
		{
			owner,
			repo,
			fullName,
			headSha,
			checkRunId,
			ref: repository.default_branch,
			skillPrompt: "/skill:codebase-daily-review",
			checkRunTitle: DAILY_CHECK_RUN_NAME,
			attemptId: claimId,
			attemptSecret: secret,
			canStart: () => isReviewDeliveryAttemptCurrent(env, checkRunId, claimId),
			canUpdate: () => isReviewDeliveryAttemptCurrent(env, checkRunId, claimId),
			onStarted: (processId) =>
				markReviewDeliveryClaimStarted(
					env,
					deliveryId,
					claimId,
					checkRunId,
					processId,
				).then(() => {}),
			onFailure: () =>
				abandonReviewDeliveryClaimStart(env, deliveryId, claimId, checkRunId),
		},
		origin,
		env,
	);
}
