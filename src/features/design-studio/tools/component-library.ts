// Component library inspector reads + the single-block re-pin (KUK-927).
// Read side: full version timelines per component (the prompt-facing
// listLibrary in component-tools.ts is compact; the inspector needs every
// version with its status/change note/turn provenance and pin counts) plus,
// optionally, the design's pages with their pinned versions so the studio
// can surface stale pins with a one-click re-pin.
//
// Re-pin side: the manual re-pin model (KUK-917) means pins NEVER move on
// their own — this operation is the editor's explicit "use the currently
// published version" button. It resolves the component's publishedVersionId
// and re-points exactly one PageBlock; drafts can never be pinned.

import { designsKey } from "@/features/design-studio/assets/design-files";
import { draftFileName } from "@/features/design-studio/chat/design-chat-prompt";
import { componentDraftPreviewBase } from "./component-tools";

type PrismaDb = ReturnType<typeof import("@/lib/db")["getPrisma"]>;

export type ComponentVersionStatus = "draft" | "published" | "retired";

export type LibraryVersion = {
	id: string;
	version: number;
	status: ComponentVersionStatus;
	changeNote: string | null;
	/** ISO timestamp. */
	createdAt: string;
	/** Chat turn that authored the version (opaque id — the UI shortens it). */
	createdTurnId: string | null;
	/** A rendered PNG preview exists in R2 (KUK-924 draft saves don't write one). */
	hasPngPreview: boolean;
	/**
	 * URL of this version's demo document under the queried design's drafts
	 * (`/designs/<designId>/file/drafts/<name-v<version>>.html`), when that
	 * design authored the version and the object still exists.
	 */
	demoDocUrl: string | null;
	/** PageBlocks pinning this exact version (informational — pins never move). */
	pinCount: number;
};

export type LibraryComponent = {
	id: string;
	name: string;
	kind: string;
	tagName: string;
	publishedVersionId: string | null;
	publishedVersion: number | null;
	/** Highest draft version, when the component has one. */
	draftVersion: number | null;
	/** Full timeline, newest first. */
	versions: LibraryVersion[];
};

export type PinnedBlock = {
	id: string;
	ordinal: number;
	kind: "component" | "template" | "html";
	/** Component-pinned blocks only below. */
	componentVersionId: string | null;
	componentId: string | null;
	componentName: string | null;
	tagName: string | null;
	version: number | null;
	versionStatus: ComponentVersionStatus | null;
};

export type DesignPagePins = {
	id: string;
	path: string;
	title: string;
	status: string;
	blocks: PinnedBlock[];
};

export type ComponentLibrary = {
	components: LibraryComponent[];
	/** Present when the read was scoped to a design (the studio case). */
	pages: DesignPagePins[] | null;
};

const VERSION_STATUS: ComponentVersionStatus[] = [
	"draft",
	"published",
	"retired",
];

function versionStatus(value: string): ComponentVersionStatus {
	return (VERSION_STATUS as string[]).includes(value)
		? (value as ComponentVersionStatus)
		: "draft";
}

/** Shared with the KUK-928 page-tools composer reads. */
export { versionStatus };

/**
 * Lists the project's live (non-deleted) components with full version
 * timelines. When `designId` is given (the studio inspector), the response
 * also carries that design's pages with their pinned versions and links each
 * version to its demo document under that design's drafts when present.
 */
