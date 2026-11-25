import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
	extractDesignTokens,
	isDesignId,
} from "@/features/design-studio/assets/design-files";
import { getLiveDesignFile } from "@/features/design-studio/publish/design-publish";
import { syncDesignTokensFromBrandKit } from "@/features/design-studio/tokens/design-tokens";
import {
	BRAND_COLOR_ROLES,
	BRAND_TYPOGRAPHY_ROLES,
	REQUIRED_LIGHT_ROLES,
} from "@/features/projects/brand-kit/brand-kit";
import {
	mapAdoptedTokens,
	missingRequiredRoles,
	parseGoogleFontLinks,
} from "@/features/projects/brand-kit/brand-kit-adopt";
import { getPrisma } from "@/lib/db";

// Brand kit domain functions (KUK-895). One kit per project: upsert replaces
// the kit's content atomically. Prisma's D1 adapter ignores transactions, so
// the write runs as one D1 batch (delete-all + reinsert — the same
// replaceCampaignChannels pattern), with deterministic kit/palette ids so
// the upsert converges instead of duplicating rows.

/** #rgb or #rrggbb (either case). */
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const paletteBody = z.object({
	mode: z.enum(["light", "dark"]),
	colors: z
		.array(
			z.object({
				role: z.enum(BRAND_COLOR_ROLES),
				value: z
					.string()
					.trim()
					.regex(
						HEX_COLOR_RE,
						"color value must be a #rgb or #rrggbb hex value",
					),
			}),
		)
		.min(1, "a palette needs at least one color"),
});

const fontBody = z.object({
	family: z.string().trim().min(1).max(120),
	source: z.enum(["system", "google", "url"]).default("google"),
	url: z.string().trim().max(2000).optional(),
	weights: z.string().trim().max(200).optional(),
	italic: z.boolean().optional(),
});

/** The PUT body schema — the router validates with it (nested as `body`). */
export const upsertBrandKitBody = z
	.object({
		name: z.string().trim().min(1).max(200),
		palettes: z
			.array(paletteBody)
			.min(1, "a brand kit needs at least one palette"),
		typography: z
			.array(
				z.object({
					role: z.enum(BRAND_TYPOGRAPHY_ROLES),
					stack: z.string().trim().min(1).max(500),
				}),
			)
			.optional(),
		fonts: z.array(fontBody).optional(),
	})
	.superRefine((body, ctx) => {
		const modes = new Set<string>();
		for (const [index, palette] of body.palettes.entries()) {
			if (modes.has(palette.mode)) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["palettes", index, "mode"],
					message: `duplicate "${palette.mode}" palette — one per mode`,
				});
			}
			modes.add(palette.mode);
			const roles = new Set<string>(palette.colors.map((color) => color.role));
			for (const [colorIndex, color] of palette.colors.entries()) {
				if (
					colorIndex === palette.colors.findIndex((c) => c.role === color.role)
				) {
					continue;
				}
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["palettes", index, "colors", colorIndex, "role"],
					message: `duplicate color role "${color.role}" in the ${palette.mode} palette`,
				});
			}
			if (palette.mode === "light") {
				const missing = REQUIRED_LIGHT_ROLES.filter((role) => !roles.has(role));
				if (missing.length > 0) {
					ctx.addIssue({
						code: z.ZodIssueCode.custom,
						path: ["palettes", index],
						message: `light palette is missing required colors: ${missing.join(", ")}`,
					});
				}
			}
		}
		const typographyRoles = new Set<string>();
		for (const [index, entry] of (body.typography ?? []).entries()) {
			if (typographyRoles.has(entry.role)) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["typography", index, "role"],
					message: `duplicate typography role "${entry.role}"`,
				});
			}
			typographyRoles.add(entry.role);
		}
	})
	.superRefine((body, ctx) => {
		for (const [index, font] of (body.fonts ?? []).entries()) {
			if (font.source !== "url") continue;
			if (!font.url?.startsWith("https://")) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["fonts", index, "url"],
					message: `font "${font.family}" with source "url" requires an https:// stylesheet url`,
				});
			}
		}
	});

export const adoptBody = z.object({
	designId: z.string().refine(isDesignId, "invalid design id"),
});

