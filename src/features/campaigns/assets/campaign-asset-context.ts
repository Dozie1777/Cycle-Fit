import {
	type BrandKitLike,
	brandKitPromptSection,
} from "@/features/projects/brand-kit/brand-kit";
import { loadBrandKit } from "@/features/projects/brand-kit/brand-kit-load";
import { getPrisma } from "@/lib/db";

/**
 * Campaign asset seeding (KUK-871): campaign assets (decks, landing pages,
 * one-pagers) ARE Designs — they inherit the full studio stack (chat,
 * publish, R2 versions, previews, public serving). A seeded asset's brief
 * (Design.prompt) opens with the asset's seed line and is followed by a
 * DISTILLED campaign context block — brief fields + plan phase names and
 * objectives only, never raw transcripts, document bodies or calendar rows —
 * so the studio continues from the campaign without blowing the context
 * window. When the campaign's project has a brand kit (KUK-899), its tokens
 * and fonts are injected between the two: the kit is the structured source
 * of truth for the asset's visual identity (CampaignBrief.tone stays
 * freeform).
 *
 * Shared by the `create_asset` chat tool (lib/campaign-chat.ts) and the
 * manual POST /campaigns/:id/assets route so both paths seed identically.
 */

type PrismaDb = ReturnType<typeof getPrisma>;

/** The fields a seeded asset needs from its campaign. */
export type CampaignAssetSeed = {
	id: string;
	projectId: string;
	name: string;
};

/** Per-field excerpt cap (characters) inside the distilled context block. */
const FIELD_CAP = 320;
const PHASE_OBJECTIVE_CAP = 200;
/** Plan phases listed in the context, across all plans. */
const MAX_PHASES = 12;
/** Total prompt cap — comfortably under the 4000-char prompts the design
 * routes accept, so a seeded asset can never blow the studio's brief.
 */
const PROMPT_CAP = 3600;

/**
 * Presentation output contract (KUK-877), appended to the seeded prompt when
 * the asset is deck/presentation-flavored. Extends the design-studio's
 * self-contained-HTML output contract (lib/design-chat-prompt.ts) with the
 * deck-specific rules — slides, keyboard navigation, progress, reduced
 * motion — in the same voice. Lives in the SEEDED prompt rather than the
 * global design prompt so only presentation assets pay for it. With a brand
 * kit (KUK-899) the external-assets clause is amended: the kit's font
 * stylesheets are the only allowed external requests.
 */
function presentationContract(brandKitFonts: boolean): string {
	// The no-kit clause is kept byte-identical to the pre-kit contract.
	const assetsClause = brandKitFonts
		? "no module scripts, no external network requests except the\n  brand-kit font stylesheets (emitted from the Brand kit section)"
		: "no module scripts,\n  no external network requests";
	return `# Presentation contract

This asset is a presentation, so publish it as ONE self-contained HTML deck
that opens ready to present:

- Each slide fills the viewport exactly once: CSS scroll-snap on the slide
  container, or hash-routed slides (#/1, #/2…) driven by a tiny inline
  script. Never a long scrolling page.
- Keyboard navigation works hands-free: ←/→ and space move between slides,
  Home/End jump to the first/last one.
- Every slide carries a \`data-slide="<n>"\` attribute and a visible
  progress indicator (e.g. "3 / 12") so the presenter knows where they are.
- Declare the design tokens in one \`:root { … }\` block and reuse them.
- Animations are encouraged within the sandbox: entrance transitions,
  count-up numbers, progress bars — all inline CSS/JS, ${assetsClause}.
- Honor \`prefers-reduced-motion: reduce\`: entrance animations degrade to
  opacity-only (or none) and nothing auto-plays.`;
}

/** The no-kit contract — byte-identical to the pre-kit seeding. */
export const PRESENTATION_CONTRACT = presentationContract(false);

/** Detection: presentation-flavored seed lines get the deck contract. */
export function isPresentationFlavored(seedLine: string): boolean {
	return /deck|slides?|presentation|presenting|one-page|pitch/i.test(seedLine);
}

/** Trims and hard-caps a value; null for empty input. */
function excerpt(value: string | null | undefined, cap: number): string | null {
	if (value == null) return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	return trimmed.length <= cap ? trimmed : `${trimmed.slice(0, cap - 1)}…`;
}

function briefLine(label: string, value: string | null | undefined) {
	const clipped = excerpt(value, FIELD_CAP);
	return clipped ? `- ${label}: ${clipped}` : null;
}

/**
 * Builds the distilled campaign context block: structured brief fields plus
 * plan phase names/objectives. Deliberately excludes freeform prose
 * (CampaignBrief.body), calendar slots and reports — those are transcripts
 * the asset should not inherit wholesale.
 */
