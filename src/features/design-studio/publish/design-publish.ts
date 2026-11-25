// Versioned design publishing: every publish stages attempt-specific live
// artifacts, commits their pointer, and writes an append-only snapshot under
// designs/<id>/versions/<n>/. Restores become new versions too.

import {
	designsKey,
	extractDesignTokens,
	nextVersionNumber,
} from "@/features/design-studio/assets/design-files";
import {
	designTokenRowsToDesignTokens,
	getProjectTokens,
	SYNCED_CATEGORIES,
} from "@/features/design-studio/tokens/design-tokens";
import {
	type ComposeResult,
	componentBundlePath,
	loadComposeInputs,
} from "@/features/design-studio/tools/compose";
import { getPrisma } from "@/lib/db";
import { renderDesignPreview } from "./design-render";
import { publicationPageSegment } from "./publication-segment";

export { publicationPageSegment };

export type DesignVersion = {
	n: number;
	createdAt: string;
	hasPreview: boolean;
};

/**
 * The tokens.json body for a publish (KUK-918): derived from the design's
 * container project's DesignToken rows when a DesignSystem with tokens
 * exists (the queryable token store is the source of truth), falling back
 * to extracting the published HTML's :root custom properties otherwise —
 * the pre-token-store behavior. Note publishDesignFiles' `projectId` is the
 * Design id (its rows key the R2 bucket), so the container project is
 * resolved through Design.projectId first.
 */
async function tokensJsonForPublish(
	env: Env,
	designId: string,
	html: string,
): Promise<string> {
	try {
		const prisma = getPrisma(env);
		const design = await prisma.design.findUnique({
			where: { id: designId },
			select: { projectId: true },
		});
		if (design?.projectId) {
			const grouped = await getProjectTokens(prisma, design.projectId);
			// The token store is authoritative only when it actually mirrors a
			// brand kit (color/typography/font rows). A DesignSystem can also
			// hold agent-authored categories alone (spacing/radius/shadow) after
			// a kit is deleted — serializing just those would silently DROP the
			// color tokens the HTML-derived snapshot would have captured, so
			// fall back to extraction in that case.
			const kitMirrored = SYNCED_CATEGORIES.some(
				(category) => (grouped[category]?.length ?? 0) > 0,
			);
			if (kitMirrored) {
				return JSON.stringify(
					designTokenRowsToDesignTokens(Object.values(grouped).flat()),
					null,
					2,
				);
			}
		}
	} catch (error) {
		// Token-store reads must never fail a publish — fall back to the
		// HTML-derived snapshot.
		console.log(
			`[design-publish] tokens.json derivation failed for ${designId}:`,
			error,
		);
	}
	return JSON.stringify(extractDesignTokens(html), null, 2);
}

/** Writes staged live artifacts and a new version snapshot. */
export async function publishDesignFiles(
	env: Env,
	projectId: string,
	html: string,
	options?: { turnId?: string },
): Promise<{ version: number }> {
	if (!html.includes("</html")) {
		throw new Error("publish: html has no </html> closing tag");
	}
	const png = await renderDesignPreview(env.BROWSER, html);
	const publicationId = crypto.randomUUID();
	const livePrefix = `turns/${publicationId}`;

	await env.DESIGNS.put(
		designsKey(projectId, `${livePrefix}/index.html`),
		html,
		{
			httpMetadata: { contentType: "text/html; charset=utf-8" },
		},
	);
	await env.DESIGNS.put(
		designsKey(projectId, `${livePrefix}/preview.png`),
		png,
		{ httpMetadata: { contentType: "image/png" } },
	);
	await env.DESIGNS.put(
		designsKey(projectId, `${livePrefix}/tokens.json`),
		await tokensJsonForPublish(env, projectId, html),
		{ httpMetadata: { contentType: "application/json" } },
	);

	// Commit the live pointer before versioning so a snapshot failure does not
	// roll back a successful publish. Chat owners commit conditionally, making
	// unreferenced staged writes from an abandoned owner harmless.
	const pointer = await getPrisma(env).design.updateMany({
		where: options?.turnId
			? { id: projectId, activeTurnId: options.turnId }
			: { id: projectId },
		data: { liveTurnId: publicationId },
	});
	if (pointer.count !== 1) {
		throw new Error(
			options?.turnId
				? "stale design chat turn"
				: `design project ${projectId} not found`,
		);
	}

	const versionPrefix = designsKey(projectId, "versions/");
	const listed = await env.DESIGNS.list({ prefix: versionPrefix });
	const n = nextVersionNumber(
		listed.objects.map((o) => o.key),
		projectId,
	);
	await env.DESIGNS.put(
		designsKey(projectId, `versions/${n}/index.html`),
		html,
		{ httpMetadata: { contentType: "text/html; charset=utf-8" } },
	);
	await env.DESIGNS.put(
		designsKey(projectId, `versions/${n}/preview.png`),
		png,
		{ httpMetadata: { contentType: "image/png" } },
	);
	return { version: n };
}

