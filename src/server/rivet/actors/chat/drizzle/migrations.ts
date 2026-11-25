import journal from "./meta/_journal.json";

const m0000 = `
CREATE TABLE \`conversations\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`title\` text,
	\`created_at\` integer NOT NULL,
	\`updated_at\` integer NOT NULL
);
CREATE TABLE \`messages\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`conversation_id\` text NOT NULL,
	\`role\` text NOT NULL,
	\`content\` text NOT NULL,
	\`created_at\` integer NOT NULL,
	\`metadata\` text
);
CREATE INDEX \`idx_conversations_updated_at\` ON \`conversations\` (\`updated_at\`);
CREATE INDEX \`idx_messages_conversation_created\` ON \`messages\` (\`conversation_id\`,\`created_at\`);
`;

export default {
	journal,
	migrations: {
		m0000,
	},
};
