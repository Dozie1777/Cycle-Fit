import { ContainerProxy, Sandbox } from "@cloudflare/sandbox";
import { createHandler } from "@rivetkit/cloudflare-workers";
import handler from "@tanstack/react-start/server-entry";
import { getAuth } from "./lib/auth";
import { serveComponentBundle } from "./server/data/component-bundles";
import {
	handleBrowserMcpRequest,
	PlaywrightMCP,
} from "./server/http/browser-mcp";
import { handleDesignMcpHttpRequest } from "./server/http/design-mcp";
import { apiNotFoundResponse } from "./server/http/not-found";
import { handleTerminalRequest } from "./server/http/terminal";
import { handleWebhookRequest } from "./server/http/webhook";
import { resolveAdminSession } from "./server/middleware";
import { registry } from "./server/rivet/registry";
import { handleScheduled } from "./server/scheduled";
import "./server/request-context";
import { runWithWorkerEnv } from "./server/worker-env";

// RivetKit actors: /rivet/* (manager gateway + WebSocket upgrades) is served
// by the registry, everything else falls through to TanStack Start. The
// `ActorHandler` Durable Object must stay exported — wrangler binds it as
// ACTOR_DO (see wrangler.jsonc).
const { handler: rivetHandler, ActorHandler } = createHandler(registry, {
	managerPath: "/rivet",
});

// ExportedHandler types fetch as optional and wraps the request in wrangler's
// IncomingRequestCfProperties variance; narrow it to the plain Workers
// signature the other handlers below use.
const rivetFetch = rivetHandler.fetch as (
	request: Request,
	env: Env,
	ctx: ExecutionContext,
) => Promise<Response>;

export { ActorHandler, ContainerProxy, PlaywrightMCP, Sandbox };

const API_NAMESPACE_PREFIXES = [
	"/api/",
	"/designs/",
	"/github-token/",
	"/process-logs/",
	"/projects/",
	"/browser-mcp/",
	"/campaigns/",
	"/terminal/",
] as const;

export function createWorkerFetch(
	designMcpHandler: typeof handleDesignMcpHttpRequest = handleDesignMcpHttpRequest,
	webhookHandler: typeof handleWebhookRequest = handleWebhookRequest,
	browserMcpHandler: typeof handleBrowserMcpRequest = handleBrowserMcpRequest,
	terminalHandler: typeof handleTerminalRequest = handleTerminalRequest,
) {
	return async (
		request: Request,
		env: Env,
		ctx: ExecutionContext,
	): Promise<Response> => {
		const { pathname } = new URL(request.url);
		if (pathname === "/rivet" || pathname.startsWith("/rivet/")) {
			// The actor gateway is not public: every request needs a Better Auth
			// session (cookies ride along on fetches and WebSocket upgrades, see
			// the @rivetkit/cloudflare-workers patch). In-worker system callers
			// bypass HTTP entirely via createInlineClient → ACTOR_DO.
			const session = await getAuth(env).api.getSession({
				headers: request.headers,
			});
			if (!session) {
				return Response.json({ error: "unauthorized" }, { status: 401 });
			}
			return rivetFetch(request, env, ctx);
		}
		if (pathname === "/api/webhook" && request.method === "POST") {
			return webhookHandler(request, env, ctx);
		}
		if (pathname === "/designs/mcp") {
			return designMcpHandler(request, env, ctx);
		}
		if (pathname === "/browser-mcp") {
			return browserMcpHandler(request, env, ctx);
		}
		if (pathname === "/terminal") {
			if (request.method !== "GET") {
				return new Response(null, {
					status: 405,
					headers: { Allow: "GET" },
				});
			}
			// The worker intercept bypasses the /_authenticated layout, so the
			// session gate must happen here — this WebSocket is a root shell
			// into the review sandbox (pre-seeded with GH_TOKEN / KIMI keys).
			const gate = await resolveAdminSession(request, env);
			if ("error" in gate) return gate.error;
			return terminalHandler(request, env, ctx);
		}
		// Published component bundles (GET only): public site artifacts under
		// the same CSP-sandboxed pipeline as design site files. Served by the
		// worker intercept rather than a Start route so the /projects/:id
		// page route can own the /projects/:id URL prefix without the file
		// route colliding with it (the handler gates on the version's publish
		// state, not a session).
		if (request.method === "GET") {
			const bundle = /^\/projects\/([^/]+)\/components\/([^/]+)\/(.+)$/.exec(
				pathname,
			);
			if (bundle) {
				try {
					return serveComponentBundle({
						env,
						projectId: decodeURIComponent(bundle[1]),
						componentId: decodeURIComponent(bundle[2]),
						file: decodeURIComponent(bundle[3]),
					});
				} catch {
					// Malformed percent-encoding → fall through to the router 404.
				}
			}
		}
		const response = await runWithWorkerEnv(env, () =>
			handler.fetch(request, {
				context: { env, executionCtx: ctx },
			}),
		);
		if (
			response.status === 404 &&
			response.headers.get("content-type")?.includes("text/html") &&
			API_NAMESPACE_PREFIXES.some((prefix) => pathname.startsWith(prefix))
		) {
			return apiNotFoundResponse();
		}
		return response;
	};
}

export default {
	fetch: createWorkerFetch(),
	scheduled: handleScheduled,
};
