import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
	env: { AI: {}, DB: {}, BETTER_AUTH_SECRET: "secret", ENVIRONMENT: "test" },
}));

vi.mock("workers-ai-provider", () => ({
	createWorkersAI: vi.fn(() => vi.fn()),
}));

vi.mock("@/lib/auth", () => ({
	getAuth: vi.fn(),
}));

import { getAuth } from "@/lib/auth";
import migrations from "../../src/server/rivet/actors/chat/drizzle/migrations";
import type { ChatConnState } from "../../src/server/rivet/actors/chat/index";
import {
	chat,
	decodeCursor,
	encodeCursor,
	projectChat,
} from "../../src/server/rivet/actors/chat/index";
import { schema } from "../../src/server/rivet/actors/chat/schema";

function makeRequest() {
	return new Request("http://localhost/rivet");
}

type CreateConnStateFn = (
	c: { request?: Request; key: string[] },
	params: unknown,
) => Promise<ChatConnState>;

function getCreateConnState(
	actor: typeof chat | typeof projectChat,
): CreateConnStateFn {
	return (actor.config as unknown as { createConnState: CreateConnStateFn })
		.createConnState;
}

function mockSession(user: { id: string; role: string | null }) {
	(vi.mocked(getAuth) as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
		api: {
			getSession: vi.fn().mockResolvedValue({ user }),
		},
	});
}

function mockMissingSession() {
	(vi.mocked(getAuth) as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
		api: {
			getSession: vi.fn().mockResolvedValue(null),
		},
	});
}

describe("chat actor database contract", () => {
	it("exports a conversations table with required columns", () => {
		expect(schema.conversations).toBeDefined();
		expect(schema.conversations.id).toBeDefined();
		expect(schema.conversations.title).toBeDefined();
		expect(schema.conversations.createdAt).toBeDefined();
		expect(schema.conversations.updatedAt).toBeDefined();
	});

	it("exports a messages table with required columns", () => {
		expect(schema.messages).toBeDefined();
		expect(schema.messages.id).toBeDefined();
		expect(schema.messages.conversationId).toBeDefined();
		expect(schema.messages.role).toBeDefined();
		expect(schema.messages.content).toBeDefined();
		expect(schema.messages.createdAt).toBeDefined();
		expect(schema.messages.metadata).toBeDefined();
	});

	it("has a migration that creates both tables", () => {
		const initSql = migrations.migrations.m0000 as string;
		expect(initSql).toBeTypeOf("string");
		const normalized = initSql.toLowerCase().replace(/`/g, "");
		expect(normalized).toContain("create table conversations");
		expect(normalized).toContain("create table messages");
	});

	it("has a journal that references the init migration", () => {
		expect(migrations.journal.entries).toHaveLength(1);
		const entry = migrations.journal.entries[0];
		expect(entry.tag).toBe("0000_init");
		expect(entry.idx).toBe(0);
	});
});

describe("chat actor authorization", () => {
	it("lets a user connect to their own user actor", async () => {
		mockSession({ id: "user-1", role: "user" });
		const state = await getCreateConnState(chat)(
			{ request: makeRequest(), key: ["user", "user-1"] },
			undefined,
		);
		expect(state.userId).toBe("user-1");
	});

	it("rejects a user trying to connect to another user's actor", async () => {
		mockSession({ id: "user-2", role: "user" });
		await expect(
			getCreateConnState(chat)(
				{ request: makeRequest(), key: ["user", "user-1"] },
				undefined,
			),
		).rejects.toMatchObject({ code: "forbidden" });
	});

	it("rejects unauthenticated callers", async () => {
		mockMissingSession();
		await expect(
			getCreateConnState(chat)(
				{ request: makeRequest(), key: ["user", "user-1"] },
				undefined,
			),
		).rejects.toMatchObject({ code: "unauthorized" });
	});

	it("lets admins connect to any project chat actor", async () => {
		mockSession({ id: "admin-1", role: "admin" });
		const state = await getCreateConnState(projectChat)(
			{ request: makeRequest(), key: ["project", "project-1"] },
			undefined,
		);
		expect(state.userId).toBe("admin-1");
	});

	it("rejects non-admins connecting to a project chat actor", async () => {
		mockSession({ id: "user-1", role: "user" });
		await expect(
			getCreateConnState(projectChat)(
				{ request: makeRequest(), key: ["project", "project-1"] },
				undefined,
			),
		).rejects.toMatchObject({ code: "forbidden" });
	});
});

describe("chat actor cursor", () => {
	it("round-trips a cursor", () => {
		const message = { createdAt: 1_700_000_000_000, id: "msg-123" };
		const cursor = encodeCursor(message);
		expect(decodeCursor(cursor)).toEqual(message);
	});

	it("rejects malformed cursors", () => {
		expect(() => decodeCursor("not-a-cursor")).toThrow();
		expect(() => decodeCursor("abc:msg")).toThrow();
		expect(() => decodeCursor("123:")).toThrow();
	});
});
