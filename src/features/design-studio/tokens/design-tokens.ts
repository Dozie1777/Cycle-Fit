// Design-token store helpers (KUK-918): DesignSystem/DesignToken are the
// project's queryable token store. This release the BrandKit tables remain
// the write source for palettes/typography/fonts — every brand-kit write is
// mirrored into DesignToken rows here (same mapping as migration 0021), and
// tokens.json at publish time is derived from the token rows when a system
// exists. The db import is type-only — no runtime dependency — so unit
// tests can stub the client.

import type { DesignTokens } from "@/features/design-studio/assets/design-files";
import type { BrandKitLike } from "@/features/projects/brand-kit/brand-kit";

type PrismaDb = ReturnType<typeof import("@/lib/db")["getPrisma"]>;

/** A DesignToken row (Prisma rows satisfy this structurally). */
export type DesignTokenRow = {
	id: string;
	systemId: string;
	category: string;
	role: string;
	value: string;
};

/**
 * The categories the brand-kit sync mirrors: "color" (light + `dark-`
 * prefixed roles), "typography" and "font". "spacing" | "radius" | "shadow"
 * tokens are agent-authored — the sync never touches them.
 */
export const SYNCED_CATEGORIES = ["color", "typography", "font"] as const;

/**
 * Dark-palette color roles are stored as `dark-<role>` (migration 0021
 * convention): the dark palette overrides the same shadcn roles, so the
 * mode is encoded as a role prefix to keep the
 * [systemId, category, role] unique collision-free.
 */
export const DARK_ROLE_PREFIX = "dark-";

/** A token triple the sync wants present for a system. */
export type DesiredToken = { category: string; role: string; value: string };

/** A font token's value: loading info as JSON (TEXT column — D1 is SQLite). */
export type FontTokenValue = {
	source: string;
	url: string | null;
	weights: string | null;
	italic: boolean;
};

/**
 * Pure mapping BrandKit → desired DesignToken rows — the TypeScript twin of
 * migration 0021's backfill. Light palette colors become color tokens keyed
 * by their shadcn role, dark palette colors become `dark-<role>`, typography
 * roles keep their role with the CSS stack as value, and each font becomes a
 * font token (role = family, value = JSON loading info). Duplicate font
 * families collapse to the first row (the kit body can repeat a family; the
 * token unique [systemId, category, role] cannot).
 */
export function brandKitToTokenRows(kit: BrandKitLike): DesiredToken[] {
	const rows: DesiredToken[] = [];
	for (const palette of kit.palettes) {
		for (const color of palette.colors) {
			rows.push({
				category: "color",
				role:
					palette.mode === "dark"
						? `${DARK_ROLE_PREFIX}${color.role}`
						: color.role,
				value: color.value,
			});
		}
	}
	for (const entry of kit.typography) {
		rows.push({
			category: "typography",
			role: entry.role,
			value: entry.stack,
		});
	}
	const seenFamilies = new Set<string>();
	for (const font of kit.fonts) {
		if (seenFamilies.has(font.family)) continue;
		seenFamilies.add(font.family);
		const value: FontTokenValue = {
			source: font.source,
			url: font.url ?? null,
			weights: font.weights ?? null,
			italic: font.italic ?? false,
		};
		rows.push({
			category: "font",
			role: font.family,
			value: JSON.stringify(value),
		});
	}
	return rows;
}

/**
 * Mirrors the project's brand kit into its DesignSystem's DesignToken rows
 * (called after every brand-kit write so the token store stays current):
 * ensures the 1:1 system row, upserts every kit-derived token on the
 * [systemId, category, role] unique, and drops kit-owned rows the kit no
 * longer defines (edited-away colors, deleted fonts). Agent-authored
 * categories (spacing/radius/shadow) are never touched. A project without a
 * brand kit gets its kit-mirrored rows cleared (a kit deletion) — or no-op
 * when it has no system row at all.
 */
