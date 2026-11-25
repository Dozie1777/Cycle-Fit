import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleDesignMcpHttpRequest } from "../../src/server/http/design-mcp";
import { createDesign, type TestDesign } from "../helpers/fixtures";
import { startJsonRequest, startWorkerRequest } from "../helpers/request";

type JsonRpcBody = {
	jsonrpc: string;
	id: string | number | null;
	result?: {
		protocolVersion?: string;
		serverInfo?: { name: string };
		tools?: { name: string }[];
		content?: { type: string; text: string }[];
		isError?: boolean;
	};
	error?: { code: number; message: string };
};

function mcpJson(token: string, message: unknown) {
	return startJsonRequest("/designs/mcp", "POST", message, {
		headers: { authorization: `Bearer ${token}` },
	});
}

async function readJson(response: Response) {
	return (await response.json()) as JsonRpcBody;
}

describe("direct design MCP HTTP transport", () => {
	it("streams the first SSE comment immediately and stays open until cancellation", async () => {
		const response = await startWorkerRequest("/designs/mcp");
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("text/event-stream");
		expect(response.headers.get("cache-control")).toBe("no-cache");
		const reader = response.body?.getReader();
		expect(reader).toBeDefined();
		if (!reader) return;

		const first = await reader.read();
		expect(first.done).toBe(false);
		expect(new TextDecoder().decode(first.value)).toBe(": connected\n\n");

		let secondSettled = false;
		const second = reader.read().then((chunk) => {
			secondSettled = true;
			return chunk;
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(secondSettled).toBe(false);
		await reader.cancel();
		expect((await second).done).toBe(true);
	});

	it("accepts public DELETE with an empty 200 response", async () => {
		const response = await startWorkerRequest("/designs/mcp", {
			method: "DELETE",
		});
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("");
	});

	it.each([
		"PUT",
		"PATCH",
		"OPTIONS",
	])("returns JSON 405 and Allow for %s", async (method) => {
		const response = await startWorkerRequest("/designs/mcp", { method });
		expect(response.status).toBe(405);
		expect(response.headers.get("allow")).toBe("GET, DELETE, POST");
		expect(response.headers.get("content-type")).toContain("application/json");
		expect(await response.json()).toEqual({ error: "method not allowed" });
	});

	describe("POST", () => {
		let project: TestDesign;

		beforeEach(async () => {
			project = await createDesign();
		});

		it.each([
			undefined,
			"wrong-token",
		])("rejects missing or wrong Bearer token %s before MCP dispatch", async (token) => {
			const response = await startWorkerRequest("/designs/mcp", {
				method: "POST",
				headers: token
					? {
							authorization: `Bearer ${token}`,
							"content-type": "application/json",
						}
					: { "content-type": "application/json" },
				body: "not json",
			});
			expect(response.status).toBe(401);
			expect(await response.json()).toEqual({ error: "unauthorized" });
		});

		it("returns a generic 500 without leaking the token when D1 fails", async () => {
			const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
			try {
				const response = await startWorkerRequest(
					"/designs/mcp",
					{
						method: "POST",
						headers: { authorization: `Bearer ${project.uploadToken}` },
						body: "{}",
					},
					{
						...env,
						DB: {
							prepare: () => {
								throw new Error("D1 unavailable");
							},
						} as unknown as D1Database,
					},
				);
				expect(response.status).toBe(500);
				expect(await response.text()).toBe("Internal Server Error");
				expect(errorLog).toHaveBeenCalled();
				expect(errorLog.mock.calls.flat().map(String).join(" ")).not.toContain(
					project.uploadToken,
				);
			} finally {
				errorLog.mockRestore();
			}
		});

		it("returns a generic 500 when MCP dispatch throws unexpectedly", async () => {
			const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
			try {
				const request = {
					method: "POST",
					headers: new Headers({
						authorization: `Bearer ${project.uploadToken}`,
					}),
					json: async () => ({
						get jsonrpc() {
							throw new Error("unexpected dispatch failure");
						},
					}),
				} as unknown as Request;
				const response = await handleDesignMcpHttpRequest(
					request,
					env,
					createExecutionContext(),
				);
				expect(response.status).toBe(500);
				expect(await response.text()).toBe("Internal Server Error");
				expect(errorLog).toHaveBeenCalledOnce();
				expect(errorLog.mock.calls.flat().map(String).join(" ")).not.toContain(
					project.uploadToken,
				);
			} finally {
				errorLog.mockRestore();
			}
		});

		it("returns the raw initialize JSON-RPC response", async () => {
			const response = await mcpJson(project.uploadToken, {
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					protocolVersion: "2025-06-18",
					capabilities: {},
					clientInfo: { name: "entry-test", version: "1" },
				},
			});
			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toContain(
				"application/json",
			);
			const body = await readJson(response);
			expect(body).toMatchObject({
				jsonrpc: "2.0",
				id: 1,
				result: {
					protocolVersion: "2025-06-18",
					serverInfo: { name: "design-uploads" },
				},
			});
		});

		it("returns the server protocol version for an unsupported client version", async () => {
			const response = await mcpJson(project.uploadToken, {
				jsonrpc: "2.0",
				id: "initialize-unsupported",
				method: "initialize",
				params: { protocolVersion: "1900-01-01" },
			});
			const body = await readJson(response);
			expect(body.result?.protocolVersion).toBe("2025-06-18");
		});

		it("responds to an explicit null id instead of treating it as a notification", async () => {
			const response = await mcpJson(project.uploadToken, {
				jsonrpc: "2.0",
				id: null,
				method: "ping",
			});
			expect(response.status).toBe(200);
			expect(await readJson(response)).toEqual({
				jsonrpc: "2.0",
				id: null,
				result: {},
			});
		});

		it.each([
			{ jsonrpc: "1.0", id: 1, method: "ping" },
			{ id: 1, method: "ping" },
			{ jsonrpc: "2.0", id: 1 },
			{ jsonrpc: "2.0", id: 1, method: 42 },
			{ jsonrpc: "2.0", id: true, method: "ping" },
			{ jsonrpc: "2.0", id: { nested: 1 }, method: "ping" },
		])("rejects an invalid JSON-RPC envelope %#", async (message) => {
			const response = await mcpJson(project.uploadToken, message);
			expect(response.status).toBe(200);
			expect(await readJson(response)).toEqual({
				jsonrpc: "2.0",
				id: null,
				error: { code: -32600, message: "Invalid Request" },
			});
		});

		it("answers ping", async () => {
			const response = await mcpJson(project.uploadToken, {
				jsonrpc: "2.0",
				id: "ping-1",
				method: "ping",
			});
			expect(await readJson(response)).toEqual({
				jsonrpc: "2.0",
				id: "ping-1",
				result: {},
			});
		});

		it("lists the upload tool with explicit projectId input", async () => {
			const response = await mcpJson(project.uploadToken, {
				jsonrpc: "2.0",
				id: 2,
				method: "tools/list",
			});
			const body = await readJson(response);
			expect(body.result?.tools).toHaveLength(1);
			expect(body.result?.tools?.[0]?.name).toBe("get_upload_url");
		});

		it("rejects an upload targeted at another project", async () => {
			const otherProject = await createDesign();
			const response = await mcpJson(project.uploadToken, {
				jsonrpc: "2.0",
				id: 3,
				method: "tools/call",
				params: {
					name: "get_upload_url",
					arguments: {
						projectId: otherProject.id,
						path: "assets/site.js",
					},
				},
			});
			const body = await readJson(response);
			expect(body.id).toBe(3);
			expect(body.result?.isError).toBe(true);
			expect(body.result?.content?.[0]?.text).toContain(
				"projectId does not match authenticated project",
			);
		});

		it("signs a safe key for the authenticated project", async () => {
			const response = await mcpJson(project.uploadToken, {
				jsonrpc: "2.0",
				id: 3,
				method: "tools/call",
				params: {
					name: "get_upload_url",
					arguments: {
						projectId: project.id,
						path: "assets/site.js",
					},
				},
			});
			const body = await readJson(response);
			expect(body.id).toBe(3);
			expect(body.result?.isError).toBe(false);
			const upload = JSON.parse(body.result?.content?.[0]?.text ?? "{}") as {
				url: string;
				key: string;
				expiresIn: number;
			};
			expect(upload.key).toBe(`designs/${project.id}/assets/site.js`);
			expect(upload.expiresIn).toBe(900);
			const url = new URL(upload.url);
			expect(url.pathname).toBe(
				`/working-dir-bucket/designs/${project.id}/assets/site.js`,
			);
			expect(url.origin).toBe(
				`https://${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
			);
			expect(url.searchParams.get("X-Amz-Signature")).toBeTruthy();
		});

		it("accepts notifications without a response body", async () => {
			const response = await mcpJson(project.uploadToken, {
				jsonrpc: "2.0",
				method: "notifications/initialized",
			});
			expect(response.status).toBe(202);
			expect(await response.text()).toBe("");
		});

		it("returns a JSON-RPC parse error after authentication", async () => {
			const response = await startWorkerRequest("/designs/mcp", {
				method: "POST",
				headers: {
					authorization: `Bearer ${project.uploadToken}`,
					"content-type": "application/json",
				},
				body: "not json",
			});
			expect(response.status).toBe(200);
			expect((await readJson(response)).error).toEqual({
				code: -32700,
				message: "Parse error",
			});
		});

		it("returns JSON-RPC errors for unknown methods and tools", async () => {
			const method = await mcpJson(project.uploadToken, {
				jsonrpc: "2.0",
				id: 4,
				method: "resources/list",
			});
			expect((await readJson(method)).error).toEqual({
				code: -32601,
				message: "Method not found: resources/list",
			});

			const tool = await mcpJson(project.uploadToken, {
				jsonrpc: "2.0",
				id: 5,
				method: "tools/call",
				params: { name: "not_a_tool", arguments: {} },
			});
			expect((await readJson(tool)).error).toEqual({
				code: -32602,
				message: "unknown tool: not_a_tool",
			});
		});
	});
});
