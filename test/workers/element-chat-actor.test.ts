// End-to-end element chat tests through the real `elementChat` RivetKit
// actor (KUK-942): one actor per project (key `["elementChat", projectId]`)
// hosts all of the project's conversations; the CONVERSATION rides in the
// connection params (`getOrCreate(key, { params: { elementChatId } })` /
// `useActor({ …, params })`), is validated and project-fenced at connect
// into the connection state, and events route only to connections in the
// same conversation (multiplayer scoping). A message body can never choose
// the conversation.
// Mirrors campaign-chat-actor.test.ts's harness (mocked workers-ai-provider
// + MockLanguageModelV3, turns driven through the ACTOR_DO binding).
import { env } from "cloudflare:workers";
import type {
	LanguageModelV3,
	LanguageModelV3StreamPart,
} from "@ai-sdk/provider";
import { createInlineClient } from "@rivetkit/cloudflare-workers";
import type { UIMessageChunk } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkersAI } from "workers-ai-provider";
import {
	ELEMENT_CHAT_CONFLICT_ERROR,
	elementChatMessageInput,
	elementChatTurnInput,
} from "@/features/design-studio/element-chat/element-chat";
import {
	type ElementChatConnState,
	elementChat,
} from "../../src/server/rivet/actors/element-chat/index";
import { registry } from "../../src/server/rivet/registry";
import {
	createAdminSession,
	createUserSession,
	type TestSession,
} from "../helpers/auth";
import { createProject } from "../helpers/fixtures";
import {
	createTrpcTestClient,
	type TrpcTestClient,
	trpcErrorCode,
	trpcErrorMessage,
} from "../helpers/trpc";

// The actor lazy-loads @/lib/element-chat inside sendMessage so the mocked
// Workers AI provider below is reached instead of the real AI binding — the
// same discipline the design and campaign chat actors follow. Turns run
// inside the ActorHandler Durable Object (env.ACTOR_DO stubs), so a direct
// lib import here would bypass the mocked module graph and must not drive
// turns.
vi.mock("workers-ai-provider", () => ({ createWorkersAI: vi.fn() }));

const usage = {
	inputTokens: {
		total: 0,
		noCache: 0,
		cacheRead: 0,
		cacheWrite: 0,
	},
	outputTokens: { total: 0, text: 0, reasoning: 0 },
};

function streamPrefix(): LanguageModelV3StreamPart[] {
	return [
		{ type: "stream-start", warnings: [] },
		{
			type: "response-metadata",
			id: "response-id",
			modelId: "test-model",
			timestamp: new Date(0),
		},
		{ type: "text-start", id: "text-id" },
	];
}

function streamSuffix(): LanguageModelV3StreamPart[] {
	return [
		{ type: "text-end", id: "text-id" },
		{
			type: "finish",
			finishReason: { unified: "stop", raw: undefined },
			usage,
		},
	];
}

function immediateTextStream(
	text: string,
): ReadableStream<LanguageModelV3StreamPart> {
	return new ReadableStream({
		start(controller) {
			for (const chunk of [
				...streamPrefix(),
				{ type: "text-delta", id: "text-id", delta: text } as const,
				...streamSuffix(),
			]) {
				controller.enqueue(chunk);
			}
			controller.close();
		},
	});
}

function installModel(doStream: LanguageModelV3["doStream"]) {
	const model = new MockLanguageModelV3({ doStream });
	const factory = vi.fn(() => model);
	vi.mocked(createWorkersAI).mockReturnValue(factory as never);
	return { model, factory };
}

function adminClient(session: TestSession): TrpcTestClient {
	return createTrpcTestClient(session.headers);
}

async function makeAdminSession() {
	const session = await createAdminSession();
	await env.DB.prepare(`UPDATE "user" SET role = ? WHERE id = ?`)
		.bind("admin", session.userId)
		.run();
	return session;
}

// The inline client dispatches through the ACTOR_DO binding with no HTTP
// request — the actor's request-less arm treats the synthetic http://actor
// origin as a system caller.
const { client: actorClient } = createInlineClient(registry);

type TestSessionRow = {
	id: string;
	projectId: string;
	elementType: string;
	elementId: string;
};

