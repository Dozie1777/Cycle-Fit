import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createCampaignAsset } from "@/features/campaigns/assets/campaign-asset-context";
import { CAMPAIGN_CHAT_CANCELLED_ERROR } from "@/features/campaigns/chat/campaign-chat";
import type { KpiStatus } from "@/features/campaigns/kpis/kpi-status";
import { isDesignId } from "@/features/design-studio/assets/design-files";
import { getPrisma } from "@/lib/db";

// Campaign ids double as chat session ids and (later) the campaign R2
// prefix — same shape as Design ids: lowercase UUIDs.
const CAMPAIGN_ID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isCampaignId(value: string): boolean {
	return CAMPAIGN_ID_RE.test(value);
}

// Project ids come from Prisma's `@default(cuid())` (handlers/projects.ts
// lets Prisma generate them), so they are cuids — NOT the UUID shape designs
// and campaigns use. Legacy/test rows may hold UUIDs, so both are accepted.
const CUID_RE = /^c[0-9a-z]{24}$/;

export function isProjectId(value: string): boolean {
	return CUID_RE.test(value) || CAMPAIGN_ID_RE.test(value);
}

function newCampaignId(): string {
	return crypto.randomUUID();
}

// Input schemas — routers use these via `.input(...)` so every mutation is
// zod-validated at the tRPC boundary before the handler runs.
export const createCampaignBody = z.object({
	// Campaigns are always filed: the container is part of creation and the
	// unfiled creator is gone — the all-campaigns form picks it explicitly.
	projectId: z.string().refine(isProjectId, "invalid project id"),
	name: z.string().trim().min(1).max(200),
	briefPrompt: z.string().trim().max(4000).optional(),
});

const createProjectCampaignBody = z.object({
	name: z.string().trim().min(1).max(200),
	briefPrompt: z.string().trim().max(4000).optional(),
});

export const updateCampaignBody = z
	.object({
		name: z.string().trim().min(1).max(200).optional(),
		// Move-to-project only: a campaign can change containers but never
		// become unfiled — every campaign is always part of a project.
		projectId: z.string().refine(isProjectId, "invalid project id").optional(),
		targetEndDate: z
			.string()
			.refine(
				(value) =>
					/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(
						value,
					) && !Number.isNaN(Date.parse(value)),
				"ISO 8601 date or datetime",
			)
			.nullish(),
	})
	.refine(
		(body) =>
			body.name !== undefined ||
			body.projectId !== undefined ||
			body.targetEndDate !== undefined,
		"name, projectId or targetEndDate required",
	);

// Manual asset creation body (KUK-871) — hoisted verbatim from the
// /campaigns/:id/assets route; validation semantics unchanged.
export const createAssetBody = z.object({
	// Optional seed: the asset's brief opens with this. Without it the
	// distilled campaign context stands alone.
	name: z.string().trim().min(1).max(200).optional(),
	briefPrompt: z.string().trim().min(1).max(4000).optional(),
});

// Calendar event slot patch (KUK-871) — hoisted verbatim from the
// /campaigns/:id/events/:eventId route: field edits plus asset attach/detach.
// The attached asset is a design of this campaign or unattached; a design of
// ANOTHER campaign is rejected (400), never silently refiled. Detaching is
// explicit: assetId = null.
export const updateEventBody = z
	.object({
		title: z.string().trim().min(1).max(200).optional(),
		// KUK-890: channels are linked by enumerated id (null clears). The
		// legacy free-text `channel` input is gone — the text column is
		// deprecated and no longer written by any surface. Unknown ids are
		// rejected with the available names; nothing is written then.
		channelId: z.string().trim().min(1).max(64).nullish(),
		scheduledAt: z
			.string()
			.trim()
			.refine(
				(value) => !Number.isNaN(Date.parse(value)),
				"invalid scheduledAt",
			)
			.optional(),
		status: z.enum(["planned", "draft", "scheduled", "published"]).optional(),
		notes: z.string().trim().max(2000).optional(),
		// Attach (design id) / detach (null); absent = leave unchanged.
		assetId: z
			.string()
			.refine(isDesignId, "invalid asset id")
			.nullable()
			.optional(),
	})
	.refine(
		(body) => Object.values(body).some((value) => value !== undefined),
		"at least one field required",
	);

