import { describe, expect, it } from "vitest";
import { newDesignId } from "@/features/design-studio/assets/design-files";
import {
	designMcpEventStream,
	GET_UPLOAD_URL_TOOL,
	handleDesignMcpRequest,
} from "./design-mcp";

const env = {
	S3_ACCESS_KEY_ID: "r2-access-key-id",
	S3_SECRET_ACCESS_KEY: "r2-secret-access-key",
	S3_BUCKET: "designs-bucket",
	CLOUDFLARE_ACCOUNT_ID: "c45688b6c27db47659026bb3d520cad3",
} as unknown as Env;

function rpc(message: Record<string, unknown>): Request {
	return new Request("https://worker/designs/mcp", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(message),
	});
}

async function readJson(response: Response) {
	return (await response.json()) as {
		jsonrpc: string;
		id: number | string | null;
		result?: {
			protocolVersion?: string;
			serverInfo?: { name: string };
			tools?: { name: string }[];
			content?: { type: string; text: string }[];
			isError?: boolean;
		};
		error?: { code: number; message: string };
	};
}

describe("handleDesignMcpRequest", () => {
	const projectId = newDesignId();

	function dispatch(request: Request, requestEnv: Env) {
		return handleDesignMcpRequest(request, requestEnv, { id: projectId });
	}

	it("answers initialize with negotiated protocol version", async () => {
		const response = await dispatch(
			rpc({
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					protocolVersion: "2025-06-18",
					capabilities: {},
					clientInfo: { name: "opencode", version: "1" },
				},
			}),
			env,
		);
		expect(response.status).toBe(200);
		const body = await readJson(response);
		expect(body.id).toBe(1);
		expect(body.result?.protocolVersion).toBe("2025-06-18");
		expect(body.result?.serverInfo?.name).toBe("design-uploads");
	});

	it("treats notifications as accepted-without-body", async () => {
		const response = await dispatch(
			rpc({ jsonrpc: "2.0", method: "notifications/initialized" }),
			env,
		);
		expect(response.status).toBe(202);
		expect(await response.text()).toBe("");
	});

	it("lists exactly the get_upload_url tool with projectId input", async () => {
		const response = await dispatch(
			rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
			env,
		);
		const body = await readJson(response);
		expect(body.result?.tools?.map((t) => t.name)).toEqual([
			GET_UPLOAD_URL_TOOL.name,
		]);
		expect(GET_UPLOAD_URL_TOOL.inputSchema.required).toEqual([
			"projectId",
			"path",
		]);
	});

	it("mints an upload URL for the authenticated projectId", async () => {
		const target = projectId;
		const response = await dispatch(
			rpc({
				jsonrpc: "2.0",
				id: 3,
				method: "tools/call",
				params: {
					name: "get_upload_url",
					arguments: { projectId: target, path: "index.html" },
				},
			}),
			env,
		);
		const body = await readJson(response);
		// JSON-RPC: responses must echo the request id so clients can match.
		expect(body.id).toBe(3);
		expect(body.result?.isError).toBe(false);
		const payload = JSON.parse(body.result?.content?.[0]?.text ?? "{}") as {
			url: string;
			key: string;
			expiresIn: number;
			upload_command: string;
		};
		expect(payload.key).toBe(`designs/${target}/index.html`);
		expect(payload.url).toContain("X-Amz-Signature=");
		expect(payload.expiresIn).toBe(900);
		expect(payload.upload_command).toContain("curl -X PUT --upload-file");
	});

	it("rejects invalid project ids as tool errors", async () => {
		const response = await dispatch(
			rpc({
				jsonrpc: "2.0",
				id: 4,
				method: "tools/call",
				params: {
					name: "get_upload_url",
					arguments: { projectId: "not-a-uuid", path: "index.html" },
				},
			}),
			env,
		);
		const body = await readJson(response);
		expect(body.error).toBeUndefined();
		expect(body.result?.isError).toBe(true);
		expect(body.result?.content?.[0]?.text).toContain("invalid projectId");
	});

	it("rejects traversal paths as tool errors, not JSON-RPC errors", async () => {
		const response = await dispatch(
			rpc({
				jsonrpc: "2.0",
				id: 5,
				method: "tools/call",
				params: {
					name: "get_upload_url",
					arguments: { projectId, path: "../etc/passwd" },
				},
			}),
			env,
		);
		const body = await readJson(response);
		expect(body.error).toBeUndefined();
		expect(body.result?.isError).toBe(true);
	});

	it("reports unavailable uploads as tool errors when S3 creds are missing", async () => {
		const response = await dispatch(
			rpc({
				jsonrpc: "2.0",
				id: 6,
				method: "tools/call",
				params: {
					name: "get_upload_url",
					arguments: { projectId, path: "a.html" },
				},
			}),
			{ ...env, S3_ACCESS_KEY_ID: "" } as unknown as Env,
		);
		const body = await readJson(response);
		expect(body.result?.isError).toBe(true);
		expect(body.result?.content?.[0]?.text).toContain("S3_ACCESS_KEY_ID");
	});

	it("returns JSON-RPC errors for unknown methods and bad JSON", async () => {
		const unknown = await dispatch(
			rpc({ jsonrpc: "2.0", id: 7, method: "resources/list" }),
			env,
		);
		expect((await readJson(unknown)).error?.code).toBe(-32601);

		const bad = await dispatch(
			new Request("https://worker/designs/mcp", {
				method: "POST",
				body: "not json",
			}),
			env,
		);
		expect((await readJson(bad)).error?.code).toBe(-32700);
	});
});

describe("designMcpEventStream", () => {
	it("opens an SSE stream", async () => {
		const response = designMcpEventStream();
		expect(response.headers.get("content-type")).toBe("text/event-stream");
		const reader = response.body?.getReader();
		const first = await reader?.read();
		expect(new TextDecoder().decode(first?.value)).toContain("connected");
		reader?.cancel();
	});
});
