// Worker tests for the campaign chat KPI tools: the agent writes structured
// KPI targets through save_brief/update_brief and records actuals with
// record_kpi_results.
import { env } from "cloudflare:workers";
import assert from "node:assert";
import { createMCPClient } from "@ai-sdk/mcp";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { MockLanguageModelV3 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkersAI } from "workers-ai-provider";
import { campaignDocumentTools } from "@/features/campaigns/chat/campaign-chat";
import { getPrisma } from "../../src/lib/db";
import { runCampaignActorTurn } from "../helpers/campaign-actor-turn";
import { createCampaign, type TestCampaign } from "../helpers/fixtures";

vi.mock("@ai-sdk/mcp", () => ({ createMCPClient: vi.fn() }));
vi.mock("workers-ai-provider", () => ({ createWorkersAI: vi.fn() }));

const usage = {
	inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
	outputTokens: { total: 0, text: 0, reasoning: 0 },
};

function immediateTextStream(
	text: string,
): ReadableStream<LanguageModelV3StreamPart> {
	return new ReadableStream({
		start(controller) {
			const chunks: LanguageModelV3StreamPart[] = [
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
			];
			for (const chunk of chunks) {
				controller.enqueue(chunk);
			}
			controller.close();
		},
	});
}

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

async function runToolTurn(
	toolName: string,
	input: unknown,
	campaignId: string,
) {
	installToolCallModel(toolName, input);
	const turn = await runCampaignActorTurn(campaignId, {
		message: "save that",
	});
	return turn.wire;
}

