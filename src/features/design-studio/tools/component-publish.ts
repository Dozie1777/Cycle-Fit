// Component lifecycle state machine (KUK-921): publish/retire/restore for
// ComponentVersion rows built on the KUK-917 manual-re-pin model.
//
// Invariants enforced here:
// - Only "draft" versions can be published; the previously published version
//   (if any) is retired and the Component pointer is flipped. D1 has no
//   interactive transactions, so the fencing is done with atomic conditional
//   UPDATE statements (single SQL statements — the pointer move only fires
//   while it still equals the value read outside, which makes a racing
//   publish fail with a clear error instead of silently re-pointing).
// - PageBlock/TemplateSlot pins are NEVER mutated by a publish (manual
//   re-pin, KUK-917 plan decision): pages keep rendering the exact version
//   they pinned until an editor explicitly re-pins them.
// - Restores never mutate old rows: republishing an old version creates a
//   NEW draft version copying its content, then runs the same publish flow.
// - Published bundles are immutable in R2: components/<componentId>/v<n>.js
//   (+ .css when present) with an immutable cache header — versioned keys
//   never change content, so they can be cached forever. KUK-923 serves
//   componentBundlePath(projectId, …) from these keys.

import { validateComponentDraft } from "./component-validate";

type PrismaDb = ReturnType<typeof import("@/lib/db")["getPrisma"]>;

/** Options shared by every lifecycle operation. */
export type ComponentPublishOptions = {
	/**
	 * Turn fencing (mirrors publishDesignFiles): when given, the operation
	 * only runs while a Design of the component's project holds this turn as
	 * its active lease. Chat turns pass their turnId; admin handlers omit it.
	 */
	turnId?: string;
};

export type ComponentPublishResult = {
	componentId: string;
	versionId: string;
	version: number;
	/** The version row this publish retired (null when nothing was live). */
	retiredVersionId: string | null;
};

export type ComponentRetireResult = {
	componentId: string;
	retiredVersionId: string;
};

/**
 * Carries an HTTP-ish status so handlers can map failures without string
 * matching: 400 rejected drafts, 404 missing rows, 409 state/race conflicts.
 */
export class ComponentPublishError extends Error {
	status: number;

	constructor(message: string, status: number) {
		super(message);
		this.name = "ComponentPublishError";
		this.status = status;
	}
}

/** The version row shape the operations read (Prisma rows satisfy this). */
type VersionRow = {
	id: string;
	componentId: string;
	version: number;
	status: string;
	js: string;
	html: string | null;
	css: string | null;
	shadowMode: string;
	apiSchema: string | null;
	defaults: string | null;
};

/** The Component row shape the operations read. */
type ComponentRow = {
	id: string;
	projectId: string;
	name: string;
	tagName: string;
	publishedVersionId: string | null;
	deletedAt: Date | null;
};

/**
 * The R2 prefix of a component version's immutable bundle files:
 * components/<componentId>/v<version>.{js,css}. KUK-923 serves
 * componentBundlePath(projectId, componentId, version) from these keys.
 */
export function componentBundleKey(
	componentId: string,
	version: number,
): string {
	return `components/${componentId}/v${version}`;
}

/** Immutable bundle cache header — versioned keys never change content. */
const BUNDLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

/** Writes the version's immutable bundle files to the DESIGNS bucket. */
async function writeComponentBundles(
	env: Env,
	version: Pick<VersionRow, "componentId" | "version" | "js" | "css">,
): Promise<void> {
	const base = componentBundleKey(version.componentId, version.version);
	await env.DESIGNS.put(`${base}.js`, version.js, {
		httpMetadata: {
			contentType: "text/javascript",
			cacheControl: BUNDLE_CACHE_CONTROL,
		},
	});
	if (version.css !== null && version.css !== undefined) {
		await env.DESIGNS.put(`${base}.css`, version.css, {
			httpMetadata: {
				contentType: "text/css",
				cacheControl: BUNDLE_CACHE_CONTROL,
			},
		});
	}
}

/** Loads a version row with its owning component, or throws a 404. */
async function loadVersionWithComponent(
	prisma: PrismaDb,
	componentId: string,
	versionId: string,
): Promise<{ version: VersionRow; component: ComponentRow }> {
	const row = await prisma.componentVersion.findUnique({
		where: { id: versionId },
		include: { component: true },
	});
	if (!row || row.componentId !== componentId) {
		throw new ComponentPublishError("component version not found", 404);
	}
	return { version: row, component: row.component };
}

/**
 * Turn-lease fence: when a turnId is given, a Design of the component's
 * project must currently hold it as its active lease (same "only the lease
 * owner may publish" rule as publishDesignFiles' activeTurnId fence).
 */
async function assertTurnLease(
	prisma: PrismaDb,
	component: Pick<ComponentRow, "projectId">,
	turnId?: string,
): Promise<void> {
	if (!turnId) return;
	const lease = await prisma.design.findFirst({
		where: { projectId: component.projectId, activeTurnId: turnId },
		select: { id: true },
	});
	if (!lease) {
		throw new ComponentPublishError("stale design chat turn", 409);
	}
}

