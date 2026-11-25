import { env } from "cloudflare:workers";
import { startWorkerRequest } from "./request";
export type TestSession = {
	cookie: string;
	headers: { cookie: string };
	userId: string;
	email: string;
};

export function bearerHeaders(token: string) {
	return { authorization: `Bearer ${token}` };
}

async function signedSessionCookie(token: string): Promise<string> {
	const secret = env.BETTER_AUTH_SECRET;
	if (!secret) throw new Error("BETTER_AUTH_SECRET test binding is missing");
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign(
		"HMAC",
		key,
		encoder.encode(token),
	);
	const encodedSignature = btoa(
		String.fromCharCode(...new Uint8Array(signature)),
	);
	return `better-auth.session_token=${encodeURIComponent(`${token}.${encodedSignature}`)}`;
}

export async function createUserSession(
	role: "admin" | "user" = "admin",
): Promise<TestSession> {
	const userId = crypto.randomUUID();
	const sessionId = crypto.randomUUID();
	const token = crypto.randomUUID();
	const email = `admin-${userId}@example.com`;
	const now = new Date();
	const nowIso = now.toISOString();
	const expiresAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
	await env.DB.batch([
		env.DB.prepare(
			`INSERT INTO "user"
				(id, name, email, emailVerified, createdAt, updatedAt, role)
				VALUES (?, ?, ?, ?, ?, ?, ?)`,
		).bind(userId, "Worker Test Admin", email, true, nowIso, nowIso, role),
		env.DB.prepare(
			`INSERT INTO "session"
				(id, userId, token, expiresAt, createdAt, updatedAt)
				VALUES (?, ?, ?, ?, ?, ?)`,
		).bind(sessionId, userId, token, expiresAt, nowIso, nowIso),
	]);
	const cookie = await signedSessionCookie(token);
	return { cookie, headers: { cookie }, userId, email };
}

export function createAdminSession(): Promise<TestSession> {
	return createUserSession("admin");
}

// A session minted by Better Auth itself, via the real sign-up route.
//
// Use this variant against code running in the raw worker entry outside
// Start's handler (e.g. the /rivet gate in src/server.ts). The DB-minted
// cookies from createUserSession validate fine through Start server
// functions, but wedge Better Auth's in-request session validation when
// presented directly to better-auth code in the custom fetch handler — the
// request hangs instead of failing. API-minted cookies are the real contract.
export async function createApiSession(): Promise<TestSession> {
	const email = `api-${crypto.randomUUID()}@example.com`;
	const response = await startWorkerRequest("/api/auth/sign-up/email", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			origin: "http://localhost:5173",
		},
		body: JSON.stringify({
			email,
			password: "correct-horse-42",
			name: "API Session User",
		}),
	});
	if (response.status !== 200) {
		throw new Error(
			`API sign-up failed (${response.status}): ${await response.text()}`,
		);
	}
	const body = (await response.json()) as { user: { id: string } };
	const setCookie = response.headers.get("set-cookie") ?? "";
	const cookie = setCookie.split(";")[0];
	if (!cookie.startsWith("better-auth.session_token=")) {
		throw new Error("Sign-up response did not include a session cookie");
	}
	return { cookie, headers: { cookie }, userId: body.user.id, email };
}

/**
 * API-minted session whose user has been promoted to the admin role in D1 —
 * use against admin-gated code in the raw worker entry outside Start's
 * handler (e.g. the /terminal intercept in src/server.ts), where DB-minted
 * cookies wedge Better Auth's in-request session validation.
 */
export async function createApiAdminSession(): Promise<TestSession> {
	const session = await createApiSession();
	await env.DB.prepare(`UPDATE "user" SET role = 'admin' WHERE id = ?`)
		.bind(session.userId)
		.run();
	return session;
}

function withSession(
	path: string,
	session: TestSession,
	init: RequestInit,
	dispatch: typeof startWorkerRequest,
): Promise<Response> {
	const headers = new Headers(init.headers);
	headers.set("cookie", session.cookie);
	return dispatch(path, { ...init, headers });
}

export function startAdminRequest(
	path: string,
	session: TestSession,
	init: RequestInit = {},
	requestEnv?: Env,
): Promise<Response> {
	return withSession(
		path,
		session,
		init,
		requestEnv
			? (requestPath, requestInit) =>
					startWorkerRequest(requestPath, requestInit, requestEnv)
			: startWorkerRequest,
	);
}
