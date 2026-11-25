import { describe, expect, it } from "vitest";
import type {
	CampaignKpiWithLatestResult,
	CampaignPlanDetail,
} from "@/client/api-types";
import { rankCampaignActions } from "./campaign-action-queue";

const NOW = new Date("2026-11-12T12:00:00.000Z");
const inDays = (n: number) =>
	new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000).toISOString();

const base = {
	status: "ready",
	targetEndDate: null,
	kpis: [] as CampaignKpiWithLatestResult[],
	events: [] as never[],
	plans: [] as CampaignPlanDetail[],
};

const event = (status: string, scheduledInDays: number) =>
	({
		id: `e-${status}-${scheduledInDays}`,
		campaignId: "c1",
		title: "Launch email",
		channel: null,
		channelId: null,
		linkedChannel: null,
		scheduledAt: inDays(scheduledInDays),
		status,
		assetId: null,
		notes: null,
		createdAt: "",
		updatedAt: "",
	}) as never;

const kpi = (results: { status: string }[]) =>
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
		results,
	}) as unknown as CampaignKpiWithLatestResult;

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

describe("rankCampaignActions", () => {
	it("ranks drafts before KPI results, both before plan finalization", () => {
		const items = rankCampaignActions(
			{
				...base,
				events: [event("draft", 2), event("planned", 3)],
				kpis: [kpi([])],
				plans: [plan("draft")],
			},
			NOW,
		);
		expect(items.map((i) => i.id)).toEqual([
			"approve-drafts",
			"record-results",
			"finalize-plan",
			"upcoming-item",
		]);
	});

	it("surfaces a failed agent turn as the most urgent item", () => {
		const items = rankCampaignActions(
			{ ...base, status: "failed", events: [event("draft", 2)] },
			NOW,
		);
		expect(items[0].id).toBe("check-failure");
		expect(items[0].urgency).toBe("urgent");
	});

	it("mentions a calendar item going out within 3 days", () => {
		const items = rankCampaignActions(
			{
				...base,
				events: [event("planned", 2)],
				plans: [plan("final")],
			},
			NOW,
		);
		expect(items.some((i) => i.id === "upcoming-item")).toBe(true);
	});

	it("ignores calendar items more than 3 days out", () => {
		const items = rankCampaignActions(
			{
				...base,
				events: [event("planned", 10)],
				plans: [plan("final")],
			},
			NOW,
		);
		expect(items.some((i) => i.id === "upcoming-item")).toBe(false);
	});

	it("returns nothing for a fully healthy campaign", () => {
		const items = rankCampaignActions(
			{
				...base,
				events: [event("planned", 10)],
				plans: [plan("final")],
				kpis: [kpi([{ status: "met" }])],
			},
			NOW,
		);
		expect(items).toEqual([]);
	});
});
