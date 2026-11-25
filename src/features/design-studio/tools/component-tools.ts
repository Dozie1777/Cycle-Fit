// Server-side operations behind the design-chat agent tools (KUK-924):
// saveComponentDraft (save_component), seedDataCollection (seed_data),
// listLibrary (list_components), publishTurnComponentDrafts (the per-turn
// auto-publish that closes the KUK-921 gap inside publish_design) and
// componentPreviewHtml (the draft preview document). Keeping the DB work
// here makes the tool executes in design-chat.ts thin wrappers and lets
// unit tests stub prisma while workers tests hit real D1.

import { buildComponentHarnessDoc } from "./component-harness";
import { publishComponentVersion } from "./component-publish";
import {
	type ComponentDraftInput,
	validateComponentDraft,
} from "./component-validate";

type PrismaDb = ReturnType<typeof import("@/lib/db")["getPrisma"]>;

/** Component kinds (Component.kind; "section" is the agent default). */
export const COMPONENT_KINDS = ["layout", "section", "element"] as const;
export type ComponentKind = (typeof COMPONENT_KINDS)[number];

/** Max dummy-data records per seed call — keeps a runaway model bounded. */
const MAX_SEED_RECORDS = 1000;
const MAX_NAME_LENGTH = 80;

/**
 * Model-correctable failure returned as a value (never thrown): `status` is
 * HTTP-ish (400 rejected input, 409 collision) so callers can classify
 * without string matching (mirrors ComponentPublishError).
 */
export type ComponentToolFailure = {
	ok: false;
	errors: string[];
	status: number;
};

export type SaveComponentDraftInput = {
	name: string;
	kind?: string | null;
	tagName: string;
	js: string;
	html?: string | null;
	css?: string | null;
	shadowMode?: string | null;
	apiSchema?: string | Record<string, unknown> | null;
	defaults?: string | Record<string, unknown> | null;
	changeNote?: string | null;
};

export type SaveComponentDraftResult =
	| {
			ok: true;
			componentId: string;
			versionId: string;
			version: number;
			name: string;
			tagName: string;
			kind: ComponentKind;
	  }
	| ComponentToolFailure;

function normalizeKind(kind: unknown): ComponentKind | null {
	return typeof kind === "string" &&
		(COMPONENT_KINDS as readonly string[]).includes(kind)
		? (kind as ComponentKind)
		: null;
}

/** JSON column convention: pre-parsed objects stringify, strings store as-is. */
function jsonColumn(
	value: string | Record<string, unknown> | null | undefined,
): string | null {
	if (value == null) return null;
	return typeof value === "string" ? value : JSON.stringify(value);
}

/**
 * Upserts a Component by (projectId, name) and appends a NEW draft
 * ComponentVersion (version = max+1, P2002-retried). The draft passes
 * validateComponentDraft first — failures return its error list verbatim so
 * the model can self-correct. Name/tagName collisions against other
 * components return a 409-style failure. publishedVersionId and page pins
 * are never touched — publishing is a separate, explicit step.
 */
