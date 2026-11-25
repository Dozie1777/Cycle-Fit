import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startWorkerRequest } from "../helpers/request";

const RUN_ID = 9012;
const OLD_ATTEMPT = "old-attempt";
const CURRENT_ATTEMPT = "current-attempt";
const OLD_SECRET = "old-secret-with-256-bits-of-test-entropy";
const CURRENT_SECRET = "current-secret-with-256-bits-of-test-entropy";

async function hashSecret(secret: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(secret),
	);
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

function checkRunSubmission(attemptId = CURRENT_ATTEMPT) {
	return {
		kind: "check-run",
		checkRunId: RUN_ID,
		attemptId,
		method: "PATCH",
		path: `repos/owner/repo/check-runs/${RUN_ID}`,
		payload: { status: "completed", conclusion: "success" },
	};
}

function annotationSubmission(attemptId = CURRENT_ATTEMPT) {
	return {
		...checkRunSubmission(attemptId),
		method: "POST",
		path: `repos/owner/repo/check-runs/${RUN_ID}/annotations`,
		payload: [{ path: "src/example.ts", message: "finding" }],
	};
}

function verdictSubmission(
	attemptId = CURRENT_ATTEMPT,
	event = "APPROVE",
	body?: string,
) {
	return {
		kind: "pr-review",
		checkRunId: RUN_ID,
		attemptId,
		owner: "owner",
		repo: "repo",
		prNumber: 42,
		event,
		...(body === undefined ? {} : { body }),
	};
}

async function post(
	path: string,
	body: unknown,
	secret?: string,
): Promise<Response> {
	return startWorkerRequest(path, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			...(secret ? { authorization: `Bearer ${secret}` } : {}),
		},
		body: JSON.stringify(body),
	});
}

beforeEach(async () => {
	for (const [attemptId, deliveryId, secret] of [
		[OLD_ATTEMPT, "old-delivery", OLD_SECRET],
		[CURRENT_ATTEMPT, "current-delivery", CURRENT_SECRET],
	]) {
		await env.DB.prepare(
			`INSERT INTO "ReviewDeliveryClaim"
				("id", "deliveryId", "checkRunId", "state", "processId", "secretHash", "leaseUntil")
			VALUES (?, ?, ?, 'started', 'process', ?, NULL)`,
		)
			.bind(attemptId, deliveryId, RUN_ID, await hashSecret(secret))
			.run();
	}
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => Response.json({ id: RUN_ID })),
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe("authenticated review attempt and submission routes", () => {
	it("rejects missing and invalid attempt credentials and accepts the current attempt", async () => {
		const body = { checkRunId: RUN_ID, attemptId: CURRENT_ATTEMPT };
		expect((await post("/api/review-attempt", body)).status).toBe(401);
		expect((await post("/api/review-attempt", body, OLD_ATTEMPT)).status).toBe(
			401,
		);
		expect(
			(await post("/api/review-attempt", body, CURRENT_SECRET)).status,
		).toBe(204);
		expect(
			(
				await post(
					"/api/review-attempt",
					{ checkRunId: RUN_ID, attemptId: OLD_ATTEMPT },
					OLD_SECRET,
				)
			).status,
		).toBe(409);
	});

	it("rejects stale completion, annotation, and verdict writes without calling GitHub", async () => {
		for (const body of [
			checkRunSubmission(OLD_ATTEMPT),
			annotationSubmission(OLD_ATTEMPT),
			verdictSubmission(OLD_ATTEMPT),
		]) {
			expect(
				(await post("/api/review-submission", body, OLD_SECRET)).status,
			).toBe(409);
		}
		expect(fetch).not.toHaveBeenCalled();
	});

	it("rejects an invalid submission credential without calling GitHub", async () => {
		const response = await post(
			"/api/review-submission",
			checkRunSubmission(),
			OLD_SECRET,
		);
		expect(response.status).toBe(401);
		expect(fetch).not.toHaveBeenCalled();
	});

	it("forwards current completion, annotation, and verdict submissions", async () => {
		for (const body of [
			checkRunSubmission(),
			annotationSubmission(),
			verdictSubmission(),
		]) {
			const response = await post(
				"/api/review-submission",
				body,
				CURRENT_SECRET,
			);
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ id: RUN_ID });
		}

		const calls = vi
			.mocked(fetch)
			.mock.calls.filter(([input]) =>
				String(input).startsWith("https://api.github.com/repos/"),
			);
		expect(calls).toHaveLength(3);
		expect(calls[0]?.[0]).toBe(
			`https://api.github.com/repos/owner/repo/check-runs/${RUN_ID}`,
		);
		expect(calls[0]?.[1]).toMatchObject({ method: "PATCH" });
		expect(calls[1]?.[0]).toBe(
			`https://api.github.com/repos/owner/repo/check-runs/${RUN_ID}/annotations`,
		);
		expect(calls[1]?.[1]).toMatchObject({ method: "POST" });
		expect(calls[2]?.[0]).toBe(
			"https://api.github.com/repos/owner/repo/pulls/42/reviews",
		);
		expect(calls[2]?.[1]).toMatchObject({ method: "POST" });
		expect(JSON.parse(String(calls[2]?.[1]?.body))).toEqual({
			event: "APPROVE",
		});
	});

	it("forwards every verdict event with its exact body", async () => {
		const verdicts = [
			{ event: "APPROVE", body: "approved exactly" },
			{ event: "REQUEST_CHANGES", body: 'needs "quotes" & $shell\nline two' },
			{ event: "COMMENT", body: "comment with `markdown` and 'quotes'" },
		];
		for (const verdict of verdicts) {
			const response = await post(
				"/api/review-submission",
				verdictSubmission(CURRENT_ATTEMPT, verdict.event, verdict.body),
				CURRENT_SECRET,
			);
			expect(response.status).toBe(200);
		}

		const calls = vi
			.mocked(fetch)
			.mock.calls.filter(([input]) =>
				String(input).includes("/pulls/42/reviews"),
			);
		expect(calls.map((call) => JSON.parse(String(call[1]?.body)))).toEqual(
			verdicts,
		);
	});
});
