import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getPrisma } from "@/lib/db";
import { isCampaignId } from "./campaigns";
import {
	availableChannelNames,
	findChannel,
	replaceCampaignChannels,
	validateChannelIds,
} from "./channels";

// Manual document edits for the campaign studio (KUK-874). The agent writes
// the same rows through its document tools (lib/campaign-chat.ts, KUK-870);
// these handlers let the admin edit brief / plan phases / calendar events /
// reports by hand with identical row semantics: partial patches, position
// ordering maintained server-side, and every id fenced to THIS campaign —
// a cross-campaign or unknown id is rejected with 400, never written.
//
// One handler dispatches by `kind` (the tRPC `documents` router exposes
// thin semantic procedures over it); getDocument fetches a full report body
// (the detail payload carries summaries only).

/** A row id that must belong to this campaign (checked per handler). */
const fencedId = z.string().min(1).max(64);

// Brief fields mirror the save_brief/update_brief tool schemas (KUK-870):
// structured strings plus freeform markdown body. `null` clears a field;
// absent leaves it untouched. `channels` (legacy free text) is deprecated —
// accepted for API compat but no longer edited by the UI; the channel mix
// lives in `channelIds` (KUK-890), which atomically replaces the
// CampaignChannel join set (all ids must exist).
const briefFields = {
	objective: z.string().max(1_000).nullish(),
	audience: z.string().max(4_000).nullish(),
	keyMessage: z.string().max(4_000).nullish(),
	tone: z.string().max(1_000).nullish(),
	channels: z.string().max(1_000).nullish(),
	channelIds: z.array(z.string().min(1).max(64)).max(50).nullish(),
	budget: z.string().max(1_000).nullish(),
	kpis: z.string().max(4_000).nullish(),
	body: z.string().max(20_000).nullish(),
} as const;

/** Brief patch payload (no `kind`) — `null` clears, absent untouched. */
export const briefPatchBody = z.object(briefFields);

type BriefPatch = Partial<
	Omit<Record<keyof typeof briefFields, string | null>, "channelIds">
>;

/** Accepts ISO 8601 dates/datetimes, or null to clear — absent skips. */
const ISO_DATE_RE =
	/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;

const dateField = z
	.string()
	.max(64)
	.refine(
		(value) => ISO_DATE_RE.test(value) && !Number.isNaN(Date.parse(value)),
		"ISO 8601 date or datetime, e.g. 2026-03-02",
	);

const nullableDate = z.union([dateField, z.null()]).optional();

const EVENT_STATUS = ["planned", "draft", "scheduled", "published"] as const;
const PLAN_STATUS = ["draft", "final"] as const;

const eventStatus = z.enum(EVENT_STATUS);
const planStatus = z.enum(PLAN_STATUS);

export const patchPlanBody = z.object({
	planId: fencedId,
	name: z.string().trim().min(1).max(120).optional(),
	status: planStatus.optional(),
});

export const patchPhaseBody = z.object({
	phaseId: fencedId,
	name: z.string().trim().min(1).max(120).optional(),
	objective: z.string().max(2_000).nullish(),
	startsAt: nullableDate,
	endsAt: nullableDate,
	body: z.string().max(20_000).nullish(),
	position: z.number().int().min(0).max(10_000).optional(),
});

export const patchEventBody = z.object({
	eventId: fencedId,
	title: z.string().trim().min(1).max(200).optional(),
	// KUK-890: channels are linked by enumerated id (null clears). The
	// legacy free-text `channel` input is gone — the text column is
	// deprecated and no longer written by any surface.
	channelId: z.string().min(1).max(64).nullish(),
	scheduledAt: nullableDate,
	status: eventStatus.optional(),
	notes: z.string().max(2_000).nullish(),
});

export const patchReportBody = z.object({
	reportId: fencedId,
	title: z.string().trim().min(1).max(200).optional(),
	periodStart: nullableDate,
	periodEnd: nullableDate,
	summary: z.string().max(4_000).nullish(),
	metrics: z.string().max(8_000).nullish(),
	body: z.string().min(1).max(100_000).optional(),
});

const patchBody = z.discriminatedUnion("kind", [
	briefPatchBody.extend({ kind: z.literal("brief") }),
	patchPlanBody.extend({ kind: z.literal("plan") }),
	patchPhaseBody.extend({ kind: z.literal("phase") }),
	patchEventBody.extend({ kind: z.literal("event") }),
	patchReportBody.extend({ kind: z.literal("report") }),
]);

export const createPlanBody = z.object({
	name: z.string().trim().min(1).max(120),
	status: planStatus.optional(),
});

