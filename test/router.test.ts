import { describe, expect, it, vi } from "vitest";
import { getRouter } from "../src/router";

// The router transitively imports lib/auth (via the /api/auth route), which
// reads the worker runtime `env` — unavailable in the plain-Node unit project.
vi.mock("cloudflare:workers", () => ({
	env: { DB: {}, BETTER_AUTH_SECRET: "secret", ENVIRONMENT: "test" },
}));

vi.mock("../src/server/admin-session", () => ({
	getAdminSession: vi.fn(),
}));

vi.mock("../src/server/http/browser-mcp", () => ({
	handleBrowserMcpRequest: vi.fn(),
	PlaywrightMCP: class {},
}));

vi.mock("@cloudflare/playwright", () => ({ launch: vi.fn() }));
vi.mock("@cloudflare/sandbox", () => ({
	ContainerProxy: class {},
	Sandbox: class {},
	getSandbox: vi.fn(),
}));

describe("router request query clients", () => {
	it("does not share seeded query cache between router requests", () => {
		const first = getRouter();
		const second = getRouter();
		const firstClient = first.options.context.queryClient;
		const secondClient = second.options.context.queryClient;

		expect(firstClient).not.toBe(secondClient);
		firstClient.setQueryData(["design", "request-private"], {
			title: "request-private-title",
		});

		expect(firstClient.getQueryData(["design", "request-private"])).toEqual({
			title: "request-private-title",
		});
		expect(
			secondClient.getQueryData(["design", "request-private"]),
		).toBeUndefined();
	});
});
