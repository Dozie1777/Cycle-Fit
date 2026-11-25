// Worker tests for the element chat turn pipeline (KUK-941): the lease on
// the ElementChat row must behave exactly like the design/campaign chats —
// claim, conflict, abandoned-lease reclaim, terminal fencing (a stolen
// lease can never persist its assistant message), and the shared 40-min
// deadline / 45-min reclaim window. Driven directly through
// runElementChatTurnStream with a mocked Workers AI model, mirroring
// campaign-chat-actor.test.ts's harness (no actor yet — that is KUK-942).
import { env } from "cloudflare:workers";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { MockLanguageModelV3 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkersAI } from "workers-ai-provider";
import { z } from "zod";
import {
	ELEMENT_CHAT_CONFLICT_ERROR,
	ELEMENT_CHAT_TIMEOUT_ERROR,
	runElementChatTurnStream,
} from "@/features/design-studio/element-chat/element-chat";
import { createProject } from "../helpers/fixtures";

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

/** Stalls mid-stream until the gate resolves — the lease-theft interleave. */
function gatedTextStream(
	first: string,
	second: string,
	gate: Promise<void>,
): ReadableStream<LanguageModelV3StreamPart> {
	return new ReadableStream({
		async start(controller) {
			for (const chunk of streamPrefix()) controller.enqueue(chunk);
			controller.enqueue({ type: "text-delta", id: "text-id", delta: first });
			await gate;
			controller.enqueue({ type: "text-delta", id: "text-id", delta: second });
			for (const chunk of streamSuffix()) controller.enqueue(chunk);
			controller.close();
		},
	});
}

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

function installModel(stream: () => ReadableStream<LanguageModelV3StreamPart>) {
	const model = new MockLanguageModelV3({
		doStream: async () => ({ stream: stream() }),
	});
	const factory = vi.fn(() => model);
	vi.mocked(createWorkersAI).mockReturnValue(factory as never);
	return { model, factory };
}

async function seedSession(
	overrides: Partial<{
		projectElementId: string;
	}> = {},
) {
	const project = await createProject();
	const id = crypto.randomUUID();
	const now = new Date().toISOString();
	await env.DB.prepare(
		`INSERT INTO "ElementChat" (id, projectId, elementType, elementId, contextPrompt, createdAt, updatedAt)
			VALUES (?, ?, 'component', ?, 'Focused context for the calendar component.', ?, ?)`,
	)
		.bind(id, project.id, overrides.projectElementId ?? "comp-1", now, now)
		.run();
	return { id, projectId: project.id };
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
		`SELECT role, content, designId, campaignId, elementId FROM "Message"
			WHERE elementId = ? ORDER BY "createdAt" ASC`,
	)
		.bind(sessionId)
		.all<{
			role: string;
			content: string;
			designId: string | null;
			campaignId: string | null;
			elementId: string;
		}>();
	return rows.results;
}

async function runTurn(
	sessionId: string,
	message: string,
	options: Partial<
		Omit<Parameters<typeof runElementChatTurnStream>[2], "message">
	> = {},
) {
	const chunks: unknown[] = [];
	await runElementChatTurnStream(
		env,
		sessionId,
		{ message, ...options },
		(chunk) => chunks.push(chunk),
	);
	return chunks;
}

