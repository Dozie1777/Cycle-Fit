import { env } from "cloudflare:workers";
import { streamText } from "ai";
import { nanoid } from "nanoid";
import { actor, event, UserError } from "rivetkit";
import { db } from "rivetkit/db";
import { createWorkersAI } from "workers-ai-provider";
import { getAuth } from "@/lib/auth";
import migrations from "./drizzle/migrations.js";

const CHAT_MODEL = "@cf/meta/llama-3.1-8b-instruct";
const MAX_CONTEXT_MESSAGES = 50;
const MAX_PAGE_LIMIT = 100;
const CURSOR_SEPARATOR = ":";
const MINUTE = 60 * 1000;

export type ChatRole = "user" | "assistant" | "system";

type Conversation = {
	id: string;
	title: string | null;
	createdAt: number;
	updatedAt: number;
};

type Message = {
	id: string;
	conversationId: string;
	role: ChatRole;
	content: string;
	createdAt: number;
	metadata: string | null;
};

export type ChatConnState = {
	userId: string;
	role: "user" | "admin" | "agent" | null;
};

type ActorMode = "user" | "project";

type MigrationClient = {
	execute: (query: string, ...args: unknown[]) => Promise<unknown[]>;
};

async function runMigrations(client: MigrationClient) {
	await client.execute(`
		CREATE TABLE IF NOT EXISTS __drizzle_migrations (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			hash TEXT NOT NULL,
			created_at INTEGER
		)
	`);

	const [lastMigration] = (await client.execute(
		"SELECT id, hash, created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1",
	)) as { hash: string; created_at: number }[];
	const lastCreatedAt = lastMigration?.created_at ?? 0;

	for (const entry of migrations.journal.entries) {
		if (entry.when <= lastCreatedAt) continue;
		const migrationKey = `m${String(entry.idx).padStart(4, "0")}`;
		const sql =
			migrations.migrations[migrationKey as keyof typeof migrations.migrations];
		if (typeof sql !== "string") continue;
		await client.execute(sql);
		await client.execute(
			"INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
			entry.tag,
			entry.when,
		);
	}
}

async function resolveCaller(c: {
	request: Request | undefined;
}): Promise<ChatConnState> {
	if (!c.request) {
		throw new UserError("unauthorized", { code: "unauthorized" });
	}

	const session = await getAuth(env).api.getSession({
		headers: c.request.headers,
	});
	if (!session) {
		throw new UserError("unauthorized", { code: "unauthorized" });
	}

	return {
		userId: session.user.id,
		role: (session.user.role as ChatConnState["role"]) ?? null,
	};
}

function parseActorKey(key: string[], mode: ActorMode): string {
	if (key.length !== 2 || key[0] !== mode) {
		throw new UserError(`invalid ${mode} actor key`, {
			code: "invalid_actor_key",
		});
	}
	return key[1];
}

export function encodeCursor(
	message: Pick<Message, "createdAt" | "id">,
): string {
	return `${message.createdAt}${CURSOR_SEPARATOR}${message.id}`;
}

export function decodeCursor(cursor: string): {
	createdAt: number;
	id: string;
} {
	const sepIndex = cursor.indexOf(CURSOR_SEPARATOR);
	if (sepIndex === -1) {
		throw new UserError("invalid cursor", { code: "invalid_cursor" });
	}

	const createdAt = Number(cursor.slice(0, sepIndex));
	const id = cursor.slice(sepIndex + 1);
	if (!Number.isFinite(createdAt) || id.length === 0) {
		throw new UserError("invalid cursor", { code: "invalid_cursor" });
	}

	return { createdAt, id };
}