export async function listProjectLibrary(
	prisma: PrismaDb,
	env: Env,
	options: { projectId: string; designId?: string },
): Promise<ComponentLibrary> {
	const components = await prisma.component.findMany({
		where: { projectId: options.projectId, deletedAt: null },
		orderBy: { name: "asc" },
		select: {
			id: true,
			name: true,
			kind: true,
			tagName: true,
			publishedVersionId: true,
		},
	});
	const componentIds = components.map((component) => component.id);
	const versions = componentIds.length
		? await prisma.componentVersion.findMany({
				where: { componentId: { in: componentIds } },
				orderBy: [{ componentId: "asc" }, { version: "desc" }],
				select: {
					id: true,
					componentId: true,
					version: true,
					status: true,
					changeNote: true,
					createdAt: true,
					createdTurnId: true,
					previewR2Key: true,
				},
			})
		: [];
	const versionIds = versions.map((version) => version.id);
	const pinGroups = versionIds.length
		? await prisma.pageBlock.groupBy({
				by: ["componentVersionId"],
				where: { componentVersionId: { in: versionIds } },
				_count: { _all: true },
			})
		: [];
	const pinCountByVersion = new Map(
		pinGroups.map((group) => [group.componentVersionId, group._count._all]),
	);

	// Demo docs: KUK-924's save_component writes drafts/<name-v<version>>.html
	// into the authoring design's bucket. One prefix listing per read (cursor
	// followed to the end — a single page caps at 1,000 objects, so a design
	// with more drafts would otherwise hide valid demo links); a version
	// links only when its expected filename is actually there.
	let draftDocNames: Set<string> | null = null;
	if (options.designId) {
		draftDocNames = new Set<string>();
		let cursor: string | undefined;
		do {
			const listed = await env.DESIGNS.list({
				prefix: designsKey(options.designId, "drafts/"),
				cursor,
			});
			for (const object of listed.objects) {
				draftDocNames.add(object.key.slice(object.key.lastIndexOf("/") + 1));
			}
			cursor = listed.truncated ? listed.cursor : undefined;
		} while (cursor);
	}

	const versionsByComponent = new Map<string, LibraryVersion[]>();
	for (const version of versions) {
		let demoDocUrl: string | null = null;
		const component = components.find(
			(entry) => entry.id === version.componentId,
		);
		if (draftDocNames && component) {
			const fileName = draftFileName(
				componentDraftPreviewBase(component.name, version.version),
			);
			if (fileName && draftDocNames.has(fileName)) {
				demoDocUrl = `/designs/${options.designId}/file/drafts/${fileName}`;
			}
		}
		const row: LibraryVersion = {
			id: version.id,
			version: version.version,
			status: versionStatus(version.status),
			changeNote: version.changeNote,
			createdAt: version.createdAt.toISOString(),
			createdTurnId: version.createdTurnId,
			hasPngPreview: version.previewR2Key !== null,
			demoDocUrl,
			pinCount: pinCountByVersion.get(version.id) ?? 0,
		};
		const list = versionsByComponent.get(version.componentId);
		if (list) list.push(row);
		else versionsByComponent.set(version.componentId, [row]);
	}

	return {
		components: components.map((component) => {
			const timeline = versionsByComponent.get(component.id) ?? [];
			const published = component.publishedVersionId
				? (timeline.find(
						(version) => version.id === component.publishedVersionId,
					) ?? null)
				: null;
			const draftVersion = timeline.find(
				(version) => version.status === "draft",
			)?.version;
			return {
				id: component.id,
				name: component.name,
				kind: component.kind,
				tagName: component.tagName,
				publishedVersionId: component.publishedVersionId,
				publishedVersion: published?.version ?? null,
				draftVersion: draftVersion ?? null,
				versions: timeline,
			};
		}),
		pages: options.designId
			? await listDesignPagePins(prisma, options.projectId, options.designId)
			: null,
	};
}

/**
 * The queried design's pages with their blocks' pinned versions. The design
 * is scoped to the requested project (KUK-927 follow-up): a designId from
 * another project yields null pages rather than leaking cross-project
 * metadata. Callers treat null as "no design context" and render the
 * library-only view.
 */
