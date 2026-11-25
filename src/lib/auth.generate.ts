import { PrismaD1 } from "@prisma/adapter-d1";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { admin } from "better-auth/plugins";
import { PrismaClient } from "../generated/prisma/client";

/**
 * Used only by `pnpm auth:generate` (@better-auth/cli generate), which needs a
 * module-level `auth` export to introspect. Never imported at runtime — the
 * real instance is built in auth.ts with the D1-bound adapter.
 *
 * Prisma 7's generated client requires a driver adapter to construct, but the
 * CLI only introspects model metadata and never issues queries, so a stub D1
 * binding is enough here (there is no D1 binding in a plain Node process).
 */
const prisma = new PrismaClient({
	adapter: new PrismaD1({} as D1Database),
});

export const auth = betterAuth({
	// CLI introspection only — never used to sign anything at runtime.
	secret: "generate-only",
	database: prismaAdapter(prisma, {
		provider: "sqlite",
	}),
	emailAndPassword: {
		enabled: true,
	},
	plugins: [admin()],
});
