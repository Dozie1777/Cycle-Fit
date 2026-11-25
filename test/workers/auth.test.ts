import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { startWorkerRequest, TEST_ORIGIN } from "../helpers/request";

type AuthUser = {
	id: string;
	email: string;
	role?: string;
};

type AuthSession = {
	user: AuthUser;
	session: { id: string; userId: string };
};

function authRequest(
	path: string,
	method: "GET" | "POST",
	body?: unknown,
	cookie?: string,
	requestEnv: Env = env,
) {
	const headers = new Headers();
	if (method === "POST") headers.set("origin", TEST_ORIGIN);
	if (body !== undefined) headers.set("content-type", "application/json");
	if (cookie) headers.set("cookie", cookie);
	return startWorkerRequest(
		path,
		{
			method,
			headers,
			body: body === undefined ? undefined : JSON.stringify(body),
		},
		{
			...requestEnv,
			BETTER_AUTH_URL: TEST_ORIGIN,
		},
	);
}

function signUp(email: string, requestEnv: Env = env) {
	return authRequest(
		"/api/auth/sign-up/email",
		"POST",
		{ name: "Start Integration User", email, password: "correct-horse-42" },
		undefined,
		requestEnv,
	);
}

function httpOnlySessionCookie(response: Response): string {
	const setCookie = response.headers.get("set-cookie");
	expect(setCookie).toContain("better-auth.session_token=");
	expect(setCookie).toMatch(/httponly/i);
	expect(setCookie).toMatch(/samesite=lax/i);
	return setCookie?.split(";", 1)[0] ?? "";
}

async function responseUser(response: Response): Promise<AuthUser> {
	const body = (await response.json()) as { user: AuthUser };
	return body.user;
}

async function responseSession(
	response: Response,
): Promise<AuthSession | null> {
	return (await response.json()) as AuthSession | null;
}