async function listDesignPagePins(
	prisma: PrismaDb,
	projectId: string,
	designId: string,
): Promise<DesignPagePins[] | null> {
	const design = await prisma.design.findUnique({
		where: { id: designId },
		select: { projectId: true },
	});
	if (!design || design.projectId !== projectId) return null;
	const pages = await prisma.page.findMany({
		where: { designId },
		orderBy: { path: "asc" },
		select: {
			id: true,
			path: true,
			title: true,
			status: true,
			blocks: {
				orderBy: { ordinal: "asc" },
				select: {
					id: true,
					ordinal: true,
					componentVersionId: true,
					templateId: true,
					sourceHtml: true,
					componentVersion: {
						select: {
							id: true,
							version: true,
							status: true,
							component: {
								select: { id: true, name: true, tagName: true },
							},
						},
					},
				},
			},
		},
	});
	return pages.map((page) => ({
		id: page.id,
		path: page.path,
		title: page.title,
		status: page.status,
		blocks: page.blocks.map((block) => {
			const pinned = block.componentVersion;
			return {
				id: block.id,
				ordinal: block.ordinal,
				kind: pinned
					? ("component" as const)
					: block.templateId
						? ("template" as const)
						: ("html" as const),
				componentVersionId: block.componentVersionId,
				componentId: pinned?.component.id ?? null,
				componentName: pinned?.component.name ?? null,
				tagName: pinned?.component.tagName ?? null,
				version: pinned?.version ?? null,
				versionStatus: pinned ? versionStatus(pinned.status) : null,
			};
		}),
	}));
}

// ---------------------------------------------------------------------------
// Single-block re-pin (POST …/blocks/:blockId/repin)
// ---------------------------------------------------------------------------

export type RepinBlockResult = {
	id: string;
	pageId: string;
	ordinal: number;
	componentVersionId: string;
	version: number;
	componentName: string;
	tagName: string;
};

export type RepinOutcome =
	| { ok: true; block: RepinBlockResult }
	/** Any of the path rows is missing or out of the path's scope. */
	| { ok: false; reason: "not found" }
	/** The component has no live published version to pin. */
	| { ok: false; reason: "no published version"; message: string };

/**
 * Re-points ONE PageBlock at the component's currently published version.
 * Every path row is fenced to its parent (block → page → design → project),
 * soft-deleted components are refused, and the resolved version must still
 * be the component's published row — a pin to a draft is impossible by
 * construction. Already-pinned blocks re-pin idempotently.
 */
export async function repinPageBlock(
	prisma: PrismaDb,
	options: {
		projectId: string;
		designId: string;
		pageId: string;
		blockId: string;
		componentId: string;
	},
): Promise<RepinOutcome> {
	const design = await prisma.design.findUnique({
		where: { id: options.designId },
		select: { projectId: true },
	});
	if (!design || design.projectId !== options.projectId) {
		return { ok: false, reason: "not found" };
	}
	const page = await prisma.page.findUnique({
		where: { id: options.pageId },
		select: { designId: true },
	});
	if (!page || page.designId !== options.designId) {
		return { ok: false, reason: "not found" };
	}
	const block = await prisma.pageBlock.findUnique({
		where: { id: options.blockId },
		select: { pageId: true },
	});
	if (!block || block.pageId !== options.pageId) {
		return { ok: false, reason: "not found" };
	}
	const component = await prisma.component.findUnique({
		where: { id: options.componentId },
		select: {
			projectId: true,
			deletedAt: true,
			name: true,
			tagName: true,
			publishedVersionId: true,
		},
	});
	if (
		!component ||
		component.projectId !== options.projectId ||
		component.deletedAt
	) {
		return { ok: false, reason: "not found" };
	}
	if (!component.publishedVersionId) {
		return {
			ok: false,
			reason: "no published version",
			message: `component "${component.name}" has no published version to pin`,
		};
	}
	const version = await prisma.componentVersion.findUnique({
		where: { id: component.publishedVersionId },
		select: { id: true, componentId: true, version: true, status: true },
	});
	if (
		!version ||
		version.componentId !== options.componentId ||
		versionStatus(version.status) !== "published"
	) {
		return {
			ok: false,
			reason: "no published version",
			message: `component "${component.name}" has no published version to pin`,
		};
	}
	const updated = await prisma.pageBlock.update({
		where: { id: options.blockId },
		data: { componentVersionId: version.id },
		select: { id: true, pageId: true, ordinal: true },
	});
	return {
		ok: true,
		block: {
			id: updated.id,
			pageId: updated.pageId,
			ordinal: updated.ordinal,
			componentVersionId: version.id,
			version: version.version,
			componentName: component.name,
			tagName: component.tagName,
		},
	};
}
