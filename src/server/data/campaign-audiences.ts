import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getPrisma } from "@/lib/db";
import { isCampaignId } from "./campaigns";

// Per-campaign target audiences: structured segmentation rows (name,
// demographics, psychographics, buying stage, freeform body). A campaign can
// hold several. Fenced to the campaign exactly like KPIs — an unknown or
// cross-campaign id is a 400 with the fence message, never written.
//
// The rows replace the deprecated CampaignBrief.audience markdown as the
// source of truth for who the campaign targets (same evolution the channel
// mix went through in KUK-890).

export const createAudienceBody = z.object({
	name: z.string().trim().min(1).max(200),
	demographics: z.string().max(4_000).nullish(),
	psychographics: z.string().max(4_000).nullish(),
	buyingStage: z.string().max(120).nullish(),
	body: z.string().max(20_000).nullish(),
});

export const updateAudienceBody = createAudienceBody.partial();

type PrismaDb = ReturnType<typeof getPrisma>;

async function assertCampaignOr404(
	env: Env,
	campaignId: string,
): Promise<PrismaDb> {
	if (!isCampaignId(campaignId)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "invalid campaign id",
		});
	}
	const prisma = getPrisma(env);
	const row = await prisma.campaign.findUnique({
		where: { id: campaignId },
		select: { id: true },
	});
	if (!row) {
		throw new TRPCError({ code: "NOT_FOUND", message: "not found" });
	}
	return prisma;
}

/** Unknown or cross-campaign id — 400 with the fence message, never written. */
function fenceError(id: string): TRPCError {
	return new TRPCError({
		code: "BAD_REQUEST",
		message: `audience ${id} does not belong to this campaign`,
	});
}

async function fencedAudience(
	prisma: PrismaDb,
	campaignId: string,
	audienceId: string,
): Promise<{ id: string } | null> {
	const row = await prisma.targetAudience.findUnique({
		where: { id: audienceId },
		select: { id: true, campaignId: true },
	});
	return row && row.campaignId === campaignId ? row : null;
}

export async function listAudiences(env: Env, campaignId: string) {
	const prisma = await assertCampaignOr404(env, campaignId);
	return prisma.targetAudience.findMany({
		where: { campaignId },
		orderBy: { createdAt: "asc" },
	});
}

export async function createAudience(input: {
	env: Env;
	campaignId: string;
	body: z.infer<typeof createAudienceBody>;
}) {
	const { env, campaignId, body } = input;
	const prisma = await assertCampaignOr404(env, campaignId);
	const row = await prisma.targetAudience.create({
		data: {
			id: crypto.randomUUID(),
			campaignId,
			name: body.name,
			demographics: body.demographics ?? null,
			psychographics: body.psychographics ?? null,
			buyingStage: body.buyingStage ?? null,
			body: body.body ?? null,
		},
	});
	return row;
}

export async function updateAudience(input: {
	env: Env;
	campaignId: string;
	audienceId: string;
	body: z.infer<typeof updateAudienceBody>;
}) {
	const { env, campaignId, audienceId, body } = input;
	const prisma = await assertCampaignOr404(env, campaignId);
	const row = await fencedAudience(prisma, campaignId, audienceId);
	if (!row) throw fenceError(audienceId);
	const data: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(body)) {
		if (value !== undefined) data[key] = value;
	}
	const updated = await prisma.targetAudience.update({
		where: { id: audienceId },
		data,
	});
	return updated;
}

export async function deleteAudience(
	env: Env,
	campaignId: string,
	audienceId: string,
): Promise<void> {
	const prisma = await assertCampaignOr404(env, campaignId);
	const row = await fencedAudience(prisma, campaignId, audienceId);
	if (!row) throw fenceError(audienceId);
	await prisma.targetAudience.delete({ where: { id: audienceId } });
}