/** Maps a version row + its component into the validator's input shape. */
function draftInput(
	component: Pick<ComponentRow, "tagName">,
	version: VersionRow,
): Parameters<typeof validateComponentDraft>[0] {
	return {
		tagName: component.tagName,
		js: version.js,
		html: version.html,
		shadowMode: version.shadowMode,
		apiSchema: version.apiSchema,
		defaults: version.defaults,
	};
}

/**
 * Publishes a draft ComponentVersion (KUK-921):
 *
 * 1. loads the draft (+ its Component) and re-validates its content through
 *    validateComponentDraft — a bad draft is rejected before any write;
 * 2. asserts the row is still a draft;
 * 3. fences and commits with atomic conditional UPDATEs (D1 has no
 *    interactive transactions): the pointer move only fires while
 *    Component.publishedVersionId still equals the value read above, so a
 *    racing publish loses the fence and fails with a clear error; the
 *    previous published version is retired and this row flipped to
 *    "published" through status-guarded updates;
 * 4. writes the immutable bundle files to R2
 *    (components/<id>/v<n>.js[.css]).
 *
 * PageBlock pins are deliberately left untouched — the manual re-pin model
 * (KUK-917) means published pages keep rendering the exact version they
 * pinned; re-pointing is an explicit editor action, never automatic.
 */
export async function publishComponentVersion(
	prisma: PrismaDb,
	env: Env,
	options: { componentId: string; versionId: string; turnId?: string },
): Promise<ComponentPublishResult> {
	const { version, component } = await loadVersionWithComponent(
		prisma,
		options.componentId,
		options.versionId,
	);
	if (component.deletedAt) {
		throw new ComponentPublishError(
			`component "${component.name}" is deleted; restore it before publishing`,
			409,
		);
	}
	const validation = validateComponentDraft(draftInput(component, version));
	if (!validation.ok) {
		throw new ComponentPublishError(
			`component draft rejected: ${validation.errors.join(" ")}`,
			400,
		);
	}
	if (version.status !== "draft") {
		throw new ComponentPublishError(
			`component version v${version.version} is ${version.status}, not draft`,
			409,
		);
	}
	await assertTurnLease(prisma, component, options.turnId);

	// Bundles are written BEFORE the DB commit: the keys/bytes are version-
	// stable (immutable per version), so pre-writing is harmless when the
	// publish subsequently fails, while the reverse order would leave a
	// published component whose bundles were never written (a retry is
	// rejected with 409 — the version is no longer a draft).
	await writeComponentBundles(env, version);

	const previousPointer = component.publishedVersionId;
	// Race fence: the pointer move is a single conditional UPDATE — it only
	// commits while the pointer is still what we read. A concurrent publish
	// that already moved it makes count 0 → fail with a clear error, before
	// any other row is touched.
	const fence = await prisma.component.updateMany({
		where: { id: component.id, publishedVersionId: previousPointer },
		data: { publishedVersionId: version.id },
	});
	if (fence.count !== 1) {
		throw new ComponentPublishError(
			"component publish raced with another publish; retry",
			409,
		);
	}
	// Status-guarded flip FIRST: fails when the row stopped being a draft
	// between the read above and the commit (double-publish of the same
	// version). Retiring the old version only happens after this succeeds —
	// so a failure here leaves BOTH rows untouched except the fenced pointer
	// (rolled back below), and the old version is still `published`, which is
	// exactly what the rollback restores.
	const flipped = await prisma.componentVersion.updateMany({
		where: { id: version.id, status: "draft" },
		data: { status: "published" },
	});
	if (flipped.count !== 1) {
		// Roll the fenced pointer back before failing: without this, the
		// component would point at a still-draft row with no live published
		// version — the invariant the fence exists to protect.
		await prisma.component.updateMany({
			where: { id: component.id, publishedVersionId: version.id },
			data: { publishedVersionId: previousPointer },
		});
		throw new ComponentPublishError(
			`component version v${version.version} is no longer a draft`,
			409,
		);
	}
	if (previousPointer !== null && previousPointer !== version.id) {
		// Retire the replaced version — only after the flip succeeded, so the
		// rollback path above never has to resurrect a retired row. count 0
		// is fine (idempotent — the row may have been retired by an earlier
		// failed/retried publish).
		await prisma.componentVersion.updateMany({
			where: { id: previousPointer, status: "published" },
			data: { status: "retired" },
		});
	}

	// Bundles are already written (version-stable keys/bytes — pre-writing is
	// harmless when the publish subsequently fails, and a retry that would
	// re-write them is impossible: the version is now published, not draft).
	return {
		componentId: component.id,
		versionId: version.id,
		version: version.version,
		retiredVersionId: previousPointer === version.id ? null : previousPointer,
	};
}

/**
 * Restores an old version by republishing it: copies the source row's
 * content into a NEW draft version (append-only — old rows are never
 * mutated, same semantics as design-version restore), then runs the same
 * publish flow. `changeNote` records the provenance.
 */