export async function createCampaign(input: {
	env: Env;
	body: z.infer<typeof createCampaignBody>;
}): Promise<{ campaignId: string }> {
	const { env, body } = input;
	const prisma = getPrisma(env);
	const container = await prisma.project.findUnique({
		where: { id: body.projectId },
	});
	if (!container) {
		throw new TRPCError({ code: "NOT_FOUND", message: "project not found" });
	}
	// Every campaign is born filed: the container is part of creation.
	const campaignId = newCampaignId();
	await prisma.campaign.create({
		data: {
			id: campaignId,
			name: body.name,
			briefPrompt: body.briefPrompt ?? null,
			projectId: container.id,
		},
	});
	return { campaignId };
}

/** List row: campaign + asset/event counts + latest report title + health inputs (KUK-982/983). */
type CampaignListRow = {
	id: string;
	assetCount: number;
	eventCount: number;
	latestReportTitle: string | null;
	draftEventCount: number;
	hasFinalPlan: boolean;
	planCount: number;
	nextScheduledAt: Date | null;
	kpiCount: number;
	recordedKpiCount: number;
	missedKpiCount: number;
	partialKpiCount: number;
	primaryKpi: {
		name: string;
		unit: string | null;
		targetNumber: number | null;
		latestResult: { actualNumber: number | null; status: KpiStatus } | null;
	} | null;
};

