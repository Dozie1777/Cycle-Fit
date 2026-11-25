import type {
	CalendarEventEntry,
	CampaignDetail,
	CampaignKpiWithLatestResult,
	CampaignPlanDetail,
	KpiStatus,
} from "@/client/api-types";

/**
 * Novice-friendly campaign status derivations (journey review S1.1/S1.2).
 *
 * The raw `Campaign.status` is a chat-pipeline state ("chatting" | "ready" |
 * "failed") — meaningless to a marketer — so every user-facing badge goes
 * through here instead. Everything is a pure function over the shapes already
 * fetched by the client (no server imports, no schema changes).
 */

// ------------------------------------------------------------------
// Lifecycle (KUK-979) — the label on a card or detail header
// ------------------------------------------------------------------

export type CampaignLifecycle =
	| "draft"
	| "planning"
	| "running"
	| "ending_soon"
	| "ended"
	| "failed";

export const LIFECYCLE_LABELS: Record<CampaignLifecycle, string> = {
	draft: "Not started",
	planning: "Planning",
	running: "Running",
	ending_soon: "Ending soon",
	ended: "Ended",
	failed: "Needs attention",
};

/** Badge variant per lifecycle — matches the shared ui/badge variants. */
export const LIFECYCLE_BADGE_VARIANTS: Record<
	CampaignLifecycle,
	"default" | "secondary" | "destructive" | "outline"
> = {
	draft: "secondary",
	planning: "secondary",
	running: "default",
	ending_soon: "outline",
	ended: "outline",
	failed: "destructive",
};

