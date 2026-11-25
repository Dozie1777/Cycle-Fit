import { env } from "cloudflare:workers";
import { createMCPClient } from "@ai-sdk/mcp";
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
	CAMPAIGN_CHAT_CANCELLED_ERROR,
	CAMPAIGN_CHAT_CONFLICT_ERROR,
	CAMPAIGN_CHAT_PUBLIC_ERROR,
	CAMPAIGN_CHAT_TIMEOUT_ERROR,
	campaignChatTurnInput,
} from "@/features/campaigns/chat/campaign-chat";
import {
	type CampaignChatConnState,
	campaignChat,
} from "../../src/server/rivet/actors/campaign-chat/index";
import { registry } from "../../src/server/rivet/registry";
import {
	createAdminSession,
	createUserSession,
	type TestSession,
} from "../helpers/auth";
import { createCampaign } from "../helpers/fixtures";
import {
	createTrpcTestClient,
	type TrpcTestClient,
	trpcErrorCode,
	trpcErrorMessage,
} from "../helpers/trpc";

// End-to-end campaign chat turn tests through the real `campaignChat`
// RivetKit actor (KUK-874 chat moved from the SSE route to the actor). The
// actor lazy-loads @/lib/campaign-chat inside sendMessage so the mocked
// Workers AI provider below is reached instead of the real AI binding — the
// same discipline the design chat actor follows. Turns run inside the
// ActorHandler Durable Object (env.ACTOR_DO stubs), so a direct lib import
// here would bypass the mocked module graph and must not drive turns.
vi.mock("@ai-sdk/mcp", () => ({ createMCPClient: vi.fn() }));
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

function installModel(doStream: LanguageModelV3["doStream"]) {
	const model = new MockLanguageModelV3({ doStream });
	const factory = vi.fn(() => model);
	vi.mocked(createWorkersAI).mockReturnValue(factory as never);
	return { model, factory };
}