async function listCampaignRows(env: Env, projectId: string | null) {
	const prisma = getPrisma(env);
	const campaigns = await prisma.campaign.findMany({
		where: projectId ? { projectId } : undefined,
		orderBy: { createdAt: "desc" },
		take: 100,
	});
	if (campaigns.length === 0) return [];
	const ids = campaigns.map((campaign) => campaign.id);
	const [
		assetCounts,
		eventCounts,
		reports,
		draftEventCounts,
		plans,
		upcoming,
		kpis,
	] = await Promise.all([
		prisma.design.groupBy({
			by: ["campaignId"],
			_count: { _all: true },
			where: { campaignId: { in: ids } },
		}),
		prisma.calendarEvent.groupBy({
			by: ["campaignId"],
			_count: { _all: true },
			where: { campaignId: { in: ids } },
		}),
		// Newest-first walk: the first row seen per campaign is its latest
		// report (no per-campaign query fan-out).
		prisma.campaignReport.findMany({
			where: { campaignId: { in: ids } },
			orderBy: { createdAt: "desc" },
			select: { campaignId: true, title: true },
		}),
		// KUK-982/983: draft calendar items awaiting a human decision.
		prisma.calendarEvent.groupBy({
			by: ["campaignId"],
			_count: { _all: true },
			where: { campaignId: { in: ids }, status: "draft" },
		}),
		// Plan presence + a final plan signal, without phase fan-out.
		prisma.campaignPlan.findMany({
			where: { campaignId: { in: ids } },
			select: { campaignId: true, status: true },
		}),
		// Earliest upcoming item per campaign = the "launches on" signal.
		prisma.calendarEvent.findMany({
			where: { campaignId: { in: ids }, scheduledAt: { not: null } },
			orderBy: { scheduledAt: "asc" },
			select: { campaignId: true, scheduledAt: true },
		}),
		prisma.campaignKpi.findMany({
			where: { campaignId: { in: ids } },
			select: {
				id: true,
				campaignId: true,
				name: true,
				unit: true,
				targetNumber: true,
				sortOrder: true,
			},
			orderBy: { sortOrder: "asc" },
		}),
	]);
	const assetCountByCampaign = new Map(
		assetCounts.map((count) => [count.campaignId, count._count._all]),
	);
	const eventCountByCampaign = new Map(
		eventCounts.map((count) => [count.campaignId, count._count._all]),
	);
	const latestReportTitle = new Map<string, string>();
	for (const report of reports) {
		if (!latestReportTitle.has(report.campaignId)) {
			latestReportTitle.set(report.campaignId, report.title);
		}
	}
	const draftEventCountByCampaign = new Map(
		draftEventCounts.map((count) => [count.campaignId, count._count._all]),
	);
	const hasFinalPlanByCampaign = new Map<string, boolean>();
	const planCountByCampaign = new Map<string, number>();
	for (const plan of plans) {
		if (plan.status === "final")
			hasFinalPlanByCampaign.set(plan.campaignId, true);
		planCountByCampaign.set(
			plan.campaignId,
			(planCountByCampaign.get(plan.campaignId) ?? 0) + 1,
		);
	}
	const nextScheduledByCampaign = new Map<string, Date>();
	for (const event of upcoming) {
		if (event.scheduledAt && !nextScheduledByCampaign.has(event.campaignId)) {
			nextScheduledByCampaign.set(event.campaignId, event.scheduledAt);
		}
	}
	// Latest result per KPI (newest-first walk, same trick as reports).
	// D1 caps bound parameters at 100, so the id list is chunked — a full
	// list (100 campaigns) can easily own more than 100 KPIs.
	const kpiIds = kpis.map((kpi) => kpi.id);
	const kpiResults: {
		kpiId: string;
		status: string;
		actualNumber: number | null;
	}[] = [];
	const KPI_ID_CHUNK = 100;
	for (let i = 0; i < kpiIds.length; i += KPI_ID_CHUNK) {
		const chunk = kpiIds.slice(i, i + KPI_ID_CHUNK);
		const rows = await prisma.campaignKpiResult.findMany({
			where: { kpiId: { in: chunk } },
			orderBy: { recordedAt: "desc" },
			select: { kpiId: true, status: true, actualNumber: true },
		});
		kpiResults.push(...rows);
	}
	const latestResultByKpi = new Map<
		string,
		{ status: KpiStatus; actualNumber: number | null }
	>();
	for (const result of kpiResults) {
		if (!latestResultByKpi.has(result.kpiId)) {
			latestResultByKpi.set(result.kpiId, {
				// The status column only ever holds validated values (same
				// contract as getCampaign's KPI rows).
				status: result.status as KpiStatus,
				actualNumber: result.actualNumber,
			});
		}
	}
	const kpisByCampaign = new Map<string, typeof kpis>();
	for (const kpi of kpis) {
		const list = kpisByCampaign.get(kpi.campaignId) ?? [];
		list.push(kpi);
		kpisByCampaign.set(kpi.campaignId, list);
	}
	return campaigns.map((campaign): CampaignListRow & typeof campaign => {
		const campaignKpis = kpisByCampaign.get(campaign.id) ?? [];
		let recordedKpiCount = 0;
		let missedKpiCount = 0;
		let partialKpiCount = 0;
		for (const kpi of campaignKpis) {
			const latest = latestResultByKpi.get(kpi.id);
			if (latest) {
				recordedKpiCount += 1;
				if (latest.status === "not_met") missedKpiCount += 1;
				if (latest.status === "partial") partialKpiCount += 1;
			}
		}
		// Primary KPI: the first with a target, else the first with a result,
		// else the first defined.
		const primaryKpi =
			campaignKpis.find((kpi) => kpi.targetNumber != null) ??
			campaignKpis.find((kpi) => latestResultByKpi.has(kpi.id)) ??
			campaignKpis[0];
		return {
			...campaign,
			// Campaigns are always filed (creation requires the container), so
			// the public contract types projectId as string; the column stays
			// nullable for legacy rows.
			projectId: campaign.projectId as string,
			assetCount: assetCountByCampaign.get(campaign.id) ?? 0,
			eventCount: eventCountByCampaign.get(campaign.id) ?? 0,
			latestReportTitle: latestReportTitle.get(campaign.id) ?? null,
			draftEventCount: draftEventCountByCampaign.get(campaign.id) ?? 0,
			hasFinalPlan: hasFinalPlanByCampaign.get(campaign.id) ?? false,
			planCount: planCountByCampaign.get(campaign.id) ?? 0,
			nextScheduledAt: nextScheduledByCampaign.get(campaign.id) ?? null,
			kpiCount: campaignKpis.length,
			recordedKpiCount,
			missedKpiCount,
			partialKpiCount,
			primaryKpi: primaryKpi
				? {
						name: primaryKpi.name,
						unit: primaryKpi.unit,
						targetNumber: primaryKpi.targetNumber,
						latestResult: latestResultByKpi.get(primaryKpi.id) ?? null,
					}
				: null,
		};
	});
}

export async function listCampaigns(env: Env, projectId: string | null) {
	if (projectId !== null && !isProjectId(projectId)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "invalid project id",
		});
	}
	return listCampaignRows(env, projectId);
}