export function lifecycleBadge(lifecycle: CampaignLifecycle): {
	label: string;
	variant: "default" | "secondary" | "destructive" | "outline";
} {
	return {
		label: LIFECYCLE_LABELS[lifecycle],
		variant: LIFECYCLE_BADGE_VARIANTS[lifecycle],
	};
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function daysUntil(date: string, now: Date = new Date()): number {
	const target = new Date(date);
	return Math.ceil((target.getTime() - now.getTime()) / DAY_MS);
}

/**
 * Derive the lifecycle label from what the user can see: chat failure first,
 * then the target end date, then whether anything has actually been planned.
 */
export function deriveLifecycle(
	campaign: {
		status: string;
		targetEndDate: string | null;
		eventCount: number;
	},
	now: Date = new Date(),
): CampaignLifecycle {
	if (campaign.status === "failed") return "failed";
	if (!campaign.targetEndDate) {
		return campaign.eventCount > 0 ? "planning" : "draft";
	}
	const days = daysUntil(campaign.targetEndDate, now);
	if (days < 0) return "ended";
	if (days <= 7) return "ending_soon";
	return campaign.eventCount > 0 ? "running" : "planning";
}

// ------------------------------------------------------------------
// Health (KUK-980) — derived triage states for list + guided home
// ------------------------------------------------------------------

export type CampaignHealth =
	| "on_track"
	| "needs_input"
	| "off_track"
	| "not_started"
	| "ending_soon";

export const HEALTH_LABELS: Record<CampaignHealth, string> = {
	on_track: "On track",
	needs_input: "Needs your input",
	off_track: "Off track",
	not_started: "Not started",
	ending_soon: "Ending soon",
};

export type HealthReason = string;

export type CampaignHealthReport = {
	health: CampaignHealth;
	/** Plain-language reasons for the state, most important first. */
	reasons: HealthReason[];
	/** Calendar items in draft that likely need a human decision. */
	draftEventCount: number;
	/** KPIs that have never recorded a result. */
	pendingKpiCount: number;
	/** Days until target end (negative when past); null when unset. */
	daysToEnd: number | null;
};

const countKpiStatuses = (kpis: CampaignKpiWithLatestResult[]) => {
	const counts: Record<KpiStatus, number> = {
		pending: 0,
		not_met: 0,
		partial: 0,
		met: 0,
		exceeded: 0,
	};
	let withResults = 0;
	for (const kpi of kpis) {
		const latest = kpi.results[0];
		if (latest) {
			withResults += 1;
			counts[latest.status] += 1;
		} else {
			counts.pending += 1;
		}
	}
	return { counts, withResults, total: kpis.length };
};

const hasFinalPlan = (plans: CampaignPlanDetail[]) =>
	plans.some((plan) => plan.status === "final");

/**
 * Compact health inputs shared by the detail view and the list rows
 * (KUK-982/983) — one derivation, no drift between surfaces.
 */
export type HealthCoreInput = {
	status: string;
	targetEndDate: string | null;
	kpiTotal: number;
	kpiWithResults: number;
	kpiMissed: number;
	kpiPartial: number;
	draftEventCount: number;
	scheduledCount: number;
	planCount: number;
	hasFinalPlan: boolean;
};

/**
 * Derive a triage state. Conservative by design: "off_track" requires both
 * a close target end and results that are visibly behind, so the badge never
 * cries wolf without data.
 */
export function deriveCampaignHealthCore(
	input: HealthCoreInput,
	now: Date = new Date(),
): CampaignHealthReport {
	const reasons: HealthReason[] = [];
	const draftEventCount = input.draftEventCount;
	const pendingKpiCount = input.kpiTotal - input.kpiWithResults;
	const daysToEnd = input.targetEndDate
		? daysUntil(input.targetEndDate, now)
		: null;

	if (input.status === "failed") {
		return {
			health: "off_track",
			reasons: [
				"The agent's last turn failed — check the studio for the error.",
			],
			draftEventCount,
			pendingKpiCount,
			daysToEnd,
		};
	}

	// Nothing planned yet — not started, regardless of dates.
	if (input.scheduledCount === 0 && input.planCount === 0) {
		return {
			health: "not_started",
			reasons: ["No plan or calendar yet — brief the agent in the studio."],
			draftEventCount,
			pendingKpiCount,
			daysToEnd,
		};
	}

	// Ending soon outranks needs_input — the clock is the loudest signal.
	if (daysToEnd !== null && daysToEnd >= 0 && daysToEnd <= 7) {
		reasons.push(
			`Target end is ${daysToEnd === 0 ? "today" : `in ${daysToEnd} day${daysToEnd === 1 ? "" : "s"}`}.`,
		);
	}

	// Visible underperformance: recorded results that missed.
	const missed = input.kpiMissed;
	if (input.kpiWithResults > 0 && missed > 0) {
		reasons.push(
			`${missed} of ${input.kpiWithResults} recorded KPI${input.kpiWithResults === 1 ? "" : "s"} missed target.`,
		);
	}

	if (draftEventCount > 0) {
		reasons.push(
			`${draftEventCount} scheduled item${draftEventCount === 1 ? "" : "s"} still in draft.`,
		);
	}
	if (pendingKpiCount > 0 && input.kpiTotal > 0) {
		reasons.push(
			`${pendingKpiCount} KPI${pendingKpiCount === 1 ? "" : "s"} with no result recorded yet.`,
		);
	}
	if (input.kpiPartial > 0) {
		reasons.push(
			`${input.kpiPartial} recorded KPI${input.kpiPartial === 1 ? "" : "s"} only partially met target.`,
		);
	}
	if (!input.hasFinalPlan) {
		reasons.push("No final plan yet — every plan version is still a draft.");
	}

	const offTrack =
		daysToEnd !== null &&
		daysToEnd >= 0 &&
		daysToEnd <= 14 &&
		input.kpiWithResults > 0 &&
		missed >= Math.max(1, Math.floor(input.kpiWithResults / 2));
	if (offTrack) {
		return {
			health: "off_track",
			reasons,
			draftEventCount,
			pendingKpiCount,
			daysToEnd,
		};
	}
	if (daysToEnd !== null && daysToEnd >= 0 && daysToEnd <= 7) {
		return {
			health: "ending_soon",
			reasons,
			draftEventCount,
			pendingKpiCount,
			daysToEnd,
		};
	}
	// Partially-met results still need a human look (review blocker:
	// partial-only campaigns must not read as on track).
	if (
		draftEventCount > 0 ||
		pendingKpiCount > 0 ||
		!input.hasFinalPlan ||
		missed > 0 ||
		input.kpiPartial > 0
	) {
		return {
			health: "needs_input",
			reasons,
			draftEventCount,
			pendingKpiCount,
			daysToEnd,
		};
	}
	return {
		health: "on_track",
		reasons: reasons.length > 0 ? reasons : ["Everything is on schedule."],
		draftEventCount,
		pendingKpiCount,
		daysToEnd,
	};
}

/** Health from the full campaign detail (dashboard hero, studio). */
export function deriveCampaignHealth(
	detail: Pick<
		CampaignDetail,
		"status" | "targetEndDate" | "kpis" | "events" | "plans"
	>,
	now: Date = new Date(),
): CampaignHealthReport {
	const { counts, withResults, total } = countKpiStatuses(detail.kpis);
	return deriveCampaignHealthCore(
		{
			status: detail.status,
			targetEndDate: detail.targetEndDate,
			kpiTotal: total,
			kpiWithResults: withResults,
			kpiMissed: counts.not_met,
			kpiPartial: counts.partial,
			draftEventCount: detail.events.filter(
				(e: CalendarEventEntry) => e.status === "draft",
			).length,
			scheduledCount: detail.events.length,
			planCount: detail.plans.length,
			hasFinalPlan: hasFinalPlan(detail.plans),
		},
		now,
	);
}

/** Health from a listCampaigns summary row (triage row, cards). */
export function deriveCampaignHealthFromSummary(
	summary: {
		status: string;
		targetEndDate: string | null;
		kpiCount: number;
		recordedKpiCount: number;
		missedKpiCount: number;
		partialKpiCount: number;
		draftEventCount: number;
		eventCount: number;
		planCount: number;
		hasFinalPlan: boolean;
	},
	now: Date = new Date(),
): CampaignHealthReport {
	return deriveCampaignHealthCore(
		{
			status: summary.status,
			targetEndDate: summary.targetEndDate,
			kpiTotal: summary.kpiCount,
			kpiWithResults: summary.recordedKpiCount,
			kpiMissed: summary.missedKpiCount,
			kpiPartial: summary.partialKpiCount,
			draftEventCount: summary.draftEventCount,
			scheduledCount: summary.eventCount,
			planCount: summary.planCount,
			hasFinalPlan: summary.hasFinalPlan,
		},
		now,
	);
}
