import { env } from "cloudflare:workers";
import { getSandbox } from "@cloudflare/sandbox";
import type { Octokit } from "octokit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createGitHubApp,
	mintInstallationToken,
} from "@/features/review/github";
import type { ReviewJob } from "@/features/review/review";

let startCheckRunReview: typeof import("@/features/review/review").startCheckRunReview;

vi.mock("@cloudflare/sandbox", () => ({ getSandbox: vi.fn() }));

vi.mock("../src/features/review/github", () => ({
	createGitHubApp: vi.fn(),
	getEnvIdentity: vi.fn((workerEnv: Env) => ({
		appId: workerEnv.APP_ID,
		privateKeyPkcs8: "test-private-key",
		installationId: workerEnv.INSTALLATION_ID,
	})),
	mintInstallationToken: vi.fn(),
	toPkcs8Pem: vi.fn((privateKey: string) => privateKey),
}));

const SHA = "0123456789abcdef0123456789abcdef01234567";
const ORIGIN = "https://reviews.example.com";
const job: ReviewJob = {
	owner: "owner",
	repo: "repo",
	fullName: "owner/repo",
	prNumber: 42,
	prUrl: "https://github.com/owner/repo/pull/42",
	headSha: SHA,
	checkRunId: 9012,
};

let octokit: Octokit;
let updates: ReturnType<typeof vi.fn>;
let sandbox: {
	exec: ReturnType<typeof vi.fn>;
	writeFile: ReturnType<typeof vi.fn>;
	startProcess: ReturnType<typeof vi.fn>;
};
let reviewEnv: Env;

