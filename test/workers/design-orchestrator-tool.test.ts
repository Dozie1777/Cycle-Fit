// Worker tests for the orchestrator's open_element_chat tool (KUK-944):
// the main design chat creates/reopens an element chat session for a design
// element, seeds its contextPrompt through the real context builders, and
// fences cross-project element ids. Driven directly through
// runDesignChatTurnStream with a mocked Workers AI model, mirroring
// element-chat-pipeline.test.ts's harness.
import { env } from "cloudflare:workers";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { MockLanguageModelV3 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkersAI } from "workers-ai-provider";
import { runDesignChatTurnStream } from "@/features/design-studio/chat/design-chat";
import { createDesign, createProject } from "../helpers/fixtures";

vi.mock("@ai-sdk/mcp", () => ({ createMCPClient: vi.fn() }));
vi.mock("workers-ai-provider", () => ({ createWorkersAI: vi.fn() }));
vi.mock("../../src/features/design-studio/tools/component-smoke", () => ({
	runComponentSmokeTest: vi.fn(),
}));
vi.mock("../../src/features/design-studio/publish/design-render", () => ({
	renderDesignPreview: vi.fn(),
}));

const usage = {
	inputTokens: {
		total: 0,
		noCache: 0,
		cacheRead: 0,
		cacheWrite: 0,
	},
	outputTokens: { total: 0, text: 0, reasoning: 0 },
};

/** Model whose first step emits one tool call, second step plain text. */
function toolCallModel(toolName: string, input: unknown) {
	let step = 0;
	return new MockLanguageModelV3({
		doStream: async () => {
			step += 1;
			if (step > 1) {
				return {
					stream: new ReadableStream<LanguageModelV3StreamPart>({
						start(controller) {
							controller.enqueue({ type: "stream-start", warnings: [] });
							controller.enqueue({
								type: "text-start",
								id: "text-id",
							});
							controller.enqueue({
								type: "text-delta",
								id: "text-id",
								delta: "done",
							});
							controller.enqueue({ type: "text-end", id: "text-id" });
							controller.enqueue({
								type: "finish",
								finishReason: { unified: "stop", raw: undefined },
								usage,
							});
							controller.close();
						},
					}),
				};
			}
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

function installModel(model: MockLanguageModelV3) {
	vi.mocked(createWorkersAI).mockReturnValue(vi.fn(() => model) as never);
}

/** A component row (identity only) in the given project. */
async function seedComponent(projectId: string, name: string) {
	const id = `comp-${crypto.randomUUID()}`;
	const now = new Date().toISOString();
	await env.DB.prepare(
		`INSERT INTO "Component" (id, projectId, name, kind, tagName, createdAt, updatedAt)
			VALUES (?, ?, ?, 'element', ?, ?, ?)`,
	)
		.bind(
			id,
			projectId,
			name,
			`tb-${name.toLowerCase().replace(/\s+/g, "-")}`,
			now,
			now,
		)
		.run();
	return id;
}

async function elementChatRows() {
	return (
		await env.DB.prepare(
			'SELECT id, elementId, contextPrompt FROM "ElementChat"',
		).all<{
			id: string;
			elementId: string;
			contextPrompt: string;
		}>()
	).results;
}

async function runDesignTurn(designId: string, message: string) {
	await runDesignChatTurnStream(
		env,
		designId,
		{ message, origin: "https://example.com" },
		() => {},
	);
}

beforeEach(() => {
	vi.mocked(createWorkersAI).mockReset();
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("open_element_chat orchestrator tool (KUK-944)", () => {
	it("creates a seeded element chat session for the design's element", async () => {
		const project = await createProject();
		const design = await createDesign({ projectId: project.id });
		const elementId = await seedComponent(project.id, "Calendar");
		installModel(
			toolCallModel("open_element_chat", {
				elementType: "component",
				elementId,
				note: "compact month grid",
			}),
		);
		await runDesignTurn(design.id, "open the calendar chat");

		const rows = await elementChatRows();
		expect(rows).toHaveLength(1);
		expect(rows[0].elementId).toBe(elementId);
		// Seeded by the real context builders: the session's prompt carries
		// the component's own name, not a placeholder.
		expect(rows[0].contextPrompt).toContain("Calendar");
		expect(rows[0].contextPrompt).not.toContain("[Element chat:");
	});

	it("is idempotent — reopening returns the same session", async () => {
		const project = await createProject();
		const design = await createDesign({ projectId: project.id });
		const elementId = await seedComponent(project.id, "Hero");
		installModel(
			toolCallModel("open_element_chat", {
				elementType: "component",
				elementId,
			}),
		);
		await runDesignTurn(design.id, "open it");
		await runDesignTurn(design.id, "open it again");

		const rows = await elementChatRows();
		expect(rows).toHaveLength(1);
	});

	it("rejects a cross-project element id without creating a session", async () => {
		const design = await createDesign();
		const foreignProject = await createProject();
		const foreignElementId = await seedComponent(foreignProject.id, "Foreign");
		installModel(
			toolCallModel("open_element_chat", {
				elementType: "component",
				elementId: foreignElementId,
			}),
		);
		await runDesignTurn(design.id, "open the foreign one");

		// Recoverable tool error: no session row, and the turn completed
		// normally (the assistant's follow-up text persisted).
		expect(await elementChatRows()).toHaveLength(0);
		const assistant = await env.DB.prepare(
			`SELECT content FROM "Message" WHERE designId = ? AND role = 'assistant'`,
		)
			.bind(design.id)
			.all<{ content: string }>();
		expect(assistant.results.map((r) => r.content)).toContain("done");
	});
});