export async function buildCampaignAssetContext(
	prisma: PrismaDb,
	campaignId: string,
): Promise<string> {
	const [brief, plans, channelLinks, audienceRows] = await Promise.all([
		prisma.campaignBrief.findUnique({
			where: { campaignId },
		}),
		prisma.campaignPlan.findMany({
			where: { campaignId },
			orderBy: { createdAt: "asc" },
			select: {
				name: true,
				phases: {
					orderBy: { position: "asc" },
					select: { name: true, objective: true },
				},
			},
		}),
		// Channel mix (KUK-890): linked channel names — the legacy free-text
		// brief.channels is only a fallback for campaigns never migrated.
		prisma.campaignChannel.findMany({
			where: { campaignId },
			select: { channel: { select: { name: true } } },
		}),
		// Target audiences: structured segmentation rows — the deprecated
		// free-text brief.audience is only a fallback.
		prisma.targetAudience.findMany({
			where: { campaignId },
			orderBy: { createdAt: "asc" },
			select: { name: true, buyingStage: true },
		}),
	]);

	const channelMix = channelLinks.length
		? channelLinks.map((link) => link.channel.name).join(", ")
		: (brief?.channels ?? null);

	const audienceMix = audienceRows.length
		? audienceRows
				.map((audience) =>
					audience.buyingStage
						? `${audience.name} (${audience.buyingStage})`
						: audience.name,
				)
				.join(", ")
		: (brief?.audience ?? null);

	const briefLines = [
		briefLine("Objective", brief?.objective),
		briefLine("Audience", audienceMix),
		briefLine("Key message", brief?.keyMessage),
		briefLine("Tone", brief?.tone),
		briefLine("Channels", channelMix),
		briefLine("Budget", brief?.budget),
		briefLine("KPIs", brief?.kpis),
	].filter((entry): entry is string => entry !== null);

	const phaseLines: string[] = [];
	for (const plan of plans) {
		if (phaseLines.length >= MAX_PHASES) break;
		for (const phase of plan.phases) {
			if (phaseLines.length >= MAX_PHASES) break;
			const objective = excerpt(phase.objective, PHASE_OBJECTIVE_CAP);
			phaseLines.push(`- ${phase.name}${objective ? `: ${objective}` : ""}`);
		}
	}

	const sections = [
		briefLines.length > 0 ? `Brief:\n${briefLines.join("\n")}` : null,
		phaseLines.length > 0 ? `Plan phases:\n${phaseLines.join("\n")}` : null,
	].filter((entry): entry is string => entry !== null);
	return sections.join("\n\n");
}

/**
 * Composes the seeded Design.prompt: the asset's seed line, followed by the
 * presentation output contract when the seed is deck/presentation-flavored
 * (KUK-877), then the project's brand kit section when one exists (KUK-899
 * — the kit is the structured source of truth for the asset's identity),
 * then the distilled campaign context — hard-capped so the studio brief
 * stays small. The kit sits in the head so tail truncation drops campaign
 * context, never the kit or the contract.
 */
function composeAssetPrompt(
	seedLine: string,
	campaignName: string,
	context: string,
	brandKit: BrandKitLike | null,
): string {
	const kitSection = brandKit ? brandKitPromptSection(brandKit) : "";
	const contract = isPresentationFlavored(seedLine)
		? `\n\n${presentationContract(kitSection !== "")}`
		: "";
	const kitBlock = kitSection ? `\n\n${kitSection}` : "";
	const head = `${seedLine}${contract}${kitBlock}\n\n# Campaign context (distilled)\nCampaign: ${campaignName}`;
	const body = context ? `\n\n${context}` : "";
	const prompt = `${head}${body}`;
	if (prompt.length <= PROMPT_CAP) return prompt;
	return `${prompt.slice(0, PROMPT_CAP - 1)}…`;
}

/**
 * Creates the Design row for a campaign asset: filed in the campaign's
 * project (never unfiled) and linked to the campaign, prompt = seed line +
 * presentation contract (deck-flavored seeds) + the project's brand kit
 * section (KUK-899) + distilled campaign context. The row has NO upload
 * token by design — file uploads are unavailable for seeded assets (the
 * uploads route rejects designs without one); the studio chat builds
 * content instead.
 */
export async function createCampaignAsset(
	env: Env,
	campaign: CampaignAssetSeed,
	seedLine: string,
): Promise<{ id: string; prompt: string; studioUrl: string }> {
	const prisma = getPrisma(env);
	const [context, brandKit] = await Promise.all([
		buildCampaignAssetContext(prisma, campaign.id),
		loadBrandKit(prisma, campaign.projectId),
	]);
	const prompt = composeAssetPrompt(seedLine, campaign.name, context, brandKit);
	const id = crypto.randomUUID();
	await prisma.design.create({
		data: {
			id,
			prompt,
			projectId: campaign.projectId,
			campaignId: campaign.id,
		},
	});
	// Same studio path the admin UI navigates to for any design.
	return { id, prompt, studioUrl: `/studio/${id}` };
}
