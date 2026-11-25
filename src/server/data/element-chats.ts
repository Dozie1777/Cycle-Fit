import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
	ElementContextNotFoundError,
	ensureElementChat,
} from "@/features/design-studio/element-chat/element-chat-session";
import { getPrisma } from "@/lib/db";

// Element chat sessions (KUK-940/KUK-942): one scoped chat per design
// element (component / page / template / data collection / flow) inside a
// project, created idempotently on (projectId, elementType, elementId) and
// fenced to the project — an element id from another project is a 404,
// never written. Creation/seeding goes through the shared
// ensureElementChat path (lib/element-chat-session.ts) so the tRPC handler
// and the orchestrator's open_element_chat tool behave identically.

export const ELEMENT_CHAT_TYPES = [
	"component",
	"page",
	"template",
	"data",
	"flow",
] as const;

export const createElementChatBody = z.object({
	projectId: z.string().min(1),
	elementType: z.enum(ELEMENT_CHAT_TYPES),
	elementId: z.string().min(1),
});

type PrismaDb = ReturnType<typeof getPrisma>;
type ElementChatRow = NonNullable<
	Awaited<ReturnType<PrismaDb["elementChat"]["findUnique"]>>
>;
/** The public session shape shared by the full row and the ensure result. */
type PublicSession = Pick<
	ElementChatRow,
	| "id"
	| "projectId"
	| "elementType"
	| "elementId"
	| "status"
	| "error"
	| "createdAt"
	| "updatedAt"
>;

function publicSession(session: PublicSession) {
	return {
		id: session.id,
		projectId: session.projectId,
		elementType: session.elementType,
		elementId: session.elementId,
		status: session.status,
		error: session.error,
		createdAt: session.createdAt,
		updatedAt: session.updatedAt,
	};
}

async function assertElementChatOr404(env: Env, elementChatId: string) {
	const prisma = getPrisma(env);
	const row = await prisma.elementChat.findUnique({
		where: { id: elementChatId },
	});
	if (!row) {
		throw new TRPCError({ code: "NOT_FOUND", message: "not found" });
	}
	return { prisma, row };
}

export async function createElementChat(input: {
	env: Env;
	body: z.infer<typeof createElementChatBody>;
}) {
	const { env, body } = input;
	const prisma = getPrisma(env);

	try {
		// Shared creation path with the orchestrator tool: validates element
		// existence + project ownership before any write, seeds the real
		// context (element definition + neighbors + project tokens), and is
		// idempotent on (projectId, elementType, elementId) — reseeding the
		// context on reopen so each open sees the current definition.
		const { session } = await ensureElementChat(
			prisma,
			body.projectId,
			body.elementType,
			body.elementId,
		);
		return publicSession(session);
	} catch (error) {
		if (error instanceof ElementContextNotFoundError) {
			throw new TRPCError({
				code: "NOT_FOUND",
				message: "element not found in this project",
			});
		}
		throw error;
	}
}

export async function getElementChat(env: Env, elementChatId: string) {
	const { row } = await assertElementChatOr404(env, elementChatId);
	return publicSession(row);
}

/** Mirrors the designs listMessages contract: newest-kept cap of 200. */
export async function listElementChatMessages(env: Env, elementChatId: string) {
	// desc + reverse so the cap drops the OLDEST rows, never recent turns.
	const messages = await getPrisma(env).message.findMany({
		where: { elementId: elementChatId },
		orderBy: { createdAt: "desc" },
		take: 200,
	});
	return messages.reverse().map((message) => ({
		id: message.id,
		role: message.role,
		content: message.content,
		// Raw stored parts JSON; parsed client-side by parseStoredParts.
		parts: message.parts,
		createdAt: message.createdAt,
	}));
}

export async function deleteElementChat(env: Env, elementChatId: string) {
	const { prisma } = await assertElementChatOr404(env, elementChatId);
	// Messages cascade via the FK (ElementChat → Message onDelete: Cascade).
	await prisma.elementChat.delete({ where: { id: elementChatId } });
	return { ok: true as const };
}
