import { describe, expect, it } from "vitest";
import type {
	CampaignKpiWithLatestResult,
	CampaignPlanDetail,
} from "@/client/api-types";
import {
	daysUntil,
	deriveCampaignHealth,
	deriveLifecycle,
	lifecycleBadge,
} from "./health";

// Fixed "now" so date math is deterministic: 2026-11-12.
const NOW = new Date("2026-11-12T12:00:00.000Z");
const inDays = (n: number) =>
	new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000).toISOString();

const kpi = (
	overrides: Partial<CampaignKpiWithLatestResult> = {},
): CampaignKpiWithLatestResult =>
	({
		id: "kpi-1",
		campaignId: "c1",
		name: "Registrations",
		kind: "number",
		targetNumber: 100,
		targetBoolean: null,
		targetText: null,
		unit: null,
		color: null,
		sortOrder: 0,
		createdAt: "",
		updatedAt: "",
		results: [],
		...overrides,
	}) as CampaignKpiWithLatestResult;

const plan = (status: string): CampaignPlanDetail =>
	({
		id: "plan-1",
		campaignId: "c1",
		name: "Plan",
		status,
		createdAt: "",
		updatedAt: "",
		phases: [],
	}) as CampaignPlanDetail;

const event = (status: string) =>
	({
		id: `event-${status}`,
		campaignId: "c1",
		title: "Post",
		channel: null,
		channelId: null,
		linkedChannel: null,
		scheduledAt: inDays(1),
		status,
		assetId: null,
		notes: null,
		createdAt: "",
		updatedAt: "",
	}) as never;

describe("deriveLifecycle", () => {
	it("shows a chat failure as needs attention", () => {
		expect(
			deriveLifecycle(
				{ status: "failed", targetEndDate: null, eventCount: 0 },
				NOW,
			),
		).toBe("failed");
		expect(lifecycleBadge("failed")).toEqual({
			label: "Needs attention",
			variant: "destructive",
		});
	});

	it("never leaks the raw chat-pipeline 'ready' state", () => {
		// Old bug: the card rendered the literal "ready" from the schema.
		const lc = deriveLifecycle(
			{ status: "ready", targetEndDate: null, eventCount: 0 },
			NOW,
		);
		expect(lifecycleBadge(lc).label).not.toBe("ready");
		expect(lc).toBe("draft");
	});

	it("no target end + no events = Not started; with events = Planning", () => {
		expect(
			deriveLifecycle(
				{ status: "ready", targetEndDate: null, eventCount: 0 },
				NOW,
			),
		).toBe("draft");
		expect(
			deriveLifecycle(
				{ status: "ready", targetEndDate: null, eventCount: 5 },
				NOW,
			),
		).toBe("planning");
	});

	it("past target end = Ended", () => {
		expect(
			deriveLifecycle(
				{ status: "ready", targetEndDate: inDays(-1), eventCount: 9 },
				NOW,
			),
		).toBe("ended");
	});

	it("target end within a week = Ending soon", () => {
		expect(
			deriveLifecycle(
				{ status: "ready", targetEndDate: inDays(5), eventCount: 9 },
				NOW,
			),
		).toBe("ending_soon");
	});

	it("future target end + scheduled posts = Running", () => {
		expect(
			deriveLifecycle(
				{ status: "ready", targetEndDate: inDays(20), eventCount: 9 },
				NOW,
			),
		).toBe("running");
	});
});

describe("deriveCampaignHealth", () => {
	const base = {
		status: "ready",
		targetEndDate: null,
		kpis: [] as CampaignKpiWithLatestResult[],
		events: [] as never[],
		plans: [] as CampaignPlanDetail[],
	};

	it("empty campaign = not started with a nudge reason", () => {
		const r = deriveCampaignHealth(base, NOW);
		expect(r.health).toBe("not_started");
		expect(r.reasons[0]).toMatch(/studio/i);
	});

	it("agent failure = off track with an error reason", () => {
		const r = deriveCampaignHealth(
			{
				...base,
				status: "failed",
				events: [event("planned")],
				plans: [plan("final")],
			},
			NOW,
		);
		expect(r.health).toBe("off_track");
		expect(r.reasons[0]).toMatch(/failed/i);
	});

	it("all final + results met + no drafts = on track", () => {
		const r = deriveCampaignHealth(
			{
				...base,
				events: [event("planned")],
				plans: [plan("final")],
				kpis: [kpi({ results: [{ status: "met" }] as never })],
			},
			NOW,
		);
		expect(r.health).toBe("on_track");
	});

	it("drafts, pending KPIs or draft-only plans = needs input", () => {
		expect(
			deriveCampaignHealth(
				{
					...base,
					events: [event("planned"), event("draft")],
					plans: [plan("final")],
				},
				NOW,
			).health,
		).toBe("needs_input");
		expect(
			deriveCampaignHealth(
				{
					...base,
					events: [event("planned")],
					plans: [plan("final")],
					kpis: [kpi()],
				},
				NOW,
			).health,
		).toBe("needs_input");
		expect(
			deriveCampaignHealth(
				{ ...base, events: [event("planned")], plans: [plan("draft")] },
				NOW,
			).health,
		).toBe("needs_input");
	});

	it("ending within 7 days wins over needs input", () => {
		const r = deriveCampaignHealth(
			{
				...base,
				targetEndDate: inDays(3),
				events: [event("planned"), event("draft")],
				plans: [plan("final")],
			},
			NOW,
		);
		expect(r.health).toBe("ending_soon");
		expect(r.reasons.join(" ")).toMatch(/in 3 days/i);
	});

	it("majority-missed results near the deadline = off track", () => {
		const r = deriveCampaignHealth(
			{
				...base,
				targetEndDate: inDays(10),
				events: [event("planned")],
				plans: [plan("final")],
				kpis: [
					kpi({ results: [{ status: "not_met" }] as never }),
					kpi({ results: [{ status: "not_met" }] as never }),
					kpi({ results: [{ status: "met" }] as never }),
				],
			},
			NOW,
		);
		expect(r.health).toBe("off_track");
	});

	it("a single miss far from the deadline is not off track", () => {
		const r = deriveCampaignHealth(
			{
				...base,
				targetEndDate: inDays(40),
				events: [event("planned")],
				plans: [plan("final")],
				kpis: [kpi({ results: [{ status: "not_met" }] as never })],
			},
			NOW,
		);
		expect(r.health).toBe("needs_input");
	});

	it("partial-only results still read as needs input", () => {
		// Review-blocker regression: partials must not fall through to on_track.
		const r = deriveCampaignHealth(
			{
				...base,
				targetEndDate: inDays(40),
				events: [event("planned")],
				plans: [plan("final")],
				kpis: [kpi({ results: [{ status: "partial" }] as never })],
			},
			NOW,
		);
		expect(r.health).toBe("needs_input");
		expect(r.reasons.join(" ")).toMatch(/partially met/i);
	});
});

describe("daysUntil", () => {
	it("whole-day difference, rounded up across midnight boundaries", () => {
		expect(daysUntil(inDays(1), NOW)).toBe(1);
		expect(daysUntil(inDays(-1), NOW)).toBe(-1);
	});
});
