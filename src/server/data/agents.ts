import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
	assertEnvelope,
	encryptPayload,
	type MasterKeys,
	parseMasterKeys,
	type VerifiedCredential,
	verifyGitHubCredential,
} from "@/features/review";
import { getAuth } from "@/lib/auth";
import { getPrisma } from "@/lib/db";

type AuditEvent = {
	action: "register" | "rotate" | "enable" | "disable";
	agentId: string;
	credentialId: string;
	adminUserId: string;
	provider: string;
	envelope: string;
};

function audit(event: AuditEvent) {
	console.log(JSON.stringify({ event: "agent-credential", ...event }));
}

function messageOf(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}

// Input schemas — routers use these via `.input(...)` so every mutation is
// zod-validated at the tRPC boundary before the handler runs.
export const createAgentBody = z.object({
	name: z.string().min(1).max(200),
	email: z.string().email().max(320),
});

export const registerCredentialBody = z.object({
	provider: z.literal("github_app"),
	externalId: z.string().min(1),
	appId: z.string().min(1),
	envelope: z.enum(["pusher", "reviewer"]),
	privateKeyPem: z.string().min(1),
	expectedRepository: z.string().optional(),
});

export const patchCredentialBody = z
	.object({
		status: z.enum(["active", "disabled"]).optional(),
		privateKeyPem: z.string().min(1).optional(),
		appId: z.string().min(1).optional(),
		envelope: z.enum(["pusher", "reviewer"]).optional(),
		externalId: z.string().min(1).optional(),
		expectedRepository: z.string().optional(),
	})
	.refine((body) => !(body.privateKeyPem && (!body.appId || !body.envelope)), {
		message: "rotation requires appId and envelope alongside privateKeyPem",
	});

function publicCredential(c: {
	id: string;
	agentId: string;
	provider: string;
	externalId: string | null;
	envelope: string;
	keyVersion: number;
	status: string;
	lastUsedAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
}) {
	return {
		id: c.id,
		agentId: c.agentId,
		provider: c.provider,
		externalId: c.externalId,
		envelope: c.envelope,
		keyVersion: c.keyVersion,
		status: c.status,
		lastUsedAt: c.lastUsedAt,
		createdAt: c.createdAt,
		updatedAt: c.updatedAt,
	};
}

export async function listAgents(env: Env) {
	const prisma = getPrisma(env);
	const agentUsers = await prisma.user.findMany({
		where: { role: "agent" },
		orderBy: { createdAt: "asc" },
	});
	const credentials = await prisma.agentCredential.findMany({
		where: { agentId: { in: agentUsers.map((user) => user.id) } },
		orderBy: { createdAt: "asc" },
	});
	const byAgent = new Map<string, ReturnType<typeof publicCredential>[]>();
	for (const credential of credentials) {
		const list = byAgent.get(credential.agentId) ?? [];
		list.push(publicCredential(credential));
		byAgent.set(credential.agentId, list);
	}
	return agentUsers.map((user) => ({
		id: user.id,
		name: user.name,
		email: user.email,
		createdAt: user.createdAt,
		credentials: byAgent.get(user.id) ?? [],
	}));
}

export async function createAgent(input: {
	env: Env;
	body: z.infer<typeof createAgentBody>;
	/** Forwarded to Better Auth so the admin session authorizes createUser. */
	headers: Headers;
}) {
	const created = (await getAuth(input.env).api.createUser({
		body: {
			name: input.body.name,
			email: input.body.email,
			role: "agent" as "admin",
		},
		headers: input.headers,
	})) as unknown as {
		user?: { id: string; name: string; email: string; role?: string };
		response?: {
			user: { id: string; name: string; email: string; role?: string };
		};
	};
	const user = created.user ?? created.response?.user;
	if (!user) {
		throw new Error("better-auth createUser returned no user");
	}
	return { id: user.id, name: user.name, email: user.email, role: user.role };
}

