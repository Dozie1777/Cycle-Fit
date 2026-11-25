// Worker tests for the campaign chat document tools (KUK-870): the agent
// writes the campaign's brief, plan phases, calendar slots and reports as
// rows through chat turns. Covers the write paths (upsert / append /
// patch / delete semantics, position maintenance) and the campaign fence —
// ids from another campaign must be rejected with a tool error the model
// can see, never written.
//
// Harness mirrors test/workers/campaign-chat-actor.test.ts: a mock Workers
// AI model that emits exactly one tool call, dispatched through the real
// `campaignChat` RivetKit actor so the pipeline (turn lease, stream,
// persistence) runs end to end. Additional fixtures are defined locally
// instead of extending test/helpers/fixtures.ts.
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

/** Runs one chat turn that calls one tool and returns the emitted chunk JSON. */
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

async function campaignState(campaignId: string) {
	return env.DB.prepare('SELECT status, error FROM "Campaign" WHERE id = ?')
		.bind(campaignId)
		.first();
}

async function insertForeignRow(
	table: "CampaignPlan" | "PlanPhase" | "CalendarEvent",
	columns: string,
	values: unknown[],
) {
	const placeholders = columns.split(", ").map(() => "?");
	await env.DB.prepare(
		`INSERT INTO "${table}" (${columns}) VALUES (${placeholders.join(", ")})`,
	)
		.bind(...values)
		.run();
}

/** A campaign plan row belonging to a DIFFERENT campaign. */
async function createForeignPlan(campaignId: string): Promise<string> {
	const id = crypto.randomUUID();
	const now = new Date().toISOString();
	await insertForeignRow(
		"CampaignPlan",
		"id, campaignId, name, status, createdAt, updatedAt",
		[id, campaignId, "Other campaign plan", "draft", now, now],
	);
	return id;
}

async function createForeignPhase(planId: string): Promise<string> {
	const id = crypto.randomUUID();
	await insertForeignRow("PlanPhase", "id, planId, name, position", [
		id,
		planId,
		"Foreign phase",
		0,
	]);
	return id;
}

async function createForeignEvent(campaignId: string): Promise<string> {
	const id = crypto.randomUUID();
	const now = new Date().toISOString();
	await insertForeignRow(
		"CalendarEvent",
		"id, campaignId, title, status, createdAt, updatedAt",
		[id, campaignId, "Foreign event", "planned", now, now],
	);
	return id;
}