beforeEach(async () => {
	vi.resetModules();
	({ startCheckRunReview } = await import("@/features/review/review"));
	updates = vi.fn(async () => ({ data: {} }));
	octokit = { rest: { checks: { update: updates } } } as unknown as Octokit;
	sandbox = {
		exec: vi.fn(async () => ({ success: true, stdout: "", stderr: "" })),
		writeFile: vi.fn(async () => {}),
		startProcess: vi.fn(async () => ({ id: "review-process" })),
	};
	reviewEnv = { ...env, Sandbox: { ...env.Sandbox } } as Env;
	vi.mocked(getSandbox).mockReturnValue(sandbox as never);
	vi.mocked(createGitHubApp).mockReturnValue({} as never);
	vi.mocked(mintInstallationToken).mockResolvedValue({
		token: "installation-token",
		expiresAt: "2026-10-26T23:59:59Z",
	});
	vi.spyOn(console, "log").mockImplementation(() => {});
	vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("check-run review orchestration", () => {
	it("clones the default branch and runs the daily skill for ref-based jobs", async () => {
		const dailyJob: ReviewJob = {
			owner: "owner",
			repo: "repo",
			fullName: "owner/repo",
			headSha: SHA,
			checkRunId: 9012,
			ref: "main",
			skillPrompt: "/skill:codebase-daily-review",
			checkRunTitle: "Daily Codebase Review",
			attemptId: "daily-claim",
			attemptSecret: "daily-secret",
		};
		await startCheckRunReview(octokit, dailyJob, ORIGIN, reviewEnv);

		const setupCommand = sandbox.exec.mock.calls.find(([command]) =>
			String(command).includes("git checkout"),
		)?.[0] as string;
		expect(setupCommand).toContain("git checkout -f 'main'");
		expect(setupCommand).not.toContain("refs/pull");
		expect(sandbox.startProcess).toHaveBeenCalledWith(
			`bash /workspace/daily-claim/run-review.sh`,
			{
				cwd: `/workspace/daily-claim/repo`,
				env: expect.objectContaining({
					KIMI_SKILL_PROMPT: "/skill:codebase-daily-review",
					CHECK_RUN_TITLE: "Daily Codebase Review",
					CHECK_RUN_ID: String(dailyJob.checkRunId),
				}),
				timeout: 600000,
			},
		);
		const env = sandbox.startProcess.mock.calls[0]?.[1].env as Record<
			string,
			string | undefined
		>;
		expect(env.PR_URL).toBeUndefined();
		expect(env.PR_NUMBER).toBeUndefined();
		expect(updates.mock.calls[0]?.[0].output.title).toBe(
			"Daily Codebase Review",
		);
	});

	it("clones the PR head when no ref is set", async () => {
		await startCheckRunReview(octokit, job, ORIGIN, reviewEnv);

		const setupCommand = sandbox.exec.mock.calls.find(([command]) =>
			String(command).includes("git checkout"),
		)?.[0] as string;
		expect(setupCommand).toContain("git fetch origin pull/42/head");
		expect(sandbox.startProcess.mock.calls[0]?.[1].env).toMatchObject({
			KIMI_SKILL_PROMPT: `/skill:github-pr-check-review ${job.prUrl}`,
			PR_URL: job.prUrl,
			PR_NUMBER: "42",
		});
	});

	it("retries transient sandbox setup failures with the explicit environment", async () => {
		sandbox.exec
			.mockRejectedValueOnce(new Error("container not ready"))
			.mockResolvedValueOnce({ success: true, stdout: "", stderr: "" });

		await startCheckRunReview(octokit, job, ORIGIN, reviewEnv);

		expect(getSandbox).toHaveBeenCalledWith(reviewEnv.Sandbox, SHA, {
			sleepAfter: "15m",
			enableDefaultSession: false,
		});
		expect(sandbox.exec).toHaveBeenCalledTimes(3);
		expect(sandbox.startProcess).toHaveBeenCalledOnce();
	});

	it("injects the installation token and launches the background review process", async () => {
		await startCheckRunReview(octokit, job, ORIGIN, reviewEnv);

		expect(mintInstallationToken).toHaveBeenCalledOnce();
		expect(sandbox.startProcess).toHaveBeenCalledWith(
			`bash /workspace/${SHA}/run-review.sh`,
			{
				cwd: `/workspace/${SHA}/repo`,
				env: expect.objectContaining({
					GH_TOKEN: "installation-token",
					PR_URL: job.prUrl,
					PR_NUMBER: "42",
					CHECK_RUN_ID: String(job.checkRunId),
				}),
				timeout: 600000,
			},
		);
		expect(sandbox.writeFile).toHaveBeenCalledTimes(4);
	});

	it("marks the run in progress with request-origin process logs", async () => {
		await startCheckRunReview(octokit, job, ORIGIN, reviewEnv);

		expect(updates).toHaveBeenCalledWith({
			owner: job.owner,
			repo: job.repo,
			check_run_id: job.checkRunId,
			status: "in_progress",
			started_at: expect.any(String),
			output: {
				title: "Code Review",
				summary: `Review running for ${SHA.slice(0, 7)}\n\nProcess logs: ${ORIGIN}/process-logs?sandbox=${SHA}&process=review-process`,
			},
		});
	});

	it("isolates intentional reruns in per-check-run workspaces", async () => {
		await startCheckRunReview(
			octokit,
			{ ...job, checkRunId: 1001, rerequested: true },
			ORIGIN,
			reviewEnv,
		);
		await startCheckRunReview(
			octokit,
			{ ...job, checkRunId: 1002, rerequested: true },
			ORIGIN,
			reviewEnv,
		);

		expect(getSandbox).toHaveBeenNthCalledWith(1, reviewEnv.Sandbox, "1001", {
			sleepAfter: "15m",
			enableDefaultSession: false,
		});
		expect(getSandbox).toHaveBeenNthCalledWith(2, reviewEnv.Sandbox, "1002", {
			sleepAfter: "15m",
			enableDefaultSession: false,
		});
		expect(sandbox.startProcess.mock.calls.map((call) => call[0])).toEqual([
			"bash /workspace/1001/run-review.sh",
			"bash /workspace/1002/run-review.sh",
		]);
		expect(sandbox.startProcess.mock.calls[0]?.[1].env).toMatchObject({
			REVIEW_RESULT_PATH: "/workspace/1001/review-result.json",
			REVIEW_OUTPUT_PATH: "/workspace/1001/review-output.log",
		});
		expect(sandbox.startProcess.mock.calls[1]?.[1].env).toMatchObject({
			REVIEW_RESULT_PATH: "/workspace/1002/review-result.json",
			REVIEW_OUTPUT_PATH: "/workspace/1002/review-output.log",
		});
		expect(updates.mock.calls[1]?.[0].output.summary).toContain(
			"sandbox=1002&process=review-process",
		);
	});

	it("completes neutral without launching when wrapper installation fails", async () => {
		sandbox.exec.mockImplementation(async (command: string) =>
			command.startsWith("chmod")
				? { success: false, stdout: "", stderr: "chmod denied" }
				: { success: true, stdout: "", stderr: "" },
		);

		await startCheckRunReview(octokit, job, ORIGIN, reviewEnv);

		expect(sandbox.startProcess).not.toHaveBeenCalled();
		expect(updates).toHaveBeenCalledWith(
			expect.objectContaining({
				status: "completed",
				conclusion: "neutral",
				output: expect.objectContaining({
					summary: expect.stringContaining("chmod denied"),
				}),
			}),
		);
	});

	it("completes the run neutral when infrastructure fails before the review starts", async () => {
		sandbox.exec.mockResolvedValue({
			success: false,
			stdout: "clone stdout",
			stderr: "clone failed",
		});

		await startCheckRunReview(octokit, job, ORIGIN, reviewEnv);

		expect(sandbox.startProcess).not.toHaveBeenCalled();
		expect(updates).toHaveBeenCalledWith({
			owner: job.owner,
			repo: job.repo,
			check_run_id: job.checkRunId,
			status: "completed",
			conclusion: "neutral",
			completed_at: expect.any(String),
			output: {
				title: "Code Review",
				summary:
					"🤖 Review infrastructure failed before the review could start: repo setup failed: clone failed",
			},
		});
	});
});
