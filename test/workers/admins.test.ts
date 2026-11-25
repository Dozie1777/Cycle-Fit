import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createAdminSession,
	createUserSession,
	type TestSession,
} from "../helpers/auth";
import { startJsonRequest } from "../helpers/request";
import {
	createTrpcTestClient,
	type TrpcTestClient,
	trpcErrorCode,
	trpcErrorMessage,
} from "../helpers/trpc";

type LogSpy = { mock: { calls: unknown[][] } };

function adminClient(session: TestSession): TrpcTestClient {
	return createTrpcTestClient(session.headers);
}

function adminBody(overrides: Record<string, unknown> = {}) {
	return {
		name: "New Admin",
		email: "new-admin@example.com",
		password: "correct-horse-42",
		...overrides,
	};
}

function auditEvents(log: LogSpy) {
	return log.mock.calls
		.map(([line]) => {
			try {
				return JSON.parse(String(line)) as Record<string, unknown>;
			} catch {
				return null;
			}
		})
		.filter(
			(event): event is Record<string, unknown> =>
				event?.event === "admin-user",
		);
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("Admin management tRPC API", () => {
	it.each([
		"short",
		"x".repeat(201),
	])("rejects invalid creation bodies and out-of-range passwords with BAD_REQUEST", async (password) => {
		const session = await createAdminSession();
		const code = await trpcErrorCode(() =>
			adminClient(session).admins.create.mutate({
				name: "",
				email: "not-an-email",
				password,
			}),
		);
		expect(code).toBe("BAD_REQUEST");
		const message = await trpcErrorMessage(() =>
			adminClient(session).admins.create.mutate({
				name: "",
				email: "not-an-email",
				password,
			}),
		);
		expect(message).toContain("name");
		expect(message).toContain("email");
		expect(message).toContain("password");
	});

	it("returns CONFLICT only for a duplicate user", async () => {
		const session = await createAdminSession();
		const first = await adminClient(session).admins.create.mutate(adminBody());
		expect(first).toEqual({
			id: expect.any(String),
			name: "New Admin",
			email: "new-admin@example.com",
			role: "admin",
		});
		const code = await trpcErrorCode(() =>
			adminClient(session).admins.create.mutate(adminBody()),
		);
		expect(code).toBe("CONFLICT");
		expect(
			await trpcErrorMessage(() =>
				adminClient(session).admins.create.mutate(adminBody()),
			),
		).toBe("user already exists");
	});

	it("rolls back an unaudited admin when credential creation fails and allows retry", async () => {
		const session = await createAdminSession();
		const password = adminBody().password;
		const internalDetail = "forced-account-insert-internal-detail";
		await env.DB.prepare(
			`CREATE TRIGGER reject_credential_account
				BEFORE INSERT ON account
				WHEN NEW.providerId = 'credential'
				BEGIN
					SELECT RAISE(ABORT, '${internalDetail}');
				END`,
		).run();
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
		// Single failed attempt — capture both the code and the message from
		// the same call so the error-log count stays exact.
		let code: string | null;
		let message: string | null;
		try {
			await adminClient(session).admins.create.mutate(adminBody());
			code = null;
			message = null;
		} catch (error) {
			code = (error as { data?: { code?: string } }).data?.code ?? "UNKNOWN";
			message = error instanceof Error ? error.message : String(error);
		}
		const orphanCount = await env.DB.prepare(
			'SELECT COUNT(*) AS count FROM "user" WHERE email = ?',
		)
			.bind("new-admin@example.com")
			.first()
			.then((row) => row?.count);
		const accountCount = await env.DB.prepare(
			'SELECT COUNT(*) AS count FROM "account"',
		)
			.first()
			.then((row) => row?.count);
		const failedAudits = auditEvents(log);
		await env.DB.prepare("DROP TRIGGER reject_credential_account").run();

		expect(code).toBe("INTERNAL_SERVER_ERROR");
		expect(message).toBe("internal server error");
		expect(message).not.toContain(internalDetail);
		expect(message).not.toContain(password);
		expect(orphanCount).toBe(0);
		expect(accountCount).toBe(0);
		expect(failedAudits).toEqual([]);
		expect(errorLog).toHaveBeenCalledTimes(1);
		expect(JSON.stringify(errorLog.mock.calls)).not.toContain(internalDetail);
		expect(JSON.stringify(errorLog.mock.calls)).not.toContain(password);

		const retry = await adminClient(session).admins.create.mutate(adminBody());
		expect(retry).toEqual({
			id: expect.any(String),
			name: "New Admin",
			email: "new-admin@example.com",
			role: "admin",
		});
		expect(auditEvents(log)).toEqual([
			expect.objectContaining({ action: "create" }),
		]);
	});

	it("creates a Better Auth credential account with a hashed password", async () => {
		const session = await createAdminSession();
		const password = adminBody().password;
		const created = await adminClient(session).admins.create.mutate(
			adminBody(),
		);
		const text = JSON.stringify(created);
		expect(text).not.toContain(password);
		expect(created).toEqual({
			id: expect.any(String),
			name: "New Admin",
			email: "new-admin@example.com",
			role: "admin",
		});
		const account = await env.DB.prepare(
			'SELECT providerId, password FROM "account" WHERE userId = ?',
		)
			.bind(created.id)
			.first();
		expect(account).toEqual({
			providerId: "credential",
			password: expect.any(String),
		});
		expect(account?.password).not.toBe(password);
		expect(String(account?.password)).not.toContain(password);

		const signIn = await startJsonRequest("/api/auth/sign-in/email", "POST", {
			email: "new-admin@example.com",
			password,
		});
		expect(signIn.status).toBe(200);
	});

	it("lists only admins in ascending creation order with public fields", async () => {
		const now = new Date().toISOString();
		const insertUser = async (id: string, role: string, createdAt: string) => {
			await env.DB.prepare(
				`INSERT INTO "user"
					(id, name, email, emailVerified, createdAt, updatedAt, role)
					VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
				.bind(
					id,
					`User ${id}`,
					`${id}@example.com`,
					false,
					createdAt,
					now,
					role,
				)
				.run();
		};
		await insertUser("second", "admin", "2026-02-01T00:00:00.000Z");
		await insertUser("first", "admin", "2026-01-01T00:00:00.000Z");
		await insertUser("ordinary", "user", "2025-01-01T00:00:00.000Z");
		const session = await createAdminSession();

		const admins = await adminClient(session).admins.list.query();
		const text = JSON.stringify(admins);
		expect(text).not.toContain("password");
		expect(admins.map((admin) => admin.id)).toEqual([
			"first",
			"second",
			session.userId,
		]);
		expect(admins[0]).toEqual({
			id: "first",
			name: "User first",
			email: "first@example.com",
			createdAt: "2026-01-01T00:00:00.000Z",
		});
	});

	it("writes the exact audit event without the password", async () => {
		const session = await createAdminSession();
		const password = adminBody().password;
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		const created = await adminClient(session).admins.create.mutate(
			adminBody(),
		);
		expect(auditEvents(log)).toEqual([
			{
				event: "admin-user",
				action: "create",
				userId: created.id,
				email: created.email,
				adminUserId: session.userId,
			},
		]);
		expect(JSON.stringify(log.mock.calls)).not.toContain(password);
		expect(JSON.stringify(log.mock.calls)).not.toContain("password");
	});

	it("rejects anonymous and non-admin users before allowing an admin", async () => {
		const anonymous = createTrpcTestClient();
		const nonAdmin = adminClient(await createUserSession("user"));
		const admin = adminClient(await createAdminSession());

		// admins.list (GET /admins)
		expect(await trpcErrorCode(() => anonymous.admins.list.query())).toBe(
			"UNAUTHORIZED",
		);
		expect(await trpcErrorCode(() => nonAdmin.admins.list.query())).toBe(
			"FORBIDDEN",
		);
		expect(await trpcErrorCode(() => admin.admins.list.query())).toBeNull();

		// admins.create (POST /admins; invalid body → BAD_REQUEST once auth passes)
		for (const client of [anonymous, nonAdmin]) {
			expect(
				await trpcErrorCode(() => client.admins.create.mutate({} as never)),
			).toBe(client === anonymous ? "UNAUTHORIZED" : "FORBIDDEN");
		}
		expect(
			await trpcErrorCode(() => admin.admins.create.mutate({} as never)),
		).toBe("BAD_REQUEST");
	});
});
