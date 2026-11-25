import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
	deriveKpiStatus,
	type KpiStatus,
} from "@/features/campaigns/kpis/kpi-status";
import { getPrisma } from "@/lib/db";
import { isCampaignId } from "./campaigns";

const KPI_KINDS = ["number", "boolean", "qualitative"] as const;
const RESULT_STATUSES = [
	"pending",
	"not_met",
	"partial",
	"met",
	"exceeded",
] as const;

const kpiKind = z.enum(KPI_KINDS);
const resultStatus = z.enum(RESULT_STATUSES);

type KpiKindWire = z.infer<typeof kpiKind>;
type ResultStatusWire = z.infer<typeof resultStatus>;

/** Reads restore the public contract's unions: the columns only ever hold
 * the validated enum values (every write goes through the zod bodies). */
function wireKpiStatus<T extends { status: string }>(row: T) {
	return { ...row, status: row.status as ResultStatusWire };
}

function wireKpiKind<T extends { kind: string }>(row: T) {
	return { ...row, kind: row.kind as KpiKindWire };
}

// Input schemas — routers use these via `.input(...)` so every mutation is
// zod-validated at the tRPC boundary before the handler runs.
export const createKpiBody = z.object({
	name: z.string().trim().min(1).max(200),
	kind: kpiKind,
	targetNumber: z.number().finite().nullish(),
	targetBoolean: z.boolean().nullish(),
	targetText: z.string().max(2_000).nullish(),
	unit: z.string().max(50).nullish(),
	color: z.string().max(7).nullish(),
	sortOrder: z.number().int().min(0).max(10_000).default(0),
});

export const updateKpiBody = createKpiBody.partial();

const isoDateOrDatetime = z
	.string()
	.refine(
		(value) =>
			/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(
				value,
			) && !Number.isNaN(Date.parse(value)),
		"ISO 8601 date or datetime",
	);

export const createResultBody = z.object({
	kpiId: z.string().min(1).max(64),
	actualNumber: z.number().finite().nullish(),
	actualBoolean: z.boolean().nullish(),
	actualText: z.string().max(2_000).nullish(),
	status: resultStatus.optional(),
	reportId: z.string().min(1).max(64).nullish(),
	recordedAt: isoDateOrDatetime.optional(),
});

export const updateResultBody = createResultBody
	.omit({ kpiId: true })
	.partial();

function dateValue(value: string | null | undefined): Date | null {
	return value != null ? new Date(value) : null;
}

async function assertCampaignExists(
	prisma: ReturnType<typeof getPrisma>,
	campaignId: string,
): Promise<boolean> {
	const row = await prisma.campaign.findUnique({
		where: { id: campaignId },
		select: { id: true },
	});
	return row != null;
}

async function fencedKpi(
	prisma: ReturnType<typeof getPrisma>,
	campaignId: string,
	kpiId: string,
): Promise<{ id: string } | null> {
	const row = await prisma.campaignKpi.findUnique({
		where: { id: kpiId },
		select: { id: true, campaignId: true },
	});
	return row && row.campaignId === campaignId ? row : null;
}

async function fencedResult(
	prisma: ReturnType<typeof getPrisma>,
	campaignId: string,
	resultId: string,
): Promise<{ id: string } | null> {
	const row = await prisma.campaignKpiResult.findUnique({
		where: { id: resultId },
		select: { id: true, kpi: { select: { campaignId: true } } },
	});
	return row && row.kpi.campaignId === campaignId ? row : null;
}

/** Unknown or cross-campaign id — 400 with the fence message, never written. */
function fenceError(kind: string, id: string): TRPCError {
	return new TRPCError({
		code: "BAD_REQUEST",
		message: `${kind} ${id} does not belong to this campaign`,
	});
}

function normalizeStatus(
	kind: string,
	targetNumber: number | null,
	actualNumber: number | null,
	providedStatus: KpiStatus | undefined,
): KpiStatus {
	if (providedStatus) return providedStatus;
	if (kind === "number" && targetNumber != null && actualNumber != null) {
		return deriveKpiStatus({ target: targetNumber, actual: actualNumber });
	}
	return "pending";
}

async function assertCampaignOr404(env: Env, campaignId: string) {
	if (!isCampaignId(campaignId)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "invalid campaign id",
		});
	}
	const prisma = getPrisma(env);
	if (!(await assertCampaignExists(prisma, campaignId))) {
		throw new TRPCError({ code: "NOT_FOUND", message: "not found" });
	}
	return prisma;
}

export async function listKpis(env: Env, campaignId: string) {
	const prisma = await assertCampaignOr404(env, campaignId);
	const rows = await prisma.campaignKpi.findMany({
		where: { campaignId },
		orderBy: { sortOrder: "asc" },
		include: {
			results: {
				orderBy: { recordedAt: "desc" },
				take: 1,
				include: { report: { select: { id: true, title: true } } },
			},
		},
	});
	return rows.map((row) => ({
		...row,
		kind: row.kind as KpiKindWire,
		results: row.results.map(wireKpiStatus),
	}));
}

export async function createKpi(input: {
	env: Env;
	campaignId: string;
	body: z.infer<typeof createKpiBody>;
}) {
	const { env, campaignId, body } = input;
	const prisma = await assertCampaignOr404(env, campaignId);
	const row = await prisma.campaignKpi.create({
		data: {
			id: crypto.randomUUID(),
			campaignId,
			name: body.name,
			kind: body.kind,
			targetNumber: body.targetNumber ?? null,
			targetBoolean: body.targetBoolean ?? null,
			targetText: body.targetText ?? null,
			unit: body.unit ?? null,
			color: body.color ?? null,
			sortOrder: body.sortOrder,
		},
	});
	return wireKpiKind(row);
}