export async function restoreComponentVersion(
	prisma: PrismaDb,
	env: Env,
	options: { componentId: string; versionId: string; turnId?: string },
): Promise<ComponentPublishResult> {
	const { version: source, component } = await loadVersionWithComponent(
		prisma,
		options.componentId,
		options.versionId,
	);
	if (component.deletedAt) {
		throw new ComponentPublishError(
			`component "${component.name}" is deleted; restore it before publishing`,
			409,
		);
	}
	// Next monotonic version for the component; the [componentId, version]
	// unique absorbs a concurrent restore (recompute and retry).
	let lastError: unknown;
	for (let attempt = 0; attempt < 3; attempt++) {
		const latest = await prisma.componentVersion.findFirst({
			where: { componentId: component.id },
			orderBy: { version: "desc" },
			select: { version: true },
		});
		try {
			const draft = await prisma.componentVersion.create({
				data: {
					componentId: component.id,
					version: (latest?.version ?? 0) + 1,
					status: "draft",
					js: source.js,
					html: source.html,
					css: source.css,
					shadowMode: source.shadowMode,
					apiSchema: source.apiSchema,
					defaults: source.defaults,
					changeNote: `restored from v${source.version}`,
					createdTurnId: options.turnId ?? null,
				},
			});
			return await publishComponentVersion(prisma, env, {
				componentId: component.id,
				versionId: draft.id,
				turnId: options.turnId,
			});
		} catch (error) {
			if ((error as { code?: string }).code === "P2002") {
				lastError = error;
				continue;
			}
			throw error;
		}
	}
	throw lastError ?? new Error("restore failed");
}

/**
 * Explicit retire without replacement: the published version's status flips
 * to "retired" and the Component pointer goes null (the component keeps its
 * history; nothing is live). Fenced against a racing publish the same way.
 */
export async function retirePublishedVersion(
	prisma: PrismaDb,
	_env: Env,
	options: { componentId: string; turnId?: string },
): Promise<ComponentRetireResult> {
	const component = await prisma.component.findUnique({
		where: { id: options.componentId },
	});
	if (!component) {
		throw new ComponentPublishError("component not found", 404);
	}
	if (component.deletedAt) {
		throw new ComponentPublishError(
			`component "${component.name}" is deleted`,
			409,
		);
	}
	if (!component.publishedVersionId) {
		throw new ComponentPublishError(
			`component "${component.name}" has no published version`,
			409,
		);
	}
	await assertTurnLease(prisma, component, options.turnId);

	const pointer = component.publishedVersionId;
	// Race fence: the conditional pointer clear only fires while the pointer
	// is still what we read (a concurrent publish would have moved it).
	const fence = await prisma.component.updateMany({
		where: { id: component.id, publishedVersionId: pointer },
		data: { publishedVersionId: null },
	});
	if (fence.count !== 1) {
		throw new ComponentPublishError(
			"component retire raced with another publish; retry",
			409,
		);
	}
	await prisma.componentVersion.updateMany({
		where: { id: pointer, status: "published" },
		data: { status: "retired" },
	});
	return { componentId: component.id, retiredVersionId: pointer };
}

/**
 * Hard-delete guard for ComponentVersion rows: a version pinned by any
 * PageBlock or TemplateSlot, or referenced by a Publication manifest of the
 * project, must never be hard-deleted — published pages and snapshots keep
 * rendering the exact pinned bytes (manual re-pin model, KUK-917). The
 * version-delete path (KUK-924 adds it) must call this first; Component
 * deletion stays soft (deletedAt) for the same reason.
 */
export async function assertComponentVersionDeletable(
	prisma: PrismaDb,
	options: { componentId: string; versionId: string },
): Promise<void> {
	const version = await prisma.componentVersion.findUnique({
		where: { id: options.versionId },
		select: { id: true, componentId: true, version: true },
	});
	if (!version || version.componentId !== options.componentId) {
		throw new ComponentPublishError("component version not found", 404);
	}
	const component = await prisma.component.findUnique({
		where: { id: options.componentId },
		select: { projectId: true },
	});
	if (!component) {
		throw new ComponentPublishError("component not found", 404);
	}
	const [pinnedByBlock, pinnedBySlot, publication] = await Promise.all([
		prisma.pageBlock.findFirst({
			where: { componentVersionId: version.id },
			select: { id: true },
		}),
		prisma.templateSlot.findFirst({
			where: { componentVersionId: version.id },
			select: { id: true },
		}),
		prisma.publication.findFirst({
			// The manifest records each pin as a componentBundlePath — match on
			// the bundle URL fragment (bundleUrl embeds componentId + version).
			where: {
				design: { projectId: component.projectId },
				manifest: {
					contains: `/components/${options.componentId}/v${version.version}.js`,
				},
			},
			select: { id: true },
		}),
	]);
	if (pinnedByBlock || pinnedBySlot || publication) {
		throw new ComponentPublishError(
			`component version v${version.version} is referenced by a page, template, or publication and cannot be deleted`,
			409,
		);
	}
}