export async function saveComponentDraft(
	prisma: PrismaDb,
	options: {
		projectId: string;
		turnId?: string;
		input: SaveComponentDraftInput;
	},
): Promise<SaveComponentDraftResult> {
	const input = options.input;
	const name = typeof input.name === "string" ? input.name.trim() : "";
	if (!name || name.length > MAX_NAME_LENGTH) {
		return {
			ok: false,
			status: 400,
			errors: [
				`name is required (a library label of ${MAX_NAME_LENGTH} characters or fewer, e.g. "PricingCard").`,
			],
		};
	}
	const kind = normalizeKind(input.kind);
	if (input.kind != null && kind === null) {
		return {
			ok: false,
			status: 400,
			errors: [
				`kind must be one of: ${COMPONENT_KINDS.join(", ")} (got "${String(input.kind)}").`,
			],
		};
	}

	// Validation gate FIRST (KUK-919): surface the validator's errors
	// verbatim — each message tells the model what broke and what the
	// convention expects instead.
	const validation = validateComponentDraft({
		tagName: input.tagName,
		js: input.js,
		html: input.html,
		shadowMode: input.shadowMode,
		apiSchema: input.apiSchema,
		defaults: input.defaults,
	} satisfies ComponentDraftInput);
	if (!validation.ok) {
		return { ok: false, status: 400, errors: validation.errors };
	}

	const existing = await prisma.component.findUnique({
		where: { projectId_name: { projectId: options.projectId, name } },
	});
	// tagName is unique per project: a same-tag row under a different name
	// is a collision the model must resolve (same tag → save under that
	// component's name instead).
	const tagOwner = await prisma.component.findFirst({
		where: { projectId: options.projectId, tagName: input.tagName },
		select: { id: true, name: true },
	});
	if (tagOwner && (!existing || tagOwner.id !== existing.id)) {
		return {
			ok: false,
			status: 409,
			errors: [
				`tagName "${input.tagName}" already belongs to component "${tagOwner.name}" — reuse that name to add a version, or pick a different tagName.`,
			],
		};
	}
	if (existing && existing.tagName !== input.tagName) {
		// The tag is fixed for the component's lifetime (schema contract):
		// versions change content, never the tag — a different tag means the
		// model means a NEW component and must pick a new name too.
		return {
			ok: false,
			status: 409,
			errors: [
				`component "${name}" is registered as "${existing.tagName}" — the tagName is fixed for its lifetime; keep "${existing.tagName}" or save under a new name.`,
			],
		};
	}
	if (existing?.deletedAt) {
		// Soft-deleted rows keep serving pinned versions; silently
		// resurrecting them is a publish-path decision, not a tool side
		// effect — make the model pick a fresh name instead.
		return {
			ok: false,
			status: 409,
			errors: [
				`component "${name}" is deleted — pick a different name or ask the user to restore it.`,
			],
		};
	}

	const componentId = existing
		? existing.id
		: (
				await prisma.component.create({
					data: {
						projectId: options.projectId,
						name,
						kind: kind ?? "section",
						tagName: input.tagName,
						createdTurnId: options.turnId ?? null,
					},
				})
			).id;
	if (existing && kind && existing.kind !== kind) {
		await prisma.component.update({
			where: { id: componentId },
			data: { kind },
		});
	}

	// version is unique per component ([componentId, version]): recompute
	// max+1 and retry on the unique violation (same pattern as
	// restoreComponentVersion).
	let lastError: unknown;
	for (let attempt = 0; attempt < 3; attempt++) {
		const latest = await prisma.componentVersion.findFirst({
			where: { componentId },
			orderBy: { version: "desc" },
			select: { version: true },
		});
		try {
			const draft = await prisma.componentVersion.create({
				data: {
					componentId,
					version: (latest?.version ?? 0) + 1,
					status: "draft",
					js: input.js,
					html: input.html ?? null,
					css: input.css ?? null,
					shadowMode: input.shadowMode ?? "light",
					apiSchema: jsonColumn(input.apiSchema),
					defaults: jsonColumn(input.defaults),
					changeNote: input.changeNote ?? null,
					createdTurnId: options.turnId ?? null,
				},
			});
			return {
				ok: true,
				componentId,
				versionId: draft.id,
				version: draft.version,
				name,
				tagName: input.tagName,
				kind:
					kind ?? (existing?.kind as ComponentKind | undefined) ?? "section",
			};
		} catch (error) {
			if ((error as { code?: string }).code === "P2002") {
				lastError = error;
				continue;
			}
			throw error;
		}
	}
	throw lastError ?? new Error("component draft save failed");
}

export type SeedDataCollectionResult =
	| {
			ok: true;
			collectionId: string;
			name: string;
			count: number;
			mode: "replace" | "append";
	  }
	| ComponentToolFailure;

/**
 * Upserts a DataCollection by (projectId, name) and writes dummy records.
 * "replace" deletes the existing records and inserts at ordinals 0..n-1;
 * "append" (the default) inserts at ordinals max+1... Records must be plain
 * JSON-serializable objects — stored as JSON strings (D1/SQLite TEXT).
 *
 * The record write is ONE atomic D1 batch (`db`, the raw D1Database binding
 * — Prisma's D1 adapter does not support transactions): for replace, the
 * delete + reinserts commit or roll back together, so an interrupted
 * replace can never leave the collection emptied or half-written (same
 * pattern as replaceCampaignChannels). Append retries recompute their
 * insertion base from the current max ordinal — a racing append can only
 * push our rows later, never erase anything.
 */