export const createPhaseBody = z.object({
	planId: fencedId,
	name: z.string().trim().min(1).max(120),
	objective: z.string().max(2_000).nullish(),
	startsAt: nullableDate,
	endsAt: nullableDate,
	body: z.string().max(20_000).nullish(),
});

export const createEventBody = z.object({
	title: z.string().trim().min(1).max(200),
	// KUK-890: channels are linked by enumerated id; the legacy
	// free-text `channel` input is gone (deprecated column, no writes).
	channelId: z.string().min(1).max(64).nullish(),
	scheduledAt: nullableDate,
	status: eventStatus.optional(),
	notes: z.string().max(2_000).nullish(),
});

export const createReportBody = z.object({
	title: z.string().trim().min(1).max(200),
	periodStart: nullableDate,
	periodEnd: nullableDate,
	summary: z.string().max(4_000).nullish(),
	metrics: z.string().max(8_000).nullish(),
	body: z.string().min(1).max(100_000),
});

const createBody = z.discriminatedUnion("kind", [
	createPlanBody.extend({ kind: z.literal("plan") }),
	createPhaseBody.extend({ kind: z.literal("phase") }),
	createEventBody.extend({ kind: z.literal("event") }),
	createReportBody.extend({ kind: z.literal("report") }),
]);

export const deleteDocumentBody = z.object({
	kind: z.enum(["plan", "phase", "event", "report"]),
	id: fencedId,
});

/** Prisma wants Date objects for DateTime columns; null clears. */
function dateValue(value: string | null | undefined): Date | null {
	return value != null ? new Date(value) : null;
}

/**
 * Writes only the keys the client actually sent. `null` becomes an explicit
 * Prisma null (clear), `undefined` is skipped entirely — the same
 * partial-patch contract the agent tools follow.
 */
function assignDates<T extends Record<string, unknown>>(
	data: T,
	key: string,
	value: string | null | undefined,
): void {
	if (value !== undefined) {
		(data as Record<string, unknown>)[key] = dateValue(value);
	}
}

type PrismaDb = ReturnType<typeof getPrisma>;

/**
 * Resolves a row owned by this campaign. Unknown ids and cross-campaign ids
 * both return null — the caller answers 400 with the fence message, matching
 * the document tools' `{ ok: false, error }` semantics.
 */
async function fencedRow(
	prisma: PrismaDb,
	campaignId: string,
	kind: "plan" | "event" | "report",
	id: string,
): Promise<{ id: string } | null> {
	if (kind === "plan") {
		const row = await prisma.campaignPlan.findUnique({
			where: { id },
			select: { id: true, campaignId: true },
		});
		return row && row.campaignId === campaignId ? row : null;
	}
	if (kind === "event") {
		const row = await prisma.calendarEvent.findUnique({
			where: { id },
			select: { id: true, campaignId: true },
		});
		return row && row.campaignId === campaignId ? row : null;
	}
	const row = await prisma.campaignReport.findUnique({
		where: { id },
		select: { id: true, campaignId: true },
	});
	return row && row.campaignId === campaignId ? row : null;
}

function fenceError(kind: string, id: string): TRPCError {
	return new TRPCError({
		code: "BAD_REQUEST",
		message: `${kind} ${id} does not belong to this campaign`,
	});
}

/** Renumbers a plan's phases 0..n-1 preserving the given order. */
async function renumberPhases(env: Env, orderedIds: string[]): Promise<void> {
	await env.DB.batch(
		orderedIds.map((id, index) =>
			env.DB.prepare('UPDATE "PlanPhase" SET position = ? WHERE id = ?').bind(
				index,
				id,
			),
		),
	);
}

/**
 * One full report row (body + metrics); the campaign detail payload carries
 * report summaries only, so the reports panel fetches the selected report
 * through here.
 */
export async function getDocument(input: {
	env: Env;
	campaignId: string;
	reportId: string;
}) {
	const { env, campaignId, reportId } = input;
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
	if (!reportId) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "reportId query parameter is required",
		});
	}
	const row = await prisma.campaignReport.findUnique({
		where: { id: reportId },
	});
	if (!row || row.campaignId !== campaignId) {
		throw fenceError("report", reportId);
	}
	return row;
}

/**
 * PATCH — partial updates: brief upsert (the row may not exist yet — first
 * save creates it), plan/phase/event/report patches fenced to the campaign.
 * A phase `position` change renumbers the plan's phases 0..n-1 around it.
 */
