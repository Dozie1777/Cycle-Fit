import "@tanstack/react-start/server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { admin } from "better-auth/plugins";
import type { PrismaClient } from "../generated/prisma/client";
import { getPrisma } from "./db";

/**
 * Better Auth instance for the agent-management surface.
 *
 * Humans sign in (email + password, admin plugin) to manage agents. Agents are
 * `user` rows with role `agent` and no login capability — never create
 * credentials (password/account rows) for them.
 *
 * The PrismaClient is NOT built here — it is passed in by the caller
 * (getAuth below uses getPrisma, the same construction path the rest of the
 * app uses: handlers, tRPC, actors). One client per request; never share one
 * across requests on Workers.
 *
 * `agent` is a custom, non-admin role (the admin plugin only grants admin
 * powers for `adminRoles`, which stays the default `["admin"]`).
 */
declare module "better-auth" {
	interface UserWithRole {
		role: "user" | "admin" | "agent";
	}
}

export function createAuth(db: PrismaClient, env: Env) {
	if (!env.BETTER_AUTH_SECRET) {
		throw new Error(
			"BETTER_AUTH_SECRET is not set — auth cannot be initialized",
		);
	}

	return betterAuth({
		secret: env.BETTER_AUTH_SECRET,
		baseURL:
			env.BETTER_AUTH_URL ??
			({
				allowedHosts: [
					"code-review-bot.uplanit.workers.dev",
					"code-review-bot.kukuana.com",
				],
				fallback: "https://code-review-bot.uplanit.workers.dev",
				protocol: "https",
			} as const),
		database: prismaAdapter(db, {
			provider: "sqlite",
		}),
		advanced: {
			useSecureCookies: env.ENVIRONMENT === "production",
			// Cloudflare Workers: the canonical client IP header is
			// cf-connecting-ip. Without this, Better Auth's default
			// (x-forwarded-for only) finds no IP and silently skips
			// rate limiting on the internet-reachable sign-in endpoint.
			ipAddress: {
				ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for"],
			},
		},
		emailAndPassword: {
			enabled: true,
			// The deployed worker is internet-reachable; the admin UI exposes
			// the login form. Sign-up stays open only in local dev — bootstrap
			// the first admin for a fresh environment there (promote via D1);
			// signed-in admins create further admins via POST /admins.
			disableSignUp: env.ENVIRONMENT !== "local",
		},
		// Local dev serves the app on Vite's default port (5173); without a
		// BETTER_AUTH_URL the baseURL falls back to production, which Better
		// Auth uses as its trusted origin and rejects localhost sign-ins.
		trustedOrigins:
			env.ENVIRONMENT === "local"
				? ["http://localhost:5173", "http://localhost:3000"]
				: undefined,
		plugins: [admin()],
	});
}

export type Auth = ReturnType<typeof createAuth>;

/**
 * Fresh Better Auth instance per call, wired to a fresh PrismaClient from
 * getPrisma (per request). The auth surface used to be memoized per isolate,
 * but the embedded shared PrismaClient made concurrent requests hang on
 * Workers — see the comment in createAuth and lib/db.ts. Callers are
 * per-request paths (route handlers, the /rivet session gate, actors), so
 * construction cost is per request.
 */
export function getAuth(env: Env): Auth {
	return createAuth(getPrisma(env), env);
}