export async function seedDataCollection(
	prisma: PrismaDb,
	db: D1Database,
	options: {
		projectId: string;
		name: string;
		records: unknown[];
		mode?: "replace" | "append";
	},
): Promise<SeedDataCollectionResult> {
	const name = typeof options.name === "string" ? options.name.trim() : "";
	if (!name || name.length > MAX_NAME_LENGTH) {
		return {
			ok: false,
			status: 400,
			errors: [
				`collection name is required (${MAX_NAME_LENGTH} characters or fewer, e.g. "courses").`,
			],
		};
	}
	const mode = options.mode ?? "append";
	if (options.records.length > MAX_SEED_RECORDS) {
		return {
			ok: false,
			status: 400,
			errors: [
				`too many records (${options.records.length}) — seed at most ${MAX_SEED_RECORDS} per call.`,
			],
		};
	}
	const rows: string[] = [];
	for (const [index, record] of options.records.entries()) {
		if (
			typeof record !== "object" ||
			record === null ||
			Array.isArray(record)
		) {
			return {
				ok: false,
				status: 400,
				errors: [
					`records[${index}] must be a plain JSON object (got ${record === null ? "null" : Array.isArray(record) ? "array" : typeof record}).`,
				],
			};
		}
		try {
			rows.push(JSON.stringify(record));
		} catch (error) {
			const detail =
				error instanceof Error ? error.message : "not serializable";
			return {
				ok: false,
				status: 400,
				errors: [`records[${index}] is not JSON-serializable (${detail}).`],
			};
		}
	}

	const collection = await prisma.dataCollection.upsert({
		where: { projectId_name: { projectId: options.projectId, name } },
		create: { projectId: options.projectId, name },
		update: {},
	});

	const insertStatements = (start: number) =>
		rows.map((data, index) =>
			db
				.prepare(
					'INSERT INTO "DataRecord" ("id", "collectionId", "ordinal", "data") VALUES (?, ?, ?, ?)',
				)
				.bind(crypto.randomUUID(), collection.id, start + index, data),
		);

	if (mode === "replace") {
		// One batch: delete + reinserts are atomic, so a failure anywhere
		// leaves the previous records untouched, and the post-delete
		// ordinals 0..n-1 cannot collide (the batch's own transaction
		// serializes against concurrent writers).
		const statements = [
			db
				.prepare('DELETE FROM "DataRecord" WHERE "collectionId" = ?')
				.bind(collection.id),
			...insertStatements(0),
		];
		if (statements.length > 1) {
			await db.batch(statements);
		}
		return {
			ok: true,
			collectionId: collection.id,
			name,
			count: rows.length,
			mode,
		};
	}

	// Append: base recomputed per attempt; an ordinal collision with a
	// racing append retries (the failed batch wrote nothing).
	let lastError: unknown;
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			const max = await prisma.dataRecord.aggregate({
				where: { collectionId: collection.id },
				_max: { ordinal: true },
			});
			const start = (max._max.ordinal ?? -1) + 1;
			const statements = insertStatements(start);
			if (statements.length > 0) {
				await db.batch(statements);
			}
			return {
				ok: true,
				collectionId: collection.id,
				name,
				count: rows.length,
				mode,
			};
		} catch (error) {
			if (
				error instanceof Error &&
				error.message.includes("UNIQUE constraint failed")
			) {
				lastError = error;
				continue;
			}
			throw error;
		}
	}
	throw lastError ?? new Error("data collection seed failed");
}

export type LibrarySummary = {
	components: Array<{
		name: string;
		tagName: string;
		kind: string;
		publishedVersion: number | null;
		draftVersion: number | null;
	}>;
	collections: Array<{ name: string; recordCount: number }>;
};

/**
 * Compact library summary for the prompt: live (non-deleted) components
 * with their published/draft version numbers, and the project's data
 * collections with record counts.
 */
export async function listLibrary(
	prisma: PrismaDb,
	options: { projectId: string },
): Promise<LibrarySummary> {
	const components = await prisma.component.findMany({
		where: { projectId: options.projectId, deletedAt: null },
		orderBy: { createdAt: "asc" },
		select: {
			id: true,
			name: true,
			tagName: true,
			kind: true,
			publishedVersionId: true,
		},
	});
	const publishedRows = components.some((c) => c.publishedVersionId)
		? await prisma.componentVersion.findMany({
				where: {
					id: {
						in: components
							.map((c) => c.publishedVersionId)
							.filter((id): id is string => id !== null),
					},
				},
				select: { id: true, version: true },
			})
		: [];
	const draftRows = components.length
		? await prisma.componentVersion.groupBy({
				by: ["componentId"],
				where: {
					componentId: { in: components.map((c) => c.id) },
					status: "draft",
				},
				_max: { version: true },
			})
		: [];
	const publishedByComponent = new Map(
		publishedRows.map((row) => [row.id, row.version]),
	);
	const draftByComponent = new Map(
		draftRows.map((row) => [row.componentId, row._max.version]),
	);
	const collections = await prisma.dataCollection.findMany({
		where: { projectId: options.projectId },
		orderBy: { createdAt: "asc" },
		select: { name: true, _count: { select: { records: true } } },
	});
	return {
		components: components.map((component) => ({
			name: component.name,
			tagName: component.tagName,
			kind: component.kind,
			publishedVersion: component.publishedVersionId
				? (publishedByComponent.get(component.publishedVersionId) ?? null)
				: null,
			draftVersion: draftByComponent.get(component.id) ?? null,
		})),
		collections: collections.map((collection) => ({
			name: collection.name,
			recordCount: collection._count.records,
		})),
	};
}

