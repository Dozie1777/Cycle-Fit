import {
	createExecutionContext,
	waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { getSandbox } from "@cloudflare/sandbox";
import type { Octokit } from "octokit";
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import {
	createGitHubApp,
	mintInstallationToken,
} from "@/features/review/github";
import { startWorkerRequest, TEST_ORIGIN } from "../helpers/request";

vi.mock("@cloudflare/sandbox", async (importOriginal) => ({
	...(await importOriginal<typeof import("@cloudflare/sandbox")>()),
	getSandbox: vi.fn(),
}));

vi.mock("../../src/features/review/github", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/features/review/github")>()),
	createGitHubApp: vi.fn(),
	mintInstallationToken: vi.fn(),
}));

const SHA = "0123456789abcdef0123456789abcdef01234567";
const RUN_ID = 9012;

type Delivery = {
	id: string;
	name: string;
	payload: string;
	signature: string;
};

type EventHandler = (event: {
	id: string;
	octokit: Octokit;
	payload: Record<string, unknown>;
}) => Promise<void>;

class FakeWebhooks {
	readonly handlers = new Map<string, EventHandler[]>();
	readonly verifyAndReceive = vi.fn(async (delivery: Delivery) => {
		if (delivery.signature === "invalid") {
			throw new Error("signature does not match");
		}
		const payload = JSON.parse(delivery.payload) as Record<string, unknown>;
		const action =
			typeof payload.action === "string" ? `.${payload.action}` : "";
		const handlers = this.handlers.get(`${delivery.name}${action}`) ?? [];
		for (const handler of handlers) {
			await handler({ id: delivery.id, octokit, payload });
		}
	});

	on(name: string, handler: EventHandler) {
		const handlers = this.handlers.get(name) ?? [];
		handlers.push(handler);
		this.handlers.set(name, handlers);
	}
}

let octokit: Octokit;
let checks: {
	listForRef: ReturnType<typeof vi.fn>;
	create: ReturnType<typeof vi.fn>;
	update: ReturnType<typeof vi.fn>;
};
let webhooks: FakeWebhooks;
let webhookApps: FakeWebhooks[];
let sandbox: {
	exec: ReturnType<typeof vi.fn>;
	writeFile: ReturnType<typeof vi.fn>;
	startProcess: ReturnType<typeof vi.fn>;
	killProcess: ReturnType<typeof vi.fn>;
};

function repository() {
	return {
		name: "repo",
		full_name: "owner/repo",
		owner: { login: "owner" },
	};
}

function pullRequestPayload(action = "opened") {
	return {
		action,
		pull_request: {
			number: 42,
			html_url: `https://github.com/owner/repo/pull/42`,
			head: { sha: SHA },
		},
		repository: repository(),
	};
}

function checkSuitePayload(action = "requested") {
	return {
		action,
		check_suite: {
			id: 77,
			head_sha: SHA,
			head_branch: "feature",
			app: { slug: "code-review-bot" },
			pull_requests: [{ number: 42 }],
		},
		repository: repository(),
	};
}

function checkRunPayload() {
	return {
		action: "rerequested",
		check_run: {
			id: RUN_ID,
			name: "Code Review",
			head_sha: SHA,
			pull_requests: [{ number: 42 }],
		},
		repository: repository(),
	};
}

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

function blockCheckRunLookups(expected: number) {
	let calls = 0;
	let releaseGate!: () => void;
	let markArrived!: () => void;
	const gate = new Promise<void>((resolve) => {
		releaseGate = resolve;
	});
	const arrived = new Promise<void>((resolve) => {
		markArrived = resolve;
	});
	checks.listForRef.mockImplementation(async () => {
		calls++;
		if (calls === expected) markArrived();
		await gate;
		return { data: { check_runs: [] } };
	});
	return { arrived, release: () => releaseGate() };
}

type WebhookInit = { body?: string; signature?: string; deliveryId?: string };

function webhookRequest(
	name: string,
	payload: unknown,
	init: WebhookInit = {},
) {
	return new Request(new URL("/api/webhook", TEST_ORIGIN), {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"x-github-delivery": init.deliveryId ?? "delivery-123",
			"x-github-event": name,
			"x-hub-signature-256": init.signature ?? "sha256=valid",
		},
		body: init.body ?? JSON.stringify(payload),
	});
}