export async function getLiveDesignFile(
	env: Env,
	projectId: string,
	path: "index.html" | "preview.png" | "tokens.json",
): Promise<R2ObjectBody | null> {
	const project = await env.DB.prepare(
		'SELECT "liveTurnId" FROM "Design" WHERE "id" = ?',
	)
		.bind(projectId)
		.first<{ liveTurnId: string | null }>();
	const livePath = project?.liveTurnId
		? `turns/${project.liveTurnId}/${path}`
		: path;
	return env.DESIGNS.get(designsKey(projectId, livePath));
}

/**
 * Lists a project's version snapshots, newest first.
 *
 * Legacy vs new-model branch (KUK-930): version history here is R2-key
 * derived (designs/<id>/versions/<n>/) with NO DB rows. Legacy designs (no
 * Publication rows) rely entirely on this; converted designs keep the same
 * append-only R2 history (restore/republish write it too) alongside their
 * Publication rows — both coexist and neither path changes shape.
 */
export async function listDesignVersions(
	env: Env,
	projectId: string,
): Promise<DesignVersion[]> {
	const listed = await env.DESIGNS.list({
		prefix: designsKey(projectId, "versions/"),
	});
	const byVersion = new Map<number, DesignVersion>();
	for (const obj of listed.objects) {
		const n = Number(
			obj.key.slice(
				designsKey(projectId, "versions/").length,
				obj.key.indexOf("/", designsKey(projectId, "versions/").length),
			),
		);
		if (!Number.isInteger(n) || n < 1) continue;
		const existing = byVersion.get(n) ?? {
			n,
			createdAt: obj.uploaded.toISOString(),
			hasPreview: false,
		};
		if (obj.key.endsWith("preview.png")) existing.hasPreview = true;
		// index.html's upload time is the authoritative version timestamp.
		if (obj.key.endsWith("index.html")) {
			existing.createdAt = obj.uploaded.toISOString();
		}
		byVersion.set(n, existing);
	}
	return [...byVersion.values()].sort((a, b) => b.n - a.n);
}

/**
 * Restores version n through a fresh staged publication and preview render.
 * The restore publishes as a NEW version (append-only history).
 *
 * Legacy compatibility (KUK-930): restore works identically for legacy
 * designs (monolithic R2 versions, no Publication rows — publishDesignFiles'
 * monolithic path) and for converted designs; restoreDesignVersion never
 * creates a Publication row either way (chat's publish_design is what
 * snapshots publications, and createPublication returns null for legacy
 * designs without pages).
 */
export async function restoreDesignVersion(
	env: Env,
	projectId: string,
	n: number,
): Promise<{ version: number }> {
	const key = designsKey(projectId, `versions/${n}/index.html`);
	const obj = await env.DESIGNS.get(key);
	if (!obj) {
		throw new Error(`version ${n} not found`);
	}
	const html = await obj.text();
	return publishDesignFiles(env, projectId, html);
}

// ---------------------------------------------------------------------------
// Publication snapshots (KUK-921 v2 pipeline)
// ---------------------------------------------------------------------------

