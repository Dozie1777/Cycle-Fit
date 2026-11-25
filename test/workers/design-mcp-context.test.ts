import {
	createExecutionContext,
	waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { createWorkerFetch } from "../../src/server";
import { handleDesignMcpHttpRequest } from "../../src/server/http/design-mcp";
import { TEST_ORIGIN } from "../helpers/request";

describe("direct design MCP execution context", () => {
	it("forwards the same context from the Worker entry to the direct handler", async () => {
		const directHandler = vi.fn(handleDesignMcpHttpRequest);
		const fetch = createWorkerFetch(directHandler);
		const request = new Request(new URL("/designs/mcp", TEST_ORIGIN), {
			method: "DELETE",
		});
		const ctx = createExecutionContext();
		const response = await fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		expect(directHandler).toHaveBeenCalledOnce();
		expect(directHandler.mock.calls[0]?.[0]).toBe(request);
		expect(directHandler.mock.calls[0]?.[1]).toBe(env);
		expect(directHandler.mock.calls[0]?.[2]).toBe(ctx);
	});
});
