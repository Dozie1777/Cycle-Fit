import { env } from "cloudflare:workers";
import { createInlineClient } from "@rivetkit/cloudflare-workers";
import { describe, expect, it } from "vitest";
import { registry } from "../../src/server/rivet/registry";

// End-to-end ping actor check against the real ActorHandler Durable Object.
// The inline client's manager driver dispatches through the ACTOR_DO binding
// (env.ACTOR_DO stubs), so this exercises the same DO that src/server.ts
// exports — actor creation, state persistence in the DO, and action calls.
describe("RivetKit ping actor", () => {
	it("answers pings and persists its pong counter in the Durable Object", async () => {
		expect(env.ACTOR_DO).toBeDefined();
		expect(env.ACTOR_KV).toBeDefined();

		const { client } = createInlineClient(registry);
		const ping = client.ping.getOrCreate(["vitest-ping"]);

		const first = await ping.ping();
		const second = await ping.ping();

		expect(first.at).toBeTypeOf("number");
		expect(second.pongs).toBe(first.pongs + 1);
	});

	it("answers raw WebSocket pings through onWebSocket", async () => {
		const { client } = createInlineClient(registry);
		const ping = client.ping.getOrCreate(["vitest-ping-ws"]);

		const ws = await ping.webSocket("/");
		const messages: string[] = [];
		ws.addEventListener("message", (event: MessageEvent) => {
			messages.push(String(event.data));
		});

		ws.addEventListener("open", () => {
			ws.send("ping");
		});

		// The server's "ready" frame races the client listener attaching, so
		// wait specifically for the pong rather than asserting on order.
		for (let i = 0; i < 50; i += 1) {
			if (messages.some((m) => m.includes('"type":"pong"'))) break;
			await new Promise((resolve) => setTimeout(resolve, 100));
		}

		const pong = messages
			.map((m) => JSON.parse(m) as { type: string; pongs: number })
			.find((m) => m.type === "pong");

		expect(pong).toEqual({
			type: "pong",
			at: expect.any(Number),
			pongs: expect.any(Number),
		});
		ws.close();
	});
});