type PrismaDb = ReturnType<typeof getPrisma>;

/** One page's resolved pins in a publication manifest. */
export type PublicationManifestBlock = {
	blockId: string;
	componentVersionId: string;
	bundleUrl: string;
};

export type PublicationManifestPage = {
	path: string;
	htmlR2Key: string;
	blocks: PublicationManifestBlock[];
};

export type PublicationManifest = {
	pages: PublicationManifestPage[];
};

/** R2 key of a page's composed HTML inside a publication snapshot. */
function publicationPageKey(
	designId: string,
	version: number,
	pagePath: string,
): string {
	return designsKey(
		designId,
		`publications/${version}/pages/${publicationPageSegment(pagePath)}/index.html`,
	);
}

/** Prisma unique-violation check without importing the client namespace. */
function isUniqueViolation(error: unknown): boolean {
	return (error as { code?: string } | null)?.code === "P2002";
}

/**
 * Creates a Publication snapshot (KUK-921): composes every published Page of
 * the design's container project into prerendered HTML, stages the artifacts
 * to R2 under designs/<designId>/publications/<version>/ (index.html per
 * page at pages/<sanitized-path>/, an index.html copy of the homepage at the
 * publication root, the first page's preview PNG, and the manifest), writes
 * the same manifest JSON to the Publication row, and commits
 * Design.liveTurnId to the publication's staged live prefix — the same
 * turns/<id> convention and turn-fencing as publishDesignFiles, so the
 * existing site/preview/file serving keeps working unchanged.
 *
 * Returns null when the project has no published pages: legacy monolithic
 * designs (no Page rows) keep the current publish path untouched.
 *
 * Compose is pure, so the same pinned rows always produce the same manifest
 * (only htmlR2Key differs, embedding the publication version) — the pins are
 * byte-reproducible, which is what makes every publication rebuildable from
 * its row.
 */
