/**
 * MCP server for design agents — a deliberately minimal, dependency-free
 * implementation of the MCP streamable-HTTP transport (JSON-RPC over POST;
 * see https://modelcontextprotocol.io/specification/) exposing exactly one
 * tool: `get_upload_url`.
 *
 * Why hand-rolled: the surface for a single static tool is tiny (initialize /
 * tools/list / tools/call + notifications), and avoiding the official SDK
 * keeps the Worker bundle small and the runtime behavior obvious. Responses
 * are plain `application/json`, which the spec allows for non-streamed
 * replies; the companion GET handler in server/http/design-mcp.ts keeps an
 * idle SSE channel open for clients that expect one.
 *
 * Authentication happens in the route before this handler runs: the caller
 * must present the agent token (minted when its sandbox session started,
 * carried in the DESIGN_AGENT_TOKEN env var) as `Authorization: Bearer
 * <token>`. The tool retains an explicit projectId input for compatibility,
 * but it must match the authenticated project; uploads always land under
 * `designs/<authenticated projectId>/`.
 */

import {
	designsKey,
	isDesignId,
	parseRelPath,
} from "@/features/design-studio/assets/design-files";
import { createDesignUploadUrl } from "@/features/design-studio/assets/design-upload";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "design-uploads", version: "1.0.0" };

export const GET_UPLOAD_URL_TOOL = {
	name: "get_upload_url",
	description:
		"Get a presigned upload URL for one file of a design project. " +
		"Upload with: curl -X PUT --upload-file <path> <url>. " +
		"The URL expires in 15 minutes — request a fresh one whenever you " +
		"need to (re)upload a file.",
	inputSchema: {
		type: "object",
		properties: {
			projectId: {
				type: "string",
				description:
					"Design project id (lowercase uuid) the file belongs to — " +
					"files land under this project's prefix",
			},
			path: {
				type: "string",
				description:
					"File path relative to the design directory, e.g. index.html, " +
					"preview.png or assets/hero.png",
			},
		},
		required: ["projectId", "path"],
		additionalProperties: false,
	},
};

type JsonRpcMessage = {
	jsonrpc?: unknown;
	id?: unknown;
	method?: unknown;
	params?: Record<string, unknown>;
};

function jsonRpcResult(id: string | number | null, result: unknown): Response {
	return Response.json({ jsonrpc: "2.0", id, result });
}

function jsonRpcError(
	id: string | number | null,
	code: number,
	message: string,
): Response {
	return Response.json({ jsonrpc: "2.0", id, error: { code, message } });
}

/** MCP tool results carry errors as content with isError, not JSON-RPC errors. */
function toolError(message: string) {
	return {
		content: [
			{ type: "text" as const, text: JSON.stringify({ error: message }) },
		],
		isError: true,
	};
}

async function callTool(
	env: Env,
	agentProject: { id: string },
	id: string | number | null,
	name: string,
	args: unknown,
): Promise<Response> {
	if (name !== GET_UPLOAD_URL_TOOL.name) {
		return jsonRpcError(id, -32602, `unknown tool: ${name}`);
	}
	const projectId =
		typeof args === "object" && args !== null
			? (args as { projectId?: unknown }).projectId
			: undefined;
	const path =
		typeof args === "object" && args !== null
			? (args as { path?: unknown }).path
			: undefined;
	if (
		typeof projectId !== "string" ||
		projectId.length === 0 ||
		typeof path !== "string" ||
		path.length === 0 ||
		path.length > 200
	) {
		return jsonRpcResult(
			id,
			toolError(
				"invalid arguments: projectId (string) and path (string, 1-200 chars) are required",
			),
		);
	}
	if (!isDesignId(projectId)) {
		return jsonRpcResult(id, toolError(`invalid projectId: ${projectId}`));
	}
	if (projectId !== agentProject.id) {
		return jsonRpcResult(
			id,
			toolError("forbidden: projectId does not match authenticated project"),
		);
	}
	const rel = parseRelPath(path.split("/"));
	if (!rel) {
		return jsonRpcResult(
			id,
			toolError(
				`invalid file path: ${path} (no traversal, valid segments only)`,
			),
		);
	}
	let upload: Awaited<ReturnType<typeof createDesignUploadUrl>>;
	try {
		upload = await createDesignUploadUrl(env, designsKey(agentProject.id, rel));
	} catch (error) {
		return jsonRpcResult(
			id,
			toolError(
				`uploads unavailable: ${error instanceof Error ? error.message : String(error)}`,
			),
		);
	}
	return jsonRpcResult(id, {
		content: [
			{
				type: "text" as const,
				text: JSON.stringify({
					...upload,
					upload_command: `curl -X PUT --upload-file "${rel}" "${upload.url}"`,
				}),
			},
		],
		isError: false,
	});
}

/**
 * Dispatches one MCP request for the project authenticated by the route.
 */
export async function handleDesignMcpRequest(
	request: Request,
	env: Env,
	agentProject: { id: string },
): Promise<Response> {
	let message: JsonRpcMessage;
	try {
		message = (await request.json()) as JsonRpcMessage;
	} catch {
		return jsonRpcError(null, -32700, "Parse error");
	}
	if (
		typeof message !== "object" ||
		message === null ||
		Array.isArray(message)
	) {
		return jsonRpcError(null, -32600, "Invalid Request");
	}
	const { id, method, params } = message;
	if (
		message.jsonrpc !== "2.0" ||
		typeof method !== "string" ||
		(id !== undefined &&
			id !== null &&
			typeof id !== "string" &&
			typeof id !== "number")
	) {
		return jsonRpcError(null, -32600, "Invalid Request");
	}

	// Only a missing id is a notification; an explicit null id gets a response.
	if (id === undefined) {
		return new Response(null, { status: 202 });
	}

	switch (method) {
		case "initialize":
			return jsonRpcResult(id, {
				protocolVersion: PROTOCOL_VERSION,
				capabilities: { tools: { listChanged: false } },
				serverInfo: SERVER_INFO,
			});
		case "ping":
			return jsonRpcResult(id, {});
		case "tools/list":
			return jsonRpcResult(id, { tools: [GET_UPLOAD_URL_TOOL] });
		case "tools/call": {
			const name = typeof params?.name === "string" ? params.name : "";
			return callTool(env, agentProject, id, name, params?.arguments);
		}
		default:
			return jsonRpcError(id, -32601, `Method not found: ${String(method)}`);
	}
}

/**
 * Idle SSE channel for MCP clients that open a server-to-client stream via
 * GET. We never push server-initiated messages, so the stream just stays
 * open (and keeps the connection alive).
 */
export function designMcpEventStream(): Response {
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new TextEncoder().encode(": connected\n\n"));
		},
	});
	return new Response(stream, {
		headers: {
			"content-type": "text/event-stream",
			"cache-control": "no-cache",
		},
	});
}
