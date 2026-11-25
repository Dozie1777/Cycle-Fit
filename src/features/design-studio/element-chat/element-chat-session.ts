/**
 * Shared ElementChat session creation (KUK-944): one creation path for the
 * orchestrator's `open_element_chat` tool (design chat) and the
 * `elementChats.create` tRPC handler. Validates that the polymorphic
 * element target exists AND belongs to the given project before any write,
 * seeds the session's contextPrompt from the real context builders, and is
 * idempotent on (projectId, elementType, elementId).
 *
 * An existing session's contextPrompt is RESEEDED on every ensure: the
 * element evolves through its own chat, and each open should see the
 * current definition. The lease columns are never touched here — only the
 * context text.
 */

import type { getPrisma } from "@/lib/db";
import type { ElementType } from "./element-chat-context";
import {
	buildElementContext,
	ElementContextNotFoundError,
} from "./element-chat-context";

type PrismaDb = ReturnType<typeof getPrisma>;

export type EnsureElementChatResult = {
	/** The session row (created or existing). */
	session: {
		id: string;
		projectId: string;
		elementType: string;
		elementId: string;
		status: string;
		error: string | null;
		createdAt: Date;
		updatedAt: Date;
	};
	/** True when this call created the session (false = existing, reseeded). */
	created: boolean;
	/** Display name of the target element for tool results and UI labels. */
	elementName: string;
};

/**
 * Resolves the target element's project + display name. Returns null when
 * the element does not exist; callers compare the project id to fence
 * cross-project ids before any write.
 */
async function resolveElement(
	prisma: PrismaDb,
	elementType: ElementType,
	elementId: string,
): Promise<{ projectId: string; name: string } | null> {
	switch (elementType) {
		case "component": {
			const row = await prisma.component.findUnique({
				where: { id: elementId },
				select: { projectId: true, name: true },
			});
			return row && { projectId: row.projectId, name: row.name };
		}
		case "page": {
			const row = await prisma.page.findUnique({
				where: { id: elementId },
				select: { projectId: true, title: true, path: true },
			});
			return row && { projectId: row.projectId, name: row.title || row.path };
		}
		case "template": {
			const row = await prisma.template.findUnique({
				where: { id: elementId },
				select: { projectId: true, name: true },
			});
			return row && { projectId: row.projectId, name: row.name };
		}
		case "data": {
			const row = await prisma.dataCollection.findUnique({
				where: { id: elementId },
				select: { projectId: true, name: true },
			});
			return row && { projectId: row.projectId, name: row.name };
		}
		case "flow": {
			const row = await prisma.flow.findUnique({
				where: { id: elementId },
				select: { projectId: true, name: true },
			});
			return row && { projectId: row.projectId, name: row.name };
		}
	}
}

/**
 * Creates or reopens the element chat session for the given element.
 * Throws ElementContextNotFoundError when the element does not exist or
 * belongs to another project — before any write.
 */
export async function ensureElementChat(
	prisma: PrismaDb,
	projectId: string,
	elementType: ElementType,
	elementId: string,
): Promise<EnsureElementChatResult> {
	const element = await resolveElement(prisma, elementType, elementId);
	if (!element || element.projectId !== projectId) {
		throw new ElementContextNotFoundError(elementType, elementId);
	}

	// Seed the distilled element context (own definition + neighbors +
	// project tokens) — also on reopen, so each open sees the current
	// definition. buildElementContext re-validates ownership internally.
	const contextPrompt = await buildElementContext(
		prisma,
		projectId,
		elementType,
		elementId,
	);

	const existing = await prisma.elementChat.findUnique({
		where: {
			projectId_elementType_elementId: { projectId, elementType, elementId },
		},
		select: { id: true },
	});
	const session = await prisma.elementChat.upsert({
		where: {
			projectId_elementType_elementId: { projectId, elementType, elementId },
		},
		create: {
			id: crypto.randomUUID(),
			projectId,
			elementType,
			elementId,
			contextPrompt,
		},
		update: { contextPrompt },
	});
	return {
		session: {
			id: session.id,
			projectId: session.projectId,
			elementType: session.elementType,
			elementId: session.elementId,
			status: session.status,
			error: session.error,
			createdAt: session.createdAt,
			updatedAt: session.updatedAt,
		},
		created: existing == null,
		elementName: element.name,
	};
}

export { ElementContextNotFoundError };
