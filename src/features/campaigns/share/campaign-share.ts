import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getPrisma } from "@/lib/db";

/**
 * Campaign share slugs. Deliberately upgraded over design sharing (which is
 * public-by-uuid and cannot be revoked): a slug is revocable and rotatable.
 *
 * - Null `shareSlug` = not shared.
 * - Rotation writes a fresh slug, invalidating every old link.
 * - Revoke clears the slug and stamps `shareRevokedAt` (dashboard record).
 * - `shareIncludeReports` gates reports/KPIs on the public page (default off).
 */

/** Base58 (Bitcoin alphabet — no 0/O/I/l), 22 chars ≈ 128.6 bits. */
const SLUG_ALPHABET =
	"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const SLUG_LENGTH = 22;
const SLUG_PATTERN = new RegExp(`^[${SLUG_ALPHABET}]{${SLUG_LENGTH}}$`);
/** Public URL path served by the share page route (KUK-876). */
const SHARE_PATH_PREFIX = "/share/campaign";
const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function isCampaignId(value: string): boolean {
	return UUID_PATTERN.test(value);
}

function newShareSlug(): string {
	// Rejection sampling keeps the alphabet uniform: any byte >= 248 is
	// discarded so every of the 58 letters is equally likely (the largest
	// full multiple of 58 below 256 is 232, hence the 248 cut-off).
	const bytes = new Uint8Array(SLUG_LENGTH * 4);
	let slug = "";
	while (slug.length < SLUG_LENGTH) {
		crypto.getRandomValues(bytes);
		for (const byte of bytes) {
			if (slug.length === SLUG_LENGTH) break;
			if (byte >= 248) continue;
			slug += SLUG_ALPHABET[byte % 58];
		}
	}
	return slug;
}

function isUniqueViolation(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		(error as { code?: unknown }).code === "P2002"
	);
}

function notFound(): TRPCError {
	return new TRPCError({ code: "NOT_FOUND", message: "not found" });
}

// Share update body — `rotate` regenerates the slug, `includeReports`
// toggles the public reports/KPIs gate; at least one is required.
export const updateCampaignShareBody = z
	.object({
		rotate: z.boolean().optional(),
		includeReports: z.boolean().optional(),
	})
	.refine(
		(body) => body.rotate !== undefined || body.includeReports !== undefined,
		"invalid body",
	);

type ShareFields = {
	shareSlug: string | null;
	shareRevokedAt: Date | null;
	shareIncludeReports: boolean;
};

export type CampaignSharePayload = {
	shared: boolean;
	shareSlug: string | null;
	shareUrl: string | null;
	shareIncludeReports: boolean;
	shareRevokedAt: Date | null;
};

function toSharePayload(campaign: ShareFields): CampaignSharePayload {
	return {
		shared: Boolean(campaign.shareSlug),
		shareSlug: campaign.shareSlug,
		shareUrl: campaign.shareSlug
			? `${SHARE_PATH_PREFIX}/${campaign.shareSlug}`
			: null,
		shareIncludeReports: campaign.shareIncludeReports,
		shareRevokedAt: campaign.shareRevokedAt,
	};
}

/**
 * Writes a freshly generated slug, retrying on the (astronomically unlikely)
 * unique collision. Clearing `shareRevokedAt` is deliberate: writing a slug
 * means the campaign is shared again, whatever happened before.
 */
async function writeNewSlug(
	env: Env,
	campaignId: string,
	extraData: { shareIncludeReports?: boolean } = {},
): Promise<ShareFields> {
	const prisma = getPrisma(env);
	for (let attempt = 0; attempt < 5; attempt++) {
		try {
			return await prisma.campaign.update({
				where: { id: campaignId },
				data: {
					shareSlug: newShareSlug(),
					shareRevokedAt: null,
					...extraData,
				},
			});
		} catch (error) {
			if (!isUniqueViolation(error) || attempt === 4) throw error;
		}
	}
	// Unreachable — the loop either returns or throws.
	throw new Error("share slug generation failed");
}

/** Generate the share slug if absent; idempotent. */
export async function generateCampaignShare(
	env: Env,
	campaignId: string,
): Promise<CampaignSharePayload> {
	if (!isCampaignId(campaignId)) throw notFound();
	const prisma = getPrisma(env);
	const campaign = await prisma.campaign.findUnique({
		where: { id: campaignId },
	});
	if (!campaign) throw notFound();
	if (campaign.shareSlug) {
		// Already shared: same slug, same link — no state change.
		return toSharePayload(campaign);
	}
	const shared = await writeNewSlug(env, campaignId);
	return toSharePayload(shared);
}

/** Rotate the slug and/or toggle reports. */
export async function updateCampaignShare(input: {
	env: Env;
	campaignId: string;
	body: z.infer<typeof updateCampaignShareBody>;
}): Promise<CampaignSharePayload> {
	const { env, campaignId, body } = input;
	if (!isCampaignId(campaignId)) throw notFound();
	const prisma = getPrisma(env);
	const campaign = await prisma.campaign.findUnique({
		where: { id: campaignId },
	});
	if (!campaign) throw notFound();
	if (body.rotate === true) {
		// Rotation regenerates the slug — old links 404. An explicit
		// includeReports applies to the fresh share in the same update.
		const rotated = await writeNewSlug(
			env,
			campaignId,
			body.includeReports === undefined
				? {}
				: { shareIncludeReports: body.includeReports },
		);
		return toSharePayload(rotated);
	}
	const updated = await prisma.campaign.update({
		where: { id: campaignId },
		data: { shareIncludeReports: body.includeReports as boolean },
	});
	return toSharePayload(updated);
}

/** Revoke: clear slug, stamp the revoke. */
export async function revokeCampaignShare(
	env: Env,
	campaignId: string,
): Promise<void> {
	if (!isCampaignId(campaignId)) throw notFound();
	const prisma = getPrisma(env);
	const campaign = await prisma.campaign.findUnique({
		where: { id: campaignId },
	});
	if (!campaign) throw notFound();
	await prisma.campaign.update({
		where: { id: campaignId },
		data: { shareSlug: null, shareRevokedAt: new Date() },
	});
}

/**
 * Slug resolution for the public share route (no auth — the caller decides
 * what a null means). Returns the campaign id only for a currently-shared,
 * non-revoked campaign; null otherwise (the page renders a 404).
 */
export async function resolveCampaignShareSlug(
	env: Env,
	slug: string,
): Promise<{ id: string } | null> {
	if (!SLUG_PATTERN.test(slug)) return null;
	const campaign = await getPrisma(env).campaign.findFirst({
		where: { shareSlug: slug, shareRevokedAt: null },
		select: { id: true },
	});
	return campaign ?? null;
}
