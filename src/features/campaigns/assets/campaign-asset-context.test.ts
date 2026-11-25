import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createCampaignAsset,
	isPresentationFlavored,
	PRESENTATION_CONTRACT,
} from "./campaign-asset-context";

// Seeding is prisma-backed; a stub covers the four reads/writes the seed
// performs (brief + plans + brand kit read, design row written).
const mocks = vi.hoisted(() => ({
	getPrisma: vi.fn(),
}));

vi.mock("@/lib/db", () => mocks);

type PrismaStub = ReturnType<typeof makePrismaStub>;

/** A full brand kit for the project (KUK-899 injection tests). */
const brandKit = {
	id: "brandkit-p-1",
	projectId: "p-1",
	name: "Acme brand",
	palettes: [
		{
			id: "brandkit-p-1-light",
			kitId: "brandkit-p-1",
			mode: "light",
			colors: [
				{ role: "background", value: "#ffffff" },
				{ role: "foreground", value: "#111111" },
				{ role: "primary", value: "#2563eb" },
			],
		},
	],
	typography: [{ role: "heading", stack: "Georgia, serif" }],
	fonts: [
		{
			family: "Inter",
			source: "google",
			url: null,
			weights: "400;700",
			italic: false,
		},
	],
};

function makePrismaStub(
	overrides: {
		brief?: unknown;
		plans?: unknown[];
		channels?: unknown[];
		audiences?: unknown[];
		kit?: unknown;
	} = {},
) {
	return {
		campaignBrief: {
			findUnique: vi.fn(async () => overrides.brief ?? null),
		},
		campaignPlan: {
			findMany: vi.fn(async () => overrides.plans ?? []),
		},
		// Channel-mix read (KUK-890) — join rows with the channel name.
		campaignChannel: {
			findMany: vi.fn(async () => overrides.channels ?? []),
		},
		// Target-audience read — structured segmentation rows.
		targetAudience: {
			findMany: vi.fn(async () => overrides.audiences ?? []),
		},
		// Brand-kit read (KUK-899) — keyed by the campaign's project.
		brandKit: {
			findUnique: vi.fn(async () => overrides.kit ?? null),
		},
		design: {
			create: vi.fn(async () => ({})),
		},
	};
}

const env = {} as Env;
const campaign = { id: "c-1", projectId: "p-1", name: "Spring relaunch" };

let prisma: PrismaStub;

beforeEach(() => {
	prisma = makePrismaStub();
	mocks.getPrisma.mockReturnValue(prisma);
});

describe("isPresentationFlavored", () => {
	it("detects deck / slides / presentation / one-page / pitch seeds", () => {
		expect(isPresentationFlavored("launch deck for the teaser phase")).toBe(
			true,
		);
		expect(isPresentationFlavored("investor slides")).toBe(true);
		expect(isPresentationFlavored("product presentation")).toBe(true);
		expect(isPresentationFlavored("one-page campaign summary")).toBe(true);
		expect(isPresentationFlavored("Series A pitch")).toBe(true);
	});

	it("rejects non-presentation seeds", () => {
		expect(isPresentationFlavored("landing page for the waitlist")).toBe(false);
		expect(isPresentationFlavored("email announcement")).toBe(false);
		expect(isPresentationFlavored("")).toBe(false);
	});
});

