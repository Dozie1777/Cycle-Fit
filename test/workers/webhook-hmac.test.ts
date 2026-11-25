import {
	createExecutionContext,
	waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { createGitHubApp, getEnvIdentity } from "@/features/review/github";
import { createWebhookApp } from "../../src/server/webhooks";
import { TEST_ORIGIN } from "../helpers/request";

vi.mock("../../src/server/webhooks", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../src/server/webhooks")>()),
	createWebhookApp: vi.fn(),
}));

const opened = vi.fn(
	async (_event: { payload: Record<string, unknown> }) => {},
);

beforeAll(async () => {
	vi.resetModules();
	await import("../../src/server");
});

beforeEach(() => {
	vi.mocked(createWebhookApp).mockImplementation((workerEnv) => {
		const app = createGitHubApp(
			getEnvIdentity(workerEnv),
			workerEnv.WEBHOOK_SECRET,
		);
		app.webhooks.on("pull_request.opened", opened);
		return app;
	});
	vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
	vi.clearAllMocks();
	vi.restoreAllMocks();
});

async function sign(body: string): Promise<string> {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(env.WEBHOOK_SECRET),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
	return `sha256=${[...new Uint8Array(signature)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("")}`;
}

async function deliver(body: string, signature: string) {
	const ctx = createExecutionContext();
	const response = await (await import("../../src/server")).default.fetch(
		new Request(new URL("/api/webhook", TEST_ORIGIN), {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-github-delivery": "signed-delivery",
				"x-github-event": "pull_request",
				"x-hub-signature-256": signature,
			},
			body,
		}),
		env,
		ctx,
	);
	const acknowledgement = await response.text();
	await waitOnExecutionContext(ctx);
	return { response, acknowledgement };
}

describe("real Octokit webhook HMAC", () => {
	it("dispatches a valid SHA-256 signature over the exact raw bytes", async () => {
		const body = '{\n  "action": "opened", "message": "café"\n}\n';

		const { response, acknowledgement } = await deliver(body, await sign(body));

		expect(response.status).toBe(200);
		expect(acknowledgement).toBe("ok");
		expect(opened).toHaveBeenCalledOnce();
		expect(opened.mock.calls[0]?.[0].payload).toMatchObject({
			action: "opened",
			message: "café",
		});
	});

	it("never dispatches an altered body or signature", async () => {
		const body = JSON.stringify({ action: "opened" });
		const validSignature = await sign(body);

		for (const delivery of [
			{ body: `${body}\n`, signature: validSignature },
			{ body, signature: await sign(`${body}\n`) },
		]) {
			const { response, acknowledgement } = await deliver(
				delivery.body,
				delivery.signature,
			);
			expect(response.status).toBe(200);
			expect(acknowledgement).toBe("ok");
		}

		expect(opened).not.toHaveBeenCalled();
	});
});