export async function registerCredential(input: {
	env: Env;
	agentId: string;
	adminUserId: string;
	body: z.infer<typeof registerCredentialBody>;
}) {
	const { env, agentId, adminUserId, body } = input;
	const prisma = getPrisma(env);
	const agent = await prisma.user.findUnique({ where: { id: agentId } });
	if (!agent) {
		throw new TRPCError({ code: "NOT_FOUND", message: "agent not found" });
	}

	const envelope = assertEnvelope(body.envelope);
	let verified: VerifiedCredential;
	try {
		verified = await verifyGitHubCredential({
			appId: body.appId,
			privateKeyPem: body.privateKeyPem,
			installationId: body.externalId,
			envelope,
			expectedRepository: body.expectedRepository,
			githubApiBaseUrl: env.GITHUB_API_BASE_URL,
		});
	} catch (error) {
		throw new TRPCError({
			code: "UNPROCESSABLE_CONTENT",
			message: messageOf(error),
		});
	}

	let masterKeys: MasterKeys;
	try {
		masterKeys = await parseMasterKeys(env);
	} catch (error) {
		throw new TRPCError({
			code: "INTERNAL_SERVER_ERROR",
			message: messageOf(error),
		});
	}
	const id = crypto.randomUUID();
	const payloadEnc = await encryptPayload(
		{
			appId: body.appId,
			privateKey: body.privateKeyPem,
			botLogin: verified.botLogin,
			botEmail: verified.botEmail,
		},
		id,
		masterKeys,
	);
	const credential = await prisma.agentCredential.create({
		data: {
			id,
			agentId: agent.id,
			provider: body.provider,
			externalId: body.externalId,
			envelope,
			payloadEnc,
			keyVersion: masterKeys.current,
		},
	});
	audit({
		action: "register",
		agentId: agent.id,
		credentialId: credential.id,
		adminUserId,
		provider: credential.provider,
		envelope: credential.envelope,
	});
	return {
		...publicCredential(credential),
		botLogin: verified.botLogin,
		repositories: verified.repositories,
	};
}

export async function patchAgentCredential(input: {
	env: Env;
	agentId: string;
	credentialId: string;
	adminUserId: string;
	body: z.infer<typeof patchCredentialBody>;
}) {
	const { env, agentId, credentialId, adminUserId, body } = input;
	const prisma = getPrisma(env);
	const credential = await prisma.agentCredential.findUnique({
		where: { id: credentialId },
	});
	if (!credential || credential.agentId !== agentId) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "credential not found",
		});
	}

	const status = body.status ?? credential.status;
	if (body.privateKeyPem) {
		const envelope = assertEnvelope(body.envelope ?? credential.envelope);
		let verified: VerifiedCredential;
		try {
			verified = await verifyGitHubCredential({
				appId: body.appId as string,
				privateKeyPem: body.privateKeyPem,
				installationId: body.externalId ?? credential.externalId ?? "",
				envelope,
				expectedRepository: body.expectedRepository,
				githubApiBaseUrl: env.GITHUB_API_BASE_URL,
			});
		} catch (error) {
			throw new TRPCError({
				code: "UNPROCESSABLE_CONTENT",
				message: messageOf(error),
			});
		}
		let masterKeys: MasterKeys;
		try {
			masterKeys = await parseMasterKeys(env);
		} catch (error) {
			throw new TRPCError({
				code: "INTERNAL_SERVER_ERROR",
				message: messageOf(error),
			});
		}
		const payloadEnc = await encryptPayload(
			{
				appId: body.appId as string,
				privateKey: body.privateKeyPem,
				botLogin: verified.botLogin,
				botEmail: verified.botEmail,
			},
			credential.id,
			masterKeys,
		);
		const updated = await prisma.agentCredential.update({
			where: { id: credential.id },
			data: {
				envelope,
				externalId: body.externalId ?? credential.externalId,
				payloadEnc,
				keyVersion: masterKeys.current,
				status,
			},
		});
		audit({
			action: "rotate",
			agentId: credential.agentId,
			credentialId: credential.id,
			adminUserId,
			provider: credential.provider,
			envelope: updated.envelope,
		});
		return publicCredential(updated);
	}

	const updated = await prisma.agentCredential.update({
		where: { id: credential.id },
		data: { status },
	});
	if (status !== credential.status) {
		audit({
			action: status === "active" ? "enable" : "disable",
			agentId: credential.agentId,
			credentialId: credential.id,
			adminUserId,
			provider: credential.provider,
			envelope: credential.envelope,
		});
	}
	return publicCredential(updated);
}
