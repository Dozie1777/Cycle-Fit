import { createMiddleware } from "@tanstack/react-start";
import { getAuth } from "../lib/auth";

type AdminGate =
	| { error: Response }
	| {
			user: NonNullable<
				Awaited<ReturnType<ReturnType<typeof getAuth>["api"]["getSession"]>>
			>["user"];
			session: NonNullable<
				Awaited<ReturnType<ReturnType<typeof getAuth>["api"]["getSession"]>>
			>["session"];
	  };

/**
 * Shared admin gate. Used by `adminMiddleware` for whole-route gating and
 * inline by handlers that live on routes where a sibling child route must
 * stay public (layout middleware would cascade to it — e.g. the asset
 * PATCH/DELETE route whose `file` child is served unauthenticated).
 */
export async function resolveAdminSession(
	request: Request,
	env: Env,
): Promise<AdminGate> {
	const authSession = await getAuth(env).api.getSession({
		headers: request.headers,
	});
	if (!authSession) {
		return { error: Response.json({ error: "unauthorized" }, { status: 401 }) };
	}
	if (authSession.user.role !== "admin") {
		return {
			error: Response.json(
				{ error: "forbidden — admin role required" },
				{ status: 403 },
			),
		};
	}
	return { user: authSession.user, session: authSession.session };
}

export const adminMiddleware = createMiddleware({ type: "request" }).server(
	async ({ request, context, next }) => {
		const gate = await resolveAdminSession(request, context.env);
		if ("error" in gate) return gate.error;
		return next({
			context: { user: gate.user, session: gate.session },
		});
	},
);