export async function getCampaign(env: Env, campaignId: string) {
	if (!isCampaignId(campaignId)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "invalid campaign id",
		});
	}
	const campaign = await getPrisma(env).campaign.findUnique({
		where: { id: campaignId },
		include: {
			brief: true,
			plans: {
				orderBy: { createdAt: "asc" },
				include: { phases: { orderBy: { position: "asc" } } },
			},
			events: {
				orderBy: { scheduledAt: "asc" },
				include: {
					// Linked channel for color-coded pills/swimlanes (KUK-890).
					linkedChannel: { select: { id: true, name: true, color: true } },
				},
			},
			// Channel mix ids for the brief multi-select (KUK-890).
			channelLinks: { select: { channelId: true } },
			// Per-campaign target audiences (structured segmentation rows).
			audiences: { orderBy: { createdAt: "asc" } },
			// Report summaries only — full bodies come from the report routes.
			reports: {
				orderBy: { createdAt: "desc" },
				select: {
					id: true,
					title: true,
					periodStart: true,
					periodEnd: true,
					createdAt: true,
				},
			},
			// Structured KPI targets with their recorded result history
			// (KUK-990: sparkline + deltas need more than the latest row).
			kpis: {
				orderBy: { sortOrder: "asc" },
				include: {
					results: {
						orderBy: { recordedAt: "desc" },
						take: 12,
						include: { report: { select: { id: true, title: true } } },
					},
				},
			},
		},
	});
	if (!campaign) {
		throw new TRPCError({ code: "NOT_FOUND", message: "not found" });
	}
	const { channelLinks, ...detail } = campaign;
	return {
		...detail,
		// Campaigns are always filed — restore the public contract's
		// non-null projectId (see listCampaignRows).
		projectId: detail.projectId as string,
		channelIds: channelLinks.map((link) => link.channelId),
		// Embedded KPI rows restore the same unions as the campaign-kpis
		// handlers (kind/status columns only ever hold validated values).
		kpis: detail.kpis.map((kpi) => ({
			...kpi,
			kind: kpi.kind as "number" | "boolean" | "qualitative",
			results: kpi.results.map((result) => ({
				...result,
				status: result.status as KpiStatus,
			})),
		})),
	};
}

export async function updateCampaign(input: {
	env: Env;
	campaignId: string;
	body: z.infer<typeof updateCampaignBody>;
}) {
	const { env, campaignId, body } = input;
	if (!isCampaignId(campaignId)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "invalid campaign id",
		});
	}
	const prisma = getPrisma(env);
	const campaign = await prisma.campaign.findUnique({
		where: { id: campaignId },
	});
	if (!campaign) {
		throw new TRPCError({ code: "NOT_FOUND", message: "not found" });
	}
	if (body.projectId !== undefined) {
		const container = await prisma.project.findUnique({
			where: { id: body.projectId },
		});
		if (!container) {
			throw new TRPCError({ code: "NOT_FOUND", message: "project not found" });
		}
	}
	const data: {
		name?: string;
		projectId?: string;
		targetEndDate?: Date | null;
	} = {};
	if (body.name !== undefined) data.name = body.name;
	if (body.projectId !== undefined) {
		data.projectId = body.projectId;
	}
	if (body.targetEndDate !== undefined) {
		data.targetEndDate =
			body.targetEndDate === null ? null : new Date(body.targetEndDate);
	}
	const updated = await prisma.campaign.update({
		where: { id: campaignId },
		data,
	});
	// Still filed (moves require an existing container) — restore the
	// public contract's non-null projectId (see listCampaignRows).
	return { ...updated, projectId: updated.projectId as string };
}

export async function deleteCampaign(
	env: Env,
	campaignId: string,
): Promise<void> {
	if (!isCampaignId(campaignId)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "invalid campaign id",
		});
	}
	const prisma = getPrisma(env);
	const campaign = await prisma.campaign.findUnique({
		where: { id: campaignId },
	});
	if (!campaign) {
		throw new TRPCError({ code: "NOT_FOUND", message: "not found" });
	}
	// Defensive spelled-out cascade (mirrors deleteDesign/deleteProject):
	// DB rows only — attached design assets stay filed in their project and
	// are detached here rather than trusting the FK behavior.
	await prisma.message.deleteMany({ where: { campaignId } });
	await prisma.calendarEvent.deleteMany({ where: { campaignId } });
	await prisma.campaignKpiResult.deleteMany({
		where: { kpi: { campaignId } },
	});
	await prisma.campaignKpi.deleteMany({ where: { campaignId } });
	await prisma.campaignReport.deleteMany({ where: { campaignId } });
	await prisma.campaignChannel.deleteMany({ where: { campaignId } });
	await prisma.planPhase.deleteMany({
		where: { plan: { campaignId } },
	});
	await prisma.campaignPlan.deleteMany({ where: { campaignId } });
	await prisma.campaignBrief.deleteMany({ where: { campaignId } });
	await prisma.design.updateMany({
		where: { campaignId },
		data: { campaignId: null },
	});
	await prisma.campaign.delete({ where: { id: campaignId } });
}

