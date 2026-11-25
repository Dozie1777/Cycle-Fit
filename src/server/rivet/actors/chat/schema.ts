import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const conversations = sqliteTable(
	"conversations",
	{
		id: text("id").primaryKey(),
		title: text("title"),
		createdAt: integer("created_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
	},
	(table) => ({
		updatedAtIdx: index("idx_conversations_updated_at").on(table.updatedAt),
	}),
);

export const messages = sqliteTable(
	"messages",
	{
		id: text("id").primaryKey(),
		conversationId: text("conversation_id").notNull(),
		role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
		content: text("content").notNull(),
		createdAt: integer("created_at").notNull(),
		metadata: text("metadata"),
	},
	(table) => ({
		conversationCreatedIdx: index("idx_messages_conversation_created").on(
			table.conversationId,
			table.createdAt,
		),
	}),
);

export const schema = { conversations, messages };