export async function updateKpi(input: {
	env: Env;
	campaignId: string;
	kpiId: string;
	body: z.infer<typeof updateKpiBody>;
}) {
	const { env, campaignId, kpiId, body } = input;
	const prisma = await assertCampaignOr404(env, campaignId);
	const row = await fencedKpi(prisma, campaignId, kpiId);
	if (!row) throw fenceError("kpi", kpiId);
	const data: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(body)) {
		if (value !== undefined) data[key] = value;
	}
	const updated = await prisma.campaignKpi.update({
		where: { id: kpiId },
		data,
	});
	return wireKpiKind(updated);
}

export async function deleteKpi(
	env: Env,
	campaignId: string,
	kpiId: string,
): Promise<void> {
	const prisma = await assertCampaignOr404(env, campaignId);
	const row = await fencedKpi(prisma, campaignId, kpiId);
	if (!row) throw fenceError("kpi", kpiId);
	await prisma.campaignKpi.delete({ where: { id: kpiId } });
}

export async function listResults(env: Env, campaignId: string) {
	const prisma = await assertCampaignOr404(env, campaignId);
	const rows = await prisma.campaignKpiResult.findMany({
		where: { kpi: { campaignId } },
		orderBy: { recordedAt: "desc" },
		include: {
			kpi: { select: { id: true, name: true, kind: true, unit: true } },
			report: { select: { id: true, title: true } },
		},
	});
	return rows.map((row) => ({
		...row,
		status: row.status as ResultStatusWire,
		kpi: wireKpiKind(row.kpi),
	}));
}

export async function createResult(input: {
	env: Env;
	campaignId: string;
	body: z.infer<typeof createResultBody>;
}) {
	const { env, campaignId, body } = input;
	const prisma = await assertCampaignOr404(env, campaignId);
	const kpi = await prisma.campaignKpi.findUnique({
		where: { id: body.kpiId },
		select: {
			id: true,
			campaignId: true,
			kind: true,
			targetNumber: true,
		},
	});
	if (!kpi || kpi.campaignId !== campaignId) {
		throw fenceError("kpi", body.kpiId);
	}
	if (body.reportId != null) {
		const report = await prisma.campaignReport.findUnique({
			where: { id: body.reportId },
			select: { campaignId: true },
		});
		if (!report || report.campaignId !== campaignId) {
			throw fenceError("report", body.reportId);
		}
	}
	const status = normalizeStatus(
		kpi.kind,
		kpi.targetNumber,
		body.actualNumber ?? null,
		body.status as KpiStatus | undefined,
	);
	const row = await prisma.campaignKpiResult.create({
		data: {
			id: crypto.randomUUID(),
			kpiId: body.kpiId,
			actualNumber: body.actualNumber ?? null,
			actualBoolean: body.actualBoolean ?? null,
			actualText: body.actualText ?? null,
			status,
			reportId: body.reportId ?? null,
			recordedAt: dateValue(body.recordedAt) ?? new Date(),
		},
		include: {
			kpi: { select: { id: true, name: true, kind: true, unit: true } },
			report: { select: { id: true, title: true } },
		},
	});
	return {
		...row,
		status: row.status as ResultStatusWire,
		kpi: wireKpiKind(row.kpi),
	};
}

export async function updateResult(input: {
	env: Env;
	campaignId: string;
	resultId: string;
	body: z.infer<typeof updateResultBody>;
}) {
	const { env, campaignId, resultId, body } = input;
	const prisma = await assertCampaignOr404(env, campaignId);
	const row = await fencedResult(prisma, campaignId, resultId);
	if (!row) throw fenceError("result", resultId);
	const existing = await prisma.campaignKpiResult.findUnique({
		where: { id: resultId },
		include: { kpi: true },
	});
	if (!existing) throw fenceError("result", resultId);
	const data: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(body)) {
		if (value !== undefined) data[key] = value;
	}
	if (body.reportId !== undefined) {
		if (body.reportId === null) {
			data.reportId = null;
		} else {
			const report = await prisma.campaignReport.findUnique({
				where: { id: body.reportId },
				select: { campaignId: true },
			});
			if (!report || report.campaignId !== campaignId) {
				throw fenceError("report", body.reportId);
			}
		}
	}
	if (body.recordedAt !== undefined) {
		data.recordedAt = dateValue(body.recordedAt);
	}
	const actualNumber =
		body.actualNumber !== undefined ? body.actualNumber : existing.actualNumber;
	const statusOverride = body.status as KpiStatus | undefined;
	if (body.actualNumber !== undefined || statusOverride !== undefined) {
		data.status = normalizeStatus(
			existing.kpi.kind,
			existing.kpi.targetNumber,
			actualNumber ?? null,
			statusOverride,
		);
	}
	const updated = await prisma.campaignKpiResult.update({
		where: { id: resultId },
		data,
		include: {
			kpi: { select: { id: true, name: true, kind: true, unit: true } },
			report: { select: { id: true, title: true } },
		},
	});
	return {
		...updated,
		status: updated.status as ResultStatusWire,
		kpi: wireKpiKind(updated.kpi),
	};
}

export async function deleteResult(
	env: Env,
	campaignId: string,
	resultId: string,
): Promise<void> {
	const prisma = await assertCampaignOr404(env, campaignId);
	const row = await fencedResult(prisma, campaignId, resultId);
	if (!row) throw fenceError("result", resultId);
	await prisma.campaignKpiResult.delete({ where: { id: resultId } });
}