export async function createProjectCampaign(input: {
	env: Env;
	projectId: string;
	body: z.infer<typeof createProjectCampaignBody>;
}): Promise<{ campaignId: string }> {
	const { env, projectId, body } = input;
	if (!isProjectId(projectId)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "invalid project id",
		});
	}
	const prisma = getPrisma(env);
	const project = await prisma.project.findUnique({
		where: { id: projectId },
	});
	if (!project) {
		throw new TRPCError({ code: "NOT_FOUND", message: "not found" });
	}
	const campaignId = newCampaignId();
	await prisma.campaign.create({
		data: {
			id: campaignId,
			name: body.name,
			briefPrompt: body.briefPrompt ?? null,
			projectId,
		},
	});
	// Same response shape as createCampaign for shared client handling.
	return { campaignId };
}

export async function listProjectCampaigns(env: Env, projectId: string) {
	if (!isProjectId(projectId)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "invalid project id",
		});
	}
	const prisma = getPrisma(env);
	const project = await prisma.project.findUnique({
		where: { id: projectId },
	});
	if (!project) {
		throw new TRPCError({ code: "NOT_FOUND", message: "not found" });
	}
	return listCampaignRows(env, projectId);
}

/** GET /campaigns/:id/assets — this campaign's design assets, newest first. */
export async function listCampaignAssets(env: Env, campaignId: string) {
	if (!isCampaignId(campaignId)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "invalid campaign id",
		});
	}
	const prisma = getPrisma(env);
	const campaign = await prisma.campaign.findUnique({
		where: { id: campaignId },
		select: { id: true },
	});
	if (!campaign) {
		throw new TRPCError({ code: "NOT_FOUND", message: "not found" });
	}
	// Design rows only — publish state comes from liveTurnId, no R2 calls.
	const assets = await prisma.design.findMany({
		where: { campaignId },
		orderBy: { createdAt: "desc" },
		take: 100,
		select: {
			id: true,
			prompt: true,
			campaignId: true,
			projectId: true,
			status: true,
			createdAt: true,
			liveTurnId: true,
		},
	});
	return assets.map((asset) => ({
		id: asset.id,
		prompt: asset.prompt,
		campaignId: asset.campaignId,
		// Filed like every design — restore the public contract's non-null
		// projectId (see handlers/designs.ts listDesigns).
		projectId: asset.projectId as string,
		status: asset.status,
		createdAt: asset.createdAt,
		published: asset.liveTurnId != null,
	}));
}

/** POST /campaigns/:id/assets — manual create with an optional seed. */
export async function createCampaignAssetManual(input: {
	env: Env;
	campaignId: string;
	body: z.infer<typeof createAssetBody>;
}): Promise<{ assetId: string; studioUrl: string; prompt: string }> {
	const { env, campaignId, body } = input;
	if (!isCampaignId(campaignId)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "invalid campaign id",
		});
	}
	const prisma = getPrisma(env);
	const campaign = await prisma.campaign.findUnique({
		where: { id: campaignId },
		select: { id: true, projectId: true, name: true },
	});
	if (!campaign) {
		throw new TRPCError({ code: "NOT_FOUND", message: "not found" });
	}
	const seedLine =
		body.briefPrompt ?? (body.name ? `Campaign asset: ${body.name}.` : "");
	const asset = await createCampaignAsset(env, campaign, seedLine);
	return {
		assetId: asset.id,
		studioUrl: asset.studioUrl,
		prompt: asset.prompt,
	};
}

export type CampaignMessage = {
	id: string;
	role: string;
	content: string;
	/** Raw JSON array of the assistant turn's UI parts; null on user rows and pre-feature rows. */
	parts: string | null;
	createdAt: Date;
};

/**
 * GET /campaigns/:id/messages — the campaign's chat transcript.
 */