beforeEach(() => {
	mockMcpClient();
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("Campaign chat document tools", () => {
	it("save_brief creates the 1:1 brief and merges later fields", async () => {
		const campaign = await createCampaign();
		await runToolTurn(
			"save_brief",
			{ objective: "Launch the spring collection" },
			campaign.id,
		);

		const brief = await env.DB.prepare(
			'SELECT objective, audience, keyMessage, tone FROM "CampaignBrief" WHERE campaignId = ?',
		)
			.bind(campaign.id)
			.first();
		// The legacy audience markdown column is deprecated — the tool schema
		// no longer takes it, so it stays null on every save.
		expect(brief).toEqual({
			objective: "Launch the spring collection",
			audience: null,
			keyMessage: null,
			tone: null,
		});

		// Second save: new fields merge in, existing fields stay.
		await runToolTurn(
			"save_brief",
			{ tone: "warm and plain-spoken", budget: "$15k total" },
			campaign.id,
		);
		const merged = await env.DB.prepare(
			'SELECT objective, audience, tone, budget FROM "CampaignBrief" WHERE campaignId = ?',
		)
			.bind(campaign.id)
			.first();
		expect(merged).toEqual({
			objective: "Launch the spring collection",
			audience: null,
			tone: "warm and plain-spoken",
			budget: "$15k total",
		});
	});

	it("audience tools create, update, list and remove per-campaign segments", async () => {
		const campaign = await createCampaign();
		const createdWire = await runToolTurn(
			"create_audience",
			{
				name: "Gen Z shoppers",
				demographics: "- 18-27, urban",
				buyingStage: "awareness",
			},
			campaign.id,
		);
		expect(createdWire).toContain("Gen Z shoppers");

		const audience = await env.DB.prepare(
			'SELECT campaignId, name, demographics, psychographics, buyingStage FROM "TargetAudience" WHERE campaignId = ?',
		)
			.bind(campaign.id)
			.first();
		expect(audience).toEqual({
			campaignId: campaign.id,
			name: "Gen Z shoppers",
			demographics: "- 18-27, urban",
			psychographics: null,
			buyingStage: "awareness",
		});

		// Patch via update_audience, discover the id from list_audiences.
		const listWire = await runToolTurn("list_audiences", {}, campaign.id);
		expect(listWire).toContain("Gen Z shoppers");
		const audienceId = await env.DB.prepare(
			'SELECT id FROM "TargetAudience" WHERE campaignId = ?',
		)
			.bind(campaign.id)
			.first<string>("id");
		await runToolTurn(
			"update_audience",
			{ audienceId, psychographics: "- price-sensitive" },
			campaign.id,
		);
		const updated = await env.DB.prepare(
			'SELECT name, psychographics, buyingStage FROM "TargetAudience" WHERE id = ?',
		)
			.bind(audienceId)
			.first();
		expect(updated).toEqual({
			name: "Gen Z shoppers",
			psychographics: "- price-sensitive",
			buyingStage: "awareness",
		});

		// The campaign fence: an audience from ANOTHER campaign is rejected
		// with a tool error, never written.
		const foreign = await createCampaign();
		const foreignId = crypto.randomUUID();
		const now = new Date().toISOString();
		await env.DB.prepare(
			'INSERT INTO "TargetAudience" (id, campaignId, name, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)',
		)
			.bind(foreignId, foreign.id, "Foreign segment", now, now)
			.run();
		const crossWire = await runToolTurn(
			"update_audience",
			{ audienceId: foreignId, name: "hijacked" },
			campaign.id,
		);
		expect(crossWire).toContain("does not belong to this campaign");

		await runToolTurn("remove_audience", { audienceId }, campaign.id);
		const remaining = await env.DB.prepare(
			'SELECT COUNT(*) AS count FROM "TargetAudience" WHERE campaignId = ?',
		)
			.bind(campaign.id)
			.first<number>("count");
		expect(remaining).toBe(0);
		// The foreign row survived the fenced update attempt.
		const foreignRow = await env.DB.prepare(
			'SELECT name FROM "TargetAudience" WHERE id = ?',
		)
			.bind(foreignId)
			.first();
		expect(foreignRow).toEqual({ name: "Foreign segment" });
	});

	it("update_brief patches provided fields only and fails without a brief", async () => {
		const campaign = await createCampaign();

		// No brief yet: the tool error surfaces on the wire and the turn
		// still completes.
		const missingWire = await runToolTurn(
			"update_brief",
			{ objective: "too early" },
			campaign.id,
		);
		expect(missingWire).toContain("call save_brief first");
		expect(await campaignState(campaign.id)).toEqual({
			status: "ready",
			error: null,
		});

		// Seed the brief, then patch one field.
		const now = new Date().toISOString();
		await env.DB.prepare(
			`INSERT INTO "CampaignBrief" (id, campaignId, objective, audience, createdAt, updatedAt)
				VALUES (?, ?, 'original objective', 'original audience', ?, ?)`,
		)
			.bind(crypto.randomUUID(), campaign.id, now, now)
			.run();
		await runToolTurn(
			"update_brief",
			{ objective: "patched objective" },
			campaign.id,
		);

		const brief = await env.DB.prepare(
			'SELECT objective, audience FROM "CampaignBrief" WHERE campaignId = ?',
		)
			.bind(campaign.id)
			.first();
		expect(brief).toEqual({
			objective: "patched objective",
			audience: "original audience",
		});
	});

	it("save_plan creates a plan and add_phase appends in order", async () => {
		const campaign = await createCampaign();
		await runToolTurn("save_plan", { name: "Q1 launch plan" }, campaign.id);

		const plan = await env.DB.prepare(
			'SELECT name, status FROM "CampaignPlan" WHERE campaignId = ?',
		)
			.bind(campaign.id)
			.first();
		expect(plan).toEqual({ name: "Q1 launch plan", status: "draft" });
		const planId = (
			await env.DB.prepare('SELECT id FROM "CampaignPlan" WHERE campaignId = ?')
				.bind(campaign.id)
				.first()
		)?.id as string;

		await runToolTurn(
			"add_phase",
			{ planId, name: "Teaser", startsAt: "2026-03-02" },
			campaign.id,
		);
		await runToolTurn(
			"add_phase",
			{
				planId,
				name: "Launch week",
				objective: "Convert the waitlist",
				startsAt: "2026-03-09T09:00:00Z",
				endsAt: "2026-03-15",
			},
			campaign.id,
		);
		await runToolTurn("add_phase", { planId, name: "Sustain" }, campaign.id);

		const phases = await env.DB.prepare(
			'SELECT name, position, startsAt, endsAt FROM "PlanPhase" WHERE planId = ? ORDER BY position',
		)
			.bind(planId)
			.all();
		// Raw SQL inserts store Prisma-normalized ISO strings (Z suffix).
		expect(phases.results).toEqual([
			{
				name: "Teaser",
				position: 0,
				startsAt: "2026-03-02T00:00:00.000Z",
				endsAt: null,
			},
			{
				name: "Launch week",
				position: 1,
				startsAt: "2026-03-09T09:00:00.000Z",
				endsAt: "2026-03-15T00:00:00.000Z",
			},
			{ name: "Sustain", position: 2, startsAt: null, endsAt: null },
		]);
	});

	it("update_phase patches a phase of this campaign", async () => {
		const campaign = await createCampaign();
		const planId = crypto.randomUUID();
		const phaseId = crypto.randomUUID();
		const now = new Date().toISOString();
		await insertForeignRow(
			"CampaignPlan",
			"id, campaignId, name, status, createdAt, updatedAt",
			[planId, campaign.id, "Own plan", "draft", now, now],
		);
		await insertForeignRow("PlanPhase", "id, planId, name, position", [
			phaseId,
			planId,
			"Old name",
			0,
		]);

		await runToolTurn(
			"update_phase",
			{ phaseId, name: "New name", objective: "New objective" },
			campaign.id,
		);
		const phase = await env.DB.prepare(
			'SELECT name, objective, position FROM "PlanPhase" WHERE id = ?',
		)
			.bind(phaseId)
			.first();
		expect(phase).toEqual({
			name: "New name",
			objective: "New objective",
			position: 0,
		});
	});

	it("rejects plan and phase ids from another campaign", async () => {
		const campaign = await createCampaign();
		const other = await createCampaign();
		const foreignPlanId = await createForeignPlan(other.id);
		const foreignPhaseId = await createForeignPhase(foreignPlanId);

		const planWire = await runToolTurn(
			"add_phase",
			{ planId: foreignPlanId, name: "Sneaky phase" },
			campaign.id,
		);
		expect(planWire).toContain("does not belong to this campaign");
		const phaseWire = await runToolTurn(
			"update_phase",
			{ phaseId: foreignPhaseId, name: "Hijacked" },
			campaign.id,
		);
		expect(phaseWire).toContain("does not belong to this campaign");

		// Nothing was written outside the fenced campaign…
		const foreignPhases = await env.DB.prepare(
			'SELECT COUNT(*) as n FROM "PlanPhase" WHERE planId = ?',
		)
			.bind(foreignPlanId)
			.first();
		expect(foreignPhases?.n).toBe(1); // only the pre-seeded foreign row
		// …and the turn itself still completes for the model.
		expect(await campaignState(campaign.id)).toEqual({
			status: "ready",
			error: null,
		});
	});

	it("add_event, update_event and remove_event manage the calendar", async () => {
		const campaign = await createCampaign();
		// KUK-890: channels are admin-owned — the agent links by id. The
		// migration seeds the standard channels, so 'chan-email' exists.
		await runToolTurn(
			"add_event",
			{
				title: "Launch email to waitlist",
				channelId: "chan-email",
				scheduledAt: "2026-03-09T09:00:00Z",
				notes: "CTA: early access",
			},
			campaign.id,
		);
		const created = (await env.DB.prepare(
			`SELECT e.id, e.title, e.channel, e.channelId, c.name as linkedName, e.scheduledAt, e.status, e.notes
				FROM "CalendarEvent" e LEFT JOIN "Channel" c ON c.id = e.channelId
				WHERE e.campaignId = ?`,
		)
			.bind(campaign.id)
			.first()) as {
			id: string;
			title: string;
			channel: string | null;
			channelId: string | null;
			linkedName: string | null;
			scheduledAt: string | null;
			status: string | null;
			notes: string | null;
		};
		expect(created.title).toBe("Launch email to waitlist");
		// The link is set; the legacy free-text column is never written.
		expect(created.channel).toBeNull();
		expect(created.channelId).toBe("chan-email");
		expect(created.linkedName).toBe("Email");
		// Prisma's D1 adapter normalizes stored datetimes to +00:00.
		expect(created.scheduledAt).toBe("2026-03-09T09:00:00.000+00:00");
		expect(created.status).toBe("planned");
		expect(created.notes).toBe("CTA: early access");

		await runToolTurn(
			"update_event",
			{ eventId: created.id, status: "scheduled" },
			campaign.id,
		);
		const updated = await env.DB.prepare(
			'SELECT title, status FROM "CalendarEvent" WHERE id = ?',
		)
			.bind(created.id)
			.first();
		expect(updated).toEqual({
			title: "Launch email to waitlist",
			status: "scheduled",
		});

		await runToolTurn("remove_event", { eventId: created.id }, campaign.id);
		const remaining = await env.DB.prepare(
			'SELECT COUNT(*) as n FROM "CalendarEvent" WHERE campaignId = ?',
		)
			.bind(campaign.id)
			.first();
		expect(remaining?.n).toBe(0);
	});

	it("list_channels enumerates the seeded channels and unknown channelIds are recoverable errors", async () => {
		const campaign = await createCampaign();

		// Cheap enumeration: the standard channels are seeded idempotently by
		// migration 0017, so list_channels sees them without any setup.
		const listWire = await runToolTurn("list_channels", {}, campaign.id);
		expect(listWire).toContain("- chan-email Email");
		expect(listWire).toContain("- chan-x X");

		// An unknown channelId is a structured tool error (the turn still
		// completes) that lists the available channel names — never written.
		const wire = await runToolTurn(
			"add_event",
			{ title: "Mystery slot", channelId: "chan-nope" },
			campaign.id,
		);
		expect(wire).toContain("Unknown channel id chan-nope");
		expect(wire).toContain("Email");
		const count = await env.DB.prepare(
			'SELECT COUNT(*) as n FROM "CalendarEvent" WHERE campaignId = ?',
		)
			.bind(campaign.id)
			.first();
		expect(count?.n).toBe(0);
		expect(await campaignState(campaign.id)).toEqual({
			status: "ready",
			error: null,
		});

		// update_event with an unknown channelId is rejected the same way.
		const now = new Date().toISOString();
		await env.DB.prepare(
			`INSERT INTO "CalendarEvent" (id, campaignId, title, status, createdAt, updatedAt)
				VALUES (?, ?, 'Own slot', 'planned', ?, ?)`,
		)
			.bind(crypto.randomUUID(), campaign.id, now, now)
			.run();
		const eventId = (
			await env.DB.prepare(
				'SELECT id FROM "CalendarEvent" WHERE campaignId = ?',
			)
				.bind(campaign.id)
				.first()
		)?.id as string;
		const updateWire = await runToolTurn(
			"update_event",
			{ eventId, channelId: "chan-nope" },
			campaign.id,
		);
		expect(updateWire).toContain("Unknown channel id chan-nope");
		const untouched = await env.DB.prepare(
			'SELECT channelId FROM "CalendarEvent" WHERE id = ?',
		)
			.bind(eventId)
			.first();
		expect(untouched?.channelId).toBeNull();
	});

	it("save_brief replaces the channel set atomically via channelIds", async () => {
		const campaign = await createCampaign();

		// Unknown id: rejected before any write.
		const unknownWire = await runToolTurn(
			"save_brief",
			{ objective: "Launch", channelIds: ["chan-email", "chan-nope"] },
			campaign.id,
		);
		expect(unknownWire).toContain("Unknown channel id(s): chan-nope");
		const linksAfterUnknown = await env.DB.prepare(
			'SELECT COUNT(*) as n FROM "CampaignChannel" WHERE campaignId = ?',
		)
			.bind(campaign.id)
			.first();
		expect(linksAfterUnknown?.n).toBe(0);

		// Valid set: two channels linked in one call.
		await runToolTurn(
			"save_brief",
			{ objective: "Launch", channelIds: ["chan-email", "chan-x"] },
			campaign.id,
		);
		const links = await env.DB.prepare(
			'SELECT channelId FROM "CampaignChannel" WHERE campaignId = ? ORDER BY channelId',
		)
			.bind(campaign.id)
			.all();
		expect(links.results).toEqual([
			{ channelId: "chan-email" },
			{ channelId: "chan-x" },
		]);

		// A later call REPLACES the whole set (not a merge).
		await runToolTurn(
			"update_brief",
			{ channelIds: ["chan-linkedin"] },
			campaign.id,
		);
		const replaced = await env.DB.prepare(
			'SELECT channelId FROM "CampaignChannel" WHERE campaignId = ? ORDER BY channelId',
		)
			.bind(campaign.id)
			.all();
		expect(replaced.results).toEqual([{ channelId: "chan-linkedin" }]);

		// An empty array clears the mix; brief fields survive untouched.
		await runToolTurn("update_brief", { channelIds: [] }, campaign.id);
		const cleared = await env.DB.prepare(
			'SELECT COUNT(*) as n FROM "CampaignChannel" WHERE campaignId = ?',
		)
			.bind(campaign.id)
			.first();
		expect(cleared?.n).toBe(0);
		const brief = await env.DB.prepare(
			'SELECT objective FROM "CampaignBrief" WHERE campaignId = ?',
		)
			.bind(campaign.id)
			.first();
		expect(brief).toEqual({ objective: "Launch" });
	});

	it("rejects calendar event ids from another campaign", async () => {
		const campaign = await createCampaign();
		const other = await createCampaign();
		const foreignEventId = await createForeignEvent(other.id);

		const updateWire = await runToolTurn(
			"update_event",
			{ eventId: foreignEventId, status: "published" },
			campaign.id,
		);
		expect(updateWire).toContain("does not belong to this campaign");

		const removeWire = await runToolTurn(
			"remove_event",
			{ eventId: foreignEventId },
			campaign.id,
		);
		expect(removeWire).toContain("does not belong to this campaign");

		// The foreign event survives untouched.
		const foreign = await env.DB.prepare(
			'SELECT status FROM "CalendarEvent" WHERE id = ?',
		)
			.bind(foreignEventId)
			.first();
		expect(foreign).toEqual({ status: "planned" });
	});

	it("save_report stores period, summary, metrics and body", async () => {
		const campaign = await createCampaign();
		await runToolTurn(
			"save_report",
			{
				title: "Week 1 performance",
				periodStart: "2026-03-02",
				periodEnd: "2026-03-08",
				summary: "Strong open, email led.",
				metrics: "| KPI | Actual |\n| --- | --- |\n| Signups | 412 |",
				body: "# Week 1\n\nThe campaign opened ahead of plan.",
			},
			campaign.id,
		);
		const report = await env.DB.prepare(
			'SELECT title, periodStart, periodEnd, summary, metrics, body FROM "CampaignReport" WHERE campaignId = ?',
		)
			.bind(campaign.id)
			.first();
		expect(report).toEqual({
			title: "Week 1 performance",
			periodStart: "2026-03-02T00:00:00.000+00:00",
			periodEnd: "2026-03-08T00:00:00.000+00:00",
			summary: "Strong open, email led.",
			metrics: "| KPI | Actual |\n| --- | --- |\n| Signups | 412 |",
			body: "# Week 1\n\nThe campaign opened ahead of plan.",
		});
	});

	it("rejects malformed writes with zod validation before any write", async () => {
		const campaign = await createCampaign();
		// Bad status value and bad date format must fail zod validation —
		// the tool never runs, nothing is written, and the turn completes.
		await runToolTurn(
			"add_event",
			{ title: "Bad slot", status: " archived ", scheduledAt: "March 9" },
			campaign.id,
		);
		const count = await env.DB.prepare(
			'SELECT COUNT(*) as n FROM "CalendarEvent" WHERE campaignId = ?',
		)
			.bind(campaign.id)
			.first();
		expect(count?.n).toBe(0);
		expect(await campaignState(campaign.id)).toEqual({
			status: "ready",
			error: null,
		});
	});

	it("confirms writes with a compact echo the model can repeat", async () => {
		const campaign = await createCampaign();
		const wire = await runToolTurn(
			"save_brief",
			{ objective: "Launch the spring collection" },
			campaign.id,
		);
		expect(wire).toContain("save_brief");
		expect(wire).toContain("Brief saved (fields: objective)");
	});
});