export async function patchDocument(input: {
	env: Env;
	campaignId: string;
	body: z.infer<typeof patchBody>;
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
		select: { id: true },
	});
	if (!campaign) {
		throw new TRPCError({ code: "NOT_FOUND", message: "not found" });
	}

	if (body.kind === "brief") {
		const { kind, channelIds, ...fields } = body;
		const patch: BriefPatch = {};
		for (const [key, value] of Object.entries(fields)) {
			if (value !== undefined) {
				patch[key as keyof BriefPatch] = value as string | null;
			}
		}
		if (channelIds === undefined && Object.keys(patch).length === 0) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "at least one brief field is required",
			});
		}
		if (channelIds != null) {
			// All ids must exist — one bad id rejects the whole request
			// before any write (same recoverable-error message as the tools).
			const invalid = await validateChannelIds(prisma, channelIds);
			if (invalid) {
				throw new TRPCError({ code: "BAD_REQUEST", message: invalid });
			}
		}
		const row = await prisma.campaignBrief.upsert({
			where: { campaignId },
			create: { id: crypto.randomUUID(), campaignId, ...patch },
			update: patch,
		});
		if (channelIds != null) {
			// Atomic replace after the scalar upsert (one batched delete +
			// reinsert); an explicit empty array clears the mix.
			await replaceCampaignChannels(env, campaignId, channelIds);
		}
		return row;
	}

	if (body.kind === "plan") {
		if (body.name === undefined && body.status === undefined) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "name or status is required",
			});
		}
		const row = await fencedRow(prisma, campaignId, "plan", body.planId);
		if (!row) throw fenceError("plan", body.planId);
		const data: { name?: string; status?: string } = {};
		if (body.name !== undefined) data.name = body.name;
		if (body.status !== undefined) data.status = body.status;
		const updated = await prisma.campaignPlan.update({
			where: { id: body.planId },
			data,
		});
		return updated;
	}

	if (body.kind === "phase") {
		const phase = await prisma.planPhase.findUnique({
			where: { id: body.phaseId },
			select: {
				id: true,
				planId: true,
				plan: { select: { campaignId: true } },
			},
		});
		if (!phase || phase.plan.campaignId !== campaignId) {
			throw fenceError("phase", body.phaseId);
		}
		const { kind, phaseId, position, startsAt, endsAt, ...fields } = body;
		const data: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(fields)) {
			if (value !== undefined) data[key] = value;
		}
		assignDates(data, "startsAt", startsAt);
		assignDates(data, "endsAt", endsAt);
		// A position-only move carries no field patch — updating with an
		// empty `data` object throws a Prisma validation error, so read the
		// row instead and let the renumber below do the work.
		const updated =
			Object.keys(data).length > 0
				? await prisma.planPhase.update({ where: { id: phaseId }, data })
				: await prisma.planPhase.findUniqueOrThrow({ where: { id: phaseId } });
		if (position !== undefined && position !== updated.position) {
			const siblings = await prisma.planPhase.findMany({
				where: { planId: phase.planId },
				orderBy: { position: "asc" },
				select: { id: true },
			});
			const others = siblings
				.map((row) => row.id)
				.filter((id) => id !== phaseId);
			const target = Math.min(Math.max(0, position), others.length);
			await renumberPhases(env, [
				...others.slice(0, target),
				phaseId,
				...others.slice(target),
			]);
			return await prisma.planPhase.findUnique({ where: { id: phaseId } });
		}
		return updated;
	}

	if (body.kind === "event") {
		const row = await fencedRow(prisma, campaignId, "event", body.eventId);
		if (!row) throw fenceError("event", body.eventId);
		const { kind, eventId, scheduledAt, channelId, ...fields } = body;
		const data: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(fields)) {
			if (value !== undefined) data[key] = value;
		}
		assignDates(data, "scheduledAt", scheduledAt);
		if (channelId !== undefined) {
			// Explicit null clears the link; an unknown id rejects the whole
			// patch with the available names (nothing written).
			if (channelId === null) {
				data.channelId = null;
			} else {
				const channel = await findChannel(prisma, channelId);
				if (!channel) {
					const names = await availableChannelNames(prisma);
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: `unknown channel id ${channelId}. Available channels: ${
							names.join(", ") || "(none yet)"
						}`,
					});
				}
				data.channelId = channel.id;
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

	const row = await fencedRow(prisma, campaignId, "report", body.reportId);
	if (!row) throw fenceError("report", body.reportId);
	const { kind, reportId, periodStart, periodEnd, ...fields } = body;
	const data: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(fields)) {
		if (value !== undefined) data[key] = value;
	}
	assignDates(data, "periodStart", periodStart);
	assignDates(data, "periodEnd", periodEnd);
	const updated = await prisma.campaignReport.update({
		where: { id: reportId },
		data,
	});
	return updated;
}

/**
 * POST — creates: plan, phase (appended after the plan's existing phases,
 * position computed atomically like add_phase), calendar event, report.
 */
