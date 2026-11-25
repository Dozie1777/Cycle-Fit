import {
	createExecutionContext,
	waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { createMCPClient } from "@ai-sdk/mcp";
import type {
	LanguageModelV3,
	LanguageModelV3StreamPart,
} from "@ai-sdk/provider";
import { MockLanguageModelV3 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkersAI } from "workers-ai-provider";
import { publishDesignFiles } from "@/features/design-studio/publish/design-publish";
import { renderDesignPreview } from "@/features/design-studio/publish/design-render";
import { createAdminSession, type TestSession } from "../helpers/auth";
import { createDesign } from "../helpers/fixtures";
import {
	startJsonRequest,
	startWorkerRequest,
	TEST_ORIGIN,
} from "../helpers/request";

vi.mock("@ai-sdk/mcp", () => ({ createMCPClient: vi.fn() }));
vi.mock("workers-ai-provider", () => ({ createWorkersAI: vi.fn() }));
vi.mock("../../src/features/design-studio/publish/design-render", () => ({
	renderDesignPreview: vi.fn(),
}));
vi.mock(
	"../../src/features/design-studio/publish/design-publish",
	async (importOriginal) => ({
		...(await importOriginal<
			typeof import("@/features/design-studio/publish/design-publish")
		>()),
		publishDesignFiles: vi.fn(),
	}),
);

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

function gateAssistantInserts(started: Deferred, release: Deferred) {
	const wrapStatement = (
		statement: D1PreparedStatement,
		shouldGate: boolean,
	): D1PreparedStatement =>
		new Proxy(statement, {
			get(target, property) {
				if (shouldGate && (property === "raw" || property === "run")) {
					return async (...args: unknown[]) => {
						started.resolve();
						await release.promise;
						const method = Reflect.get(target, property, target) as (
							...args: unknown[]
						) => unknown;
						return method.apply(target, args);
					};
				}
				const value = Reflect.get(target, property, target);
				return typeof value === "function" ? value.bind(target) : value;
			},
		});
	const db = Object.create(env.DB) as D1Database;
	db.prepare = (query: string) => {
		const statement = env.DB.prepare(query);
		return new Proxy(statement, {
			get(target, property) {
				if (property === "bind") {
					return (...args: unknown[]) =>
						wrapStatement(
							target.bind(...args),
							query.includes('"Message"') &&
								query.includes("INSERT") &&
								args.includes("stale assistant"),
						);
				}
				const value = Reflect.get(target, property, target);
				return typeof value === "function" ? value.bind(target) : value;
			},
		});
	};
	return db;
}

type Deferred = ReturnType<typeof deferred>;

function mockMcpClient() {
	const client = {
		tools: vi.fn(async () => ({})),
		close: vi.fn(async () => {}),
	};
	vi.mocked(createMCPClient).mockResolvedValue(client as never);
	return client;
}

async function dispatchChat(
	projectId: string,
	body: unknown,
	session: TestSession,
	requestEnv: Env = env,
) {
	const { default: worker } = await import("../../src/server");
	const ctx = createExecutionContext();
	const response = await worker.fetch(
		new Request(new URL(`/designs/${projectId}/chat`, TEST_ORIGIN), {
			method: "POST",
			headers: {
				"content-type": "application/json",
				cookie: session.cookie,
			},
			body: JSON.stringify(body),
		}),
		requestEnv,
		ctx,
	);
	return { response, ctx };
}

async function projectState(projectId: string) {
	return env.DB.prepare('SELECT status, error FROM "Design" WHERE id = ?')
		.bind(projectId)
		.first();
}

async function projectMessages(projectId: string) {
	return env.DB.prepare(
		'SELECT role, content FROM "Message" WHERE designId = ? ORDER BY createdAt, rowid',
	)
		.bind(projectId)
		.all();
}

async function readUntil(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	marker: string,
) {
	const decoder = new TextDecoder();
	let text = "";
	while (!text.includes(marker)) {
		const chunk = await reader.read();
		if (chunk.done) break;
		text += decoder.decode(chunk.value, { stream: true });
	}
	return text;
}

beforeEach(() => {
	mockMcpClient();
	installModel(async () => ({ stream: immediateTextStream("ok") }));
	vi.mocked(renderDesignPreview).mockResolvedValue(Uint8Array.from([1, 2, 3]));
	vi.mocked(publishDesignFiles).mockResolvedValue({ version: 1 });
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("Start design chat route", () => {
	it.each([
		{},
		{ message: "" },
		{ message: "   " },
		{ message: "x".repeat(8001) },
		{ message: 42 },
		{ message: "hello", section: "" },
		{ message: "hello", section: "x".repeat(61) },
		// Unknown model ids are no longer rejected: the route accepts any
		// string and design-chat coerces them to DESIGN_CHAT_MODEL (stale
		// clients self-heal — see lib/design-chat.ts).
	])("rejects invalid chat input %#", async (body) => {
		const project = await createDesign();
		const session = await createAdminSession();
		const response = await startJsonRequest(
			`/designs/${project.id}/chat`,
			"POST",
			body,
			{ headers: session.headers },
		);
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: expect.any(String) });
		expect(createWorkersAI).not.toHaveBeenCalled();
	});

	it("returns 400 for malformed JSON", async () => {
		const project = await createDesign();
		const session = await createAdminSession();
		const response = await startWorkerRequest(`/designs/${project.id}/chat`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				cookie: session.cookie,
			},
			body: "{",
		});
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: expect.any(String) });
	});

	it("coerces unknown model ids to the default instead of failing the turn", async () => {
		// #775: stale client localStorage must self-heal — the route accepts
		// any model string and design-chat resolves unknown ids to the default.
		const project = await createDesign();
		const session = await createAdminSession();
		const response = await startJsonRequest(
			`/designs/${project.id}/chat`,
			"POST",
			{ message: "hello", model: "not-a-model" },
			{ headers: session.headers },
		);
		expect(response.status).toBe(200);
	});

	it("rejects an invalid project id and returns 404 for a missing project", async () => {
		const session = await createAdminSession();
		const invalid = await startJsonRequest(
			"/designs/not-a-uuid/chat",
			"POST",
			{ message: "hello" },
			{ headers: session.headers },
		);
		expect(invalid.status).toBe(400);
		expect(await invalid.json()).toEqual({ error: "invalid project id" });

		const missing = await startJsonRequest(
			`/designs/${crypto.randomUUID()}/chat`,
			"POST",
			{ message: "hello" },
			{ headers: session.headers },
		);
		expect(missing.status).toBe(404);
		expect(await missing.json()).toEqual({ error: "not found" });
		expect(createWorkersAI).not.toHaveBeenCalled();
	});

	it("returns a public 502 and finalizes early setup failures", async () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		vi.mocked(createWorkersAI).mockImplementation(() => {
			throw new Error("AI unavailable");
		});
		const project = await createDesign();
		const session = await createAdminSession();
		const response = await startJsonRequest(
			`/designs/${project.id}/chat`,
			"POST",
			{ message: "hello" },
			{ headers: session.headers },
		);
		expect(response.status).toBe(502);
		expect(await response.json()).toEqual({
			error: "chat turn failed — try again",
		});
		expect(await projectState(project.id)).toEqual({
			status: "failed",
			error: "chat turn failed — try again",
		});
		expect((await projectMessages(project.id)).results).toEqual([
			{ role: "user", content: "hello" },
		]);
		expect(log.mock.calls.flat().map(String).join(" ")).toContain(
			"AI unavailable",
		);
	});

	it("closes an acquired MCP client and finalizes model setup failures", async () => {
		const mcp = mockMcpClient();
		const factory = vi.fn(() => {
			throw new Error("provider credentials leaked here");
		});
		vi.mocked(createWorkersAI).mockReturnValue(factory as never);
		const project = await createDesign();
		const session = await createAdminSession();
		const response = await startJsonRequest(
			`/designs/${project.id}/chat`,
			"POST",
			{ message: "fail after MCP" },
			{ headers: session.headers },
		);
		expect(response.status).toBe(502);
		expect(await response.json()).toEqual({
			error: "chat turn failed — try again",
		});
		expect(createMCPClient).toHaveBeenCalledOnce();
		expect(mcp.close).toHaveBeenCalledOnce();
		expect(await projectState(project.id)).toEqual({
			status: "failed",
			error: "chat turn failed — try again",
		});
		expect((await projectMessages(project.id)).results).toEqual([
			{ role: "user", content: "fail after MCP" },
		]);
	});

	it("propagates section, model, and origin and preserves stream headers", async () => {
		const { model, factory } = installModel(async () => ({
			stream: immediateTextStream("Hello from the model"),
		}));
		const mcp = mockMcpClient();
		const project = await createDesign({ prompt: "A landing page" });
		const session = await createAdminSession();
		const { response, ctx } = await dispatchChat(
			project.id,
			{
				message: "Change the headline",
				section: "Hero",
				model: "@cf/deepseek-ai/deepseek-v4.1-flash-1017",
			},
			session,
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/event-stream");
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(response.headers.get("content-encoding")).toBe("identity");
		expect(response.headers.get("transfer-encoding")).toBe("chunked");
		const wire = await response.text();
		await waitOnExecutionContext(ctx);
		expect(wire).toContain("Hello from the model");

		expect(createWorkersAI).toHaveBeenCalledWith({ binding: env.AI });
		expect(factory).toHaveBeenCalledWith(
			"@cf/deepseek-ai/deepseek-v4.1-flash-1017",
			{},
		);
		expect(model.doStreamCalls).toHaveLength(1);
		const prompt = JSON.stringify(model.doStreamCalls[0]?.prompt);
		expect(prompt).toContain("A landing page");
		expect(prompt).toContain(`${TEST_ORIGIN}/designs/${project.id}/site`);
		expect(prompt).toContain("[Selected section: Hero] Change the headline");
		expect(vi.mocked(createMCPClient).mock.calls[0]?.[0]).toMatchObject({
			transport: { url: `${TEST_ORIGIN}/browser-mcp` },
		});
		expect(mcp.close).toHaveBeenCalledOnce();
	});

	it("delivers two delayed model chunks separately", async () => {
		const gate = deferred();
		const { model } = installModel(async () => ({
			stream: gatedTextStream("first-chunk", "second-chunk", gate.promise),
		}));
		const project = await createDesign();
		const session = await createAdminSession();
		const { response, ctx } = await dispatchChat(
			project.id,
			{ message: "stream" },
			session,
		);
		const reader = response.body?.getReader();
		expect(reader).toBeDefined();
		if (!reader) return;

		const first = await readUntil(reader, "first-chunk");
		expect(first).toContain("first-chunk");
		expect(first).not.toContain("second-chunk");
		let secondSettled = false;
		const second = readUntil(reader, "second-chunk").then((text) => {
			secondSettled = true;
			return text;
		});
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(secondSettled).toBe(false);
		expect(model.doStreamCalls).toHaveLength(1);

		gate.resolve();
		expect(await second).toContain("second-chunk");
		while (!(await reader.read()).done) {}
		await waitOnExecutionContext(ctx);
	});

	it("finishes persistence and MCP cleanup after response cancellation", async () => {
		const gate = deferred();
		const mcp = mockMcpClient();
		installModel(async () => ({
			stream: gatedTextStream("persisted ", "assistant reply", gate.promise),
		}));
		const project = await createDesign();
		const session = await createAdminSession();
		const { response, ctx } = await dispatchChat(
			project.id,
			{ message: "persist after disconnect" },
			session,
		);

		await response.body?.cancel();
		gate.resolve();
		await waitOnExecutionContext(ctx);

		expect((await projectMessages(project.id)).results).toEqual([
			{ role: "user", content: "persist after disconnect" },
			{ role: "assistant", content: "persisted assistant reply" },
		]);
		expect(await projectState(project.id)).toEqual({
			status: "ready",
			error: null,
		});
		expect(mcp.close).toHaveBeenCalledOnce();
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
		const project = await createDesign();
		const session = await createAdminSession();
		const { response, ctx } = await dispatchChat(
			project.id,
			{ message: "trigger failure" },
			session,
		);

		const wire = await response.text();
		await waitOnExecutionContext(ctx);
		expect(wire).toContain("chat turn failed — try again");
		expect(wire).not.toContain("model exploded");
		expect(await projectState(project.id)).toEqual({
			status: "failed",
			error: "chat turn failed — try again",
		});
		expect((await projectMessages(project.id)).results).toEqual([
			{ role: "user", content: "trigger failure" },
		]);
		expect(mcp.close).toHaveBeenCalledOnce();
	});

	it("rejects a concurrent turn before any new side effects", async () => {
		const gate = deferred();
		const { model, factory } = installModel(async () => ({
			stream: gatedTextStream("first ", "response", gate.promise),
		}));
		const project = await createDesign();
		const session = await createAdminSession();
		const first = await dispatchChat(
			project.id,
			{ message: "first turn" },
			session,
		);
		await vi.waitFor(() => {
			expect(model.doStreamCalls).toHaveLength(1);
		});
		const second = await dispatchChat(
			project.id,
			{ message: "conflicting turn" },
			session,
		);
		try {
			expect(second.response.status).toBe(409);
			expect(await second.response.json()).toEqual({
				error: "chat turn already in progress",
			});
			await waitOnExecutionContext(second.ctx);
			expect(factory).toHaveBeenCalledOnce();
			expect(createMCPClient).toHaveBeenCalledOnce();
			expect(publishDesignFiles).not.toHaveBeenCalled();
			expect((await projectMessages(project.id)).results).toEqual([
				{ role: "user", content: "first turn" },
			]);
		} finally {
			gate.resolve();
			await first.response.text();
			await waitOnExecutionContext(first.ctx);
			if (second.response.status === 200) {
				await second.response.text();
				await waitOnExecutionContext(second.ctx);
			}
		}
	});

	it("reclaims an abandoned turn and fences the old owner", async () => {
		const gate = deferred();
		const abandonedModel = new MockLanguageModelV3({
			doStream: async () => ({
				stream: gatedTextStream(
					"<!doctype html><html><body>stale",
					"</body></html>",
					gate.promise,
				),
			}),
		});
		const replacementModel = new MockLanguageModelV3({
			doStream: async () => ({ stream: immediateTextStream("replacement") }),
		});
		vi.mocked(createWorkersAI).mockReturnValue(
			vi
				.fn()
				.mockReturnValueOnce(abandonedModel)
				.mockReturnValueOnce(replacementModel) as never,
		);
		const project = await createDesign();
		const session = await createAdminSession();
		const abandoned = await dispatchChat(
			project.id,
			{ message: "abandoned turn" },
			session,
		);
		await vi.waitFor(() => {
			expect(abandonedModel.doStreamCalls).toHaveLength(1);
		});
		await env.DB.prepare('UPDATE "Design" SET turnClaimedAt = ? WHERE id = ?')
			.bind(new Date(Date.now() - 46 * 60 * 1000).toISOString(), project.id)
			.run();

		const replacement = await dispatchChat(
			project.id,
			{ message: "replacement turn" },
			session,
		);
		let abandonedFinished = false;
		let replacementFinished = false;
		try {
			expect(replacement.response.status).toBe(200);
			await replacement.response.text();
			await waitOnExecutionContext(replacement.ctx);
			replacementFinished = true;
			expect(await projectState(project.id)).toEqual({
				status: "ready",
				error: null,
			});

			gate.resolve();
			await abandoned.response.text();
			await waitOnExecutionContext(abandoned.ctx);
			abandonedFinished = true;

			expect(publishDesignFiles).not.toHaveBeenCalled();
			expect((await projectMessages(project.id)).results).toEqual([
				{ role: "user", content: "abandoned turn" },
				{ role: "user", content: "replacement turn" },
				{ role: "assistant", content: "replacement" },
			]);
			expect(await projectState(project.id)).toEqual({
				status: "ready",
				error: null,
			});
		} finally {
			gate.resolve();
			if (!abandonedFinished) {
				await abandoned.response.text();
				await waitOnExecutionContext(abandoned.ctx);
			}
			if (replacement.response.status === 200 && !replacementFinished) {
				await replacement.response.text();
				await waitOnExecutionContext(replacement.ctx);
			}
		}
	});

	it("does not let an in-flight abandoned publish replace newer live content", async () => {
		const { publishDesignFiles: actualPublish } = await vi.importActual<
			typeof import("@/features/design-studio/publish/design-publish")
		>("../../src/features/design-studio/publish/design-publish");
		const publishStarted = deferred();
		const releasePublish = deferred();
		let publishCount = 0;
		vi.mocked(publishDesignFiles).mockImplementation(async (...args) => {
			publishCount += 1;
			if (publishCount === 1) {
				publishStarted.resolve();
				await releasePublish.promise;
			}
			return actualPublish(...args);
		});
		const staleHtml = "<!doctype html><html><body>stale live</body></html>";
		const currentHtml = "<!doctype html><html><body>current live</body></html>";
		const abandonedModel = toolCallModel("publish_design", { html: staleHtml });
		const replacementModel = toolCallModel("publish_design", {
			html: currentHtml,
		});
		vi.mocked(createWorkersAI).mockReturnValue(
			vi
				.fn()
				.mockReturnValueOnce(abandonedModel)
				.mockReturnValueOnce(replacementModel) as never,
		);
		const project = await createDesign();
		const session = await createAdminSession();
		const abandoned = await dispatchChat(
			project.id,
			{ message: "abandoned publish" },
			session,
		);
		await publishStarted.promise;
		await env.DB.prepare('UPDATE "Design" SET turnClaimedAt = ? WHERE id = ?')
			.bind(new Date(Date.now() - 46 * 60 * 1000).toISOString(), project.id)
			.run();
		const replacement = await dispatchChat(
			project.id,
			{ message: "current publish" },
			session,
		);
		let abandonedFinished = false;
		let replacementFinished = false;
		try {
			expect(replacement.response.status).toBe(200);
			await replacement.response.text();
			await waitOnExecutionContext(replacement.ctx);
			replacementFinished = true;

			releasePublish.resolve();
			await abandoned.response.text();
			await waitOnExecutionContext(abandoned.ctx);
			abandonedFinished = true;

			const site = await startWorkerRequest(`/designs/${project.id}/site`);
			expect(await site.text()).toBe(currentHtml);
			expect((await projectMessages(project.id)).results).toEqual([
				{ role: "user", content: "abandoned publish" },
				{ role: "user", content: "current publish" },
				{ role: "assistant", content: "tool finished" },
			]);
		} finally {
			releasePublish.resolve();
			if (!abandonedFinished) {
				await abandoned.response.text();
				await waitOnExecutionContext(abandoned.ctx);
			}
			if (replacement.response.status === 200 && !replacementFinished) {
				await replacement.response.text();
				await waitOnExecutionContext(replacement.ctx);
			}
		}
	});

	it("does not let an in-flight abandoned owner append assistant history", async () => {
		const insertStarted = deferred();
		const releaseInsert = deferred();
		const abandonedModel = new MockLanguageModelV3({
			doStream: async () => ({
				stream: immediateTextStream("stale assistant"),
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
		const project = await createDesign();
		const session = await createAdminSession();
		const abandoned = await dispatchChat(
			project.id,
			{ message: "abandoned history" },
			session,
			{ ...env, DB: gateAssistantInserts(insertStarted, releaseInsert) },
		);
		await insertStarted.promise;
		await env.DB.prepare('UPDATE "Design" SET turnClaimedAt = ? WHERE id = ?')
			.bind(new Date(Date.now() - 46 * 60 * 1000).toISOString(), project.id)
			.run();
		const replacement = await dispatchChat(
			project.id,
			{ message: "current history" },
			session,
		);
		let abandonedFinished = false;
		let replacementFinished = false;
		try {
			expect(replacement.response.status).toBe(200);
			await replacement.response.text();
			await waitOnExecutionContext(replacement.ctx);
			replacementFinished = true;

			releaseInsert.resolve();
			await abandoned.response.text();
			await waitOnExecutionContext(abandoned.ctx);
			abandonedFinished = true;

			expect((await projectMessages(project.id)).results).toEqual([
				{ role: "user", content: "abandoned history" },
				{ role: "user", content: "current history" },
				{ role: "assistant", content: "current assistant" },
			]);
		} finally {
			releaseInsert.resolve();
			if (!abandonedFinished) {
				await abandoned.response.text();
				await waitOnExecutionContext(abandoned.ctx);
			}
			if (replacement.response.status === 200 && !replacementFinished) {
				await replacement.response.text();
				await waitOnExecutionContext(replacement.ctx);
			}
		}
	});

	it("allows sequential turns after ready and failed states", async () => {
		const project = await createDesign();
		const session = await createAdminSession();
		const runTurn = async (message: string) => {
			const { response, ctx } = await dispatchChat(
				project.id,
				{ message },
				session,
			);
			await response.text();
			await waitOnExecutionContext(ctx);
		};

		installModel(async () => ({
			stream: immediateTextStream("first assistant"),
		}));
		await runTurn("first");
		installModel(async () => ({
			stream: immediateTextStream("second assistant"),
		}));
		await runTurn("second");
		installModel(async () => ({
			stream: new ReadableStream<LanguageModelV3StreamPart>({
				start(controller) {
					controller.enqueue({ type: "stream-start", warnings: [] });
					controller.enqueue({ type: "error", error: new Error("failure") });
					controller.close();
				},
			}),
		}));
		await runTurn("third");
		expect(await projectState(project.id)).toEqual({
			status: "failed",
			error: "chat turn failed — try again",
		});
		installModel(async () => ({
			stream: immediateTextStream("after failure"),
		}));
		await runTurn("fourth");

		expect(await projectState(project.id)).toEqual({
			status: "ready",
			error: null,
		});
		expect((await projectMessages(project.id)).results).toEqual([
			{ role: "user", content: "first" },
			{ role: "assistant", content: "first assistant" },
			{ role: "user", content: "second" },
			{ role: "assistant", content: "second assistant" },
			{ role: "user", content: "third" },
			{ role: "user", content: "fourth" },
			{ role: "assistant", content: "after failure" },
		]);
	});

	it("finalizes the turn and never leaks the raw MCP error when browser tools are unavailable", async () => {
		vi.mocked(createMCPClient).mockRejectedValue(new Error("raw tool secret"));
		installModel(async () => ({
			stream: immediateTextStream("no browser, plain answer"),
		}));
		const project = await createDesign();
		const session = await createAdminSession();
		const { response, ctx } = await dispatchChat(
			project.id,
			{ message: "search" },
			session,
		);
		const wire = await response.text();
		await waitOnExecutionContext(ctx);
		expect(wire).toContain("no browser, plain answer");
		expect(wire).not.toContain("raw tool secret");
		await vi.waitFor(async () => {
			expect(await projectState(project.id)).toEqual({
				status: "ready",
				error: null,
			});
		});
		expect((await projectMessages(project.id)).results).toEqual([
			{ role: "user", content: "search" },
			{ role: "assistant", content: "no browser, plain answer" },
		]);
	});

	it.each([
		{
			toolName: "wireframe",
			input: {
				name: "hero",
				svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">${"x".repeat(60)}</svg>`,
			},
			expected: "wireframe failed — try again",
		},
		{
			toolName: "preview_section",
			input: {
				name: "hero",
				html: `<section>${"x".repeat(60)}</section>`,
			},
			expected: "section preview failed — try again",
		},
		{
			toolName: "propose_design",
			input: {
				name: "hero",
				html: `<section>${"x".repeat(60)}</section>`,
			},
			expected: "design proposal failed — try again",
		},
		{
			toolName: "publish_design",
			input: {
				html: `<!doctype html><html><body>${"x".repeat(60)}</body></html>`,
			},
			expected: "design publish failed — try again",
		},
	])("returns a stable $toolName output error", async ({
		toolName,
		input,
		expected,
	}) => {
		installToolCallModel(toolName, input);
		const designs = Object.create(env.DESIGNS) as R2Bucket;
		designs.put = vi.fn(async () => {
			throw new Error("raw tool secret");
		});
		vi.mocked(publishDesignFiles).mockRejectedValue(
			new Error("raw tool secret"),
		);
		const project = await createDesign();
		const session = await createAdminSession();
		const { response, ctx } = await dispatchChat(
			project.id,
			{ message: "call tool" },
			session,
			{ ...env, DESIGNS: designs },
		);
		const wire = await response.text();
		await waitOnExecutionContext(ctx);
		expect(wire).toContain(expected);
		expect(wire).not.toContain("raw tool secret");
	});

	it("marks the turn failed when publish_design reports a failure", async () => {
		installToolCallModel("publish_design", {
			html: `<!doctype html><html><body>${"x".repeat(60)}</body></html>`,
		});
		vi.mocked(publishDesignFiles).mockRejectedValue(
			new Error("version snapshot failed"),
		);
		const project = await createDesign();
		const session = await createAdminSession();
		const { response, ctx } = await dispatchChat(
			project.id,
			{ message: "republish" },
			session,
		);
		const wire = await response.text();
		await waitOnExecutionContext(ctx);

		expect(wire).toContain("design publish failed — try again");
		expect(publishDesignFiles).toHaveBeenCalledOnce();
		await vi.waitFor(async () => {
			expect(await projectState(project.id)).toEqual({
				status: "failed",
				error: "chat turn failed — try again",
			});
		});
		expect((await projectMessages(project.id)).results).toEqual([
			{ role: "user", content: "republish" },
		]);
	});

	it("persists a later successful publish after an earlier publish failure", async () => {
		const project = await createDesign();
		const session = await createAdminSession();
		let step = 0;
		installModel(async () => {
			step += 1;
			if (step === 3) return { stream: immediateTextStream("recovered") };
			return {
				stream: new ReadableStream<LanguageModelV3StreamPart>({
					start(controller) {
						controller.enqueue({ type: "stream-start", warnings: [] });
						controller.enqueue({
							type: "tool-call",
							toolCallId: `publish-${step}`,
							toolName: "publish_design",
							input: JSON.stringify({
								html: `<!doctype html><html><body>${"x".repeat(60)}</body></html>`,
							}),
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
		});
		vi.mocked(publishDesignFiles)
			.mockRejectedValueOnce(new Error("temporary publish failure"))
			.mockResolvedValueOnce({ version: 2 });
		const { response, ctx } = await dispatchChat(
			project.id,
			{ message: "publish twice" },
			session,
		);
		await response.text();
		await waitOnExecutionContext(ctx);

		await vi.waitFor(async () => {
			expect(await projectState(project.id)).toEqual({
				status: "ready",
				error: null,
			});
		});
		expect(publishDesignFiles).toHaveBeenCalledTimes(2);
		expect((await projectMessages(project.id)).results).toEqual([
			{ role: "user", content: "publish twice" },
			{ role: "assistant", content: "recovered" },
		]);
	});
});