beforeEach(() => {
	mockMcpClient();
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("Campaign chat KPI tools", () => {
	it("save_brief writes structured KPI targets", async () => {
		const campaign = await createCampaign();
		await runToolTurn(
			"save_brief",
			{
				objective: "Launch",
				kpis: [
					{
						name: "Sign-ups",
						kind: "number",
						targetNumber: 1000,
						unit: "users",
						color: "#3b82f6",
					},
					{ name: "Launch on time", kind: "boolean", targetBoolean: true },
				],
			},
			campaign.id,
		);

		const rows = await env.DB.prepare(
			'SELECT name, kind, "targetNumber", "targetBoolean", unit, color FROM "CampaignKpi" WHERE "campaignId" = ? ORDER BY "sortOrder"',
		)
			.bind(campaign.id)
			.all();
		expect(rows.results).toEqual([
			{
				name: "Sign-ups",
				kind: "number",
				targetNumber: 1000,
				targetBoolean: null,
				unit: "users",
				color: "#3b82f6",
			},
			{
				name: "Launch on time",
				kind: "boolean",
				targetNumber: null,
				targetBoolean: 1,
				unit: null,
				color: null,
			},
		]);
	});

	it("update_brief replaces the KPI set atomically", async () => {
		const campaign = await createCampaign();
		await runToolTurn(
			"save_brief",
			{
				objective: "Launch",
				kpis: [{ name: "Old", kind: "number", targetNumber: 1 }],
			},
			campaign.id,
		);
		await runToolTurn(
			"update_brief",
			{
				kpis: [
					{ name: "New", kind: "number", targetNumber: 2, color: "#ef4444" },
				],
			},
			campaign.id,
		);

		const rows = await env.DB.prepare(
			'SELECT name, "targetNumber", color FROM "CampaignKpi" WHERE "campaignId" = ?',
		)
			.bind(campaign.id)
			.all();
		expect(rows.results).toEqual([
			{ name: "New", targetNumber: 2, color: "#ef4444" },
		]);
	});

	it("record_kpi_results records actuals and derives numeric status", async () => {
		const campaign = await createCampaign();
		await runToolTurn(
			"save_brief",
			{
				objective: "Launch",
				kpis: [
					{ name: "Sign-ups", kind: "number", targetNumber: 100 },
					{ name: "Launch on time", kind: "boolean", targetBoolean: true },
				],
			},
			campaign.id,
		);
		const kpis = (await env.DB.prepare(
			'SELECT id, name FROM "CampaignKpi" WHERE "campaignId" = ?',
		)
			.bind(campaign.id)
			.all()) as { results: Array<{ id: string; name: string }> };
		const signUps = kpis.results.find((row) => row.name === "Sign-ups");
		const onTime = kpis.results.find((row) => row.name === "Launch on time");
		assert(signUps);
		assert(onTime);

		const wire = await runToolTurn(
			"record_kpi_results",
			{
				results: [
					{ kpiId: signUps.id, actualNumber: 85 },
					{
						kpiId: onTime.id,
						actualBoolean: true,
						status: "met",
					},
				],
			},
			campaign.id,
		);
		expect(wire).toContain("Recorded 2 KPI result(s)");

		const results = await env.DB.prepare(
			'SELECT "kpiId", "actualNumber", "actualBoolean", status FROM "CampaignKpiResult" ORDER BY "createdAt"',
		).all();
		expect(results.results).toEqual([
			{
				kpiId: signUps.id,
				actualNumber: 85,
				actualBoolean: null,
				status: "partial",
			},
			{ kpiId: onTime.id, actualNumber: null, actualBoolean: 1, status: "met" },
		]);
	});

	it("record_kpi_results rejects a KPI id from another campaign", async () => {
		const campaign = await createCampaign();
		const other = await createCampaign();
		await runToolTurn(
			"save_brief",
			{
				objective: "Other",
				kpis: [{ name: "Other KPI", kind: "number", targetNumber: 10 }],
			},
			other.id,
		);
		const foreignKpi = (
			await env.DB.prepare(
				'SELECT id FROM "CampaignKpi" WHERE "campaignId" = ?',
			)
				.bind(other.id)
				.first<{ id: string }>()
		)?.id as string;

		const wire = await runToolTurn(
			"record_kpi_results",
			{ results: [{ kpiId: foreignKpi, actualNumber: 5 }] },
			campaign.id,
		);
		expect(wire).toContain("does not belong to this campaign");
		const count = await env.DB.prepare(
			'SELECT COUNT(*) as n FROM "CampaignKpiResult"',
		).first();
		expect(count?.n).toBe(0);
	});
});

/**
 * Direct tool-surface tests: prove the agent can discover KPI ids from the
 * brief tools and list_kpis, then record results, without needing to query D1.
 */
describe("Campaign KPI tool surface", () => {
	function kpiTools(campaign: TestCampaign) {
		const prisma = getPrisma(env);
		return campaignDocumentTools({
			env,
			prisma,
			campaignId: campaign.id,
			campaign: {
				id: campaign.id,
				projectId: campaign.projectId,
				name: campaign.name,
			},
			assertTurnActive: async () => {},
		}) as unknown as Record<
			string,
			{ execute: (input: unknown) => Promise<unknown> }
		>;
	}

	it("save_brief returns KPI ids and list_kpis echoes them", async () => {
		const campaign = await createCampaign();
		const tools = kpiTools(campaign);

		const saveResult = await tools.save_brief.execute({
			objective: "Launch",
			kpis: [
				{
					name: "Sign-ups",
					kind: "number",
					targetNumber: 1000,
					unit: "users",
				},
			],
		});
		expect(typeof saveResult).toBe("string");
		expect(saveResult).toContain("KPI ids:");
		expect(saveResult).toContain("Sign-ups=");

		const listResult = String(await tools.list_kpis.execute({}));
		const match = listResult.match(
			/- ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}) Sign-ups/,
		);
		assert(match);
		const kpiId = match[1];

		const recordResult = await tools.record_kpi_results.execute({
			results: [{ kpiId, actualNumber: 850 }],
		});
		expect(typeof recordResult).toBe("string");
		expect(recordResult).toContain("Recorded 1 KPI result(s)");
	});

	it("update_brief with id preserves the KPI and its recorded results", async () => {
		const campaign = await createCampaign();
		const tools = kpiTools(campaign);

		await tools.save_brief.execute({
			objective: "Launch",
			kpis: [{ name: "Sign-ups", kind: "number", targetNumber: 100 }],
		});
		const listBefore = String(await tools.list_kpis.execute({}));
		const matchBefore = listBefore.match(
			/- ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}) Sign-ups/,
		);
		assert(matchBefore);
		const kpiId = matchBefore[1];

		await tools.record_kpi_results.execute({
			results: [{ kpiId, actualNumber: 50 }],
		});

		const updateResult = await tools.update_brief.execute({
			kpis: [
				{
					id: kpiId,
					name: "Sign-ups",
					kind: "number",
					targetNumber: 200,
				},
			],
		});
		expect(updateResult).toContain("KPI ids:");
		expect(updateResult).toContain(`Sign-ups=${kpiId}`);

		const listAfter = String(await tools.list_kpis.execute({}));
		const matchAfter = listAfter.match(
			/- ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}) Sign-ups/,
		);
		assert(matchAfter);
		expect(matchAfter[1]).toBe(kpiId);

		const results = await env.DB.prepare(
			'SELECT "kpiId", "actualNumber", status FROM "CampaignKpiResult"',
		).all();
		expect(results.results).toEqual([
			{ kpiId, actualNumber: 50, status: "not_met" },
		]);
	});

	it("record_kpi_results prevalidates the whole batch before writing", async () => {
		const campaign = await createCampaign();
		const tools = kpiTools(campaign);

		await tools.save_brief.execute({
			objective: "Launch",
			kpis: [{ name: "Sign-ups", kind: "number", targetNumber: 100 }],
		});
		const list = String(await tools.list_kpis.execute({}));
		const match = list.match(
			/- ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}) Sign-ups/,
		);
		assert(match);
		const kpiId = match[1];

		const badReportId = crypto.randomUUID();
		const recordResult = await tools.record_kpi_results.execute({
			results: [
				{ kpiId, actualNumber: 50 },
				{ kpiId, reportId: badReportId, actualNumber: 60 },
			],
		});
		expect(recordResult).toEqual({
			ok: false,
			error: expect.stringContaining(`Report ${badReportId}`),
		});

		const count = await env.DB.prepare(
			'SELECT COUNT(*) as n FROM "CampaignKpiResult"',
		).first<{ n: number }>();
		expect(count?.n).toBe(0);
	});
});
