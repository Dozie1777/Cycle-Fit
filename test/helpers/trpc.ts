// Typed tRPC client for the workerd integration tests. Calls go through
// the REAL HTTP path — the batch protocol hits the /api/trpc Start route
// inside the test worker, so auth middleware, context wiring and the
// fetch adapter are all exercised exactly as in production.
import { createTRPCClient, httpBatchLink, TRPCClientError } from "@trpc/client";
import type { AppRouter } from "../../src/server/trpc/app-router";
import { startWorkerRequest, TEST_ORIGIN } from "./request";

export type TrpcTestClient = ReturnType<typeof createTrpcTestClient>;

/**
 * A typed client over the test worker. `headers` (e.g. the admin session
 * cookie from createAdminSession) ride along on every batch request; an
 * optional `requestEnv` overrides the worker env for that client (the old
 * HTTP tests' per-request env override).
 */
export function createTrpcTestClient(
	headers: HeadersInit = {},
	requestEnv?: Env,
) {
	return createTRPCClient<AppRouter>({
		links: [
			httpBatchLink({
				url: `${TEST_ORIGIN}/api/trpc`,
				headers: () => headers,
				// Dispatch the batched request through the same worker the
				// HTTP tests drive (startWorkerRequest → src/server.ts).
				fetch: (input, init) =>
					startWorkerRequest(
						input instanceof Request ? input.url : String(input),
						init ?? { method: "POST" },
						requestEnv,
					),
			}),
		],
	});
}

/** The tRPC error code ("NOT_FOUND", "FORBIDDEN", …) of a failed call. */
export async function trpcErrorCode(call: () => Promise<unknown>) {
	try {
		await call();
		return null;
	} catch (error) {
		if (error instanceof TRPCClientError) {
			return (error.data as { code?: string } | undefined)?.code ?? "UNKNOWN";
		}
		return "UNKNOWN";
	}
}

/** The error message of a failed tRPC call (mirrors the old jfetch). */
export async function trpcErrorMessage(call: () => Promise<unknown>) {
	try {
		await call();
		return null;
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
}