describe("Better Auth through the TanStack Start Worker entry", () => {
	it("signs up, signs in, reads an httpOnly session, and signs out", async () => {
		const email = `start-${crypto.randomUUID()}@example.com`;
		const signUpResponse = await signUp(email);
		expect(signUpResponse.status).toBe(200);
		expect((await responseUser(signUpResponse)).email).toBe(email);
		const signUpCookie = httpOnlySessionCookie(signUpResponse);

		const signInResponse = await authRequest(
			"/api/auth/sign-in/email",
			"POST",
			{ email, password: "correct-horse-42" },
		);
		expect(signInResponse.status).toBe(200);
		expect((await responseUser(signInResponse)).email).toBe(email);
		const signInCookie = httpOnlySessionCookie(signInResponse);
		expect(signInCookie).not.toBe(signUpCookie);

		const sessionResponse = await authRequest(
			"/api/auth/get-session",
			"GET",
			undefined,
			signInCookie,
		);
		expect(sessionResponse.status).toBe(200);
		const session = await responseSession(sessionResponse);
		expect(session?.user.email).toBe(email);
		expect(session?.session.userId).toBe(session?.user.id);

		const signOutResponse = await authRequest(
			"/api/auth/sign-out",
			"POST",
			{},
			signInCookie,
		);
		expect(signOutResponse.status).toBe(200);
		expect(signOutResponse.headers.get("set-cookie")).toMatch(
			/better-auth\.session_token=; Max-Age=0;.*HttpOnly/i,
		);

		const signedOutSession = await authRequest(
			"/api/auth/get-session",
			"GET",
			undefined,
			signInCookie,
		);
		expect(signedOutSession.status).toBe(200);
		expect(await responseSession(signedOutSession)).toBeNull();
	}, 20_000);

	it("reads an admin session after promoting the signed-up user through real D1", async () => {
		const email = `admin-${crypto.randomUUID()}@example.com`;
		const signUpResponse = await signUp(email);
		expect(signUpResponse.status).toBe(200);
		const user = await responseUser(signUpResponse);
		const cookie = httpOnlySessionCookie(signUpResponse);

		const promotion = await env.DB.prepare(
			'UPDATE "user" SET role = ?, updatedAt = ? WHERE id = ?',
		)
			.bind("admin", new Date().toISOString(), user.id)
			.run();
		expect(promotion.meta.changes).toBe(1);

		const sessionResponse = await authRequest(
			"/api/auth/get-session",
			"GET",
			undefined,
			cookie,
		);
		expect(sessionResponse.status).toBe(200);
		const session = await responseSession(sessionResponse);
		expect(session?.user).toMatchObject({ id: user.id, email, role: "admin" });
	});

	it("returns no session for a malformed signed cookie without crashing", async () => {
		const response = await authRequest(
			"/api/auth/get-session",
			"GET",
			undefined,
			"better-auth.session_token=not-a-valid-session",
		);
		expect(response.status).toBe(200);
		expect(await responseSession(response)).toBeNull();
	});

	it("returns no session for an expired signed cookie without crashing", async () => {
		const signUpResponse = await signUp(
			`expired-${crypto.randomUUID()}@example.com`,
		);
		expect(signUpResponse.status).toBe(200);
		const cookie = httpOnlySessionCookie(signUpResponse);
		const cookieValue = cookie.slice(cookie.indexOf("=") + 1);
		const token = decodeURIComponent(cookieValue).split(".", 1)[0];
		const expiry = await env.DB.prepare(
			'UPDATE "session" SET expiresAt = ? WHERE token = ?',
		)
			.bind(new Date(Date.now() - 60_000).toISOString(), token)
			.run();
		expect(expiry.meta.changes).toBe(1);

		const response = await authRequest(
			"/api/auth/get-session",
			"GET",
			undefined,
			cookie,
		);
		expect(response.status).toBe(200);
		expect(await responseSession(response)).toBeNull();
	});

	it("uses a Secure __Secure session cookie for production sign-in", async () => {
		const email = `secure-${crypto.randomUUID()}@example.com`;
		const signUpResponse = await signUp(email);
		expect(signUpResponse.status).toBe(200);

		const response = await authRequest(
			"/api/auth/sign-in/email",
			"POST",
			{ email, password: "correct-horse-42" },
			undefined,
			{ ...env, ENVIRONMENT: "production" },
		);
		expect(response.status).toBe(200);
		const setCookie = response.headers.get("set-cookie");
		expect(setCookie).toContain("__Secure-better-auth.session_token=");
		expect(setCookie).toMatch(/;\s*Secure(?:;|$)/i);
	});

	it("rejects sign-up when ENVIRONMENT is production", async () => {
		const productionEnv = { ...env, ENVIRONMENT: "production" };
		const response = await signUp(
			`production-${crypto.randomUUID()}@example.com`,
			productionEnv,
		);
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			message: "Email and password sign up is not enabled",
			code: "EMAIL_PASSWORD_SIGN_UP_DISABLED",
		});
	});

	it("round-trips a real Prisma design project after a Start auth request", async () => {
		const authResponse = await authRequest("/api/auth/get-session", "GET");
		expect(authResponse.status).toBe(200);
		expect(await responseSession(authResponse)).toBeNull();

		const { getPrisma } = await import("../../src/lib/db");
		const prisma = getPrisma(env);
		const id = crypto.randomUUID();
		const created = await prisma.design.create({
			data: {
				id,
				prompt: "Prisma WASM through Start",
				uploadToken: crypto.randomUUID(),
			},
		});
		expect(created.status).toBe("ready");

		const updated = await prisma.design.update({
			where: { id },
			data: { prompt: "Read back through D1", status: "chatting" },
		});
		expect(updated).toMatchObject({
			id,
			prompt: "Read back through D1",
			status: "chatting",
		});
		expect(await prisma.design.findUnique({ where: { id } })).toEqual(updated);

		await prisma.design.delete({ where: { id } });
		expect(await prisma.design.findUnique({ where: { id } })).toBeNull();
	});
});
