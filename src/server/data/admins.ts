import { TRPCError } from "@trpc/server";
import { hashPassword } from "better-auth/crypto";
import { z } from "zod";
import { getPrisma } from "@/lib/db";

type AuditEvent = {
	action: "create";
	userId: string;
	email: string;
	adminUserId: string;
};

function audit(event: AuditEvent) {
	console.log(JSON.stringify({ event: "admin-user", ...event }));
}

function isDuplicateUserError(error: unknown) {
	const candidates = [
		error,
		typeof error === "object" && error !== null && "cause" in error
			? error.cause
			: null,
	];
	return candidates.some(
		(candidate) =>
			typeof candidate === "object" &&
			candidate !== null &&
			"message" in candidate &&
			typeof candidate.message === "string" &&
			/UNIQUE constraint failed: (?:"user"|user)\.email/.test(
				candidate.message,
			),
	);
}

function logCreateFailure(adminUserId: string, error: unknown) {
	console.error(
		JSON.stringify({
			event: "admin-user-create-failed",
			adminUserId,
			errorName: error instanceof Error ? error.name : "UnknownError",
		}),
	);
}

// Input schema — the router validates via `.input(...)`.
export const createAdminBody = z.object({
	name: z.string().min(1).max(200),
	email: z.string().email().max(320),
	password: z.string().min(8).max(200),
});

export async function listAdmins(env: Env) {
	const prisma = getPrisma(env);
	const adminUsers = await prisma.user.findMany({
		where: { role: "admin" },
		orderBy: { createdAt: "asc" },
	});
	return adminUsers.map((user) => ({
		id: user.id,
		name: user.name,
		email: user.email,
		createdAt: user.createdAt,
	}));
}

export async function createAdmin(input: {
	env: Env;
	adminUserId: string;
	body: z.infer<typeof createAdminBody>;
}) {
	const { env, adminUserId, body } = input;
	const name = body.name;
	const password = body.password;
	const email = body.email.toLowerCase();
	const userId = crypto.randomUUID();
	const accountId = crypto.randomUUID();
	try {
		const passwordHash = await hashPassword(password);
		const now = new Date().toISOString();
		// D1 batches are atomic; Prisma's D1 adapter ignores transactions.
		await env.DB.batch([
			env.DB.prepare(
				`INSERT INTO "user"
					(id, name, email, emailVerified, createdAt, updatedAt, role)
					VALUES (?, ?, ?, ?, ?, ?, 'admin')`,
			).bind(userId, name, email, false, now, now),
			env.DB.prepare(
				`INSERT INTO "account"
					(id, userId, accountId, providerId, password, createdAt, updatedAt)
					VALUES (?, ?, ?, 'credential', ?, ?, ?)`,
			).bind(accountId, userId, userId, passwordHash, now, now),
		]);
	} catch (error) {
		if (isDuplicateUserError(error)) {
			throw new TRPCError({
				code: "CONFLICT",
				message: "user already exists",
			});
		}
		logCreateFailure(adminUserId, error);
		throw new TRPCError({
			code: "INTERNAL_SERVER_ERROR",
			message: "internal server error",
		});
	}
	audit({ action: "create", userId, email, adminUserId });
	return { id: userId, name, email, role: "admin" };
}