/** Project + component row + the ElementChat session row for it. */
async function seedElementChat(overrides: Partial<TestSessionRow> = {}) {
	const project = await createProject();
	const componentId = crypto.randomUUID();
	const now = new Date().toISOString();
	await env.DB.prepare(
		`INSERT INTO "Component" (id, projectId, name, kind, tagName, createdAt, updatedAt)
			VALUES (?, ?, 'TestComponent', 'section', 'tb-test-component', ?, ?)`,
	)
		.bind(componentId, project.id, now, now)
		.run();
	const id = crypto.randomUUID();
	await env.DB.prepare(
		`INSERT INTO "ElementChat" (id, projectId, elementType, elementId, contextPrompt, createdAt, updatedAt)
			VALUES (?, ?, 'component', ?, 'Focused context for the test component.', ?, ?)`,
	)
		.bind(id, project.id, componentId, now, now)
		.run();
	const session: TestSessionRow = {
		id,
		projectId: project.id,
		elementType: "component",
		elementId: componentId,
		...overrides,
	};
	return { project, componentId, session };
}

async function sessionRow(id: string) {
	return env.DB.prepare(
		`SELECT activeTurnId, status, error FROM "ElementChat" WHERE id = ?`,
	)
		.bind(id)
		.first<{
			activeTurnId: string | null;
			status: string;
			error: string | null;
		}>();
}

async function messages(sessionId: string) {
	const rows = await env.DB.prepare(
		`SELECT role, content FROM "Message" WHERE elementId = ? ORDER BY createdAt, rowid`,
	)
		.bind(sessionId)
		.all<{ role: string; content: string }>();
	return rows.results;
}

type ActorTurnResult = {
	chunks: UIMessageChunk[];
	failed: string | undefined;
	finished: boolean;
	/** Raw rejection from the action call, if any. */
	actionError: unknown;
};

function startTurn(
	projectId: string,
	elementChatId: string,
	message: string,
	/** Extra message-body keys (e.g. a smuggled elementChatId) for tests. */
	extraBody: Record<string, unknown> = {},
): {
	chunks: UIMessageChunk[];
	done: Promise<ActorTurnResult>;
	dispose: () => Promise<void>;
} {
	// The conversation rides in the connection params — exactly how the
	// studio's useActor will pass it — never in the message body.
	const handle = actorClient.elementChat.getOrCreate(
		["elementChat", projectId],
		{ params: { elementChatId } },
	);
	const conn = handle.connect();
	const chunks: UIMessageChunk[] = [];
	let failed: string | undefined;
	let finished = false;
	let settled = false;
	let resolveDone!: (result: ActorTurnResult) => void;
	const done = new Promise<ActorTurnResult>((resolve) => {
		resolveDone = resolve;
	});
	const finish = (actionError?: unknown) => {
		if (settled) return;
		settled = true;
		resolveDone({ chunks, failed, finished, actionError });
	};
	const unsubs = [
		conn.on("uiMessageChunk", (payload: unknown) => {
			const chunk =
				(payload as { chunk?: UIMessageChunk } | undefined)?.chunk ??
				(payload as UIMessageChunk);
			if (chunk) chunks.push(chunk);
		}),
		conn.on("turnFinished", () => {
			finished = true;
		}),
		conn.on("turnFailed", (payload: unknown) => {
			failed =
				(payload as { error?: string } | undefined)?.error ??
				"element chat turn failed";
		}),
	];
	conn
		.sendMessage({
			message,
			...extraBody,
		})
		.then(
			() => finish(),
			(error) => finish(error),
		);
	return {
		chunks,
		done,
		dispose: async () => {
			for (const unsub of unsubs) unsub();
			await conn.dispose().catch(() => {});
		},
	};
}

async function runTurn(
	projectId: string,
	elementChatId: string,
	message: string,
	extraBody: Record<string, unknown> = {},
) {
	const turn = startTurn(projectId, elementChatId, message, extraBody);
	const result = await turn.done;
	await turn.dispose();
	return result;
}

function chunkDeltas(chunks: UIMessageChunk[]): string {
	return chunks
		.map((chunk) => (chunk.type === "text-delta" ? chunk.delta : ""))
		.join("");
}

/** A subscribed viewer connection (params-scoped) that never sends. */
function viewer(projectId: string, elementChatId: string) {
	const handle = actorClient.elementChat.getOrCreate(
		["elementChat", projectId],
		{ params: { elementChatId } },
	);
	const conn = handle.connect();
	const chunks: UIMessageChunk[] = [];
	const unsub = conn.on("uiMessageChunk", (payload: unknown) => {
		const chunk =
			(payload as { chunk?: UIMessageChunk } | undefined)?.chunk ??
			(payload as UIMessageChunk);
		if (chunk) chunks.push(chunk);
	});
	// No bind call: the conversation was declared by the connection params.
	return {
		chunks,
		dispose: async () => {
			unsub();
			await conn.dispose().catch(() => {});
		},
	};
}