export async function listCampaignMessages(
	env: Env,
	campaignId: string,
): Promise<CampaignMessage[]> {
	if (!isCampaignId(campaignId)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "invalid campaign id",
		});
	}
	// Public transcript fields only. desc + reverse so the cap drops the
	// OLDEST rows, never recent turns (mirrors listMessages for designs).
	const messages = await getPrisma(env).message.findMany({
		where: { campaignId },
		orderBy: { createdAt: "desc" },
		take: 200,
	});
	return messages.reverse().map((message) => ({
		id: message.id,
		role: message.role,
		content: message.content,
		// Raw stored parts JSON; parsed client-side by parseStoredParts.
		parts: message.parts,
		createdAt: message.createdAt,
	}));
}

/**
 * Admin escape hatch for the stuck-chat bug: a hung agent turn used to
 * hold the campaign's turn lease until the lazy 45-minute reclaim, so the
 * chat 409'd on every send. This handler releases the lease immediately, no
 * matter which turn holds it or how old it is. The abandoned owner cannot
 * pollute history afterwards: its assistant INSERT and lease-clear are
 * both fenced on its own turnId (see persistAssistantMessage), which no
 * longer owns the lease.
 */
export async function releaseCampaignTurn(
	env: Env,
	campaignId: string,
): Promise<{ released: boolean }> {
	if (!isCampaignId(campaignId)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "invalid campaign id",
		});
	}
	const prisma = getPrisma(env);
	const campaign = await prisma.campaign.findUnique({
		where: { id: campaignId },
		select: { id: true },
	});
	if (!campaign) {
		throw new TRPCError({ code: "NOT_FOUND", message: "not found" });
	}
	const released = await prisma.campaign.updateMany({
		where: { id: campaignId, activeTurnId: { not: null } },
		data: {
			activeTurnId: null,
			turnClaimedAt: null,
			status: "failed",
			error: CAMPAIGN_CHAT_CANCELLED_ERROR,
		},
	});
	return { released: released.count === 1 };
}

/**
 * PATCH /campaigns/:id/events/:eventId — field edits + asset attach/detach.
 */
export async function updateCampaignEvent(input: {
	env: Env;
	campaignId: string;
	eventId: string;
	body: z.infer<typeof updateEventBody>;
}) {
	const { env, campaignId, eventId, body } = input;
	if (!isCampaignId(campaignId)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "invalid campaign id",
		});
	}
	const prisma = getPrisma(env);
	const event = await prisma.calendarEvent.findUnique({
		where: { id: eventId },
	});
	if (!event) {
		throw new TRPCError({ code: "NOT_FOUND", message: "not found" });
	}
	if (event.campaignId !== campaignId) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "event does not belong to this campaign",
		});
	}

	const data: {
		title?: string;
		channelId?: string | null;
		scheduledAt?: Date;
		status?: string;
		notes?: string;
		assetId?: string | null;
	} = {};
	const { assetId, scheduledAt, channelId, ...fields } = body;
	Object.assign(data, fields);
	if (scheduledAt !== undefined) {
		data.scheduledAt = new Date(scheduledAt);
	}
	if (channelId !== undefined) {
		// Explicit null clears the link; an unknown id rejects the whole
		// patch with the available names (nothing written).
		if (channelId === null) {
			data.channelId = null;
		} else {
			const channel = await prisma.channel.findUnique({
				where: { id: channelId },
				select: { id: true },
			});
			if (!channel) {
				const names = await prisma.channel.findMany({
					orderBy: { name: "asc" },
					select: { name: true },
				});
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `unknown channel id ${channelId}. Available channels: ${
						names.map((c) => c.name).join(", ") || "(none yet)"
					}`,
				});
			}
			data.channelId = channelId;
		}
	}
	if (assetId !== undefined) {
		if (assetId === null) {
			// Detach: clear the slot's asset link.
			data.assetId = null;
		} else {
			const design = await prisma.design.findUnique({
				where: { id: assetId },
				select: { id: true, campaignId: true },
			});
			if (!design) {
				throw new TRPCError({ code: "NOT_FOUND", message: "asset not found" });
			}
			// Fencing: a design of another campaign can never be attached —
			// only this campaign's assets or unattached designs may link.
			if (design.campaignId !== campaignId && design.campaignId !== null) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "asset does not belong to this campaign",
				});
			}
			data.assetId = assetId;
		}
	}
	const updated = await prisma.calendarEvent.update({
		where: { id: eventId },
		data,
		include: {
			linkedChannel: { select: { id: true, name: true, color: true } },
		},
	});
	return updated;
}
