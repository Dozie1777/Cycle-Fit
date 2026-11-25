import { env as workerEnv } from "cloudflare:workers";
import { createMcpAgent } from "@cloudflare/playwright-mcp";

export const PlaywrightMCP = createMcpAgent(workerEnv.BROWSER);

async function tokensMatch(provided: string, expected: string) {
	if (provided.length !== expected.length) return false;
	const encoder = new TextEncoder();
	const [a, b] = await Promise.all([
		crypto.subtle.digest("SHA-256", encoder.encode(provided)),
		crypto.subtle.digest("SHA-256", encoder.encode(expected)),
	]);
	const av = new Uint8Array(a);
	const bv = new Uint8Array(b);
	let diff = 0;
	for (let i = 0; i < av.length; i++) diff |= av[i] ^ bv[i];
	return diff === 0;
}

export async function handleBrowserMcpRequest(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response> {
	const expected = env.BROWSER_MCP_TOKEN;
	const authorization = request.headers.get("authorization") ?? "";
	const provided = authorization.startsWith("Bearer ")
		? authorization.slice("Bearer ".length)
		: "";
	if (!expected || !(await tokensMatch(provided, expected))) {
		return Response.json({ error: "unauthorized" }, { status: 401 });
	}

	const handler = PlaywrightMCP.serve("/browser-mcp");
	return handler.fetch(
		request,
		env,
		ctx as unknown as Parameters<typeof handler.fetch>[2],
	);
}
