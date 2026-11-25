import { SELF } from "cloudflare:test";
import { ContainerProxy, Sandbox } from "@cloudflare/sandbox";
import { describe, expect, it } from "vitest";
import worker, {
	ActorHandler,
	PlaywrightMCP,
	ContainerProxy as WorkerContainerProxy,
	Sandbox as WorkerSandbox,
} from "../../src/server";
import wranglerConfig from "../../wrangler.jsonc?raw";
import { createApiSession } from "../helpers/auth";

describe("TanStack Start worker entry", () => {
	it("preserves the Durable Object exports without adding event handlers", () => {
		expect(worker).toEqual({ fetch: expect.any(Function) });
		expect(worker).not.toHaveProperty("queue");
		expect(worker).not.toHaveProperty("scheduled");
		expect(WorkerContainerProxy).toBe(ContainerProxy);
		expect(WorkerSandbox).toBe(Sandbox);
		expect(PlaywrightMCP).toBeDefined();
		expect(PlaywrightMCP.serve).toBeTypeOf("function");
		// RivetKit actor driver: the ActorHandler DO class from
		// createHandler(registry) in src/server.ts.
		expect(ActorHandler).toBeTypeOf("function");
	});

	it("redirects the root to login for anonymous visitors", async () => {
		const response = await SELF.fetch("https://code-review-bot.test/", {
			redirect: "manual",
		});

		expect(response.status, await response.text()).toBe(307);
		expect(
			new URL(
				response.headers.get("location") ?? "",
				"https://code-review-bot.test",
			).pathname,
		).toBe("/login");
	});

	it("serves the RivetKit manager at /rivet for authenticated sessions only", async () => {
		const session = await createApiSession();

		const anonymous = await SELF.fetch("https://code-review-bot.test/rivet");
		expect(anonymous.status, await anonymous.text()).toBe(401);

		const response = await SELF.fetch("https://code-review-bot.test/rivet", {
			headers: { cookie: session.cookie },
		});
		const body = await response.text();

		expect(response.status, body).toBe(200);
		expect(body).toContain("This is a RivetKit server.");
	}, 60_000);

	it("keeps the Worker entry and Durable Object migrations in Wrangler", () => {
		expect(wranglerConfig).toMatch(/"main":\s*"src\/server\.ts"/);
		expect(wranglerConfig).toMatch(
			/"new_sqlite_classes":\s*\["Sandbox"\][\s\S]*?"tag":\s*"v1"/,
		);
		expect(wranglerConfig).toMatch(
			/"new_sqlite_classes":\s*\["PlaywrightMCP"\][\s\S]*?"tag":\s*"v2"/,
		);
		expect(wranglerConfig).toMatch(
			/"new_sqlite_classes":\s*\["ActorHandler"\][\s\S]*?"tag":\s*"v3"/,
		);
		expect(wranglerConfig).toMatch(/"binding":\s*"ACTOR_KV"/);
		expect(wranglerConfig).toMatch(/"class_name":\s*"ActorHandler"/);
		expect(wranglerConfig).not.toContain("./admin-ui/dist");
	});
});
