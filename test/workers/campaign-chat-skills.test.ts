// Worker tests for the studio skills in the campaign chat pipeline (KUK-891):
// the "Available skills" system-prompt section, the load_skill tool (happy /
// disabled / unknown) and the "/slug" slash resolution (known → skill content
// injected into the model context while the persisted row stays as typed;
// unknown → plain text).
//
// Harness mirrors test/workers/campaign-chat-actor.test.ts: a mock Workers AI
// model dispatched through the real `campaignChat` RivetKit actor.
import { env } from "cloudflare:workers";
import { createMCPClient } from "@ai-sdk/mcp";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { MockLanguageModelV3 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkersAI } from "workers-ai-provider";
import { runCampaignActorTurn } from "../helpers/campaign-actor-turn";
import { createCampaign } from "../helpers/fixtures";

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

function immediateTextStream(
	text: string,
): ReadableStream<LanguageModelV3StreamPart> {
	return new ReadableStream({
		start(controller) {
			for (const chunk of [
				{ type: "stream-start", warnings: [] },
				{
					type: "response-metadata",
					id: "response-id",
					modelId: "test-model",
					timestamp: new Date(0),
				},
				{ type: "text-start", id: "text-id" },
				{ type: "text-delta", id: "text-id", delta: text },
				{ type: "text-end", id: "text-id" },
				{
					type: "finish",
					finishReason: { unified: "stop", raw: undefined },
					usage,
				},
			] as LanguageModelV3StreamPart[]) {
				controller.enqueue(chunk);
			}
			controller.close();
		},
	});
}

/**
 * Mock model whose first step emits one tool call and whose second step
 * finishes with plain text (how the real pipeline continues after a tool
 * executes without ask_user).
 */
