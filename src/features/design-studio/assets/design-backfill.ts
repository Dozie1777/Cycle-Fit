// Legacy compatibility backfill (KUK-930): converts a pre-pipeline "legacy"
// design — one monolithic self-contained HTML document whose sections are
// emergent from `data-section` attributes — into first-class building
// blocks: one published Page at "/" with one-off PageBlocks (sourceHtml —
// never a Component; components require the validation gate, one-off blocks
// are the escape hatch) carrying the document's head style/link assets and
// every top-level body segment in document order, derived DesignToken rows,
// and an initial Publication snapshot via the normal createPublication
// pipeline.
//
// Admin-triggered only (POST /projects/:projectId/designs/:designId/backfill)
// — no cron, no automatic conversion. The splitter is READ-ONLY over R2:
// legacy drafts, versions, and the monolithic live document stay exactly
// where they are, so the pre-backfill legacy behavior remains reproducible.

import {
	createPublication,
	getLiveDesignFile,
} from "@/features/design-studio/publish/design-publish";
import {
	decodeHtmlEntities,
	extractHeadAssets,
	hasDataSectionMarkers,
	htmlTokensToTokenRows,
	splitBody,
} from "@/features/design-studio/publish/design-sections";
import {
	getProjectTokens,
	SYNCED_CATEGORIES,
} from "@/features/design-studio/tokens/design-tokens";
import { extractDesignTokens } from "./design-files";

type PrismaDb = ReturnType<typeof import("@/lib/db")["getPrisma"]>;

function pageTitleFromHtml(html: string): string | null {
	const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
	const title = match?.[1].trim();
	return title === "" || title === undefined ? null : title;
}

// ---------------------------------------------------------------------------
// Backfill
// ---------------------------------------------------------------------------

/**
 * Per-design backfill outcome (the route serializes this verbatim).
 *
 * Refusal reasons:
 * - "not found" — design missing or out of the route project's scope (404).
 * - "design has no project" — unfiled designs have no Page container.
 * - "already has pages" — the container project already owns pages of
 *   another design, or this design already completed a backfill (a
 *   Publication exists — final regardless of force; re-converting over a
 *   completed publication would silently rewrite the live site). Idempotence
 *   guard (409).
 * - "incomplete backfill" — this design's own pages exist without a
 *   Publication (a crashed prior attempt, or authored draft pages). The
 *   previous page data is NOT touched; the admin opts into replacement by
 *   retrying with `force: true` (409).
 * - "contains scripts" — the legacy document has executable JavaScript
 *   (<script> tags, inline event-handler attributes like onclick=, or
 *   javascript: URLs); its behavior cannot be preserved losslessly under
 *   the new serving model (publications are prerendered HTML served under
 *   a strict sandbox CSP, so executable scripts would be stripped) —
 *   refusal, not lossy conversion. The handler/URL detection is
 *   deliberately over-approximated: refusing a convertible document is
 *   safe; converting one that loses behavior is not.
 * - "no published html" — no live document to read from R2.
 * - "no sections" — the document has no `data-section` markers; nothing is
 *   fabricated (409-free, a clean 200 refusal).
 */
export type BackfillResult =
	| {
			ok: true;
			pageCount: number;
			blockCount: number;
			publicationVersion: number;
	  }
	| { ok: false; reason: string };

/**
 * Converts one legacy design into building blocks.
 *
 * Validation is strictly READ-ONLY first: the live document is fetched from
 * R2 and checked (executable JavaScript, data-section markers) BEFORE any
 * row is touched, so a refusal can never be preceded by row deletion. Only
 * after validation passes are existing rows considered:
 *
 * - Pages of OTHER designs (or unfiled pages) in the container → refuse,
 *   never touched.
 * - This design's own pages without a Publication → an incomplete prior
 *   attempt or authored draft pages (KUK-925's compose_page creates drafts
 *   legitimately): refused with "incomplete backfill" unless `force` is
 *   set, in which case they are deleted (blocks cascade) and the backfill
 *   proceeds fresh. Force NEVER overrides a completed backfill (the
 *   Publication guard runs first) — it is for incomplete attempts only.
 *
 * The Page + its blocks are written in ONE Prisma nested create (a single
 * transaction); the force-retry path is the safety net for a failure
 * between that write and the publication commit.
 *
 * Reads the live document through the existing getLiveDesignFile helper,
 * never writes R2 (legacy drafts/versions/monolithic artifacts remain
 * untouched), derives DesignToken rows only when the project lacks a
 * kit-mirrored token store (KUK-918 machinery, create-only — existing rows
 * are never overwritten).
 */