export async function syncDesignTokensFromBrandKit(
	prisma: PrismaDb,
	projectId: string,
): Promise<void> {
	const kit = await prisma.brandKit.findUnique({
		where: { projectId },
		include: {
			palettes: {
				orderBy: { mode: "asc" },
				include: { colors: { orderBy: { role: "asc" } } },
			},
			typography: { orderBy: { role: "asc" } },
			fonts: { orderBy: { createdAt: "asc" } },
		},
	});
	if (!kit) {
		// The kit was deleted (or never existed): clear the kit-mirrored
		// categories so no stale token outlives its source. Agent-authored
		// categories and the system row itself stay — and a project without a
		// system row does not get one manufactured here.
		const system = await prisma.designSystem.findUnique({
			where: { projectId },
			select: { id: true },
		});
		if (system) {
			await prisma.designToken.deleteMany({
				where: {
					systemId: system.id,
					category: { in: [...SYNCED_CATEGORIES] },
				},
			});
		}
		return;
	}
	// Ensure the 1:1 system row exists (unique projectId).
	const system = await prisma.designSystem.upsert({
		where: { projectId },
		create: { projectId },
		update: {},
	});
	const desired = brandKitToTokenRows(kit);
	for (const token of desired) {
		await prisma.designToken.upsert({
			where: {
				systemId_category_role: {
					systemId: system.id,
					category: token.category,
					role: token.role,
				},
			},
			create: {
				systemId: system.id,
				category: token.category,
				role: token.role,
				value: token.value,
			},
			update: { value: token.value },
		});
	}
	// Rows still present for the synced categories that the current kit does
	// not define are stale — delete them. Nothing else is touched.
	const kept = new Set(
		desired.map((token) => `${token.category}\n${token.role}`),
	);
	const existing = await prisma.designToken.findMany({
		where: { systemId: system.id, category: { in: [...SYNCED_CATEGORIES] } },
		select: { category: true, role: true },
	});
	const stale = existing.filter(
		(token) =>
			// Kept deliberately redundant with the findMany's category filter:
			// the unit-test fake for Prisma does not model `category: { in }`,
			// so the sweep must not rely on the query filter alone (an
			// agent-authored token sharing a role with a kit color must
			// never be swept).
			(SYNCED_CATEGORIES as readonly string[]).includes(token.category) &&
			!kept.has(`${token.category}\n${token.role}`),
	);
	if (stale.length > 0) {
		await prisma.designToken.deleteMany({
			where: {
				systemId: system.id,
				OR: stale.map((token) => ({
					category: token.category,
					role: token.role,
				})),
			},
		});
	}
}

/**
 * The project's DesignToken rows grouped by category ("color" → its color
 * tokens, ...), or an empty object when the project has no DesignSystem.
 * Tokens within a category sort by role.
 */
export async function getProjectTokens(
	prisma: PrismaDb,
	projectId: string,
): Promise<Record<string, DesignTokenRow[]>> {
	const system = await prisma.designSystem.findUnique({
		where: { projectId },
		include: {
			tokens: { orderBy: [{ category: "asc" }, { role: "asc" }] },
		},
	});
	if (!system) return {};
	const grouped: Record<string, DesignTokenRow[]> = {};
	for (const token of system.tokens) {
		const bucket = grouped[token.category];
		if (bucket) {
			bucket.push(token);
		} else {
			grouped[token.category] = [token];
		}
	}
	return grouped;
}

/**
 * Derives the tokens.json snapshot from DesignToken rows. Naming matches
 * extractDesignTokens' HTML-derived output exactly so consumers cannot tell
 * the provenance apart: color tokens map to `--<role>` (dark rows become
 * `--dark-<role>`) and typography tokens map to `--font-<role>` (the
 * brand-kit CSS vocabulary the adoption path maps back —
 * TYPOGRAPHY_ROLE_BY_VARIABLE). Agent-authored categories serialize as
 * `--<category>-<role>`. The "font" category is excluded: its value is font
 * loading metadata (JSON), not a CSS custom-property value.
 */
export function designTokenRowsToDesignTokens(
	rows: DesignTokenRow[],
): DesignTokens {
	const colors: DesignTokens["colors"] = [];
	const other: DesignTokens["other"] = [];
	for (const row of rows) {
		if (row.category === "font") continue;
		const name =
			row.category === "color"
				? `--${row.role}`
				: row.category === "typography"
					? `--font-${row.role}`
					: `--${row.category}-${row.role}`;
		(row.category === "color" ? colors : other).push({
			name,
			value: row.value,
		});
	}
	return { colors, other };
}
