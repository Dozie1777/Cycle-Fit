import {
	designMcpEventStream,
	handleDesignMcpRequest,
} from "@/features/design-studio/mcp/design-mcp";
import { getPrisma } from "../../lib/db";

export async function handleDesignMcpHttpRequest(
	request: Request,
	env: Env,
	_ctx: ExecutionContext,
): Promise<Response> {
	if (request.method === "GET") return designMcpEventStream();
	if (request.method === "DELETE") return new Response(null, { status: 200 });
	if (request.method !== "POST") {
		return Response.json(
			{ error: "method not allowed" },
			{ status: 405, headers: { allow: "GET, DELETE, POST" } },
		);
	}

	try {
		const authorization = request.headers.get("authorization") ?? "";
		const token = authorization.startsWith("Bearer ")
			? authorization.slice(7)
			: "";
		const agentProject = token
			? await getPrisma(env).design.findFirst({
					where: { uploadToken: token },
				})
			: null;
		if (!agentProject) {
			return Response.json({ error: "unauthorized" }, { status: 401 });
		}
		return await handleDesignMcpRequest(request, env, agentProject);
	} catch (error) {
		console.error(error);
		return new Response("Internal Server Error", { status: 500 });
	}
}
