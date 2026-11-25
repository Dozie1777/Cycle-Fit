import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { PlaywrightMCP } from "../../src/server/http/browser-mcp";

type TestTransport = {
	start: () => Promise<void>;
	send: () => void;
	close: () => void;
};
type AgentInstance = {
	server: Promise<{
		connect: (transport: TestTransport) => Promise<void>;
		close: () => Promise<void>;
	}>;
};

const AgentClass = PlaywrightMCP as unknown as new (
	...args: unknown[]
) => AgentInstance;

describe("Browser MCP transport lifecycle", () => {
	it("gives each Durable Object session an independent MCP server", async () => {
		const stub = env.MCP_OBJECT.get(env.MCP_OBJECT.newUniqueId());
		const [first, second] = await runInDurableObject(
			stub,
			async (_instance, state) => [
				new AgentClass(state, env),
				new AgentClass(state, env),
			],
		);

		const [firstServer, secondServer] = await Promise.all([
			first.server,
			second.server,
		]);
		expect(firstServer).not.toBe(secondServer);
		const firstTransport = {
			start: vi.fn(async () => {}),
			send: vi.fn(),
			close: vi.fn(),
		};
		const secondTransport = {
			start: vi.fn(async () => {}),
			send: vi.fn(),
			close: vi.fn(),
		};
		await firstServer.connect(firstTransport);
		await secondServer.connect(secondTransport);
		expect(firstTransport.start).toHaveBeenCalledOnce();
		expect(secondTransport.start).toHaveBeenCalledOnce();
		await firstServer.close();
		await secondServer.close();
	});
});