export async function postDocument(input: {
	env: Env;
	campaignId: string;
	body: z.infer<typeof createBody>;
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
		select: { id: true },
	});
	if (!campaign) {
		throw new TRPCError({ code: "NOT_FOUND", message: "not found" });
	}

	if (body.kind === "plan") {
		const row = await prisma.campaignPlan.create({
			data: {
				id: crypto.randomUUID(),
				campaignId,
				name: body.name,
				...(body.status != null ? { status: body.status } : {}),
			},
		});
		return row;
	}

	if (body.kind === "phase") {
		const plan = await fencedRow(prisma, campaignId, "plan", body.planId);
		if (!plan) throw fenceError("plan", body.planId);
		const id = crypto.randomUUID();
		// One atomic statement, mirroring add_phase: the EXISTS clause fences
		// the insert to this campaign's plan and position = MAX + 1 is
		// computed in the same statement, so concurrent appends cannot collide.
		const inserted = await env.DB.prepare(
			`INSERT INTO "PlanPhase" (id, planId, name, objective, startsAt, endsAt, position, body)
			SELECT ?, ?, ?, ?, ?, ?, COALESCE((SELECT MAX(position) + 1 FROM "PlanPhase" WHERE "planId" = ?), 0), ?
			WHERE EXISTS (SELECT 1 FROM "CampaignPlan" WHERE id = ? AND "campaignId" = ?)`,
		)
			.bind(
				id,
				body.planId,
				body.name,
				body.objective ?? null,
				body.startsAt != null ? dateValue(body.startsAt)?.toISOString() : null,
				body.endsAt != null ? dateValue(body.endsAt)?.toISOString() : null,
				body.planId,
				body.body ?? null,
				body.planId,
				campaignId,
			)
			.run();
		if (inserted.meta.changes !== 1) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "could not add the phase to this plan",
			});
		}
		return await prisma.planPhase.findUnique({ where: { id } });
	}

	if (body.kind === "event") {
		let channelId: string | null = null;
		if (body.channelId != null) {
			const channel = await findChannel(prisma, body.channelId);
			if (!channel) {
				const names = await availableChannelNames(prisma);
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `unknown channel id ${body.channelId}. Available channels: ${
						names.join(", ") || "(none yet)"
					}`,
				});
			}
			channelId = channel.id;
		}
		const row = await prisma.calendarEvent.create({
			data: {
				id: crypto.randomUUID(),
				campaignId,
				title: body.title,
				channelId,
				scheduledAt: dateValue(body.scheduledAt),
				status: body.status ?? "planned",
				notes: body.notes ?? null,
			},
			include: {
				linkedChannel: { select: { id: true, name: true, color: true } },
			},
		});
		return row;
	}

	const row = await prisma.campaignReport.create({
		data: {
			id: crypto.randomUUID(),
			campaignId,
			title: body.title,
			periodStart: dateValue(body.periodStart),
			periodEnd: dateValue(body.periodEnd),
			summary: body.summary ?? null,
			metrics: body.metrics ?? null,
			body: body.body,
		},
	});
	return row;
}

/** DELETE — removes one fenced plan / phase / event / report row. */
export async function deleteDocument(input: {
	env: Env;
	campaignId: string;
	body: z.infer<typeof deleteDocumentBody>;
}): Promise<void> {
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
		select: { id: true },
	});
	if (!campaign) {
		throw new TRPCError({ code: "NOT_FOUND", message: "not found" });
	}
	const { kind, id } = body;

	if (kind === "plan") {
		const row = await fencedRow(prisma, campaignId, "plan", id);
		if (!row) throw fenceError("plan", id);
		// Phases go first (the FK would cascade, but deletion is spelled out
		// like deleteCampaign so it never depends on the DB behavior).
		await prisma.planPhase.deleteMany({ where: { planId: id } });
		await prisma.campaignPlan.delete({ where: { id } });
		return;
	}
	if (kind === "phase") {
		const phase = await prisma.planPhase.findUnique({
			where: { id },
			select: { id: true, plan: { select: { campaignId: true } } },
		});
		if (!phase || phase.plan.campaignId !== campaignId) {
			throw fenceError("phase", id);
		}
		await prisma.planPhase.delete({ where: { id } });
		return;
	}
	if (kind === "event") {
		const row = await fencedRow(prisma, campaignId, "event", id);
		if (!row) throw fenceError("event", id);
		await prisma.calendarEvent.delete({ where: { id } });
		return;
	}
	const row = await fencedRow(prisma, campaignId, "report", id);
	if (!row) throw fenceError("report", id);
	await prisma.campaignReport.delete({ where: { id } });
}