function createChatActor(mode: ActorMode) {
	return actor({
		options: {
			actionTimeout: 15 * MINUTE,
			sleepTimeout: 10 * MINUTE,
		},
		db: db({ onMigrate: runMigrations }),
		createConnState: async (c) => {
			const caller = await resolveCaller(c);

			if (mode === "user") {
				const ownerId = parseActorKey(c.key, "user");
				if (caller.userId !== ownerId) {
					throw new UserError("forbidden", { code: "forbidden" });
				}
			} else {
				parseActorKey(c.key, "project");
				// Project chat is intentionally admin-only until a project membership
				// model is introduced. User chat enforces per-user ownership above.
				if (caller.role !== "admin") {
					throw new UserError("forbidden", { code: "forbidden" });
				}
			}

			return caller;
		},
		events: {
			messageDelta: event<{
				conversationId: string;
				messageId: string;
				content: string;
			}>(),
			messageComplete: event<{ conversationId: string; message: Message }>(),
		},
		actions: {
			createConversation: async (c, title?: string) => {
				const now = Date.now();
				const id = nanoid();
				await c.db.execute(
					"INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
					id,
					title ?? null,
					now,
					now,
				);
				const conversation: Conversation = {
					id,
					title: title ?? null,
					createdAt: now,
					updatedAt: now,
				};
				return { conversation };
			},

			sendMessage: async (c, conversationId: string, content: string) => {
				if (
					!conversationId ||
					typeof content !== "string" ||
					content.length === 0
				) {
					throw new UserError(
						"conversationId and non-empty content are required",
						{
							code: "invalid_params",
						},
					);
				}

				const [conversation] = (await c.db.execute(
					"SELECT id FROM conversations WHERE id = ?",
					conversationId,
				)) as Conversation[];

				if (!conversation) {
					throw new UserError("Conversation not found", {
						code: "conversation_not_found",
					});
				}

				const now = Date.now();
				const userMessageId = nanoid();
				await c.db.execute(
					"INSERT INTO messages (id, conversation_id, role, content, created_at, metadata) VALUES (?, ?, ?, ?, ?, ?)",
					userMessageId,
					conversationId,
					"user",
					content,
					now,
					null,
				);

				const history = (await c.db.execute(
					"SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?",
					conversationId,
					MAX_CONTEXT_MESSAGES,
				)) as Pick<Message, "role" | "content">[];
				history.reverse();

				const assistantMessageId = nanoid();
				const assistantCreatedAt = Date.now();
				const workersai = createWorkersAI({ binding: env.AI });
				let assistantContent = "";

				try {
					const result = streamText({
						model: workersai(CHAT_MODEL),
						messages: history.map((m) => ({
							role: m.role,
							content: m.content,
						})),
						abortSignal: c.abortSignal,
					});
					for await (const part of result.textStream) {
						assistantContent += part;
						c.broadcast("messageDelta", {
							conversationId,
							messageId: assistantMessageId,
							content: part,
						});
					}
				} catch (cause) {
					throw new UserError("LLM call failed", {
						code: "llm_error",
						metadata: { cause: String(cause) },
					});
				}

				await c.db.execute(
					"INSERT INTO messages (id, conversation_id, role, content, created_at, metadata) VALUES (?, ?, ?, ?, ?, ?)",
					assistantMessageId,
					conversationId,
					"assistant",
					assistantContent,
					assistantCreatedAt,
					JSON.stringify({ model: CHAT_MODEL }),
				);
				await c.db.execute(
					"UPDATE conversations SET updated_at = ? WHERE id = ?",
					Date.now(),
					conversationId,
				);

				const assistantMessage: Message = {
					id: assistantMessageId,
					conversationId,
					role: "assistant",
					content: assistantContent,
					createdAt: assistantCreatedAt,
					metadata: JSON.stringify({ model: CHAT_MODEL }),
				};

				c.broadcast("messageComplete", {
					conversationId,
					message: assistantMessage,
				});

				return { message: assistantMessage };
			},

			getMessages: async (
				c,
				conversationId: string,
				{ limit = 50, before }: { limit?: number; before?: string } = {},
			) => {
				if (
					!conversationId ||
					!Number.isInteger(limit) ||
					limit <= 0 ||
					limit > MAX_PAGE_LIMIT
				) {
					throw new UserError(
						`conversationId and limit between 1 and ${MAX_PAGE_LIMIT} are required`,
						{ code: "invalid_params" },
					);
				}

				const params: (string | number)[] = [conversationId];
				let sql =
					"SELECT id, conversation_id AS conversationId, role, content, created_at AS createdAt, metadata FROM messages WHERE conversation_id = ?";

				if (before) {
					const cursor = decodeCursor(before);
					sql += " AND (created_at < ? OR (created_at = ? AND id < ?))";
					params.push(cursor.createdAt, cursor.createdAt, cursor.id);
				}

				sql += " ORDER BY created_at DESC, id DESC LIMIT ?";
				params.push(limit + 1);

				const rows = (await c.db.execute(sql, ...params)) as Message[];

				const hasMore = rows.length > limit;
				const page = hasMore ? rows.slice(0, limit) : rows;
				const nextCursor = hasMore
					? encodeCursor(page[page.length - 1])
					: undefined;

				return { messages: page.reverse(), nextCursor };
			},

			listConversations: async (c) => {
				const rows = (await c.db.execute(
					"SELECT id, title, created_at AS createdAt, updated_at AS updatedAt FROM conversations ORDER BY updated_at DESC",
				)) as Conversation[];
				return { conversations: rows };
			},

			deleteConversation: async (c, conversationId: string) => {
				await c.db.execute(
					"DELETE FROM messages WHERE conversation_id = ?",
					conversationId,
				);
				await c.db.execute(
					"DELETE FROM conversations WHERE id = ?",
					conversationId,
				);
				return { success: true as const };
			},
		},
	});
}

export const chat = createChatActor("user");
export const projectChat = createChatActor("project");
