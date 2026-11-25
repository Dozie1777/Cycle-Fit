import { env } from "cloudflare:workers";
import { getSandbox } from "@cloudflare/sandbox";
import type { Octokit } from "octokit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	dailyReviewDeliveryId,
	runDailyCodebaseReview,
} from "@/features/review/daily-review";

vi.mock("@cloudflare/sandbox", () => ({ getSandbox: vi.fn() }));

const SHA = "0123456789abcdef0123456789abcdef01234567";

let sandbox: {
	exec: ReturnType<typeof vi.fn>;
	writeFile: ReturnType<typeof vi.fn>;
	startProcess: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
	sandbox = {
		exec: vi.fn(async () => ({ success: true, stdout: "", stderr: "" })),
		writeFile: vi.fn(async () => {}),
		startProcess: vi.fn(async () => ({ id: "daily-process" })),
	};
	vi.mocked(getSandbox).mockReturnValue(sandbox as never);
	vi.spyOn(console, "log").mockImplementation(() => {});
	vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
});

function stubOctokit(checkRunId = 777) {
	const create = vi.fn(async () => ({ data: { id: checkRunId } }));
	const update = vi.fn(async () => ({ data: {} }));
	const octokit = {
		rest: {
			repos: {
				get: vi.fn(async () => ({
					data: { default_branch: "main", full_name: "owner/repo" },
				})),
				getBranch: vi.fn(async () => ({
					data: { commit: { sha: SHA } },
				})),
			},
			checks: { create, update },
		},
	} as unknown as Octokit;
	return { octokit, create, update };
}

describe("dailyReviewDeliveryId", () => {
	it("keys one delivery per UTC day", () => {
		expect(dailyReviewDeliveryId(new Date("2026-11-12T05:00:00Z"))).toBe(
			"daily-review-2026-11-12",
		);
		expect(dailyReviewDeliveryId(new Date("2026-11-12T23:59:59Z"))).toBe(
			"daily-review-2026-11-12",
		);
		expect(dailyReviewDeliveryId(new Date("2026-11-13T00:00:01Z"))).toBe(
			"daily-review-2026-11-13",
		);
	});

	it("changes every day so claimReviewDelivery runs once per day", () => {
		const ids = new Set(
			[1, 2, 3].map((day) =>
				dailyReviewDeliveryId(
					new Date(`2026-11-${String(day).padStart(2, "0")}T05:00:00Z`),
				),
			),
		);
		expect(ids.size).toBe(3);
	});
});

describe("runDailyCodebaseReview", () => {
	it("drives a fresh claim through check-run creation into the launch pipeline", async () => {
		const { octokit, create, update } = stubOctokit(777);
		const target = {
			owner: "owner",
			repo: "repo",
			fullName: "owner/repo",
			origin: "https://reviews.example.com",
		};
		const deliveryId = `daily-review-orchestration-${Date.now()}`;

		await runDailyCodebaseReview(octokit, env as Env, target, deliveryId);

		expect(create).toHaveBeenCalledWith({
			owner: "owner",
			repo: "repo",
			name: "Daily Codebase Review",
			head_sha: SHA,
			status: "queued",
		});
		// Regression: the pipeline must receive the CREATED check-run id, not
		// the stale null from the claim object.
		expect(sandbox.startProcess).toHaveBeenCalledOnce();
		expect(update).toHaveBeenCalledWith(
			expect.objectContaining({
				check_run_id: 777,
				status: "in_progress",
			}),
		);
		const procEnv = sandbox.startProcess.mock.calls[0]?.[1].env as Record<
			string,
			string
		>;
		expect(procEnv.CHECK_RUN_ID).toBe("777");
		expect(procEnv.KIMI_SKILL_PROMPT).toBe("/skill:codebase-daily-review");
		expect(procEnv.CHECK_RUN_TITLE).toBe("Daily Codebase Review");
	});

	it("skips a second run the same day (delivery already claimed)", async () => {
		const { octokit, create } = stubOctokit(778);
		const target = {
			owner: "owner",
			repo: "repo",
			fullName: "owner/repo",
			origin: "https://reviews.example.com",
		};
		const deliveryId = `daily-review-once-${Date.now()}`;

		await runDailyCodebaseReview(octokit, env as Env, target, deliveryId);
		await runDailyCodebaseReview(octokit, env as Env, target, deliveryId);

		expect(create).toHaveBeenCalledTimes(1);
		expect(sandbox.startProcess).toHaveBeenCalledOnce();
	});
});
