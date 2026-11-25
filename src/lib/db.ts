import "@tanstack/react-start/server-only";
import { PrismaD1 } from "@prisma/adapter-d1";
import { PrismaClient } from "../generated/prisma/client";

/**
 * One PrismaClient per request against the D1 binding via the driver
 * adapter — Prisma never opens its own connection. Clients are cheap to
 * construct; do not share them across requests.
 *
 * `env` must be the request-scoped env: tests (and future preview flows)
 * override bindings per request through the TanStack Start context, and the
 * static `cloudflare:workers` module env cannot observe those overrides.
 */
export function getPrisma(env: Env) {
	return new PrismaClient({
		adapter: new PrismaD1(env.DB),
	});
}