beforeEach(() => {
	installModel(async () => ({ stream: immediateTextStream("ok") }));
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("Element chat actor authorization", () => {
	type CreateConnStateFn = (
		c: { request?: Request; key: string[] },
		params: unknown,
	) => Promise<ElementChatConnState>;

	function getCreateConnState(): CreateConnStateFn {
		return (
			elementChat.config as unknown as { createConnState: CreateConnStateFn }
		).createConnState;
	}

	it("lets an admin connect to an element chat actor", async () => {
		const session = await makeAdminSession();
		const { project, session: chat } = await seedElementChat();
		const state = await getCreateConnState()(
			{
				request: new Request("http://localhost/rivet", {
					headers: session.headers,
				}),
				key: ["elementChat", project.id],
			},
			{ elementChatId: chat.id },
		);
		expect(state.userId).toBe(session.userId);
		expect(state.role).toBe("admin");
		expect(state.elementChatId).toBe(chat.id);
	});

	it("rejects a non-admin caller", async () => {
		const session = await createUserSession("user");
		await expect(
			getCreateConnState()(
				{
					request: new Request("http://localhost/rivet", {
						headers: session.headers,
					}),
					key: ["elementChat", "project-1"],
				},
				{ elementChatId: "session-1" },
			),
		).rejects.toMatchObject({ code: "forbidden" });
	});

	it("rejects unauthenticated callers", async () => {
		await expect(
			getCreateConnState()(
				{
					request: new Request("http://localhost/rivet"),
					key: ["elementChat", "project-1"],
				},
				{ elementChatId: "session-1" },
			),
		).rejects.toMatchObject({ code: "unauthorized" });
	});

	it("rejects request-less callers with no request at all", async () => {
		await expect(
			getCreateConnState()(
				{ key: ["elementChat", "project-1"] },
				{ elementChatId: "session-1" },
			),
		).rejects.toMatchObject({ code: "unauthorized" });
	});

	it("rejects an invalid actor key", async () => {
		const session = await makeAdminSession();
		await expect(
			getCreateConnState()(
				{
					request: new Request("http://localhost/rivet", {
						headers: session.headers,
					}),
					key: ["element", "project-1"],
				},
				{ elementChatId: "session-1" },
			),
		).rejects.toMatchObject({ code: "invalid_actor_key" });
	});

	it("rejects missing or malformed connection params", async () => {
		const session = await makeAdminSession();
		const { project } = await seedElementChat();
		for (const params of [undefined, {}, { elementChatId: "" }, "chat-1"]) {
			await expect(
				getCreateConnState()(
					{
						request: new Request("http://localhost/rivet", {
							headers: session.headers,
						}),
						key: ["elementChat", project.id],
					},
					params,
				),
			).rejects.toMatchObject({ code: "invalid_conn_params" });
		}
	});

	it("rejects params pointing at another project's conversation", async () => {
		const session = await makeAdminSession();
		const { session: chat } = await seedElementChat();
		const other = await createProject();
		await expect(
			getCreateConnState()(
				{
					request: new Request("http://localhost/rivet", {
						headers: session.headers,
					}),
					key: ["elementChat", other.id],
				},
				{ elementChatId: chat.id },
			),
		).rejects.toMatchObject({ code: "forbidden" });
	});

	it("rejects params pointing at an unknown conversation", async () => {
		const session = await makeAdminSession();
		const { project } = await seedElementChat();
		await expect(
			getCreateConnState()(
				{
					request: new Request("http://localhost/rivet", {
						headers: session.headers,
					}),
					key: ["elementChat", project.id],
				},
				{ elementChatId: crypto.randomUUID() },
			),
		).rejects.toMatchObject({ code: "not_found" });
	});

	it("treats inline-driver callers (synthetic http://actor origin) as system callers", async () => {
		const { project, session: chat } = await seedElementChat();
		const state = await getCreateConnState()(
			{
				request: new Request("http://actor/action/sendMessage"),
				key: ["elementChat", project.id],
			},
			{ elementChatId: chat.id },
		);
		expect(state.role).toBe("system");
		expect(state.elementChatId).toBe(chat.id);
	});
});

describe("Element chat actor contract", () => {
	it("exports the sendMessage action (bind is gone — params scope connections)", () => {
		const config = elementChat.config as unknown as {
			actions: Record<string, unknown>;
		};
		expect(config.actions.sendMessage).toBeDefined();
		expect(config.actions.bind).toBeUndefined();
	});

	it("exports ui message stream events", () => {
		const config = elementChat.config as unknown as {
			events: Record<string, unknown>;
		};
		expect(config.events.uiMessageChunk).toBeDefined();
		expect(config.events.turnFinished).toBeDefined();
		expect(config.events.turnFailed).toBeDefined();
	});
});

describe("Element chat turn input", () => {
	it.each([
		{},
		{ message: "" },
		{ message: "   " },
		{ message: "x".repeat(8001) },
		{ message: 42 },
	])("rejects invalid message input %#", (body) => {
		expect(elementChatMessageInput.safeParse(body).success).toBe(false);
	});

	it("accepts unknown model strings (coerced server-side)", () => {
		expect(
			elementChatMessageInput.safeParse({
				message: "hello",
				model: "removed-model",
			}).success,
		).toBe(true);
	});

	// The full turn schema (non-actor callers) still requires the id.
	it("rejects a turn input without an explicit elementChatId", () => {
		expect(elementChatTurnInput.safeParse({ message: "hello" }).success).toBe(
			false,
		);
	});
});

describe("Element chat actor turns", () => {
	it("ignores an elementChatId in the message body — the connection params rule", async () => {
		const { model } = installModel(async () => ({
			stream: immediateTextStream("params win"),
		}));
		const { project, session: chatA } = await seedElementChat();
		// A second conversation in the SAME project (same actor).
		const chatBId = crypto.randomUUID();
		const now = new Date().toISOString();
		await env.DB.prepare(
			`INSERT INTO "ElementChat" (id, projectId, elementType, elementId, contextPrompt, createdAt, updatedAt)
				VALUES (?, ?, 'page', 'page-b', 'Context for page B.', ?, ?)`,
		)
			.bind(chatBId, project.id, now, now)
			.run();

		// The connection is scoped to chat A via params; the body tries to
		// redirect the turn to chat B. The body key is stripped by the
		// shared schema and the turn runs on chat A.
		const result = await runTurn(project.id, chatA.id, "hi", {
			elementChatId: chatBId,
		});

		expect(result.actionError).toBeUndefined();
		expect(chunkDeltas(result.chunks)).toContain("params win");
		expect(model.doStreamCalls).toHaveLength(1);
		// The turn ran on the params conversation, never on chat B.
		expect(await messages(chatA.id)).toEqual([
			{ role: "user", content: "hi" },
			{ role: "assistant", content: "params win" },
		]);
		expect(await messages(chatBId)).toEqual([]);
	});

	// An unknown id in the params is rejected at connect time (see the
	// authorization describe); nothing reaches the model or D1.
	it("runs a turn and emits chunks, finish and persistence", async () => {
		const { model } = installModel(async () => ({
			stream: immediateTextStream("component tuned"),
		}));
		const { project, session } = await seedElementChat();
		const result = await runTurn(project.id, session.id, "tighten spacing");

		expect(result.actionError).toBeUndefined();
		expect(result.failed).toBeUndefined();
		expect(result.finished).toBe(true);
		expect(chunkDeltas(result.chunks)).toContain("component tuned");
		expect(model.doStreamCalls).toHaveLength(1);
		expect(await messages(session.id)).toEqual([
			{ role: "user", content: "tighten spacing" },
			{ role: "assistant", content: "component tuned" },
		]);
		expect(await sessionRow(session.id)).toEqual({
			activeTurnId: null,
			status: "ready",
			error: null,
		});
	});

	it("surfaces a concurrent turn as the public conflict error", async () => {
		installModel(async () => ({ stream: immediateTextStream("ok") }));
		const { project, session } = await seedElementChat();
		await env.DB.prepare(
			`UPDATE "ElementChat" SET activeTurnId = ?, turnClaimedAt = ? WHERE id = ?`,
		)
			.bind("other-turn", new Date().toISOString(), session.id)
			.run();

		const result = await runTurn(project.id, session.id, "conflicting");
		expect(result.failed).toBe(ELEMENT_CHAT_CONFLICT_ERROR);
		expect(String(result.actionError)).toContain(ELEMENT_CHAT_CONFLICT_ERROR);
		// The foreign lease is untouched.
		expect((await sessionRow(session.id))?.activeTurnId).toBe("other-turn");
	});

	it("scopes stream events to connections in the same conversation", async () => {
		installModel(async () => ({
			stream: immediateTextStream("only for chat one"),
		}));
		const { project, session: chatOne } = await seedElementChat();
		// A second element chat in a DIFFERENT project (a different actor).
		const second = await seedElementChat();
		expect(second.project.id).not.toBe(project.id);

		const viewerOne = viewer(project.id, chatOne.id);
		const viewerOtherProjectChat = viewer(second.project.id, second.session.id);

		const result = await runTurn(project.id, chatOne.id, "stream to one");
		expect(result.failed).toBeUndefined();

		// A viewer of the same conversation sees the stream…
		await vi.waitFor(() => {
			expect(chunkDeltas(viewerOne.chunks)).toContain("only for chat one");
		});
		// …while a connection in another project's conversation (a
		// different actor entirely) sees nothing.
		expect(viewerOtherProjectChat.chunks).toEqual([]);
		await viewerOne.dispose();
		await viewerOtherProjectChat.dispose();
	});

	it("does not leak one element's stream into another element's connection on the same actor", async () => {
		installModel(async () => ({
			stream: immediateTextStream("chat A stream"),
		}));
		const { project, session: chatA } = await seedElementChat();
		// A second element chat in the SAME project → SAME actor instance.
		const chatBId = crypto.randomUUID();
		const now = new Date().toISOString();
		await env.DB.prepare(
			`INSERT INTO "ElementChat" (id, projectId, elementType, elementId, contextPrompt, createdAt, updatedAt)
				VALUES (?, ?, 'page', 'page-b', 'Context for page B.', ?, ?)`,
		)
			.bind(chatBId, project.id, now, now)
			.run();

		const viewerA = viewer(project.id, chatA.id);
		const viewerB = viewer(project.id, chatBId);

		const result = await runTurn(project.id, chatA.id, "stream on A");
		expect(result.failed).toBeUndefined();

		await vi.waitFor(() => {
			expect(chunkDeltas(viewerA.chunks)).toContain("chat A stream");
		});
		// Per-conversation scoping: B's connection is in a different
		// conversation on the SAME actor and receives none of A's chunks.
		expect(viewerB.chunks).toEqual([]);
		await viewerA.dispose();
		await viewerB.dispose();
	});
});

describe("Element chats tRPC router", () => {
	async function seedComponent(projectId: string) {
		const id = crypto.randomUUID();
		const now = new Date().toISOString();
		await env.DB.prepare(
			`INSERT INTO "Component" (id, projectId, name, kind, tagName, createdAt, updatedAt)
				VALUES (?, ?, 'RouterComponent', 'section', 'tb-router-component', ?, ?)`,
		)
			.bind(id, projectId, now, now)
			.run();
		return id;
	}

	it("requires an admin session", async () => {
		const unauthorized = () =>
			createTrpcTestClient().elementChats.listMessages.query({
				elementChatId: "any",
			});
		expect(await trpcErrorCode(unauthorized)).toBe("UNAUTHORIZED");
	});

	it("create validates element existence and project ownership", async () => {
		const session = await makeAdminSession();
		const project = await createProject();
		const componentId = await seedComponent(project.id);

		// Unknown element id → NOT_FOUND.
		const unknown = () =>
			adminClient(session).elementChats.create.mutate({
				projectId: project.id,
				elementType: "component",
				elementId: crypto.randomUUID(),
			});
		expect(await trpcErrorCode(unknown)).toBe("NOT_FOUND");
		expect(await trpcErrorMessage(unknown)).toBe(
			"element not found in this project",
		);

		// Element belongs to another project → NOT_FOUND, never written.
		const otherProject = await createProject();
		const cross = () =>
			adminClient(session).elementChats.create.mutate({
				projectId: otherProject.id,
				elementType: "component",
				elementId: componentId,
			});
		expect(await trpcErrorCode(cross)).toBe("NOT_FOUND");

		// Invalid elementType → BAD_REQUEST.
		const invalidType = () =>
			adminClient(session).elementChats.create.mutate({
				projectId: project.id,
				elementType: "widget" as never,
				elementId: componentId,
			});
		expect(await trpcErrorCode(invalidType)).toBe("BAD_REQUEST");

		const count = await env.DB.prepare(
			`SELECT COUNT(*) AS n FROM "ElementChat" WHERE projectId = ?`,
		)
			.bind(project.id)
			.first<{ n: number }>();
		expect(count?.n).toBe(0);
	});

	it("create is idempotent per (project, elementType, elementId)", async () => {
		const session = await makeAdminSession();
		const project = await createProject();
		const componentId = await seedComponent(project.id);

		const first = await adminClient(session).elementChats.create.mutate({
			projectId: project.id,
			elementType: "component",
			elementId: componentId,
		});
		const second = await adminClient(session).elementChats.create.mutate({
			projectId: project.id,
			elementType: "component",
			elementId: componentId,
		});
		expect(second.id).toBe(first.id);
		expect(second.status).toBe("ready");

		const rows = await env.DB.prepare(
			`SELECT id, contextPrompt FROM "ElementChat" WHERE projectId = ?`,
		)
			.bind(project.id)
			.all<{ id: string; contextPrompt: string }>();
		expect(rows.results).toHaveLength(1);
		expect(rows.results[0]?.id).toBe(first.id);
		// KUK-944: creation seeds the real context (the component's own
		// definition via the context builders), not a placeholder.
		expect(rows.results[0]?.contextPrompt).toContain("RouterComponent");
		expect(rows.results[0]?.contextPrompt).not.toContain("[Element chat:");
	});

	it("get returns the session and 404s unknown ids", async () => {
		const session = await makeAdminSession();
		const { session: chat } = await seedElementChat();
		const found = await adminClient(session).elementChats.get.query({
			elementChatId: chat.id,
		});
		expect(found.id).toBe(chat.id);
		expect(found.elementType).toBe("component");

		const missing = () =>
			adminClient(session).elementChats.get.query({
				elementChatId: crypto.randomUUID(),
			});
		expect(await trpcErrorCode(missing)).toBe("NOT_FOUND");
	});

	it("listMessages is chronological and scoped to the session", async () => {
		const session = await makeAdminSession();
		const { session: chat } = await seedElementChat();
		const other = await seedElementChat();
		const base = Date.parse("2026-01-01T00:00:00.000Z");
		const rows = [
			{ id: crypto.randomUUID(), role: "user", content: "first" },
			{ id: crypto.randomUUID(), role: "assistant", content: "answer" },
		];
		for (const [index, row] of rows.entries()) {
			await env.DB.prepare(
				`INSERT INTO "Message" (id, elementId, role, content, createdAt)
					VALUES (?, ?, ?, ?, ?)`,
			)
				.bind(
					row.id,
					chat.id,
					row.role,
					row.content,
					new Date(base + index * 1000).toISOString(),
				)
				.run();
		}
		// A message on ANOTHER element chat must not leak in.
		await env.DB.prepare(
			`INSERT INTO "Message" (id, elementId, role, content, createdAt)
				VALUES (?, ?, 'user', 'other chat', ?)`,
		)
			.bind(crypto.randomUUID(), other.session.id, new Date(base).toISOString())
			.run();

		const body = await adminClient(session).elementChats.listMessages.query({
			elementChatId: chat.id,
		});
		expect(body).toHaveLength(2);
		expect(body.map((row) => row.content)).toEqual(["first", "answer"]);
	});

	it("delete cascades the messages", async () => {
		const session = await makeAdminSession();
		const { session: chat } = await seedElementChat();
		await env.DB.prepare(
			`INSERT INTO "Message" (id, elementId, role, content, createdAt)
				VALUES (?, ?, 'user', 'to be deleted', ?)`,
		)
			.bind(crypto.randomUUID(), chat.id, new Date().toISOString())
			.run();

		const deleted = await adminClient(session).elementChats.delete.mutate({
			elementChatId: chat.id,
		});
		expect(deleted).toEqual({ ok: true });
		expect(await sessionRow(chat.id)).toBeNull();
		const rows = await env.DB.prepare(
			`SELECT COUNT(*) AS n FROM "Message" WHERE elementId = ?`,
		)
			.bind(chat.id)
			.first<{ n: number }>();
		expect(rows?.n).toBe(0);

		const missing = () =>
			adminClient(session).elementChats.delete.mutate({
				elementChatId: chat.id,
			});
		expect(await trpcErrorCode(missing)).toBe("NOT_FOUND");
	});
});