export async function createPublication(
	prisma: PrismaDb,
	env: Env,
	designId: string,
	options?: { turnId?: string },
): Promise<{ version: number; publicationId: string } | null> {
	const design = await prisma.design.findUnique({ where: { id: designId } });
	if (!design) {
		throw new Error(`publication: design ${designId} not found`);
	}
	const pages = await prisma.page.findMany({
		where: { projectId: design.projectId ?? "", status: "published" },
		orderBy: { path: "asc" },
		include: { blocks: { orderBy: { ordinal: "asc" } } },
	});
	if (pages.length === 0) return null;

	// Compose everything first — a page with any composition error fails the
	// publication (a broken page is never published; the errors are listed
	// for the caller/agent). Ordered by path, so "/" sorts first.
	const composed: { pagePath: string; html: string }[] = [];
	for (const page of pages) {
		const result: ComposeResult = await loadComposeInputs(prisma, page.id);
		if (result.errors.length > 0) {
			throw new Error(
				`publication: page "${page.path}" failed composition:\n- ${result.errors.join("\n- ")}`,
			);
		}
		composed.push({ pagePath: page.path, html: result.html });
	}

	// Resolved pins for the manifest: PageBlock rows carry only the version
	// id, so the componentId + version number come from the pinned rows.
	const pinIds = [
		...new Set(
			pages
				.flatMap((page) => page.blocks.map((block) => block.componentVersionId))
				.filter((id): id is string => id !== null),
		),
	];
	const pinRows =
		pinIds.length > 0
			? await prisma.componentVersion.findMany({
					where: { id: { in: pinIds } },
					select: { id: true, componentId: true, version: true },
				})
			: [];
	const pinById = new Map(pinRows.map((row) => [row.id, row]));

	// Full-page preview of the first page (the homepage when present, else
	// the first page in path order) — same render-session pattern as
	// publishDesignFiles.
	const homepage =
		composed.find((page) => page.pagePath === "/") ?? composed[0];
	const png = await renderDesignPreview(env.BROWSER, homepage.html);

	let lastError: unknown;
	for (let attempt = 0; attempt < 3; attempt++) {
		const latest = await prisma.publication.findFirst({
			where: { designId },
			orderBy: { version: "desc" },
			select: { version: true },
		});
		const version = (latest?.version ?? 0) + 1;
		const publicationId = crypto.randomUUID();
		const projectId = design.projectId ?? "";
		const manifest: PublicationManifest = {
			pages: pages.map((page) => ({
				path: page.path,
				htmlR2Key: publicationPageKey(designId, version, page.path),
				blocks: page.blocks.flatMap((block) => {
					const pin = block.componentVersionId
						? pinById.get(block.componentVersionId)
						: undefined;
					if (!block.componentVersionId || !pin) return [];
					return [
						{
							blockId: block.id,
							componentVersionId: block.componentVersionId,
							bundleUrl: componentBundlePath(
								projectId,
								pin.componentId,
								pin.version,
							),
						},
					];
				}),
			})),
		};
		const manifestJson = JSON.stringify(manifest);
		const snapshotPrefix = designsKey(designId, `publications/${version}`);
		const livePrefix = designsKey(designId, `turns/${publicationId}`);
		const htmlMetadata = {
			httpMetadata: { contentType: "text/html; charset=utf-8" },
		} as const;

		// Stage the immutable snapshot AND the staged live artifacts before
		// committing anything: the pointer flip must never expose a prefix
		// that isn't fully written.
		for (const page of composed) {
			await env.DESIGNS.put(
				`${snapshotPrefix}/pages/${publicationPageSegment(page.pagePath)}/index.html`,
				page.html,
				htmlMetadata,
			);
			if (page.pagePath === homepage.pagePath) {
				await env.DESIGNS.put(
					`${snapshotPrefix}/index.html`,
					page.html,
					htmlMetadata,
				);
				await env.DESIGNS.put(
					`${livePrefix}/index.html`,
					page.html,
					htmlMetadata,
				);
			}
		}
		await env.DESIGNS.put(`${snapshotPrefix}/preview.png`, png, {
			httpMetadata: { contentType: "image/png" },
		});
		await env.DESIGNS.put(`${livePrefix}/preview.png`, png, {
			httpMetadata: { contentType: "image/png" },
		});
		await env.DESIGNS.put(`${snapshotPrefix}/manifest.json`, manifestJson, {
			httpMetadata: { contentType: "application/json" },
		});
		await env.DESIGNS.put(
			`${livePrefix}/tokens.json`,
			await tokensJsonForPublish(env, designId, homepage.html),
			{ httpMetadata: { contentType: "application/json" } },
		);

		try {
			await prisma.publication.create({
				data: {
					id: publicationId,
					designId,
					version,
					renderedR2Key: snapshotPrefix,
					previewR2Key: `${snapshotPrefix}/preview.png`,
					manifest: manifestJson,
				},
			});
		} catch (error) {
			// The [designId, version] unique absorbs a concurrent publication —
			// recompute max(version)+1 and restage under the next number.
			if (isUniqueViolation(error)) {
				lastError = error;
				continue;
			}
			throw error;
		}

		// Same ownership fence as publishDesignFiles: with a turnId, only the
		// turn holding the design's lease may move the live pointer. The row
		// was already committed — on a fence failure it is deleted again, so
		// a committed-but-never-live Publication row can't accumulate.
		// (Staged R2 artifacts under the abandoned version/prefix are
		// deliberately left in place: harmless, version-stable, and cheaper
		// than an unlink loop — the next publication skips ahead.)
		const pointer = await prisma.design.updateMany({
			where: options?.turnId
				? { id: designId, activeTurnId: options.turnId }
				: { id: designId },
			data: { liveTurnId: publicationId },
		});
		if (pointer.count !== 1) {
			const message = options?.turnId
				? "stale design chat turn"
				: `design ${designId} not found`;
			await prisma.publication
				.delete({ where: { id: publicationId } })
				.catch(() => {
					// Best effort — a stale row self-heals on the next publish.
				});
			throw new Error(message);
		}
		return { version, publicationId };
	}
	throw lastError ?? new Error("publication failed");
}
