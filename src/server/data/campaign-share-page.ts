import { resolveCampaignShareSlug } from "@/features/campaigns/share/campaign-share";
import { getPrisma } from "@/lib/db";

/**
 * Server-compiled snapshot for the public campaign share page (KUK-876).
 *
 * This is a marketing surface, not an admin view: it must never touch admin
 * session APIs and must never carry admin-only data. The snapshot therefore
 * selects exactly the fields it renders — event notes, briefPrompt, chat
 * state, and report rows are never fetched when the owner has not opted in
 * (`shareIncludeReports`, default off), so nothing can leak through the
 * serialized loader data embedded in the SSR HTML.
 *
 * Slug resolution is shared with the dashboard share routes: null → the page
 * renders a 404 (missing, revoked, or rotated-away slug).
 */

export type CampaignShareBrief = {
	objective: string | null;
	audience: string | null;
	keyMessage: string | null;
	tone: string | null;
	channels: string | null;
	body: string | null;
};

export type CampaignSharePhase = {
	id: string;
	name: string;
	objective: string | null;
	startsAt: string | null;
	endsAt: string | null;
};

export type CampaignSharePlan = {
	id: string;
	name: string;
	status: string;
	phases: CampaignSharePhase[];
};

export type CampaignShareEvent = {
	id: string;
	title: string;
	channel: string | null;
	scheduledAt: string | null;
	status: string;
};

export type CampaignShareAsset = {
	id: string;
	prompt: string;
};

export type CampaignShareReport = {
	id: string;
	title: string;
	periodStart: string | null;
	periodEnd: string | null;
	summary: string | null;
	metrics: string | null;
	body: string;
};

export type CampaignShareAudience = {
	id: string;
	name: string;
	buyingStage: string | null;
};

export type CampaignShareSnapshot = {
	campaignId: string;
	name: string;
	/** Inferred from plan phases, falling back to calendar events. */
	dateRange: { start: string | null; end: string | null };
	brief: CampaignShareBrief | null;
	/** Per-campaign target audiences (structured segmentation rows). */
	audiences: CampaignShareAudience[];
	plans: CampaignSharePlan[];
	events: CampaignShareEvent[];
	/** Published assets (live publication) — embedded as sandboxed iframes. */
	assets: CampaignShareAsset[];
	/** Null when reports are gated off — the fields were never fetched. */
	reports: CampaignShareReport[] | null;
};

function iso(date: Date | null): string | null {
	return date ? date.toISOString() : null;
}

/** min startsAt / max endsAt across phases, falling back to event dates. */
function inferDateRange(
	phases: Array<{ startsAt: Date | null; endsAt: Date | null }>,
	events: Array<{ scheduledAt: Date | null }>,
): { start: string | null; end: string | null } {
	const starts = phases
		.map((phase) => phase.startsAt)
		.filter((date): date is Date => date !== null);
	const ends = phases
		.map((phase) => phase.endsAt)
		.filter((date): date is Date => date !== null);
	if (starts.length > 0 || ends.length > 0) {
		return {
			start: starts.length
				? new Date(Math.min(...starts.map((d) => d.getTime()))).toISOString()
				: null,
			end: ends.length
				? new Date(Math.max(...ends.map((d) => d.getTime()))).toISOString()
				: null,
		};
	}
	const scheduled = events
		.map((event) => event.scheduledAt)
		.filter((date): date is Date => date !== null);
	if (scheduled.length === 0) return { start: null, end: null };
	return {
		start: new Date(
			Math.min(...scheduled.map((d) => d.getTime())),
		).toISOString(),
		end: new Date(Math.max(...scheduled.map((d) => d.getTime()))).toISOString(),
	};
}

export async function loadCampaignShareSnapshot(
	env: Env,
	slug: string,
): Promise<CampaignShareSnapshot | null> {
	const resolved = await resolveCampaignShareSlug(env, slug);
	if (!resolved) return null;
	const prisma = getPrisma(env);
	const campaign = await prisma.campaign.findUnique({
		where: { id: resolved.id },
		select: {
			id: true,
			name: true,
			shareIncludeReports: true,
			brief: {
				select: {
					objective: true,
					audience: true,
					keyMessage: true,
					tone: true,
					channels: true,
					body: true,
				},
			},
			// Per-campaign target audiences (public marketing context). Only the
			// fields the page renders are selected — demographics/psychographics
			// and freeform notes never reach the unauthenticated snapshot.
			audiences: {
				orderBy: { createdAt: "asc" },
				select: {
					id: true,
					name: true,
					buyingStage: true,
				},
			},
			plans: {
				orderBy: { createdAt: "asc" },
				select: {
					id: true,
					name: true,
					status: true,
					phases: {
						orderBy: { position: "asc" },
						select: {
							id: true,
							name: true,
							objective: true,
							startsAt: true,
							endsAt: true,
						},
					},
				},
			},
			events: {
				orderBy: { scheduledAt: "asc" },
				// Public calendar: title/channel/date/status only — never notes.
				// Channel prefers the linked enumeration name (KUK-890), falling
				// back to the legacy text.
				select: {
					id: true,
					title: true,
					channel: true,
					linkedChannel: { select: { name: true } },
					scheduledAt: true,
					status: true,
				},
			},
			// Published assets only: a live publication means the /designs/:id/site
			// embed actually renders content (the site route 404s without one).
			assets: {
				where: { liveTurnId: { not: null } },
				orderBy: { updatedAt: "desc" },
				select: { id: true, prompt: true },
			},
		},
	});
	if (!campaign) return null;
	const includeReports = campaign.shareIncludeReports;
	// Gated off (the default): report rows are never fetched, so bodies,
	// metrics, and titles cannot leak into the serialized loader data.
	const reports = includeReports
		? await prisma.campaignReport.findMany({
				where: { campaignId: campaign.id },
				orderBy: { createdAt: "desc" },
				select: {
					id: true,
					title: true,
					periodStart: true,
					periodEnd: true,
					summary: true,
					metrics: true,
					body: true,
				},
			})
		: null;

	return {
		campaignId: campaign.id,
		name: campaign.name,
		dateRange: inferDateRange(
			campaign.plans.flatMap((plan) => plan.phases),
			campaign.events,
		),
		brief: campaign.brief,
		audiences: campaign.audiences,
		plans: campaign.plans.map((plan) => ({
			id: plan.id,
			name: plan.name,
			status: plan.status,
			phases: plan.phases.map((phase) => ({
				id: phase.id,
				name: phase.name,
				objective: phase.objective,
				startsAt: iso(phase.startsAt),
				endsAt: iso(phase.endsAt),
			})),
		})),
		events: campaign.events.map((event) => ({
			id: event.id,
			title: event.title,
			channel: event.linkedChannel?.name ?? event.channel,
			scheduledAt: iso(event.scheduledAt),
			status: event.status,
		})),
		assets: campaign.assets,
		reports:
			reports === null
				? null
				: reports.map((report) => ({
						id: report.id,
						title: report.title,
						periodStart: iso(report.periodStart),
						periodEnd: iso(report.periodEnd),
						summary: report.summary,
						metrics: report.metrics,
						body: report.body,
					})),
	};
}