export type TurnComponentPublishOutcome = {
	published: Array<{ componentId: string; version: number; repinned: number }>;
	failed: Array<{ componentId: string; error: string }>;
};

/**
 * Re-points every PageBlock and TemplateSlot pinning a version a turn's
 * publish just RETIRED to that component's freshly published version
 * (KUK-925 review: the turn repairs its own fallout). Without this, the
 * sequence save v2 → compose pins published v1 → publish v2 retires v1
 * would leave the page silently block-less in the next publication (the
 * composer skips retired rows). This is a deterministic, version-scoped
 * migration — NOT a general auto-repin: pins to any other version (older or
 * newer, same or other component) are untouched, preserving the KUK-917
 * manual re-pin model. Returns the number of moved pins.
 */
async function repinRetiredVersion(
	prisma: PrismaDb,
	options: { fromVersionId: string; toVersionId: string },
): Promise<number> {
	const blocks = await prisma.pageBlock.updateMany({
		where: { componentVersionId: options.fromVersionId },
		data: { componentVersionId: options.toVersionId },
	});
	const slots = await prisma.templateSlot.updateMany({
		where: { componentVersionId: options.fromVersionId },
		data: { componentVersionId: options.toVersionId },
	});
	return blocks.count + slots.count;
}

/**
 * Publishes the Component drafts a chat turn authored (KUK-921 gap, closed
 * in KUK-924): called by publish_design BEFORE createPublication so a
 * composed snapshot pins the freshest drafts. Multiple saves of the same
 * component collapse to the LAST draft version. A publish that retires the
 * previously published version first re-points the pins on exactly that
 * retired version (see repinRetiredVersion) so the snapshot still renders
 * them; the moved count is reported per published component. A failed
 * component publish is collected, never thrown — the monolithic publish
 * must not abort.
 */
export async function publishTurnComponentDrafts(
	prisma: PrismaDb,
	env: Env,
	options: {
		turnId: string;
		drafts: Array<{ componentId: string; versionId: string }>;
	},
): Promise<TurnComponentPublishOutcome> {
	const latest = new Map<string, string>();
	for (const draft of options.drafts) {
		latest.set(draft.componentId, draft.versionId);
	}
	const published: TurnComponentPublishOutcome["published"] = [];
	const failed: TurnComponentPublishOutcome["failed"] = [];
	for (const [componentId, versionId] of latest) {
		try {
			const result = await publishComponentVersion(prisma, env, {
				componentId,
				versionId,
				turnId: options.turnId,
			});
			// Before createPublication: the just-retired version's pins must
			// point at the fresh version or the snapshot omits their blocks.
			const repinned = result.retiredVersionId
				? await repinRetiredVersion(prisma, {
						fromVersionId: result.retiredVersionId,
						toVersionId: versionId,
					})
				: 0;
			published.push({ componentId, version: result.version, repinned });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.log("[design-chat] component publish failed:", error);
			failed.push({ componentId, error: message });
		}
	}
	return { published, failed };
}

/**
 * The R2 drafts filename base for a saved component version's preview:
 * `<slugified-name>-v<version>`. Shared between the save path
 * (`design-chat.ts` → putComponentHarness) and the library demo-doc
 * lookup (`component-library.ts`) so the two can never drift apart —
 * the lookup resolves EXACTLY this name through draftFileName.
 */
export function componentDraftPreviewBase(
	name: string,
	version: number,
): string {
	return `${name.slice(0, 40)}-v${version}`;
}

/**
 * Standalone preview document for a component draft: the authored fragment
 * in the body, styles in <head>, the element source in a trailing inline
 * script so the custom element upgrades after its markup parses. Served
 * through the existing drafts file route (`allow-scripts` sandbox CSP, same
 * as preview_section). The UI-render integration (inspector thumbnails) is
 * KUK-927; this gives the model + admin an immediate rendered check.
 *
 * Thin wrapper over the harness builder (`component-harness.ts`) so drafts
 * preview the exact document the smoke test runs — error collector included.
 */
export function componentPreviewHtml(content: {
	js: string;
	css?: string | null;
	html?: string | null;
}): string {
	return buildComponentHarnessDoc(content);
}