function toolCallModel(toolName: string, input: unknown) {
	let step = 0;
	return new MockLanguageModelV3({
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
							toolName,
							input: JSON.stringify(input),
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
}

function installToolCallModel(toolName: string, input: unknown) {
	const model = toolCallModel(toolName, input);
	const factory = vi.fn(() => model);
	vi.mocked(createWorkersAI).mockReturnValue(factory as never);
	return { model, factory };
}

function adminClient(session: TestSession): TrpcTestClient {
	return createTrpcTestClient(session.headers);
}

function mockMcpClient() {
	const client = {
		tools: vi.fn(async () => ({})),
		close: vi.fn(async () => {}),
	};
	vi.mocked(createMCPClient).mockResolvedValue(client as never);
	return client;
}

// The inline client dispatches through the ACTOR_DO binding with no HTTP
// request — the actor's request-less arm treats it as a system caller.
const { client: actorClient } = createInlineClient(registry);

type TurnBody = {
	message: string;
	model?: string;
	thinkingEffort?: string;
};

type ActorTurnResult = {
	chunks: UIMessageChunk[];
	/** Public error text carried by the turnFailed event, if any. */
	failed: string | undefined;
	/** Raw rejection from the sendMessage action call, if any. */
	actionError: unknown;
};

type ActorTurn = {
	chunks: UIMessageChunk[];
	done: Promise<ActorTurnResult>;
	dispose: () => Promise<void>;
};

function startTurn(campaignId: string, body: TurnBody): ActorTurn {
	const handle = actorClient.campaignChat.getOrCreate(["campaign", campaignId]);
	const conn = handle.connect();
	const chunks: UIMessageChunk[] = [];
	let failed: string | undefined;
	let settled = false;
	let resolveDone!: (result: ActorTurnResult) => void;
	const done = new Promise<ActorTurnResult>((resolve) => {
		resolveDone = resolve;
	});
	const finish = (actionError?: unknown) => {
		if (settled) return;
		settled = true;
		resolveDone({ chunks, failed, actionError });
	};
	const unsubs = [
		conn.on("uiMessageChunk", (payload: unknown) => {
			const chunk =
				(payload as { chunk?: UIMessageChunk } | undefined)?.chunk ??
				(payload as UIMessageChunk);
			if (chunk) chunks.push(chunk);
		}),
		conn.on("turnFailed", (payload: unknown) => {
			failed =
				(payload as { error?: string } | undefined)?.error ??
				"campaign chat turn failed";
		}),
	];
	conn
		.sendMessage({
			message: body.message,
			model: body.model,
			thinkingEffort: body.thinkingEffort,
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

async function runTurn(campaignId: string, body: TurnBody) {
	const turn = startTurn(campaignId, body);
	const result = await turn.done;
	await turn.dispose();
	return result;
}

function chunkDeltas(chunks: UIMessageChunk[]): string {
	return chunks
		.map((chunk) => (chunk.type === "text-delta" ? chunk.delta : ""))
		.join("");
}

async function campaignState(campaignId: string) {
	return env.DB.prepare('SELECT status, error FROM "Campaign" WHERE id = ?')
		.bind(campaignId)
		.first();
}

async function campaignMessages(campaignId: string) {
	return env.DB.prepare(
		'SELECT role, content FROM "Message" WHERE campaignId = ? ORDER BY createdAt, rowid',
	)
		.bind(campaignId)
		.all();
}

beforeEach(() => {
	mockMcpClient();
	installModel(async () => ({ stream: immediateTextStream("ok") }));
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("Campaign chat actor authorization", () => {
	type CreateConnStateFn = (
		c: { request?: Request; key: string[] },
		params: unknown,
	) => Promise<CampaignChatConnState>;

	function getCreateConnState(): CreateConnStateFn {
		return (
			campaignChat.config as unknown as { createConnState: CreateConnStateFn }
		).createConnState;
	}

	async function makeAdminSession() {
		const session = await createAdminSession();
		await env.DB.prepare(`UPDATE "user" SET role = ? WHERE id = ?`)
			.bind("admin", session.userId)
			.run();
		return session;
	}

	it("lets an admin connect to a campaign chat actor", async () => {
		const session = await makeAdminSession();
		const state = await getCreateConnState()(
			{
				request: new Request("http://localhost/rivet", {
					headers: session.headers,
				}),
				key: ["campaign", "campaign-1"],
			},
			undefined,
		);
		expect(state.userId).toBe(session.userId);
		expect(state.role).toBe("admin");
	});

	it("rejects a non-admin caller", async () => {
		const session = await createUserSession("user");
		await expect(
			getCreateConnState()(
				{
					request: new Request("http://localhost/rivet", {
						headers: session.headers,
					}),
					key: ["campaign", "campaign-1"],
				},
				undefined,
			),
		).rejects.toMatchObject({ code: "forbidden" });
	});

	it("rejects unauthenticated callers", async () => {
		await expect(
			getCreateConnState()(
				{
					request: new Request("http://localhost/rivet"),
					key: ["campaign", "campaign-1"],
				},
				undefined,
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
					key: ["wrong", "campaign-1"],
				},
				undefined,
			),
		).rejects.toMatchObject({ code: "invalid_actor_key" });
	});

	it("treats inline-driver callers (synthetic http://actor origin) as system callers", async () => {
		// createInlineClient dispatches through the ACTOR_DO binding with the
		// framework's synthetic origin and no credentials — only in-worker
		// code can reach that arm.
		const state = await getCreateConnState()(
			{
				request: new Request("http://actor/action/sendMessage"),
				key: ["campaign", "campaign-1"],
			},
			undefined,
		);
		expect(state.role).toBe("system");
	});

	it("rejects request-less callers with no request at all", async () => {
		await expect(
			getCreateConnState()({ key: ["campaign", "campaign-1"] }, undefined),
		).rejects.toMatchObject({ code: "unauthorized" });
	});
});

describe("Campaign chat actor contract", () => {
	it("exports the sendMessage action", () => {
		const config = campaignChat.config as unknown as {
			actions: Record<string, unknown>;
		};
		expect(config.actions.sendMessage).toBeDefined();
	});

	it("exports ui message stream events", () => {
		const config = campaignChat.config as unknown as {
			events: Record<string, unknown>;
		};
		expect(config.events.uiMessageChunk).toBeDefined();
		expect(config.events.turnFinished).toBeDefined();
		expect(config.events.turnFailed).toBeDefined();
	});
});

describe("Campaign chat turn input", () => {
	it.each([
		{},
		{ message: "" },
		{ message: "   " },
		{ message: "x".repeat(8001) },
		{ message: 42 },
		// Unknown model ids are not rejected: the schema accepts any string
		// and campaign-chat coerces them to CAMPAIGN_CHAT_MODEL (stale
		// clients self-heal — see lib/campaign-chat.ts).
	])("rejects invalid turn input %#", async (body) => {
		expect(campaignChatTurnInput.safeParse(body).success).toBe(false);
	});

	it("accepts unknown model and effort strings (coerced server-side)", () => {
		expect(
			campaignChatTurnInput.safeParse({
				message: "hello",
				model: "removed-model",
				thinkingEffort: "ultra",
			}).success,
		).toBe(true);
	});
});

describe("Campaign chat actor turns", () => {
	it("rejects a concurrent turn before any new side effects", async () => {
		const gate = deferred();
		const { model, factory } = installModel(async () => ({
			stream: gatedTextStream("first ", "response", gate.promise),
		}));
		const campaign = await createCampaign();
		const first = startTurn(campaign.id, { message: "first turn" });
		await vi.waitFor(() => {
			expect(model.doStreamCalls).toHaveLength(1);
		});

		const second = await runTurn(campaign.id, { message: "conflicting turn" });
		expect(second.failed).toBe(CAMPAIGN_CHAT_CONFLICT_ERROR);
		expect(String(second.actionError)).toContain(CAMPAIGN_CHAT_CONFLICT_ERROR);
		expect(factory).toHaveBeenCalledOnce();
		expect(createMCPClient).toHaveBeenCalledOnce();
		expect((await campaignMessages(campaign.id)).results).toEqual([
			{ role: "user", content: "first turn" },
		]);

		gate.resolve();
		const firstResult = await first.done;
		// Turn events are scoped to the requesting connection (per-conn sends,
		// not broadcasts): the second send's conflict must NOT leak into the
		// first turn's live stream — it keeps streaming its own chunks and
		// finishes with its own turnFinished.
		expect(firstResult.actionError).toBeUndefined();
		expect(firstResult.failed).toBeUndefined();
		expect(chunkDeltas(firstResult.chunks)).toContain("first ");
		expect(chunkDeltas(firstResult.chunks)).toContain("response");
		expect(JSON.stringify(firstResult.chunks)).not.toContain(
			CAMPAIGN_CHAT_CONFLICT_ERROR,
		);
		await first.dispose();
	});

	it("propagates model and brief to the model loop", async () => {
		const { model, factory } = installModel(async () => ({
			stream: immediateTextStream("Hello from the model"),
		}));
		const mcp = mockMcpClient();
		const campaign = await createCampaign();
		await env.DB.prepare('UPDATE "Campaign" SET briefPrompt = ? WHERE id = ?')
			.bind("A product launch for power users", campaign.id)
			.run();
		const result = await runTurn(campaign.id, {
			message: "Plan the launch",
			model: "@cf/deepseek-ai/deepseek-v4.1-flash-1017",
		});

		expect(result.failed).toBeUndefined();
		expect(result.actionError).toBeUndefined();
		expect(chunkDeltas(result.chunks)).toContain("Hello from the model");
		expect(createWorkersAI).toHaveBeenCalledWith({ binding: env.AI });
		expect(factory).toHaveBeenCalledWith(
			"@cf/deepseek-ai/deepseek-v4.1-flash-1017",
			{},
		);
		expect(model.doStreamCalls).toHaveLength(1);
		const prompt = JSON.stringify(model.doStreamCalls[0]?.prompt);
		expect(prompt).toContain("A product launch for power users");
		expect(vi.mocked(createMCPClient).mock.calls[0]?.[0]).toMatchObject({
			// The origin is derived server-side from the actor connection (the
			// inline driver's synthetic http://actor origin) — never from the
			// client-supplied body, which carries the BROWSER_MCP_TOKEN.
			transport: { url: "http://actor/browser-mcp" },
		});
		expect(mcp.close).toHaveBeenCalledOnce();
	});

	it("delivers two delayed model chunks separately", async () => {
		const gate = deferred();
		const { model } = installModel(async () => ({
			stream: gatedTextStream("first-chunk", "second-chunk", gate.promise),
		}));
		const campaign = await createCampaign();
		const turn = startTurn(campaign.id, { message: "stream" });

		await vi.waitFor(() => {
			expect(chunkDeltas(turn.chunks)).toContain("first-chunk");
		});
		expect(chunkDeltas(turn.chunks)).not.toContain("second-chunk");
		expect(model.doStreamCalls).toHaveLength(1);

		gate.resolve();
		const result = await turn.done;
		expect(result.failed).toBeUndefined();
		expect(chunkDeltas(result.chunks)).toContain("second-chunk");
		await turn.dispose();
	});

	it("closes MCP and stores only a public stream failure", async () => {
		const mcp = mockMcpClient();
		installModel(async () => ({
			stream: new ReadableStream<LanguageModelV3StreamPart>({
				start(controller) {
					controller.enqueue({ type: "stream-start", warnings: [] });
					controller.enqueue({
						type: "error",
						error: new Error("model exploded"),
					});
					controller.close();
				},
			}),
		}));
		const campaign = await createCampaign();
		const result = await runTurn(campaign.id, { message: "trigger failure" });

		const wire = JSON.stringify(result.chunks);
		expect(wire).toContain(CAMPAIGN_CHAT_PUBLIC_ERROR);
		expect(wire).not.toContain("model exploded");
		expect(await campaignState(campaign.id)).toEqual({
			status: "failed",
			error: CAMPAIGN_CHAT_PUBLIC_ERROR,
		});
		expect((await campaignMessages(campaign.id)).results).toEqual([
			{ role: "user", content: "trigger failure" },
		]);
		expect(mcp.close).toHaveBeenCalledOnce();
	});

	it("reclaims an abandoned turn and fences the old owner", async () => {
		// The abandoned turn's model stream is gated so its assistant insert
		// only runs after the replacement has already reclaimed the lease —
		// the fenced INSERT (activeTurnId = stale turn) must then be rejected.
		const gate = deferred();
		const abandonedModel = new MockLanguageModelV3({
			doStream: async () => ({
				stream: gatedTextStream("stale ", "assistant", gate.promise),
			}),
		});
		const replacementModel = new MockLanguageModelV3({
			doStream: async () => ({
				stream: immediateTextStream("current assistant"),
			}),
		});
		vi.mocked(createWorkersAI).mockReturnValue(
			vi
				.fn()
				.mockReturnValueOnce(abandonedModel)
				.mockReturnValueOnce(replacementModel) as never,
		);
		const campaign = await createCampaign();
		const abandoned = startTurn(campaign.id, { message: "abandoned history" });
		await vi.waitFor(() => {
			expect(createWorkersAI).toHaveBeenCalledOnce();
		});

		await env.DB.prepare('UPDATE "Campaign" SET turnClaimedAt = ? WHERE id = ?')
			.bind(new Date(Date.now() - 46 * 60 * 1000).toISOString(), campaign.id)
			.run();

		const replacement = await runTurn(campaign.id, {
			message: "current history",
		});
		expect(replacement.failed).toBeUndefined();
		expect(await campaignState(campaign.id)).toEqual({
			status: "ready",
			error: null,
		});

		gate.resolve();
		// The stale turn settles once its fenced assistant write is rejected
		// (the lease now belongs to the replacement) — without disturbing the
		// current turn's state.
		await abandoned.done;
		await abandoned.dispose();

		expect((await campaignMessages(campaign.id)).results).toEqual([
			{ role: "user", content: "abandoned history" },
			{ role: "user", content: "current history" },
			{ role: "assistant", content: "current assistant" },
		]);
		expect(await campaignState(campaign.id)).toEqual({
			status: "ready",
			error: null,
		});
	});

	it("does not duplicate the user message when a failed turn is retried", async () => {
		// First attempt streams an error: the trailing row is the user message.
		installModel(async () => ({
			stream: new ReadableStream<LanguageModelV3StreamPart>({
				start(controller) {
					controller.enqueue({ type: "stream-start", warnings: [] });
					controller.enqueue({ type: "error", error: new Error("failure") });
					controller.close();
				},
			}),
		}));
		const campaign = await createCampaign();
		await runTurn(campaign.id, { message: "retry me" });
		expect((await campaignMessages(campaign.id)).results).toEqual([
			{ role: "user", content: "retry me" },
		]);

		// Retry with a working model: the identical trailing user message is
		// not persisted a second time.
		installModel(async () => ({
			stream: immediateTextStream("recovered"),
		}));
		await runTurn(campaign.id, { message: "retry me" });
		expect((await campaignMessages(campaign.id)).results).toEqual([
			{ role: "user", content: "retry me" },
			{ role: "assistant", content: "recovered" },
		]);
	});

	it("replays earlier turns as history on the next turn", async () => {
		const campaign = await createCampaign();

		const first = installModel(async () => ({
			stream: immediateTextStream("first assistant reply"),
		}));
		const firstTurn = await runTurn(campaign.id, {
			message: "who is the audience?",
		});
		expect(firstTurn.failed).toBeUndefined();

		const second = installModel(async () => ({
			stream: immediateTextStream("second assistant reply"),
		}));
		const secondTurn = await runTurn(campaign.id, {
			message: "and the budget?",
		});
		expect(secondTurn.failed).toBeUndefined();

		expect(second.model.doStreamCalls).toHaveLength(1);
		const history = JSON.stringify(second.model.doStreamCalls[0]?.prompt);
		expect(history).toContain("who is the audience?");
		expect(history).toContain("first assistant reply");
		// The current user message is the last entry, after the replay.
		expect(history.indexOf("who is the audience?")).toBeLessThan(
			history.indexOf("and the budget?"),
		);
		expect(first.model.doStreamCalls).toHaveLength(1);

		expect((await campaignMessages(campaign.id)).results).toEqual([
			{ role: "user", content: "who is the audience?" },
			{ role: "assistant", content: "first assistant reply" },
			{ role: "user", content: "and the budget?" },
			{ role: "assistant", content: "second assistant reply" },
		]);
	});

	it("allows sequential turns after ready and failed states", async () => {
		const campaign = await createCampaign();

		installModel(async () => ({
			stream: immediateTextStream("first assistant"),
		}));
		await runTurn(campaign.id, { message: "first" });
		installModel(async () => ({
			stream: immediateTextStream("second assistant"),
		}));
		await runTurn(campaign.id, { message: "second" });
		installModel(async () => ({
			stream: new ReadableStream<LanguageModelV3StreamPart>({
				start(controller) {
					controller.enqueue({ type: "stream-start", warnings: [] });
					controller.enqueue({ type: "error", error: new Error("failure") });
					controller.close();
				},
			}),
		}));
		await runTurn(campaign.id, { message: "third" });
		expect(await campaignState(campaign.id)).toEqual({
			status: "failed",
			error: CAMPAIGN_CHAT_PUBLIC_ERROR,
		});
		installModel(async () => ({
			stream: immediateTextStream("after failure"),
		}));
		await runTurn(campaign.id, { message: "fourth" });

		expect(await campaignState(campaign.id)).toEqual({
			status: "ready",
			error: null,
		});
		expect((await campaignMessages(campaign.id)).results).toEqual([
			{ role: "user", content: "first" },
			{ role: "assistant", content: "first assistant" },
			{ role: "user", content: "second" },
			{ role: "assistant", content: "second assistant" },
			{ role: "user", content: "third" },
			{ role: "user", content: "fourth" },
			{ role: "assistant", content: "after failure" },
		]);
	});

	it("ends the turn on ask_user and persists the fallback question text", async () => {
		installToolCallModel("ask_user", {
			question: "Which channel mix should we lead with?",
			options: [
				{ label: "Social first", value: "social" },
				{ label: "Email first", value: "email" },
			],
		});
		const campaign = await createCampaign();
		const result = await runTurn(campaign.id, {
			message: "propose channels",
		});
		expect(result.failed).toBeUndefined();

		expect(await campaignState(campaign.id)).toEqual({
			status: "ready",
			error: null,
		});
		expect((await campaignMessages(campaign.id)).results).toEqual([
			{ role: "user", content: "propose channels" },
			{
				role: "assistant",
				content: "I'd like to know: Which channel mix should we lead with?",
			},
		]);
	});

	it("finalizes the turn and never leaks the raw MCP error when browser tools are unavailable", async () => {
		vi.mocked(createMCPClient).mockRejectedValue(new Error("raw tool secret"));
		installModel(async () => ({
			stream: immediateTextStream("no browser, plain answer"),
		}));
		const campaign = await createCampaign();
		const result = await runTurn(campaign.id, { message: "search" });

		expect(result.failed).toBeUndefined();
		const wire = JSON.stringify(result.chunks);
		expect(wire).toContain("no browser, plain answer");
		expect(wire).not.toContain("raw tool secret");
		await vi.waitFor(async () => {
			expect(await campaignState(campaign.id)).toEqual({
				status: "ready",
				error: null,
			});
		});
		expect((await campaignMessages(campaign.id)).results).toEqual([
			{ role: "user", content: "search" },
			{ role: "assistant", content: "no browser, plain answer" },
		]);
	});

	it("releases the lease when the model stream exceeds the turn deadline", async () => {
		// A stream that starts but never finishes — the hang that used to hold
		// the turn lease forever (the stuck-chat bug). The timeout knob is
		// read from the worker env inside the Durable Object, so the test
		// mutates it directly and restores it afterwards.
		const hungModel = new MockLanguageModelV3({
			doStream: async () => ({
				stream: new ReadableStream<LanguageModelV3StreamPart>({
					start(controller) {
						for (const chunk of streamPrefix()) controller.enqueue(chunk);
						// No text-end/finish: the stream stays open forever.
					},
				}),
			}),
		});
		vi.mocked(createWorkersAI).mockReturnValue(
			vi.fn().mockReturnValue(hungModel) as never,
		);
		const campaign = await createCampaign();
		const envWithTimeout = env as unknown as Record<string, unknown>;
		const previousTimeout = envWithTimeout.CAMPAIGN_CHAT_TURN_TIMEOUT_MS;
		envWithTimeout.CAMPAIGN_CHAT_TURN_TIMEOUT_MS = "120";
		try {
			const hung = await runTurn(campaign.id, { message: "hung turn" });
			// The deadline watchdog fails the turn: the actor broadcasts
			// turnFailed and the action rejects instead of spinning forever.
			expect(hung.failed).toBe(CAMPAIGN_CHAT_TIMEOUT_ERROR);
			expect(String(hung.actionError)).toContain(CAMPAIGN_CHAT_TIMEOUT_ERROR);
			await vi.waitFor(async () => {
				expect(await campaignState(campaign.id)).toEqual({
					status: "failed",
					error: CAMPAIGN_CHAT_TIMEOUT_ERROR,
				});
			});
		} finally {
			if (previousTimeout === undefined) {
				delete envWithTimeout.CAMPAIGN_CHAT_TURN_TIMEOUT_MS;
			} else {
				envWithTimeout.CAMPAIGN_CHAT_TURN_TIMEOUT_MS = previousTimeout;
			}
		}

		// The chat is progressable again immediately — no 45-minute wait.
		installModel(async () => ({ stream: immediateTextStream("recovered") }));
		const next = await runTurn(campaign.id, { message: "next turn" });
		expect(next.failed).toBeUndefined();
		await vi.waitFor(async () => {
			expect(await campaignState(campaign.id)).toEqual({
				status: "ready",
				error: null,
			});
		});
		expect((await campaignMessages(campaign.id)).results).toEqual([
			{ role: "user", content: "hung turn" },
			{ role: "user", content: "next turn" },
			{ role: "assistant", content: "recovered" },
		]);
	});

	it("continues without browser tools when the MCP connect hangs", async () => {
		// createMCPClient that never resolves — the handshake used to hang the
		// request after the turn lease was already claimed.
		vi.mocked(createMCPClient).mockImplementation(
			() => new Promise(() => {}) as never,
		);
		const campaign = await createCampaign();
		const envWithTimeout = env as unknown as Record<string, unknown>;
		const previousTimeout = envWithTimeout.CAMPAIGN_CHAT_MCP_CONNECT_TIMEOUT_MS;
		envWithTimeout.CAMPAIGN_CHAT_MCP_CONNECT_TIMEOUT_MS = "50";
		try {
			const result = await runTurn(campaign.id, { message: "mcp hang" });
			expect(result.failed).toBeUndefined();
			expect(chunkDeltas(result.chunks)).toContain("ok");
			await vi.waitFor(async () => {
				expect(await campaignState(campaign.id)).toEqual({
					status: "ready",
					error: null,
				});
			});
			expect(createMCPClient).toHaveBeenCalledOnce();
		} finally {
			if (previousTimeout === undefined) {
				delete envWithTimeout.CAMPAIGN_CHAT_MCP_CONNECT_TIMEOUT_MS;
			} else {
				envWithTimeout.CAMPAIGN_CHAT_MCP_CONNECT_TIMEOUT_MS = previousTimeout;
			}
		}
	});

	it("force-releases a stuck turn via campaigns.releaseTurn", async () => {
		const gate = deferred();
		const { model } = installModel(async () => ({
			stream: gatedTextStream("stuck ", "response", gate.promise),
		}));
		const campaign = await createCampaign();
		const session = await createAdminSession();
		const stuck = startTurn(campaign.id, { message: "stuck turn" });
		await vi.waitFor(() => {
			expect(model.doStreamCalls).toHaveLength(1);
		});

		// While the lease is held, sends conflict.
		const conflict = await runTurn(campaign.id, { message: "blocked send" });
		expect(conflict.failed).toBe(CAMPAIGN_CHAT_CONFLICT_ERROR);

		const released = await adminClient(session).campaigns.releaseTurn.mutate({
			campaignId: campaign.id,
		});
		expect(released).toEqual({ released: true });
		expect(await campaignState(campaign.id)).toEqual({
			status: "failed",
			error: CAMPAIGN_CHAT_CANCELLED_ERROR,
		});

		// The chat is progressable again immediately.
		installModel(async () => ({
			stream: immediateTextStream("after cancel"),
		}));
		await runTurn(campaign.id, { message: "after release" });

		gate.resolve();
		await stuck.done;
		await stuck.dispose();

		// The abandoned turn's assistant write stays fenced out; the new turn
		// owns the history.
		expect((await campaignMessages(campaign.id)).results).toEqual([
			{ role: "user", content: "stuck turn" },
			{ role: "user", content: "after release" },
			{ role: "assistant", content: "after cancel" },
		]);
	});

	it("reports released:false when no turn is running", async () => {
		const campaign = await createCampaign();
		const session = await createAdminSession();
		const released = await adminClient(session).campaigns.releaseTurn.mutate({
			campaignId: campaign.id,
		});
		expect(released).toEqual({ released: false });
	});

	it("rejects campaigns.releaseTurn without an admin session", async () => {
		const campaign = await createCampaign();
		const unauthorized = () =>
			createTrpcTestClient().campaigns.releaseTurn.mutate({
				campaignId: campaign.id,
			});
		expect(await trpcErrorCode(unauthorized)).toBe("UNAUTHORIZED");
		expect(await trpcErrorMessage(unauthorized)).toBe("unauthorized");
	});
});

describe("Campaign messages route", () => {
	it("requires an admin session", async () => {
		const campaign = await createCampaign();
		const unauthorized = () =>
			createTrpcTestClient().campaigns.listMessages.query({
				campaignId: campaign.id,
			});
		expect(await trpcErrorCode(unauthorized)).toBe("UNAUTHORIZED");
	});

	it("returns BAD_REQUEST for an invalid campaign id", async () => {
		const session = await createAdminSession();
		const invalid = () =>
			adminClient(session).campaigns.listMessages.query({
				campaignId: "not-a-uuid",
			});
		expect(await trpcErrorCode(invalid)).toBe("BAD_REQUEST");
		expect(await trpcErrorMessage(invalid)).toBe("invalid campaign id");
	});

	it("returns public fields in chronological order", async () => {
		const campaign = await createCampaign();
		const session = await createAdminSession();
		const base = Date.parse("2026-01-01T00:00:00.000Z");
		const rows = [
			{ id: crypto.randomUUID(), role: "user", content: "first question" },
			{ id: crypto.randomUUID(), role: "assistant", content: "first answer" },
			{ id: crypto.randomUUID(), role: "user", content: "second question" },
		];
		for (const [index, row] of rows.entries()) {
			await env.DB.prepare(
				`INSERT INTO "Message" (id, campaignId, role, content, createdAt)
					VALUES (?, ?, ?, ?, ?)`,
			)
				.bind(
					row.id,
					campaign.id,
					row.role,
					row.content,
					new Date(base + index * 1000).toISOString(),
				)
				.run();
		}
		const body = await adminClient(session).campaigns.listMessages.query({
			campaignId: campaign.id,
		});
		expect(body).toHaveLength(3);
		expect(body.map((row) => row.content)).toEqual([
			"first question",
			"first answer",
			"second question",
		]);
		for (const row of body) {
			expect(Object.keys(row).sort()).toEqual([
				"content",
				"createdAt",
				"id",
				"role",
			]);
		}
	});

	it("caps the transcript at 200 messages", async () => {
		const campaign = await createCampaign();
		const session = await createAdminSession();
		const base = Date.parse("2026-01-01T00:00:00.000Z");
		const statements = [];
		for (let index = 0; index < 205; index += 1) {
			statements.push(
				env.DB.prepare(
					`INSERT INTO "Message" (id, campaignId, role, content, createdAt)
						VALUES (?, ?, 'user', ?, ?)`,
				).bind(
					crypto.randomUUID(),
					campaign.id,
					`message ${index}`,
					new Date(base + index * 1000).toISOString(),
				),
			);
		}
		await env.DB.batch(statements);

		const body = await adminClient(session).campaigns.listMessages.query({
			campaignId: campaign.id,
		});
		expect(body).toHaveLength(200);
		// Chronological asc + take 200: the earliest rows win.
		expect(body[0]?.content).toBe("message 0");
		expect(body.at(-1)?.content).toBe("message 199");
	});
});
