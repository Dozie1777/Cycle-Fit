import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@/server/trpc/app-router";

/**
 * Typed tRPC client (batched HTTP over the same origin — the admin session
 * cookie rides along automatically, no credentials/token handling here).
 *
 * Used through src/queries.ts hooks: `trpc.<router>.<proc>.query(input)` /
 * `.mutate(input)` are fully typed end-to-end against AppRouter, and the
 * hooks keep their TanStack Query keys/invalidation scheme on top.
 */
export const trpc = createTRPCClient<AppRouter>({
	links: [httpBatchLink({ url: "/api/trpc" })],
});

/**
 * Maps a server type to its JSON wire shape. Prisma rows carry `Date`
 * fields; over the wire (JSON) those arrive as ISO strings — exactly what
 * the previous fetch layer produced. Conditional types distribute over
 * unions, so `Date | null` becomes `string | null`, and the recursion
 * covers nested objects and arrays.
 */
export type Wire<T> = T extends Date
	? string
	: T extends object
		? { [K in keyof T]: Wire<T[K]> }
		: T;

/**
 * Types a tRPC call by its JSON wire shape. The server serializes Prisma
 * rows to JSON exactly like the previous fetch layer did; this pins the
 * inference at the one place where the HTTP boundary is crossed.
 */
export function asJson<T>(call: Promise<T>): Promise<Wire<T>> {
	return call as Promise<Wire<T>>;
}

/** True when a tRPC failure is the NOT_FOUND code (e.g. brand-kit 404s are
 * the client's empty state, not an error). */
export function isTrpcNotFound(error: unknown): boolean {
	const code =
		error instanceof Error &&
		"data" in error &&
		typeof error.data === "object" &&
		error.data !== null
			? (error.data as { code?: unknown }).code
			: undefined;
	return code === "NOT_FOUND";
}