async function dispatch(
	name: string,
	payload: unknown,
	init: WebhookInit = {},
) {
	const ctx = createExecutionContext();
	const response = await (await import("../../src/server")).default.fetch(
		webhookRequest(name, payload, init),
		env,
		ctx,
	);
	return { ctx, response };
}

async function deliver(name: string, payload: unknown, signature?: string) {
	const { ctx, response } = await dispatch(name, payload, { signature });
	const acknowledgement = await response.text();
	await waitOnExecutionContext(ctx);
	return { response, acknowledgement };
}

let logCalls: unknown[][];

beforeAll(async () => {
	vi.resetModules();
	await import("../../src/server");
});

beforeEach(() => {
	logCalls = [];
	checks = {
		listForRef: vi.fn(async () => ({ data: { check_runs: [] } })),
		create: vi.fn(async () => ({ data: { id: RUN_ID } })),
		update: vi.fn(async () => ({ data: {} })),
	};
	octokit = { rest: { checks } } as unknown as Octokit;
	webhooks = new FakeWebhooks();
	webhookApps = [];
	vi.mocked(createGitHubApp).mockImplementation(() => {
		if (webhookApps.length > 0) webhooks = new FakeWebhooks();
		webhookApps.push(webhooks);
		return { webhooks } as never;
	});
	vi.mocked(mintInstallationToken).mockResolvedValue({
		token: "installation-token",
		expiresAt: "2026-10-26T23:59:59Z",
	});
	sandbox = {
		exec: vi.fn(async () => ({ success: true, stdout: "", stderr: "" })),
		writeFile: vi.fn(async () => {}),
		startProcess: vi.fn(async () => ({ id: "review-process" })),
		killProcess: vi.fn(async () => {}),
	};
	vi.mocked(getSandbox).mockReturnValue(sandbox as never);
	vi.spyOn(console, "log").mockImplementation((...args) => {
		logCalls.push(args);
	});
	vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("direct webhook acknowledgement", () => {
	it("acknowledges before blocked dispatch and forwards the exact body and headers", async () => {
		const body = '{\n  "action": "opened", "message": "café"\n}\n';
		let finishDispatch: (() => void) | undefined;
		const blocked = new Promise<void>((resolve) => {
			finishDispatch = resolve;
		});
		webhooks.verifyAndReceive.mockImplementationOnce(() => blocked);
		const ctx = createExecutionContext();
		const response = await (await import("../../src/server")).default.fetch(
			webhookRequest("pull_request", pullRequestPayload(), { body }),
			env,
			ctx,
		);

		expect(response.status).toBe(200);
		expect(await response.text()).toBe("ok");
		expect(createGitHubApp).toHaveBeenCalledOnce();
		expect(webhooks.verifyAndReceive).toHaveBeenCalledWith({
			id: "delivery-123",
			name: "pull_request",
			payload: body,
			signature: "sha256=valid",
		});

		finishDispatch?.();
		await waitOnExecutionContext(ctx);
	});

	it("logs an invalid signature asynchronously without dispatching or rejecting the acknowledgement", async () => {
		const { response, acknowledgement } = await deliver(
			"pull_request",
			pullRequestPayload(),
			"invalid",
		);

		expect(response.status).toBe(200);
		expect(acknowledgement).toBe("ok");
		expect(checks.listForRef).not.toHaveBeenCalled();
		expect(checks.create).not.toHaveBeenCalled();
		expect(sandbox.startProcess).not.toHaveBeenCalled();
		expect(logCalls).toContainEqual([
			"[webhooks] async dispatch failed:",
			expect.any(Error),
		]);
	});
});

describe("webhook review registrations", () => {
	it("skips pull_request.opened when a review run already exists", async () => {
		checks.listForRef.mockResolvedValueOnce({
			data: { check_runs: [{ id: RUN_ID }] },
		});

		await deliver("pull_request", pullRequestPayload());

		expect(checks.listForRef).toHaveBeenCalledWith({
			owner: "owner",
			repo: "repo",
			ref: SHA,
			check_name: "Code Review",
		});
		expect(checks.create).not.toHaveBeenCalled();
		expect(sandbox.startProcess).not.toHaveBeenCalled();
	});

	it("creates a queued run and starts the review for pull_request.opened", async () => {
		await deliver("pull_request", pullRequestPayload());

		expect(checks.create).toHaveBeenCalledWith({
			owner: "owner",
			repo: "repo",
			name: "Code Review",
			head_sha: SHA,
			status: "queued",
		});
		expect(sandbox.startProcess).toHaveBeenCalledOnce();
		expect(checks.update).toHaveBeenCalledWith(
			expect.objectContaining({ check_run_id: RUN_ID, status: "in_progress" }),
		);
	});

	it("keeps pull_request.synchronize and check_suite.completed log-only", async () => {
		await deliver("pull_request", pullRequestPayload("synchronize"));
		const completed = checkSuitePayload("completed");
		Object.assign(completed.check_suite, {
			status: "completed",
			conclusion: "success",
		});
		await deliver("check_suite", completed);

		expect(checks.listForRef).not.toHaveBeenCalled();
		expect(checks.create).not.toHaveBeenCalled();
		expect(sandbox.startProcess).not.toHaveBeenCalled();
	});

	it("skips check_suite.requested without a head SHA", async () => {
		const payload = checkSuitePayload();
		payload.check_suite.head_sha = null as never;

		await deliver("check_suite", payload);

		expect(checks.listForRef).not.toHaveBeenCalled();
		expect(checks.create).not.toHaveBeenCalled();
	});

	it("skips check_suite.requested without a pull request", async () => {
		const payload = checkSuitePayload();
		payload.check_suite.pull_requests = [];

		await deliver("check_suite", payload);

		expect(checks.listForRef).not.toHaveBeenCalled();
		expect(checks.create).not.toHaveBeenCalled();
	});

	it("skips check_suite.requested when a review run already exists", async () => {
		checks.listForRef.mockResolvedValueOnce({
			data: { check_runs: [{ id: RUN_ID }] },
		});

		await deliver("check_suite", checkSuitePayload());

		expect(checks.create).not.toHaveBeenCalled();
		expect(sandbox.startProcess).not.toHaveBeenCalled();
	});

	it("deduplicates check_suite.requested and starts a new run when none exists", async () => {
		await deliver("check_suite", checkSuitePayload());

		expect(checks.listForRef).toHaveBeenCalledOnce();
		expect(checks.create).toHaveBeenCalledOnce();
		expect(sandbox.startProcess).toHaveBeenCalledOnce();
	});

	it("atomically claims concurrent opened and suite deliveries for the same commit", async () => {
		const lookups = blockCheckRunLookups(2);
		const [opened, suite] = await Promise.all([
			dispatch("pull_request", pullRequestPayload(), {
				deliveryId: "delivery-opened",
			}),
			dispatch("check_suite", checkSuitePayload(), {
				deliveryId: "delivery-suite",
			}),
		]);
		await Promise.all([opened.response.text(), suite.response.text()]);
		await lookups.arrived;
		lookups.release();
		await Promise.all([
			waitOnExecutionContext(opened.ctx),
			waitOnExecutionContext(suite.ctx),
		]);

		expect(checks.create).toHaveBeenCalledOnce();
		expect(sandbox.startProcess).toHaveBeenCalledOnce();
	});

	it("deduplicates concurrent and later redeliveries by delivery ID", async () => {
		const lookups = blockCheckRunLookups(2);
		const delivery = { deliveryId: "delivery-duplicate" };
		const [first, second] = await Promise.all([
			dispatch("pull_request", pullRequestPayload(), delivery),
			dispatch("pull_request", pullRequestPayload(), delivery),
		]);
		await Promise.all([first.response.text(), second.response.text()]);
		await lookups.arrived;
		lookups.release();
		await Promise.all([
			waitOnExecutionContext(first.ctx),
			waitOnExecutionContext(second.ctx),
		]);
		const redelivery = await dispatch(
			"pull_request",
			pullRequestPayload(),
			delivery,
		);
		await redelivery.response.text();
		await waitOnExecutionContext(redelivery.ctx);

		expect(checks.create).toHaveBeenCalledOnce();
		expect(sandbox.startProcess).toHaveBeenCalledOnce();
	});

	it("always creates a fresh run for check_suite.rerequested", async () => {
		checks.listForRef.mockResolvedValueOnce({
			data: { check_runs: [{ id: RUN_ID }] },
		});

		await deliver("check_suite", checkSuitePayload("rerequested"));

		expect(checks.listForRef).not.toHaveBeenCalled();
		expect(checks.create).toHaveBeenCalledOnce();
		expect(sandbox.startProcess).toHaveBeenCalledOnce();
	});

	it("ignores check_run.rerequested for another check name", async () => {
		const payload = checkRunPayload();
		payload.check_run.name = "Build";

		await deliver("check_run", payload);

		expect(checks.create).not.toHaveBeenCalled();
		expect(sandbox.startProcess).not.toHaveBeenCalled();
	});

	it("ignores check_run.rerequested without a pull request", async () => {
		const payload = checkRunPayload();
		payload.check_run.pull_requests = [];

		await deliver("check_run", payload);

		expect(checks.create).not.toHaveBeenCalled();
		expect(sandbox.startProcess).not.toHaveBeenCalled();
	});

	it("reuses the existing run ID for a valid check_run.rerequested", async () => {
		await deliver("check_run", checkRunPayload());

		expect(checks.create).not.toHaveBeenCalled();
		expect(checks.update).toHaveBeenCalledWith(
			expect.objectContaining({ check_run_id: RUN_ID, status: "in_progress" }),
		);
		expect(sandbox.startProcess).toHaveBeenCalledOnce();
	});

	it("does not reject the acknowledged invocation and allows a retry after GitHub creation fails", async () => {
		checks.create.mockRejectedValueOnce(new Error("GitHub unavailable"));

		const { response, acknowledgement } = await deliver(
			"check_suite",
			checkSuitePayload(),
		);
		const retry = await dispatch("check_suite", checkSuitePayload(), {
			deliveryId: "delivery-after-create-failure",
		});
		await retry.response.text();
		await waitOnExecutionContext(retry.ctx);

		expect(response.status).toBe(200);
		expect(acknowledgement).toBe("ok");
		expect(checks.create).toHaveBeenCalledTimes(2);
		expect(sandbox.startProcess).toHaveBeenCalledOnce();
	});
});

describe("webhook lifecycle recovery", () => {
	it("lets a waiting contender take over when the pending owner fails", async () => {
		const ownerStarted = deferred();
		const failOwner = deferred();
		checks.create.mockImplementationOnce(async () => {
			ownerStarted.resolve();
			await failOwner.promise;
			throw new Error("owner create failed");
		});
		const owner = await dispatch("pull_request", pullRequestPayload(), {
			deliveryId: "delivery-pending-owner",
		});
		await owner.response.text();
		await ownerStarted.promise;
		const contender = await dispatch("check_suite", checkSuitePayload(), {
			deliveryId: "delivery-pending-contender",
		});
		await contender.response.text();
		await new Promise((resolve) => setTimeout(resolve, 75));
		failOwner.resolve();
		await Promise.all([
			waitOnExecutionContext(owner.ctx),
			waitOnExecutionContext(contender.ctx),
		]);

		expect(checks.create).toHaveBeenCalledTimes(2);
		expect(sandbox.startProcess).toHaveBeenCalledOnce();
		expect(checks.update).toHaveBeenCalledWith(
			expect.objectContaining({ status: "in_progress" }),
		);
	});

	it("recovers an abandoned claim after its lease expires", async () => {
		await env.DB.prepare(
			`INSERT INTO "ReviewClaim"
				("id", "repository", "headSha", "deliveryId", "leaseUntil")
			VALUES ('abandoned-claim', 'owner/repo', ?, 'abandoned-delivery', ?)`,
		)
			.bind(SHA, new Date(Date.now() - 1_000).toISOString())
			.run();

		await deliver("check_suite", checkSuitePayload());

		expect(checks.create).toHaveBeenCalledOnce();
		expect(sandbox.startProcess).toHaveBeenCalledOnce();
		const claim = await env.DB.prepare(
			`SELECT "checkRunId" FROM "ReviewClaim" WHERE "deliveryId" = 'delivery-123'`,
		).first<{ checkRunId: number }>();
		expect(claim).toEqual({ checkRunId: RUN_ID });
	});

	it("recovers a pending claim after release fails and its lease expires", async () => {
		await env.DB.prepare(
			`CREATE TRIGGER "fail_review_claim_release"
			BEFORE DELETE ON "ReviewClaim"
			BEGIN SELECT RAISE(ABORT, 'forced release failure'); END`,
		).run();
		checks.create.mockRejectedValueOnce(new Error("GitHub unavailable"));
		try {
			await deliver("pull_request", pullRequestPayload());
		} finally {
			await env.DB.prepare(`DROP TRIGGER "fail_review_claim_release"`).run();
		}
		await env.DB.prepare(
			`UPDATE "ReviewClaim" SET "leaseUntil" = ? WHERE "deliveryId" = 'delivery-123'`,
		)
			.bind(new Date(Date.now() - 1_000).toISOString())
			.run();

		await deliver("check_suite", checkSuitePayload(), undefined);

		expect(checks.create).toHaveBeenCalledTimes(2);
		expect(sandbox.startProcess).toHaveBeenCalledOnce();
	});

	it("deduplicates suite rerequest deliveries without blocking distinct reruns", async () => {
		const ownerStarted = deferred();
		const finishOwner = deferred();
		checks.create
			.mockImplementationOnce(async () => {
				ownerStarted.resolve();
				await finishOwner.promise;
				return { data: { id: 1001 } };
			})
			.mockImplementationOnce(async () => ({ data: { id: 1002 } }));
		const duplicate = { deliveryId: "delivery-suite-rerequest" };
		const owner = await dispatch(
			"check_suite",
			checkSuitePayload("rerequested"),
			duplicate,
		);
		await owner.response.text();
		await ownerStarted.promise;
		const contender = await dispatch(
			"check_suite",
			checkSuitePayload("rerequested"),
			duplicate,
		);
		await contender.response.text();
		await new Promise((resolve) => setTimeout(resolve, 75));
		finishOwner.resolve();
		await Promise.all([
			waitOnExecutionContext(owner.ctx),
			waitOnExecutionContext(contender.ctx),
		]);
		await deliver("check_suite", checkSuitePayload("rerequested"));

		expect(checks.create).toHaveBeenCalledTimes(2);
		expect(sandbox.startProcess).toHaveBeenCalledTimes(2);
		const sandboxIds = vi.mocked(getSandbox).mock.calls.map((call) => call[1]);
		expect(new Set(sandboxIds).size).toBe(2);
		for (const sandboxId of sandboxIds) {
			expect(getSandbox).toHaveBeenCalledWith(env.Sandbox, sandboxId, {
				sleepAfter: "15m",
				enableDefaultSession: false,
			});
		}
	});

	it("deduplicates check-run rerequest deliveries without blocking distinct reruns", async () => {
		const duplicate = { deliveryId: "delivery-check-run-rerequest" };
		const [first, second] = await Promise.all([
			dispatch("check_run", checkRunPayload(), duplicate),
			dispatch("check_run", checkRunPayload(), duplicate),
		]);
		await Promise.all([
			waitOnExecutionContext(first.ctx),
			waitOnExecutionContext(second.ctx),
		]);
		await deliver("check_run", checkRunPayload());

		expect(checks.create).not.toHaveBeenCalled();
		expect(sandbox.startProcess).toHaveBeenCalledTimes(2);
	});

	it("recovers after the contender wait and a later owner failure", async () => {
		const ownerStarted = deferred();
		const failOwner = deferred();
		checks.create.mockImplementationOnce(async () => {
			ownerStarted.resolve();
			await failOwner.promise;
			throw new Error("late owner failure");
		});
		const owner = await dispatch("pull_request", pullRequestPayload(), {
			deliveryId: "delivery-late-owner",
		});
		await ownerStarted.promise;
		const contender = await dispatch("check_suite", checkSuitePayload(), {
			deliveryId: "delivery-late-contender",
		});
		await new Promise((resolve) => setTimeout(resolve, 1_100));
		failOwner.resolve();
		await Promise.all([
			waitOnExecutionContext(owner.ctx),
			waitOnExecutionContext(contender.ctx),
		]);

		expect(checks.create).toHaveBeenCalledTimes(2);
		expect(sandbox.startProcess).toHaveBeenCalledOnce();
	});

	it("resumes a created run after abandonment before process launch", async () => {
		const setupStarted = deferred();
		const finishAbandonedSetup = deferred();
		sandbox.exec.mockImplementationOnce(async () => {
			setupStarted.resolve();
			await finishAbandonedSetup.promise;
			return { success: true, stdout: "", stderr: "" };
		});
		const owner = await dispatch("check_suite", checkSuitePayload(), {
			deliveryId: "delivery-created-owner",
		});
		await setupStarted.promise;
		const contender = await dispatch("pull_request", pullRequestPayload(), {
			deliveryId: "delivery-created-contender",
		});
		await env.DB.prepare(
			`UPDATE "ReviewClaim" SET "leaseUntil" = ? WHERE "deliveryId" = 'delivery-created-owner'`,
		)
			.bind(new Date(Date.now() - 1_000).toISOString())
			.run();
		await waitOnExecutionContext(contender.ctx);
		const recoveredProcesses = sandbox.startProcess.mock.calls.length;
		finishAbandonedSetup.resolve();
		await waitOnExecutionContext(owner.ctx);

		expect(recoveredProcesses).toBe(1);
		expect(checks.create).toHaveBeenCalledOnce();
		expect(sandbox.startProcess).toHaveBeenCalledOnce();
		expect(checks.update).toHaveBeenCalledWith(
			expect.objectContaining({ check_run_id: RUN_ID, status: "in_progress" }),
		);
	});

	it("isolates concurrent check-run attempts and fences stale updates", async () => {
		const firstProcessStarted = deferred();
		const finishFirstProcess = deferred();
		sandbox.startProcess
			.mockImplementationOnce(async () => {
				firstProcessStarted.resolve();
				await finishFirstProcess.promise;
				return { id: "old-process" };
			})
			.mockImplementationOnce(async () => ({ id: "new-process" }));
		const first = await dispatch("check_run", checkRunPayload(), {
			deliveryId: "delivery-old-attempt",
		});
		await firstProcessStarted.promise;
		const second = await dispatch("check_run", checkRunPayload(), {
			deliveryId: "delivery-new-attempt",
		});
		await waitOnExecutionContext(second.ctx);
		finishFirstProcess.resolve();
		await waitOnExecutionContext(first.ctx);

		const processCalls = sandbox.startProcess.mock.calls;
		expect(new Set(processCalls.map((call) => call[0])).size).toBe(2);
		expect(processCalls[0]?.[1].env.REVIEW_RESULT_PATH).not.toBe(
			processCalls[1]?.[1].env.REVIEW_RESULT_PATH,
		);
		expect(processCalls[0]?.[1].env.REVIEW_OUTPUT_PATH).not.toBe(
			processCalls[1]?.[1].env.REVIEW_OUTPUT_PATH,
		);
		const inProgressUpdates = checks.update.mock.calls
			.map((call) => call[0])
			.filter((update) => update.status === "in_progress");
		expect(inProgressUpdates).toHaveLength(1);
		expect(inProgressUpdates[0].output.summary).toContain(
			"process=new-process",
		);
		const oldAttemptId = processCalls[0]?.[1].env.REVIEW_ATTEMPT_ID;
		const newAttemptId = processCalls[1]?.[1].env.REVIEW_ATTEMPT_ID;
		const oldSecret = processCalls[0]?.[1].env.REVIEW_ATTEMPT_SECRET;
		const newSecret = processCalls[1]?.[1].env.REVIEW_ATTEMPT_SECRET;
		expect(oldSecret).toEqual(expect.any(String));
		expect(newSecret).toEqual(expect.any(String));
		const [oldFence, newFence] = await Promise.all([
			startWorkerRequest("/api/review-attempt", {
				method: "POST",
				headers: { authorization: `Bearer ${oldSecret}` },
				body: JSON.stringify({ checkRunId: RUN_ID, attemptId: oldAttemptId }),
			}),
			startWorkerRequest("/api/review-attempt", {
				method: "POST",
				headers: { authorization: `Bearer ${newSecret}` },
				body: JSON.stringify({ checkRunId: RUN_ID, attemptId: newAttemptId }),
			}),
		]);
		expect(oldFence.status).toBe(409);
		expect(newFence.status).toBe(204);
		const publicOutput = JSON.stringify({
			logCalls,
			updates: checks.update.mock.calls,
		});
		expect(publicOutput).not.toContain(oldSecret);
		expect(publicOutput).not.toContain(newSecret);
	});
});
