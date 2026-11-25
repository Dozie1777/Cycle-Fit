import {
	createExecutionContext,
	waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleDesignMcpHttpRequest } from "../../src/server/http/design-mcp";
import { handleWebhookRequest } from "../../src/server/http/webhook";
import { TEST_ORIGIN } from "../helpers/request";

vi.mock("@cloudflare/playwright-mcp", () => ({
	createMcpAgent: vi.fn(() => ({ serve: vi.fn() })),
}));

let createWorkerFetch: typeof import("../../src/server").createWorkerFetch;
let handleBrowserMcpRequest: typeof import("../../src/server/http/browser-mcp").handleBrowserMcpRequest;
let PlaywrightMCP: typeof import("../../src/server/http/browser-mcp").PlaywrightMCP;
let mcpFetch: ReturnType<typeof vi.fn>;

beforeAll(async () => {
	vi.resetModules();
	({ createWorkerFetch } = await import("../../src/server"));
	({ handleBrowserMcpRequest, PlaywrightMCP } = await import(
		"../../src/server/http/browser-mcp"
	));
});

beforeEach(() => {
	mcpFetch = vi.fn();
	vi.mocked(PlaywrightMCP.serve).mockReset();
	vi.mocked(PlaywrightMCP.serve).mockReturnValue({ fetch: mcpFetch } as never);
});

describe("direct Browser MCP transport", () => {
	it.each([
		{ name: "missing", authorization: undefined },
		{ name: "wrong", authorization: "Bearer wrong" },
		{
			name: "equal-length wrong",
			authorization: `Bearer ${"x".repeat(env.BROWSER_MCP_TOKEN.length)}`,
		},
	])("rejects a $name Bearer token before MCP dispatch", async ({
		authorization,
	}) => {
		const request = new Request(new URL("/browser-mcp", TEST_ORIGIN), {
			method: "POST",
			headers: authorization ? { authorization } : undefined,
			body: "not json",
		});
		const response = await handleBrowserMcpRequest(
			request,
			env,
			createExecutionContext(),
		);

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ error: "unauthorized" });
		expect(PlaywrightMCP.serve).not.toHaveBeenCalled();
	});

	it("forwards the identical request, URL, body, environment, and context and returns the raw stream", async () => {
		const body = '{"jsonrpc":"2.0","message":"café"}\n';
		const request = new Request(
			new URL("/browser-mcp?transport=streamable", TEST_ORIGIN),
			{
				method: "POST",
				headers: { authorization: `Bearer ${env.BROWSER_MCP_TOKEN}` },
				body,
			},
		);
		const ctx = createExecutionContext();
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode(": connected\n\n"));
			},
		});
		const rawResponse = new Response(stream, {
			status: 200,
			headers: { "content-type": "text/event-stream" },
		});
		mcpFetch.mockImplementation(
			async (
				forwardedRequest: Request,
				forwardedEnv: Env,
				forwardedCtx: ExecutionContext,
			) => {
				expect(forwardedRequest).toBe(request);
				expect(forwardedRequest.url).toBe(request.url);
				expect(await forwardedRequest.text()).toBe(body);
				expect(forwardedEnv).toBe(env);
				expect(forwardedCtx).toBe(ctx);
				return rawResponse;
			},
		);

		const response = await handleBrowserMcpRequest(request, env, ctx);

		expect(response).toBe(rawResponse);
		expect(response.body).toBe(stream);
		expect(PlaywrightMCP.serve).toHaveBeenCalledOnce();
		expect(PlaywrightMCP.serve).toHaveBeenCalledWith("/browser-mcp");
		expect(mcpFetch).toHaveBeenCalledOnce();
		const reader = response.body?.getReader();
		expect(new TextDecoder().decode((await reader?.read())?.value)).toBe(
			": connected\n\n",
		);
		await reader?.cancel();
		await waitOnExecutionContext(ctx);
	});

	it("dispatches the exact path directly from the Worker entry without changing response identity", async () => {
		const rawResponse = new Response("mcp", { status: 202 });
		const directHandler = vi.fn(async () => rawResponse);
		const fetch = createWorkerFetch(
			handleDesignMcpHttpRequest,
			handleWebhookRequest,
			directHandler,
		);
		const request = new Request(new URL("/browser-mcp", TEST_ORIGIN), {
			method: "POST",
		});
		const ctx = createExecutionContext();

		const response = await fetch(request, env, ctx);

		expect(response).toBe(rawResponse);
		expect(directHandler).toHaveBeenCalledOnce();
		expect(directHandler).toHaveBeenCalledWith(request, env, ctx);
		await waitOnExecutionContext(ctx);
	});
});