describe("createCampaignAsset prompt seeding", () => {
	it("appends the presentation contract to deck-flavored seeds", async () => {
		const asset = await createCampaignAsset(
			env,
			campaign,
			"Create the campaign asset: launch deck for the teaser phase.",
		);
		expect(asset.prompt).toContain("Create the campaign asset: launch deck");
		expect(asset.prompt).toContain("# Presentation contract");
		// The contract carries the full deck output rules.
		expect(asset.prompt).toContain("scroll-snap");
		expect(asset.prompt).toContain("#/1");
		expect(asset.prompt).toContain("data-slide");
		expect(asset.prompt).toContain("prefers-reduced-motion");
		expect(asset.prompt).toContain(":root");
		// The campaign context still follows the contract.
		expect(asset.prompt).toContain("# Campaign context (distilled)");
		expect(asset.prompt).toContain("Campaign: Spring relaunch");
	});

	it("does NOT add the contract to non-presentation seeds", async () => {
		const asset = await createCampaignAsset(
			env,
			campaign,
			"Create the campaign asset: landing page for the waitlist.",
		);
		expect(asset.prompt).not.toContain("Presentation contract");
		expect(asset.prompt).not.toContain(PRESENTATION_CONTRACT);
		expect(asset.prompt).toContain("# Campaign context (distilled)");
	});

	it("keeps the contract even when the context saturates the prompt cap", async () => {
		// A campaign context long enough to push the composed prompt over
		// PROMPT_CAP (all brief fields + a dozen phases) — the contract sits
		// in the head, so tail truncation must not drop it.
		const blob = (ch: string) => `${ch}${ch}${ch} `.repeat(107);
		prisma = makePrismaStub({
			brief: {
				objective: blob("o"),
				audience: blob("a"),
				keyMessage: blob("k"),
				tone: blob("t"),
				channels: blob("c"),
				budget: blob("b"),
				kpis: blob("p"),
			},
			plans: [
				{
					name: "Plan",
					phases: Array.from({ length: 12 }, (_, i) => ({
						name: `Phase ${i + 1}`,
						objective: blob("x"),
					})),
				},
			],
		});
		mocks.getPrisma.mockReturnValue(prisma);
		const asset = await createCampaignAsset(
			env,
			campaign,
			"Create the campaign asset: launch deck.",
		);
		expect(asset.prompt.length).toBeLessThanOrEqual(3600);
		expect(asset.prompt.endsWith("…")).toBe(true);
		expect(asset.prompt).toContain("# Presentation contract");
	});
});

describe("createCampaignAsset brand kit inheritance (KUK-899)", () => {
	it("injects the project's brand kit between the contract and the campaign context", async () => {
		prisma = makePrismaStub({ kit: brandKit });
		mocks.getPrisma.mockReturnValue(prisma);
		const asset = await createCampaignAsset(
			env,
			campaign,
			"Create the campaign asset: launch deck for the teaser phase.",
		);
		// The kit is read from the campaign's project.
		expect(prisma.brandKit.findUnique).toHaveBeenCalledWith(
			expect.objectContaining({ where: { projectId: "p-1" } }),
		);
		// Tokens, typography and font loading markup are all in the prompt.
		expect(asset.prompt).toContain("## Brand kit: Acme brand");
		expect(asset.prompt).toContain("--background: #ffffff;");
		expect(asset.prompt).toContain("--primary: #2563eb;");
		expect(asset.prompt).toContain("--font-heading: Georgia, serif;");
		expect(asset.prompt).toContain("family=Inter:wght@400;700");
		expect(asset.prompt).toContain("never `@import`");
		// The amended external-assets language rides with the kit section.
		expect(asset.prompt).toContain("brand-kit font stylesheets");
		// The presentation contract's clause is amended for kit fonts.
		expect(asset.prompt).toContain("except the");
		expect(asset.prompt).toContain(
			"brand-kit font stylesheets (emitted from the Brand kit section)",
		);
		// Order: seed → contract → kit → campaign context.
		expect(asset.prompt.indexOf("## Brand kit")).toBeGreaterThan(
			asset.prompt.indexOf("# Presentation contract"),
		);
		expect(asset.prompt.indexOf("## Brand kit")).toBeLessThan(
			asset.prompt.indexOf("# Campaign context"),
		);
	});

	it("amends the external-assets clause even for non-presentation seeds", async () => {
		prisma = makePrismaStub({ kit: brandKit });
		mocks.getPrisma.mockReturnValue(prisma);
		const asset = await createCampaignAsset(
			env,
			campaign,
			"Create the campaign asset: landing page for the waitlist.",
		);
		expect(asset.prompt).not.toContain("Presentation contract");
		expect(asset.prompt).toContain("## Brand kit: Acme brand");
		expect(asset.prompt).toContain("brand-kit font stylesheets");
	});

	it("no-kit golden: the seeded prompt is unchanged", async () => {
		const asset = await createCampaignAsset(
			env,
			campaign,
			"Create the campaign asset: launch deck for the teaser phase.",
		);
		expect(prisma.brandKit.findUnique).toHaveBeenCalledTimes(1);
		expect(asset.prompt).not.toContain("Brand kit");
		expect(asset.prompt).toContain(PRESENTATION_CONTRACT);
		expect(asset.prompt).toContain("no external network requests");
		expect(asset.prompt).not.toContain("except the");
	});
});
