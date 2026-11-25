import { initTRPC, TRPCError } from "@trpc/server";
import { resolveAdminSession } from "../middleware";

// Better Auth session shapes (mirrors the adminMiddleware gate in
// ../middleware.ts).
export type AdminAuth = {
	user: {
		id: string;
		role: string | null;
	};
	session: {
		id: string;
		userId: string;
	};
};

/**
 * tRPC request context. Built once per HTTP request (batched calls share
 * it) from the Start route handler's worker context. Admin auth is resolved
 * lazily — public procedures (share page) never touch Better Auth.
 */
export type TRPCContext = {
	env: Env;
	executionCtx: ExecutionContext;
	request: Request;
	/** Resolves the Better Auth session and enforces the admin role. */
	admin: () => Promise<AdminAuth>;
};

export function createTRPCContext(
	request: Request,
	env: Env,
	executionCtx: ExecutionContext,
): TRPCContext {
	return {
		env,
		executionCtx,
		request,
		admin: async () => {
			const gate = await resolveAdminSession(request, env);
			if ("error" in gate) {
				throw new TRPCError({
					code: gate.error.status === 403 ? "FORBIDDEN" : "UNAUTHORIZED",
					message:
						gate.error.status === 403
							? "forbidden — admin role required"
							: "unauthorized",
				});
			}
			return {
				user: { id: gate.user.id, role: gate.user.role ?? null },
				session: { id: gate.session.id, userId: gate.session.userId },
			};
		},
	};
}

const t = initTRPC.context<TRPCContext>().create();

export const publicProcedure = t.procedure;

/** Requires a Better Auth session with the admin role; injects `auth`. */
export const adminProcedure = t.procedure.use(async ({ ctx, next }) => {
	const auth = await ctx.admin();
	return next({ ctx: { auth } });
});

export const router = t.router;
export const middleware = t.middleware;
