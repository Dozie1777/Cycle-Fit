import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	brandKitToTokenRows,
	DARK_ROLE_PREFIX,
	designTokenRowsToDesignTokens,
	getProjectTokens,
	syncDesignTokensFromBrandKit,
} from "./design-tokens";

// The sync/loader are prisma-backed; a stub covers the reads/writes they
// perform (brand kit read, system upsert, token upserts + stale sweep).
// The client type is derived from the functions' parameters — the db import
// in design-tokens.ts is type-only, so no runtime mock is needed.
type PrismaDb = Parameters<typeof syncDesignTokensFromBrandKit>[0];

function kit(overrides?: {
	palettes?: { mode: string; colors: { role: string; value: string }[] }[];
	typography?: { role: string; stack: string }[];
	fonts?: {
		family: string;
		source: string;
		url?: string | null;
		weights?: string | null;
		italic?: boolean | null;
	}[];
}) {
	return {
		name: "Acme brand",
		palettes: [
			{
				mode: "light",
				colors: [
					{ role: "background", value: "#ffffff" },
					{ role: "primary", value: "#2563eb" },
				],
			},
			{
				mode: "dark",
				colors: [{ role: "background", value: "#0a0a0a" }],
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
		...overrides,
	};
}

describe("brandKitToTokenRows", () => {
	it("maps the full kit with the migration-0021 mapping", () => {
		expect(brandKitToTokenRows(kit())).toEqual([
			{ category: "color", role: "background", value: "#ffffff" },
			{ category: "color", role: "primary", value: "#2563eb" },
			{ category: "color", role: "dark-background", value: "#0a0a0a" },
			{ category: "typography", role: "heading", value: "Georgia, serif" },
			{
				category: "font",
				role: "Inter",
				value: JSON.stringify({
					source: "google",
					url: null,
					weights: "400;700",
					italic: false,
				}),
			},
		]);
	});

	it("handles a kit with only palettes, and null font fields", () => {
		const rows = brandKitToTokenRows(
			kit({
				palettes: [
					{ mode: "light", colors: [{ role: "muted", value: "#f1f5f9" }] },
				],
				typography: [],
				fonts: [
					{
						family: "System Stack",
						source: "system",
						url: undefined,
						weights: undefined,
						italic: null,
					},
				],
			}),
		);
		expect(rows).toEqual([
			{ category: "color", role: "muted", value: "#f1f5f9" },
			{
				category: "font",
				role: "System Stack",
				value: JSON.stringify({
					source: "system",
					url: null,
					weights: null,
					italic: false,
				}),
			},
		]);
	});

	it("collapses duplicate font families to the first row", () => {
		const rows = brandKitToTokenRows(
			kit({
				palettes: [],
				typography: [],
				fonts: [
					{ family: "Inter", source: "google", weights: "400" },
					{ family: "Inter", source: "url", url: "https://example.com/x.css" },
				],
			}),
		);
		expect(rows).toHaveLength(1);
		expect(rows[0].value).toContain('"google"');
	});

	it("prefixes every dark-palette color with the dark- role prefix", () => {
		const rows = brandKitToTokenRows(
			kit({
				palettes: [
					{
						mode: "dark",
						colors: [
							{ role: "background", value: "#0a0a0a" },
							{ role: "primary", value: "#1d4ed8" },
						],
					},
				],
				typography: [],
				fonts: [],
			}),
		);
		expect(rows.map((row) => row.role)).toEqual([
			`${DARK_ROLE_PREFIX}background`,
			`${DARK_ROLE_PREFIX}primary`,
		]);
	});
});

describe("designTokenRowsToDesignTokens", () => {
	it("derives the tokens.json shape from token rows", () => {
		const rows = [
			{
				id: "1",
				systemId: "ds",
				category: "color",
				role: "background",
				value: "#ffffff",
			},
			{
				id: "2",
				systemId: "ds",
				category: "color",
				role: "dark-background",
				value: "#0a0a0a",
			},
			{
				id: "3",
				systemId: "ds",
				category: "typography",
				role: "heading",
				value: "Georgia, serif",
			},
			{ id: "4", systemId: "ds", category: "font", role: "Inter", value: "{}" },
		];
		expect(designTokenRowsToDesignTokens(rows)).toEqual({
			colors: [
				{ name: "--background", value: "#ffffff" },
				{ name: "--dark-background", value: "#0a0a0a" },
			],
			other: [
				// Typography maps to the --font-<role> vocabulary (matches the
				// HTML-derived path and the adoption mapping); font tokens are
				// loading metadata, excluded from tokens.json entirely.
				{ name: "--font-heading", value: "Georgia, serif" },
			],
		});
	});

	it("returns empty buckets for no rows", () => {
		expect(designTokenRowsToDesignTokens([])).toEqual({
			colors: [],
			other: [],
		});
	});
});

function makePrismaStub(overrides: { kit?: unknown; system?: unknown } = {}) {
	return {
		brandKit: {
			findUnique: vi.fn(async (_args: unknown) => overrides.kit ?? null),
		},
		designSystem: {
			findUnique: vi.fn(async (_args: unknown) => overrides.system ?? null),
			upsert: vi.fn(async (_args: unknown) => ({
				id: "ds-1",
				projectId: "p-1",
			})),
		},
		designToken: {
			upsert: vi.fn(async (_args: unknown) => ({})),
			findMany: vi.fn(
				async (
					_args: unknown,
				): Promise<{ category: string; role: string }[]> => [],
			),
			deleteMany: vi.fn(async (_args: unknown) => ({ count: 0 })),
		},
	};
}

describe("syncDesignTokensFromBrandKit", () => {
	let prisma: ReturnType<typeof makePrismaStub>;

	beforeEach(() => {
		prisma = makePrismaStub({ kit: kit() });
	});

	it("upserts every kit-derived token on the [systemId, category, role] unique", async () => {
		prisma.designToken.findMany.mockResolvedValue([
			{ category: "color", role: "primary" },
		]);
		await syncDesignTokensFromBrandKit(prisma as unknown as PrismaDb, "p-1");
		expect(prisma.brandKit.findUnique).toHaveBeenCalledWith(
			expect.objectContaining({ where: { projectId: "p-1" } }),
		);
		expect(prisma.designSystem.upsert).toHaveBeenCalledWith({
			where: { projectId: "p-1" },
			create: { projectId: "p-1" },
			update: {},
		});
		const upserts = prisma.designToken.upsert.mock.calls.map(
			(call) =>
				(
					call[0] as unknown as {
						where: {
							systemId_category_role: { category: string; role: string };
						};
					}
				).where.systemId_category_role,
		);
		expect(upserts).toEqual([
			{ systemId: "ds-1", category: "color", role: "background" },
			{ systemId: "ds-1", category: "color", role: "primary" },
			{ systemId: "ds-1", category: "color", role: "dark-background" },
			{ systemId: "ds-1", category: "typography", role: "heading" },
			{ systemId: "ds-1", category: "font", role: "Inter" },
		]);
		// The color row the current kit still defines is not stale.
		expect(prisma.designToken.deleteMany).not.toHaveBeenCalled();
	});

	it("deletes stale kit-owned rows but keeps agent-authored categories", async () => {
		prisma.designToken.findMany.mockResolvedValue([
			{ category: "color", role: "accent" }, // kit no longer defines it
			{ category: "spacing", role: "md" }, // agent-authored — never touched
		]);
		await syncDesignTokensFromBrandKit(prisma as unknown as PrismaDb, "p-1");
		expect(prisma.designToken.deleteMany).toHaveBeenCalledWith({
			where: {
				systemId: "ds-1",
				OR: [{ category: "color", role: "accent" }],
			},
		});
	});

	it("clears kit-mirrored rows when the kit is gone, keeping the system row", async () => {
		prisma = makePrismaStub({ kit: null, system: { id: "ds-1" } });
		await syncDesignTokensFromBrandKit(prisma as unknown as PrismaDb, "p-1");
		expect(prisma.designSystem.upsert).not.toHaveBeenCalled();
		expect(prisma.designToken.deleteMany).toHaveBeenCalledWith({
			where: {
				systemId: "ds-1",
				category: { in: ["color", "typography", "font"] },
			},
		});
	});

	it("no-ops for a project with neither kit nor system row", async () => {
		prisma = makePrismaStub({ kit: null, system: null });
		await syncDesignTokensFromBrandKit(prisma as unknown as PrismaDb, "p-1");
		expect(prisma.designSystem.upsert).not.toHaveBeenCalled();
		expect(prisma.designSystem.findUnique).toHaveBeenCalledWith({
			where: { projectId: "p-1" },
			select: { id: true },
		});
		expect(prisma.designToken.deleteMany).not.toHaveBeenCalled();
		expect(prisma.designToken.upsert).not.toHaveBeenCalled();
	});
});

describe("getProjectTokens", () => {
	it("groups the system's tokens by category", async () => {
		const prisma = makePrismaStub({
			system: {
				id: "ds-1",
				tokens: [
					{
						id: "t1",
						systemId: "ds-1",
						category: "color",
						role: "background",
						value: "#ffffff",
					},
					{
						id: "t2",
						systemId: "ds-1",
						category: "color",
						role: "dark-primary",
						value: "#1d4ed8",
					},
					{
						id: "t3",
						systemId: "ds-1",
						category: "typography",
						role: "body",
						value: "Inter, sans-serif",
					},
				],
			},
		});
		const grouped = await getProjectTokens(
			prisma as unknown as PrismaDb,
			"p-1",
		);
		expect(Object.keys(grouped).sort()).toEqual(["color", "typography"]);
		expect(grouped.color.map((token) => token.role)).toEqual([
			"background",
			"dark-primary",
		]);
		expect(grouped.typography).toHaveLength(1);
	});

	it("returns an empty object when the project has no DesignSystem", async () => {
		const prisma = makePrismaStub({ system: null });
		expect(
			await getProjectTokens(prisma as unknown as PrismaDb, "p-1"),
		).toEqual({});
	});
});