/** Kit with its palettes/colors/typography/fonts, or null when none. */
async function loadKit(env: Env, projectId: string) {
	return getPrisma(env).brandKit.findUnique({
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
}

/**
 * GET semantics: 404 both when the project is missing and when the project
 * has no kit — the client maps that error to the empty state (null).
 */
export async function getBrandKit(env: Env, projectId: string) {
	const prisma = getPrisma(env);
	const project = await prisma.project.findUnique({
		where: { id: projectId },
		select: { id: true },
	});
	if (!project) {
		throw new TRPCError({ code: "NOT_FOUND", message: "not found" });
	}
	const kit = await loadKit(env, projectId);
	if (!kit) {
		throw new TRPCError({ code: "NOT_FOUND", message: "not found" });
	}
	return kit;
}

export type UpsertData = z.infer<typeof upsertBrandKitBody>;

/** Shared save failure message (the legacy 400 body text). */
const SAVE_FAILURE = "could not save brand kit — check for conflicting values";

/**
 * The shared, already-validated write path (KUK-901): one atomic D1 batch
 * replacing the kit's content. Both the upsert handler and token adoption go
 * through this — adoption never forks the validation or the write.
 */
export async function saveKitRows(
	env: Env,
	projectId: string,
	body: UpsertData,
): Promise<void> {
	// Deterministic ids: the kit id and palette ids are derived from the
	// project id + mode, so an upsert against an existing kit updates the
	// same rows (ON CONFLICT) instead of colliding with random ids.
	const kitId = `brandkit-${projectId}`;
	const paletteId = (mode: string) => `${kitId}-${mode}`;
	const statements = [
		env.DB.prepare(
			'INSERT INTO "BrandKit" ("id", "projectId", "name", "createdAt", "updatedAt") VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT("projectId") DO UPDATE SET "name" = excluded."name", "updatedAt" = CURRENT_TIMESTAMP',
		).bind(kitId, projectId, body.name),
		// Replace content: colors/typography/fonts are delete-all + reinsert
		// (the CampaignChannel pattern); palettes not present in the body are
		// dropped so the kit never keeps a stale mode with no colors.
		env.DB.prepare(
			'DELETE FROM "BrandColor" WHERE "paletteId" IN (SELECT "id" FROM "BrandPalette" WHERE "kitId" = ?)',
		).bind(kitId),
		env.DB.prepare('DELETE FROM "BrandTypography" WHERE "kitId" = ?').bind(
			kitId,
		),
		env.DB.prepare('DELETE FROM "BrandFont" WHERE "kitId" = ?').bind(kitId),
		...body.palettes.map((palette) =>
			env.DB.prepare(
				'INSERT INTO "BrandPalette" ("id", "kitId", "mode") VALUES (?, ?, ?) ON CONFLICT("kitId", "mode") DO NOTHING',
			).bind(paletteId(palette.mode), kitId, palette.mode),
		),
		...body.palettes.flatMap((palette) =>
			palette.colors.map((color) =>
				env.DB.prepare(
					'INSERT INTO "BrandColor" ("id", "paletteId", "role", "value") VALUES (?, ?, ?, ?)',
				).bind(
					crypto.randomUUID(),
					paletteId(palette.mode),
					color.role,
					color.value,
				),
			),
		),
		...(body.typography ?? []).map((entry) =>
			env.DB.prepare(
				'INSERT INTO "BrandTypography" ("id", "kitId", "role", "stack") VALUES (?, ?, ?, ?)',
			).bind(crypto.randomUUID(), kitId, entry.role, entry.stack),
		),
		...(body.fonts ?? []).map((font) =>
			env.DB.prepare(
				'INSERT INTO "BrandFont" ("id", "kitId", "family", "source", "url", "weights", "italic") VALUES (?, ?, ?, ?, ?, ?, ?)',
			).bind(
				crypto.randomUUID(),
				kitId,
				font.family,
				font.source,
				font.url ?? null,
				font.weights ?? null,
				font.italic ?? false,
			),
		),
	];
	try {
		// D1 batches are atomic; Prisma's D1 adapter ignores transactions.
		await env.DB.batch(statements);
	} catch {
		throw new Error(SAVE_FAILURE);
	}
	// Mirror the kit into the DesignSystem/DesignToken store (KUK-918) —
	// every brand-kit write (upsert and adoption both go through here) keeps
	// the token rows current.
	// The kit batch has committed; the token-store mirror is a derived copy.
	// A transient sync failure must not tell the client the kit write failed
	// (it succeeded) — log and return; the next kit write re-syncs anyway.
	try {
		await syncDesignTokensFromBrandKit(getPrisma(env), projectId);
	} catch (error) {
		console.log(
			`[brand-kits] token-store sync failed for ${projectId} (kit saved):`,
			error,
		);
	}
}

export async function upsertBrandKit(input: {
	env: Env;
	projectId: string;
	body: UpsertData;
}) {
	const { env, projectId, body } = input;
	const prisma = getPrisma(env);
	const project = await prisma.project.findUnique({
		where: { id: projectId },
		select: { id: true },
	});
	if (!project) {
		throw new TRPCError({ code: "NOT_FOUND", message: "not found" });
	}
	try {
		await saveKitRows(env, projectId, body);
	} catch {
		throw new TRPCError({ code: "BAD_REQUEST", message: SAVE_FAILURE });
	}
	return getBrandKit(env, projectId);
}

/** Kit name for a first-time adoption (the admin can rename afterwards). */
const ADOPTED_KIT_NAME = "Adopted brand kit";

/**
 * Token adoption (KUK-901): seeds the brand kit from a published design of
 * this project. Reads the design's live index.html from the DESIGNS bucket,
 * maps its `:root` custom properties onto the shadcn role vocabulary and
 * parses its Google Fonts css2 <link> tags back into font rows, then saves
 * through the SAME validation/write path as the upsert (upsertBrandKitBody +
 * saveKitRows). Required roles still apply: when the extraction misses one,
 * nothing is saved and `missing` tells the UI which roles to fill.
 *
 * Response: `{ adopted, skipped, missing, saved, kit }` — `saved: false`
 * keeps `kit` null; `skipped` lists (a capped sample of) the extracted
 * variables that could not be mapped; `kit` is the freshly saved kit.
 */
export async function adoptBrandKit(input: {
	env: Env;
	projectId: string;
	designId: string;
}) {
	const { env, projectId, designId } = input;
	const prisma = getPrisma(env);
	const project = await prisma.project.findUnique({
		where: { id: projectId },
		select: { id: true },
	});
	if (!project) {
		throw new TRPCError({ code: "NOT_FOUND", message: "not found" });
	}
	// The design must belong to this project's container.
	const design = await prisma.design.findUnique({
		where: { id: designId },
		select: { id: true, projectId: true },
	});
	if (!design || design.projectId !== projectId) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "design not found in this project",
		});
	}
	// Published state: getLiveDesignFile resolves the live turn pointer (or
	// the root index.html fallback) — same path the file-serving route uses.
	const object = await getLiveDesignFile(env, design.id, "index.html");
	if (!object) {
		throw new TRPCError({
			code: "CONFLICT",
			message: "design has no published index.html",
		});
	}
	const html = await object.text();
	const mapped = mapAdoptedTokens(extractDesignTokens(html));
	const fonts = parseGoogleFontLinks(html);
	const adopted = {
		colors: mapped.colors,
		typography: mapped.typography,
		fonts: fonts.map((font) => ({
			family: font.family,
			source: font.source,
			url: font.url ?? null,
			weights: font.weights ?? null,
			italic: font.italic ?? false,
		})),
	};
	const missing = missingRequiredRoles(mapped.colors);
	if (missing.length > 0) {
		// Not saveable — hand back what was extracted so the UI can prefill
		// the editor and ask the admin to fill the required roles.
		return {
			adopted,
			skipped: mapped.skipped,
			missing,
			saved: false,
			kit: null,
		};
	}
	const candidate = upsertBrandKitBody.safeParse({
		name: ADOPTED_KIT_NAME,
		palettes: [{ mode: "light", colors: mapped.colors }],
		...(mapped.typography.length ? { typography: mapped.typography } : {}),
		...(fonts.length ? { fonts } : {}),
	});
	// Defensive: the mapping keeps values inside the PUT validation bounds,
	// so this only fires if the schema and the mapper drift apart.
	if (!candidate.success) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: candidate.error.issues[0]?.message ?? "invalid body",
		});
	}
	try {
		await saveKitRows(env, projectId, candidate.data);
	} catch {
		throw new TRPCError({ code: "BAD_REQUEST", message: SAVE_FAILURE });
	}
	return {
		adopted,
		skipped: mapped.skipped,
		missing: [],
		saved: true,
		kit: await loadKit(env, projectId),
	};
}

export async function deleteBrandKit(
	env: Env,
	projectId: string,
): Promise<void> {
	const prisma = getPrisma(env);
	const kit = await prisma.brandKit.findUnique({
		where: { projectId },
		select: { id: true },
	});
	if (!kit) {
		throw new TRPCError({ code: "NOT_FOUND", message: "not found" });
	}
	// DB relations cascade: kit -> palettes -> colors, typography, fonts.
	await prisma.brandKit.delete({ where: { id: kit.id } });
	// The token store is a mirror of the kit (KUK-918) — a kit deletion
	// clears its kit-mirrored DesignToken rows too. Fail-soft like the save
	// path: the kit row is already gone (a retry would 404), so a transient
	// sync error must not 500 — it is healed by the next kit write or, for
	// stale rows after a delete, the next publish's authoritative gate
	// treats an empty kit mirror as "extract from HTML".
	try {
		await syncDesignTokensFromBrandKit(prisma, projectId);
	} catch (error) {
		console.log(
			`[brand-kits] token-store sync failed after kit delete for ${projectId}:`,
			error,
		);
	}
}
