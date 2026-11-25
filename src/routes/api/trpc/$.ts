import { createFileRoute } from "@tanstack/react-router";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "../../../server/trpc/app-router";
import { createTRPCContext } from "../../../server/trpc/trpc";

/**
 * The tRPC endpoint (batched HTTP). Everything the admin UI reads/writes as
 * JSON flows through here; plain-HTTP surfaces (webhook, chat streams, R2
 * file serving, MCP/WebSocket transports) stay as Start routes or
 * worker-entry handlers.
 */
function handle({
	request,
	context,
}: {
	request: Request;
	context: { env: Env; executionCtx: ExecutionContext };
}) {
	return fetchRequestHandler({
		endpoint: "/api/trpc",
		req: request,
		router: appRouter,
		createContext: () =>
			createTRPCContext(request, context.env, context.executionCtx),
	});
}

export const Route = createFileRoute("/api/trpc/$")({
	server: {
		handlers: {
			GET: handle,
			POST: handle,
		},
	},
});