export async function backfillDesign(
	prisma: PrismaDb,
	env: Env,
	options: {
		designId: string;
		projectId?: string;
		/** Replace an incomplete prior attempt's pages (see the doc above). */
		force?: boolean;
	},
): Promise<BackfillResult> {
	const design = await prisma.design.findUnique({
		where: { id: options.designId },
	});
	if (
		!design ||
		(options.projectId !== undefined && design.projectId !== options.projectId)
	) {
		return { ok: false, reason: "not found" };
	}
	if (!design.projectId) {
		return { ok: false, reason: "design has no project" };
	}
	const projectId = design.projectId;

	// A committed Publication means this design's conversion completed —
	// final, regardless of force (re-converting would silently rewrite the
	// live site).
	const publicationCount = await prisma.publication.count({
		where: { designId: design.id },
	});
	if (publicationCount > 0) {
		return { ok: false, reason: "already has pages" };
	}

	// READ-ONLY VALIDATION FIRST — the live document is fetched and checked
	// before ANY row is touched, so a refusal is never preceded by deletion.
	const live = await getLiveDesignFile(env, design.id, "index.html");
	if (!live) {
		return { ok: false, reason: "no published html" };
	}
	const html = await live.text();

	// Behavior cannot be preserved losslessly: publications are prerendered
	// documents served under a strict sandbox CSP, so any executable
	// JavaScript in the legacy document — <script> tags, inline event-
	// handler attributes (onclick=, onsubmit=, …), or javascript: URLs —
	// means behavior would change on conversion. Refuse instead of
	// silently dropping it.
	//
	// The scheme test runs on an ENTITY-DECODED copy of the document: the
	// browser decodes character references inside attribute values, so a
	// source-level /javascript:/i check is bypassable with
	// `href="jav&#x61;script:…"`. After decoding, tab/LF/CR are collapsed —
	// the URL parser strips them anywhere in a URL, so `java&NewLine;script:`
	// is a javascript: URL too. Attribute NAMES cannot be entity-encoded, so
	// the <script> and on*= checks stay on the raw source.
	const hasExecutableScript =
		/<script\b/i.test(html) ||
		/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>])/i.test(html) ||
		/javascript:/i.test(decodeHtmlEntities(html).replace(/[\t\n\r]/g, ""));
	if (hasExecutableScript) {
		return { ok: false, reason: "contains scripts" };
	}

	const segments = splitBody(html);
	// The data-section markers ARE the backfill contract: a document without
	// any marker — anywhere, top-level or nested — has nothing to convert.
	// (Nested markers inside an unmarked wrapper still count: the wrapper is
	// preserved as one verbatim raw segment, which is exactly the point.)
	// Never fabricate structure.
	if (!hasDataSectionMarkers(html)) {
		return { ok: false, reason: "no sections" };
	}

	// Validation passed — only now are existing rows examined.
	const existingPages = await prisma.page.findMany({
		where: { projectId },
		select: { id: true, designId: true },
	});
	if (existingPages.some((page) => page.designId !== design.id)) {
		// Another design's (or an unfiled) page — other work, never touched.
		return { ok: false, reason: "already has pages" };
	}
	if (existingPages.length > 0) {
		// This design's own pages without a Publication: a crashed prior
		// attempt or authored draft pages. Explicit opt-in only — never
		// implicitly deleted behind a refusal.
		if (!options.force) {
			return { ok: false, reason: "incomplete backfill" };
		}
		await prisma.page.deleteMany({
			where: { id: { in: existingPages.map((page) => page.id) } },
		});
	}

	// Tokens: reuse the KUK-918 decision — the token store is authoritative
	// only when it mirrors a brand kit; otherwise derive rows from the
	// document's :root custom properties. Create-only upserts: rows that
	// already exist (agent-authored categories) keep their values.
	try {
		const grouped = await getProjectTokens(prisma, projectId);
		const kitMirrored = SYNCED_CATEGORIES.some(
			(category) => (grouped[category]?.length ?? 0) > 0,
		);
		if (!kitMirrored) {
			const desired = htmlTokensToTokenRows(extractDesignTokens(html));
			if (desired.length > 0) {
				const system = await prisma.designSystem.upsert({
					where: { projectId },
					create: { projectId },
					update: {},
				});
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
						// Do not overwrite existing rows.
						update: {},
					});
				}
			}
		}
	} catch (error) {
		// Token derivation must never fail the structural backfill — the
		// publication's tokens.json still falls back to HTML extraction.
		console.log(
			`[design-backfill] token derivation failed for ${design.id}:`,
			error,
		);
	}

	// Block assembly in document order: the head's style/link assets first
	// (emitted inside a block div in the body they still render
	// document-wide — this is what preserves the legacy styling), then one
	// one-off block per top-level body segment (sections AND unmarked raw
	// content, so nothing is dropped).
	const sourceBlocks: string[] = [];
	const headAssets = extractHeadAssets(html);
	if (headAssets !== "") {
		sourceBlocks.push(headAssets);
	}
	for (const segment of segments) {
		sourceBlocks.push(segment.html);
	}

	// One published page at "/" linked to the design. Page + blocks are a
	// single Prisma nested create — one atomic write (see the resume
	// contract above for the crash window before the publication commits).
	await prisma.page.create({
		data: {
			projectId,
			designId: design.id,
			path: "/",
			title: pageTitleFromHtml(html) ?? design.prompt.trim(),
			status: "published",
			blocks: {
				create: sourceBlocks.map((sourceHtml, ordinal) => ({
					ordinal,
					sourceHtml,
				})),
			},
		},
	});

	// Initial publication through the normal pipeline (compose + prerender +
	// version snapshot + live pointer). Admin-triggered: no turn lease.
	const publication = await createPublication(prisma, env, design.id);
	if (!publication) {
		// Unreachable in practice (the page was just created published), but
		// the conversion must not report success without a snapshot.
		return { ok: false, reason: "publication failed" };
	}
	return {
		ok: true,
		pageCount: 1,
		blockCount: sourceBlocks.length,
		publicationVersion: publication.version,
	};
}