function toolCallModel(toolName: string, input: unknown) {
	let step = 0;
	return new MockLanguageModelV3({
		doStream: async () => {
			step += 1;
			if (step > 1) return { stream: immediateTextStream("done") };
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

function installModel(doStream: MockLanguageModelV3["doStream"]) {
	const model = new MockLanguageModelV3({ doStream });
	const factory = vi.fn(() => model);
	vi.mocked(createWorkersAI).mockReturnValue(factory as never);
	return { model, factory };
}

function installToolCallModel(toolName: string, input: unknown) {
	const model = toolCallModel(toolName, input);
	const factory = vi.fn(() => model);
	vi.mocked(createWorkersAI).mockReturnValue(factory as never);
	return { model, factory };
}

function mockMcpClient() {
	const client = {
		tools: vi.fn(async () => ({})),
		close: vi.fn(async () => {}),
	};
	vi.mocked(createMCPClient).mockResolvedValue(client as never);
	return client;
}

/** Runs one tool-call turn and returns the emitted chunk JSON. */
async function runToolTurn(
	toolName: string,
	input: unknown,
	campaignId: string,
) {
	installToolCallModel(toolName, input);
	const turn = await runCampaignActorTurn(campaignId, {
		message: "use the skill",
	});
	return { wire: turn.wire };
}

async function campaignMessages(campaignId: string) {
	const rows = await env.DB.prepare(
		'SELECT role, content FROM "Message" WHERE campaignId = ? ORDER BY createdAt, rowid',
	)
		.bind(campaignId)
		.all<{ role: string; content: string }>();
	return rows.results;
}

async function setSkillEnabled(slug: string, enabled: boolean) {
	await env.DB.prepare('UPDATE "Skill" SET enabled = ? WHERE slug = ?')
		.bind(enabled ? 1 : 0, slug)
		.run();
}

/**
 * A single-line excerpt of a skill's markdown — SSE wires and JSON.stringify
 * escape newlines, so multi-line slices never match literally.
 */
function excerpt(content: string | undefined): string {
	return (
		content
			?.split("\n")
			.find((line) => line.trim().length > 24)
			?.trim() ?? ""
	);
}

beforeEach(() => {
	mockMcpClient();
	installModel(async () => ({ stream: immediateTextStream("ok") }));
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("Campaign chat skills (KUK-891)", () => {
	it("lists enabled skills in the system prompt and excludes disabled ones", async () => {
		await setSkillEnabled("launch-plan", false);
		const campaign = await createCampaign();
		const { model } = installModel(async () => ({
			stream: immediateTextStream("hi"),
		}));
		await runCampaignActorTurn(campaign.id, { message: "hello" });

		expect(model.doStreamCalls).toHaveLength(1);
		const prompt = JSON.stringify(model.doStreamCalls[0]?.prompt);
		expect(prompt).toContain("# Available skills");
		expect(prompt).toContain("/campaign-basics");
		expect(prompt).toContain("/draft-a-brief");
		expect(prompt).toContain("/content-calendar");
		// The disabled skill stays out — its slug is unique to it.
		expect(prompt).not.toContain("launch-plan");
	});

	it("load_skill returns the full content for an enabled skill", async () => {
		const campaign = await createCampaign();
		const seeded = await env.DB.prepare(
			'SELECT content FROM "Skill" WHERE slug = ?',
		)
			.bind("draft-a-brief")
			.first<{ content: string }>();
		const { wire } = await runToolTurn(
			"load_skill",
			{ slug: "draft-a-brief" },
			campaign.id,
		);
		// The tool result streams back to the model in step two — visible on
		// the wire as the second step's prompt.
		expect(wire).toContain(excerpt(seeded?.content));
	});

	it("load_skill rejects unknown and disabled slugs with a recoverable error", async () => {
		const campaign = await createCampaign();

		const unknown = await runToolTurn(
			"load_skill",
			{ slug: "no-such-skill" },
			campaign.id,
		);
		expect(unknown.wire).toContain("No enabled skill");
		expect(await campaignMessages(campaign.id)).toEqual([
			{ role: "user", content: "use the skill" },
			{ role: "assistant", content: "done" },
		]);

		await setSkillEnabled("launch-plan", false);
		const disabled = await runToolTurn(
			"load_skill",
			{ slug: "launch-plan" },
			campaign.id,
		);
		expect(disabled.wire).toContain("No enabled skill");
	});

	it("resolves a known /slug into the turn context and persists the raw text", async () => {
		const campaign = await createCampaign();
		const seeded = await env.DB.prepare(
			'SELECT name, content FROM "Skill" WHERE slug = ?',
		)
			.bind("campaign-basics")
			.first<{ name: string; content: string }>();
		const { model } = installModel(async () => ({
			stream: immediateTextStream("following the skill"),
		}));
		await runCampaignActorTurn(campaign.id, {
			message: "/campaign-basics give me the tour",
		});

		expect(model.doStreamCalls).toHaveLength(1);
		const prompt = JSON.stringify(model.doStreamCalls[0]?.prompt);
		// The skill block is prepended to the invoking turn's context.
		expect(prompt).toContain(`[Skill: ${seeded?.name}]`);
		expect(prompt).toContain(excerpt(seeded?.content));
		expect(prompt).toContain("[End skill]");
		expect(prompt).toContain("give me the tour");
		// The persisted user row keeps exactly what the user typed.
		expect(await campaignMessages(campaign.id)).toEqual([
			{ role: "user", content: "/campaign-basics give me the tour" },
			{ role: "assistant", content: "following the skill" },
		]);
	});

	it("treats an unknown /slug as plain text", async () => {
		const campaign = await createCampaign();
		const { model } = installModel(async () => ({
			stream: immediateTextStream("plain answer"),
		}));
		await runCampaignActorTurn(campaign.id, {
			message: "/not-a-skill plan the launch",
		});

		const prompt = JSON.stringify(model.doStreamCalls[0]?.prompt);
		expect(prompt).not.toContain("[Skill:");
		expect(prompt).toContain("/not-a-skill plan the launch");
		// Persisted and model-facing text are identical here.
		expect(await campaignMessages(campaign.id)).toEqual([
			{ role: "user", content: "/not-a-skill plan the launch" },
			{ role: "assistant", content: "plain answer" },
		]);
	});

	it("treats a disabled skill's /slug as plain text too", async () => {
		const campaign = await createCampaign();
		await setSkillEnabled("draft-a-brief", false);
		const { model } = installModel(async () => ({
			stream: immediateTextStream("plain answer"),
		}));
		await runCampaignActorTurn(campaign.id, {
			message: "/draft-a-brief focus on retention",
		});

		const prompt = JSON.stringify(model.doStreamCalls[0]?.prompt);
		expect(prompt).not.toContain("[Skill:");
		expect(prompt).toContain("/draft-a-brief focus on retention");
	});
});