beforeEach(() => {
	vi.mocked(createWorkersAI).mockReset();
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("Element chat turn pipeline (KUK-941)", () => {
	it("persists the turn and releases the lease on finish", async () => {
		const session = await seedSession();
		installModel(() => immediateTextStream("component updated"));
		const chunks = await runTurn(session.id, "make the calendar compact");

		expect(chunks.length).toBeGreaterThan(0);
		const rows = await messages(session.id);
		expect(rows).toEqual([
			{
				role: "user",
				content: "make the calendar compact",
				designId: null,
				campaignId: null,
				elementId: session.id,
			},
			{
				role: "assistant",
				content: "component updated",
				designId: null,
				campaignId: null,
				elementId: session.id,
			},
		]);
		const row = await sessionRow(session.id);
		expect(row).toEqual({ activeTurnId: null, status: "ready", error: null });
	});

	it("conflicts while another turn holds the lease", async () => {
		const session = await seedSession();
		// A live foreign turn holds the lease (claimed just now).
		await env.DB.prepare(
			`UPDATE "ElementChat" SET activeTurnId = ?, turnClaimedAt = ? WHERE id = ?`,
		)
			.bind("other-turn", new Date().toISOString(), session.id)
			.run();
		installModel(() => immediateTextStream("never"));
		await expect(runTurn(session.id, "hello")).rejects.toThrow(
			ELEMENT_CHAT_CONFLICT_ERROR,
		);
		// The foreign lease is untouched.
		const row = await sessionRow(session.id);
		expect(row?.activeTurnId).toBe("other-turn");
	});

	it("reclaims an abandoned lease older than the 45-minute window", async () => {
		const session = await seedSession();
		const stale = new Date(Date.now() - 46 * 60 * 1000).toISOString();
		await env.DB.prepare(
			`UPDATE "ElementChat" SET activeTurnId = 'abandoned-turn', turnClaimedAt = ? WHERE id = ?`,
		)
			.bind(stale, session.id)
			.run();
		installModel(() => immediateTextStream("reclaimed"));
		await runTurn(session.id, "retry after abandon");
		const row = await sessionRow(session.id);
		expect(row?.status).toBe("ready");
		const rows = await messages(session.id);
		expect(rows.map((m) => m.role)).toEqual(["user", "assistant"]);
	});

	it("never persists an assistant message after its lease was stolen", async () => {
		const session = await seedSession();
		const gate = deferred();
		installModel(() => gatedTextStream("partial ", "tail", gate.promise));
		const turn = runTurn(session.id, "say something");

		// Let the first chunk land, then steal the lease (a successor turn
		// reclaimed it mid-stream).
		await new Promise((resolve) => setTimeout(resolve, 50));
		await env.DB.prepare(
			`UPDATE "ElementChat" SET activeTurnId = 'successor-turn', turnClaimedAt = ? WHERE id = ?`,
		)
			.bind(new Date().toISOString(), session.id)
			.run();
		gate.resolve();
		await turn;

		// The abandoned turn's assistant tail is fenced out.
		const rows = await messages(session.id);
		expect(rows.map((m) => m.role)).toEqual(["user"]);
		// And its failTurn could not clobber the successor's lease either —
		// every fenced write (assistant persist AND failure finalize) matches
		// zero rows because the turn no longer owns the lease.
		const row = await sessionRow(session.id);
		expect(row?.activeTurnId).toBe("successor-turn");
	});

	it("fences injected element tools through the turn lease", async () => {
		const session = await seedSession();
		let fenceError: string | null = null;
		// Model that calls the injected update_element tool once, then
		// finishes with text (mirrors campaign-chat-actor's toolCallModel).
		let step = 0;
		const model = new MockLanguageModelV3({
			doStream: async () => {
				step += 1;
				if (step > 1) return { stream: immediateTextStream("tool finished") };
				return {
					stream: new ReadableStream<LanguageModelV3StreamPart>({
						start(controller) {
							controller.enqueue({ type: "stream-start", warnings: [] });
							controller.enqueue({
								type: "tool-call",
								toolCallId: "tool-call-1",
								toolName: "update_element",
								input: JSON.stringify({}),
							});
							controller.enqueue({
								type: "finish",
								finishReason: { unified: "tool-calls", raw: undefined },
								usage,
							});
							controller.close();
						},
					}),
				};
			},
		});
		vi.mocked(createWorkersAI).mockReturnValue(vi.fn(() => model) as never);

		await runTurn(session.id, "use the tool", {
			assembleTools: (fence) => ({
				update_element: {
					description: "test tool",
					inputSchema: z.object({}),
					execute: async () => {
						// Steal the lease from under this turn, then fence:
						// the fence must reject the stale turn.
						await env.DB.prepare(
							`UPDATE "ElementChat" SET activeTurnId = 'successor-turn', turnClaimedAt = ? WHERE id = ?`,
						)
							.bind(new Date().toISOString(), session.id)
							.run();
						try {
							await fence();
						} catch (e) {
							fenceError = e instanceof Error ? e.message : String(e);
							throw e;
						}
						return { ok: true };
					},
				},
			}),
		});

		expect(fenceError).toBe("stale element chat turn");
		// No assistant row: the turn's fenced persist matches zero rows (the
		// successor owns the lease), and neither can its failTurn write.
		const rows = await messages(session.id);
		expect(rows.map((m) => m.role)).toEqual(["user"]);
		const row = await sessionRow(session.id);
		expect(row?.activeTurnId).toBe("successor-turn");
	});

	it("releases the lease and persists failed status when post-claim setup fails", async () => {
		const session = await seedSession();
		installModel(() => immediateTextStream("never reached"));
		// Make user-message persistence fail deterministically: hide the
		// Message table for the duration of the turn (reversible rename, no
		// schema loss), then restore it in the finally.
		await env.DB.prepare(
			'ALTER TABLE "Message" RENAME TO "Message_hidden"',
		).run();
		try {
			await expect(runTurn(session.id, "hello")).rejects.toThrow();
		} finally {
			await env.DB.prepare(
				'ALTER TABLE "Message_hidden" RENAME TO "Message"',
			).run();
		}
		// The lease was released immediately through failTurn — the session
		// is not wedged "chatting" until the 45-minute lazy reclaim.
		const row = await sessionRow(session.id);
		expect(row).toEqual({
			activeTurnId: null,
			status: "failed",
			error: expect.any(String),
		});
		// And the chat is progressable again right away.
		installModel(() => immediateTextStream("recovered"));
		await runTurn(session.id, "next turn");
		const after = await sessionRow(session.id);
		expect(after).toEqual({ activeTurnId: null, status: "ready", error: null });
	});

	it("fails a hung stream at the deadline and persists the timeout error", async () => {
		const session = await seedSession();
		// A stream that never finishes: no text-end, no finish chunk.
		installModel(
			() =>
				new ReadableStream<LanguageModelV3StreamPart>({
					start(controller) {
						for (const chunk of streamPrefix()) controller.enqueue(chunk);
					},
				}),
		);
		const envWithTimeout = env as unknown as Record<string, unknown>;
		const previousTimeout = envWithTimeout.ELEMENT_CHAT_TURN_TIMEOUT_MS;
		envWithTimeout.ELEMENT_CHAT_TURN_TIMEOUT_MS = "120";
		try {
			await expect(runTurn(session.id, "hung turn")).rejects.toThrow(
				/element chat turn exceeded/,
			);
			await vi.waitFor(async () => {
				expect(await sessionRow(session.id)).toEqual({
					activeTurnId: null,
					status: "failed",
					error: ELEMENT_CHAT_TIMEOUT_ERROR,
				});
			});
		} finally {
			if (previousTimeout === undefined) {
				delete envWithTimeout.ELEMENT_CHAT_TURN_TIMEOUT_MS;
			} else {
				envWithTimeout.ELEMENT_CHAT_TURN_TIMEOUT_MS = previousTimeout;
			}
		}

		// The session is progressable again immediately — no 45-minute wait.
		installModel(() => immediateTextStream("recovered"));
		await runTurn(session.id, "next turn");
		expect(await sessionRow(session.id)).toEqual({
			activeTurnId: null,
			status: "ready",
			error: null,
		});
	});
});
