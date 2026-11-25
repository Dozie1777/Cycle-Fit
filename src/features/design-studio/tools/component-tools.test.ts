// Unit tests for the KUK-924 agent-tool operations (component-tools.ts). A
// small in-memory prisma stub implements exactly the reads/writes the
// operations perform (same stub style as component-publish.test.ts): the
// client type is derived from the functions' parameters and the stub is
// cast — no runtime mock needed. publishTurnComponentDrafts runs the REAL
// publishComponentVersion against the stub so the publish flow (fence,
// flip, retire, R2 bundles) is exercised too.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { draftFileName } from "@/features/design-studio/chat/design-chat-prompt";
import { buildComponentHarnessDoc } from "./component-harness";
import {
	componentDraftPreviewBase,
	componentPreviewHtml,
	type LibrarySummary,
	listLibrary,
	publishTurnComponentDrafts,
	type SaveComponentDraftResult,
	type SeedDataCollectionResult,
	saveComponentDraft,
	seedDataCollection,
} from "./component-tools";
import { validateComponentDraft } from "./component-validate";

type PrismaDb = Parameters<typeof saveComponentDraft>[0];
type Env = Parameters<typeof publishTurnComponentDrafts>[1];

const COMPONENT_JS =
	'class TbHero extends HTMLElement {\n\tconnectedCallback() {\n\t\tif (this.hasAttribute("data-ssr")) return;\n\t\tthis.innerHTML = "<p>hero</p>";\n\t}\n}\ncustomElements.define("tb-hero", TbHero);';

type ComponentRow = {
	id: string;
	projectId: string;
	name: string;
	kind: string;
	tagName: string;
	publishedVersionId: string | null;
	createdTurnId: string | null;
	deletedAt: Date | null;
};

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
	changeNote: string | null;
	createdTurnId: string | null;
};

type CollectionRow = { id: string; projectId: string; name: string };
type RecordRow = {
	id: string;
	collectionId: string;
	ordinal: number;
	data: string;
};

type PageBlockRow = {
	id: string;
	pageId: string;
	ordinal: number;
	componentVersionId: string | null;
};
type TemplateSlotRow = {
	id: string;
	templateId: string;
	ordinal: number;
	componentVersionId: string | null;
};

/**
 * In-memory prisma stub: rows live in Maps keyed by id and the query
 * methods scan them. `failNextVersionCreate` simulates a concurrent winner
 * inserting the same [componentId, version] (P2002) while the caller's
 * insert also lands — forcing the recompute-and-retry path.
 */
function makePrismaStub() {
	const components = new Map<string, ComponentRow>();
	const versions = new Map<string, VersionRow>();
	const collections = new Map<string, CollectionRow>();
	const records: RecordRow[] = [];
	const pageBlocks = new Map<string, PageBlockRow>();
	const templateSlots = new Map<string, TemplateSlotRow>();
	let componentSeq = 0;
	let versionSeq = 0;
	let collectionSeq = 0;
	let recordSeq = 0;
	/** Set to force exactly one P2002 on the next createMany (retry tests). */
	let failNextCreateMany = false;
	let failNextVersionCreate = false;

	const stub = {
		component: {
			async findUnique(args: {
				where: { projectId_name: { projectId: string; name: string } };
			}) {
				for (const row of components.values()) {
					if (
						row.projectId === args.where.projectId_name.projectId &&
						row.name === args.where.projectId_name.name
					) {
						return row;
					}
				}
				return null;
			},
			async findFirst(args: { where: { projectId: string; tagName: string } }) {
				for (const row of components.values()) {
					if (
						row.projectId === args.where.projectId &&
						row.tagName === args.where.tagName
					) {
						return row;
					}
				}
				return null;
			},
			async create(args: { data: Record<string, unknown> }) {
				const row = {
					id: `comp-${++componentSeq}`,
					publishedVersionId: null,
					deletedAt: null,
					...args.data,
				} as ComponentRow;
				components.set(row.id, row);
				return row;
			},
			async update(args: {
				where: { id: string };
				data: Record<string, unknown>;
			}) {
				const row = components.get(args.where.id);
				if (row) Object.assign(row, args.data);
				return row;
			},
			async findMany(args: { where: { projectId: string; deletedAt: null } }) {
				return [...components.values()].filter(
					(row) =>
						row.projectId === args.where.projectId && row.deletedAt === null,
				);
			},
			async updateMany(args: {
				where: { id: string; publishedVersionId?: string | null };
				data: { publishedVersionId: string | null };
			}) {
				const row = components.get(args.where.id);
				if (!row || row.publishedVersionId !== args.where.publishedVersionId) {
					return { count: 0 };
				}
				row.publishedVersionId = args.data.publishedVersionId;
				return { count: 1 };
			},
		},
		componentVersion: {
			async findFirst(args: {
				where: { componentId: string };
				orderBy: { version: string };
			}) {
				let latest: VersionRow | null = null;
				for (const row of versions.values()) {
					if (row.componentId !== args.where.componentId) continue;
					if (!latest || row.version > latest.version) latest = row;
				}
				return latest ? { version: latest.version } : null;
			},
			async findUnique(args: { where: { id: string } }) {
				const row = versions.get(args.where.id);
				if (!row) return null;
				return { ...row, component: components.get(row.componentId) };
			},
			async create(args: { data: Record<string, unknown> }) {
				const row = { id: `v-${++versionSeq}`, ...args.data } as VersionRow;
				versions.set(row.id, row);
				if (failNextVersionCreate) {
					failNextVersionCreate = false;
					const error = new Error("Unique constraint failed");
					(error as { code?: string }).code = "P2002";
					throw error;
				}
				return row;
			},
			async findMany(args: { where: { id: { in: string[] } } }) {
				return [...versions.values()].filter((row) =>
					args.where.id.in.includes(row.id),
				);
			},
			async groupBy(args: {
				where: { componentId: { in: string[] }; status: string };
				_max: { version: true };
			}) {
				const maxByComponent = new Map<string, number>();
				for (const row of versions.values()) {
					if (
						!args.where.componentId.in.includes(row.componentId) ||
						row.status !== args.where.status
					) {
						continue;
					}
					const current = maxByComponent.get(row.componentId);
					if (current === undefined || row.version > current) {
						maxByComponent.set(row.componentId, row.version);
					}
				}
				return [...maxByComponent.entries()].map(([componentId, version]) => ({
					componentId,
					_max: { version },
				}));
			},
			async updateMany(args: {
				where: { id: string; status: string };
				data: { status: string };
			}) {
				const row = versions.get(args.where.id);
				if (!row || row.status !== args.where.status) return { count: 0 };
				row.status = args.data.status;
				return { count: 1 };
			},
		},
		dataCollection: {
			async upsert(args: {
				where: { projectId_name: { projectId: string; name: string } };
				create: { projectId: string; name: string };
			}) {
				for (const row of collections.values()) {
					if (
						row.projectId === args.where.projectId_name.projectId &&
						row.name === args.where.projectId_name.name
					) {
						return row;
					}
				}
				const row = { id: `coll-${++collectionSeq}`, ...args.create };
				collections.set(row.id, row);
				return row;
			},
			async findMany(args: {
				where: { projectId: string };
				select: { name: true; _count: { select: { records: true } } };
			}) {
				return [...collections.values()]
					.filter((row) => row.projectId === args.where.projectId)
					.map((row) => ({
						name: row.name,
						_count: {
							records: records.filter((r) => r.collectionId === row.id).length,
						},
					}));
			},
		},
		dataRecord: {
			async deleteMany(args: { where: { collectionId: string } }) {
				let count = 0;
				for (let i = records.length - 1; i >= 0; i--) {
					if (records[i].collectionId === args.where.collectionId) {
						records.splice(i, 1);
						count++;
					}
				}
				return { count };
			},
			async createMany(args: {
				data: Array<{
					collectionId: string;
					ordinal: number;
					data: string;
				}>;
			}) {
				if (failNextCreateMany) {
					failNextCreateMany = false;
					// Simulate a concurrent append winning the race during the
					// replace window (between the delete and our insert): the
					// racer's row lands at the ordinal our attempt targeted.
					records.push({
						id: `rec-${++recordSeq}`,
						collectionId: args.data[0].collectionId,
						ordinal: args.data[0].ordinal,
						data: JSON.stringify({ title: "Raced in" }),
					});
					const error = new Error("unique constraint") as {
						code?: string;
					};
					error.code = "P2002";
					throw error;
				}
				for (const row of args.data) {
					records.push({ id: `rec-${++recordSeq}`, ...row });
				}
				return { count: args.data.length };
			},
			async aggregate(args: {
				where: { collectionId: string };
				_max: { ordinal: true };
			}) {
				let max: number | null = null;
				for (const row of records) {
					if (row.collectionId !== args.where.collectionId) continue;
					if (max === null || row.ordinal > max) max = row.ordinal;
				}
				return { _max: { ordinal: max } };
			},
		},
		pageBlock: {
			async updateMany(args: {
				where: { componentVersionId: string };
				data: { componentVersionId: string };
			}) {
				let count = 0;
				for (const row of pageBlocks.values()) {
					if (row.componentVersionId === args.where.componentVersionId) {
						row.componentVersionId = args.data.componentVersionId;
						count++;
					}
				}
				return { count };
			},
		},
		templateSlot: {
			async updateMany(args: {
				where: { componentVersionId: string };
				data: { componentVersionId: string };
			}) {
				let count = 0;
				for (const row of templateSlots.values()) {
					if (row.componentVersionId === args.where.componentVersionId) {
						row.componentVersionId = args.data.componentVersionId;
						count++;
					}
				}
				return { count };
			},
		},
		design: {
			// Turn lease present: publishTurnComponentDrafts passes the turn's
			// turnId and the real publishComponentVersion fences on it.
			async findFirst() {
				return { id: "design-1" };
			},
		},
	};
	return {
		stub,
		components,
		versions,
		collections,
		records,
		pageBlocks,
		templateSlots,
		failNextVersionCreate: () => {
			failNextVersionCreate = true;
		},
		/**
		 * Fake raw D1Database: prepare().bind() captures SQL+params, batch()
		 * validates ALL statements first (unique constraints) then applies —
		 * modeling D1's atomic batches (a throw applies nothing).
		 */
		d1: makeFakeD1(records, () => {
			failNextCreateMany = false;
			return failNextCreateMany;
		}),
	};
}

function makeFakeD1(records: RecordRow[], _reset: () => boolean) {
	let raceNextBatch = false;
	let breakNextBatch: Error | null = null;
	return {
		/** Simulate a concurrent writer colliding with the next batch. */
		raceNextBatch: () => {
			raceNextBatch = true;
		},
		/** Make the next batch fail with an arbitrary error (nothing applied). */
		breakNextBatch: (error: Error) => {
			breakNextBatch = error;
		},
		prepare(sql: string) {
			return {
				sql,
				bind: (...params: unknown[]) => ({ sql, params }),
			};
		},
		async batch(
			statements: Array<{ sql: string; params: unknown[] }>,
		): Promise<unknown> {
			if (breakNextBatch) {
				const error = breakNextBatch;
				breakNextBatch = null;
				throw error;
			}
			if (raceNextBatch) {
				raceNextBatch = false;
				// A racing writer lands a row at the first insert's target
				// ordinal BEFORE the batch runs — the batch then violates the
				// unique constraint and writes nothing (atomic).
				const first = statements.find((s) =>
					s.sql.startsWith('INSERT INTO "DataRecord"'),
				);
				if (first) {
					records.push({
						id: `rec-${++insertSeq}`,
						collectionId: first.params[1] as string,
						ordinal: first.params[2] as number,
						data: JSON.stringify({ title: "Raced in" }),
					});
				}
			}
			// D1 batches execute statements in order inside a transaction —
			// a later INSERT does not collide with rows a prior DELETE in the
			// same batch removed. Any throw rolls the whole batch back.
			const snapshot = records.slice();
			try {
				for (const { sql, params } of statements) {
					if (sql.startsWith('DELETE FROM "DataRecord"')) {
						const collectionId = params[0] as string;
						for (let i = records.length - 1; i >= 0; i--) {
							if (records[i].collectionId === collectionId) {
								records.splice(i, 1);
							}
						}
					} else if (sql.startsWith('INSERT INTO "DataRecord"')) {
						const [id, collectionId, ordinal, data] = params as [
							string,
							string,
							number,
							string,
						];
						if (
							records.some(
								(row) =>
									row.collectionId === collectionId && row.ordinal === ordinal,
							)
						) {
							throw new Error(
								"UNIQUE constraint failed: DataRecord.collectionId, DataRecord.ordinal",
							);
						}
						records.push({ id, collectionId, ordinal, data });
					}
				}
			} catch (error) {
				records.splice(0, records.length, ...snapshot);
				throw error;
			}
			return statements.map(() => ({ meta: {} }));
		},
	};
}

let insertSeq = 0;

function makeEnv() {
	const writes: Array<{ key: string; value: string }> = [];
	return {
		writes,
		DESIGNS: {
			put: vi.fn(async (key: string, value: string) => {
				writes.push({ key, value });
			}),
		},
	} as unknown as Env & { writes: Array<{ key: string; value: string }> };
}

const PROJECT = "proj-1";

async function saveHero(
	db: ReturnType<typeof makePrismaStub>,
	overrides: Record<string, unknown> = {},
): Promise<SaveComponentDraftResult> {
	return saveComponentDraft(db.stub as unknown as PrismaDb, {
		projectId: PROJECT,
		turnId: "turn-1",
		input: {
			name: "Hero",
			tagName: "tb-hero",
			js: COMPONENT_JS,
			css: "p { color: var(--tb-text-primary) }",
			...overrides,
		},
	});
}

describe("saveComponentDraft", () => {
	let db: ReturnType<typeof makePrismaStub>;

	beforeEach(() => {
		db = makePrismaStub();
	});

	it("creates the component and a draft version 1 with turn provenance", async () => {
		const result = await saveHero(db);
		expect(result).toMatchObject({
			ok: true,
			version: 1,
			name: "Hero",
			tagName: "tb-hero",
			kind: "section",
		});
		const component = [...db.components.values()][0];
		expect(component).toMatchObject({
			projectId: PROJECT,
			name: "Hero",
			kind: "section",
			tagName: "tb-hero",
			createdTurnId: "turn-1",
		});
		const version = [...db.versions.values()][0];
		expect(version).toMatchObject({
			componentId: component.id,
			version: 1,
			status: "draft",
			js: COMPONENT_JS,
			shadowMode: "light",
			createdTurnId: "turn-1",
		});
		// The pointer is never touched by a draft save.
		expect(component.publishedVersionId).toBeNull();
	});

	it("keeps versions monotonic across saves of the same component", async () => {
		const first = await saveHero(db);
		const second = await saveHero(db, { changeNote: "tightened spacing" });
		expect(first).toMatchObject({ ok: true, version: 1 });
		expect(second).toMatchObject({ ok: true, version: 2 });
		expect([...db.versions.values()].map((v) => v.version)).toEqual([1, 2]);
		// Still ONE component row — the save upserted, not duplicated.
		expect(db.components.size).toBe(1);
	});

	it("recomputes the version and retries on a P2002 unique violation", async () => {
		db.failNextVersionCreate();
		const result = await saveHero(db);
		// The failed insert had already landed a v1 (the concurrent winner);
		// the retry must recompute max+1 = 2.
		expect(result).toMatchObject({ ok: true, version: 2 });
		expect([...db.versions.values()].map((v) => v.version)).toEqual([1, 2]);
	});

	it("passes validator errors through verbatim without writing", async () => {
		const input = {
			name: "Hero",
			tagName: "TB-Hero",
			js: "const x = 1;",
		} as const;
		const result = await saveComponentDraft(db.stub as unknown as PrismaDb, {
			projectId: PROJECT,
			input,
		});
		const expected = validateComponentDraft(input);
		if (expected.ok) throw new Error("fixture should fail validation");
		expect(result).toEqual({ ok: false, status: 400, errors: expected.errors });
		expect(db.components.size).toBe(0);
		expect(db.versions.size).toBe(0);
	});

	it("rejects an unknown kind", async () => {
		const result = await saveHero(db, { kind: "widget" });
		expect(result).toMatchObject({
			ok: false,
			status: 400,
			errors: [expect.stringContaining("kind must be one of")],
		});
		expect(db.components.size).toBe(0);
	});

	it("respects an explicit kind", async () => {
		const result = await saveHero(db, { kind: "element" });
		expect(result).toMatchObject({ ok: true, kind: "element" });
	});

	it("collides when the tagName belongs to another component", async () => {
		await saveHero(db);
		const result = await saveComponentDraft(db.stub as unknown as PrismaDb, {
			projectId: PROJECT,
			input: {
				name: "Hero Banner",
				tagName: "tb-hero",
				js: COMPONENT_JS,
			},
		});
		expect(result).toMatchObject({
			ok: false,
			status: 409,
			errors: [expect.stringContaining('already belongs to component "Hero"')],
		});
		expect(db.components.size).toBe(1);
	});

	it("rejects changing the fixed tagName of an existing component", async () => {
		await saveHero(db);
		const result = await saveHero(db, {
			tagName: "tb-hero-v2",
			js: COMPONENT_JS.replace("tb-hero", "tb-hero-v2"),
		});
		expect(result).toMatchObject({
			ok: false,
			status: 409,
			errors: [expect.stringContaining("fixed for its lifetime")],
		});
	});

	it("refuses to resurrect a soft-deleted component name", async () => {
		await saveHero(db);
		const component = [...db.components.values()][0];
		component.deletedAt = new Date();
		const result = await saveHero(db);
		expect(result).toMatchObject({
			ok: false,
			status: 409,
			errors: [expect.stringContaining('component "Hero" is deleted')],
		});
	});

	it("stringifies pre-parsed apiSchema/defaults objects", async () => {
		await saveHero(db, {
			apiSchema: { attributes: { heading: { type: "string" } } },
			defaults: { heading: "Hi" },
		});
		const version = [...db.versions.values()][0];
		expect(version.apiSchema).toBe(
			JSON.stringify({ attributes: { heading: { type: "string" } } }),
		);
		expect(version.defaults).toBe(JSON.stringify({ heading: "Hi" }));
	});
});

describe("seedDataCollection", () => {
	let db: ReturnType<typeof makePrismaStub>;
	const seed = (overrides: Record<string, unknown> = {}) =>
		seedDataCollection(
			db.stub as unknown as PrismaDb,
			db.d1 as unknown as D1Database,
			{
				projectId: PROJECT,
				name: "courses",
				records: [{ title: "Intro to SQL" }, { title: "Advanced SQL" }],
				...overrides,
			},
		);

	beforeEach(() => {
		db = makePrismaStub();
	});

	it("replace deletes existing records and inserts at ordinals 0..n-1", async () => {
		const result = (await seed({ mode: "replace" })) as Extract<
			SeedDataCollectionResult,
			{ ok: true }
		>;
		expect(result).toMatchObject({
			ok: true,
			name: "courses",
			count: 2,
			mode: "replace",
		});
		expect(db.records.map((r) => r.ordinal)).toEqual([0, 1]);
		expect(db.records.map((r) => JSON.parse(r.data))).toEqual([
			{ title: "Intro to SQL" },
			{ title: "Advanced SQL" },
		]);
		// Upserted collection row, keyed per project.
		const collection = [...db.collections.values()][0];
		expect(collection).toMatchObject({ projectId: PROJECT, name: "courses" });
		expect(result.collectionId).toBe(collection.id);
	});

	it("append starts after the highest existing ordinal", async () => {
		await seed({ mode: "replace" });
		const result = (await seed({
			records: [{ title: "Third" }],
		})) as Extract<SeedDataCollectionResult, { ok: true }>;
		// Default mode is append.
		expect(result.mode).toBe("append");
		expect(result.count).toBe(1);
		expect(db.records.map((r) => r.ordinal)).toEqual([0, 1, 2]);
		// The two original records survive an append.
		expect(db.records).toHaveLength(3);
	});

	it("replace after append rewrites the collection from 0", async () => {
		await seed({ mode: "replace" });
		await seed({ records: [{ title: "Third" }] });
		const result = (await seed({
			mode: "replace",
			records: [{ title: "Fresh" }],
		})) as Extract<SeedDataCollectionResult, { ok: true }>;
		expect(result.count).toBe(1);
		expect(db.records.map((r) => r.ordinal)).toEqual([0]);
		expect(JSON.parse(db.records[0].data)).toEqual({ title: "Fresh" });
	});

	it("append retry after a racing writer lands first (nothing erased)", async () => {
		await seed({ mode: "replace" });
		// A racing writer lands a row during the replace window — the fake D1
		// injects it at the batch's first insert target ordinal before the
		// batch validates, so the batch fails atomically and retries.
		db.d1.raceNextBatch();
		const result = (await seed({
			mode: "append",
			records: [{ title: "Fresh" }],
		})) as Extract<SeedDataCollectionResult, { ok: true }>;
		expect(result.ok).toBe(true);
		// Nothing was erased by the failed batch; our record lands after the
		// racer's.
		const rows = db.records.map((r) => ({
			ordinal: r.ordinal,
			title: JSON.parse(r.data).title,
		}));
		expect(rows).toEqual([
			{ ordinal: 0, title: "Intro to SQL" },
			{ ordinal: 1, title: "Advanced SQL" },
			{ ordinal: 2, title: "Raced in" },
			{ ordinal: 3, title: "Fresh" },
		]);
	});

	it("failed atomic replace preserves the previous records", async () => {
		await seed({ mode: "replace" });
		// Force the replace batch to fail after it started (a generic D1
		// error): the atomic batch must roll back — the previous records
		// survive untouched, never an emptied collection.
		db.d1.breakNextBatch(new Error("D1 write failed"));
		await expect(
			seed({
				mode: "replace",
				records: [{ title: "Fresh" }],
			}),
		).rejects.toThrow("D1 write failed");
		expect(db.records.map((r) => JSON.parse(r.data).title)).toEqual([
			"Intro to SQL",
			"Advanced SQL",
		]);
	});

	it("rejects non-object and non-serializable records", async () => {
		const bad = await seed({ records: ["nope"] as unknown as unknown[] });
		expect(bad).toMatchObject({
			ok: false,
			status: 400,
			errors: [
				expect.stringContaining("records[0] must be a plain JSON object"),
			],
		});
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		const bad2 = await seed({ records: [cyclic] });
		expect(bad2).toMatchObject({
			ok: false,
			status: 400,
			errors: [expect.stringContaining("records[0] is not JSON-serializable")],
		});
		expect(db.collections.size).toBe(0);
	});

	it("rejects a blank collection name", async () => {
		const result = await seed({ name: "   " });
		expect(result).toMatchObject({ ok: false, status: 400 });
	});
});

describe("listLibrary", () => {
	let db: ReturnType<typeof makePrismaStub>;
	let env: ReturnType<typeof makeEnv>;

	beforeEach(() => {
		db = makePrismaStub();
		env = makeEnv();
	});

	it("summarizes components with published/draft versions and collections", async () => {
		// Hero: v1 published, v2 draft.
		const hero = (await saveHero(db)) as Extract<
			SaveComponentDraftResult,
			{ ok: true }
		>;
		await publishTurnComponentDrafts(db.stub as unknown as PrismaDb, env, {
			turnId: "turn-1",
			drafts: [{ componentId: hero.componentId, versionId: hero.versionId }],
		});
		await saveHero(db, { changeNote: "v2 draft" });
		// Card: draft only.
		await saveComponentDraft(db.stub as unknown as PrismaDb, {
			projectId: PROJECT,
			input: {
				name: "Card",
				tagName: "tb-card",
				js: COMPONENT_JS.replace("tb-hero", "tb-card"),
			},
		});
		await seedDataCollection(
			db.stub as unknown as PrismaDb,
			db.d1 as unknown as D1Database,
			{
				projectId: PROJECT,
				name: "courses",
				records: [{ title: "a" }, { title: "b" }],
			},
		);

		const summary: LibrarySummary = await listLibrary(
			db.stub as unknown as PrismaDb,
			{ projectId: PROJECT },
		);
		expect(summary.components).toEqual([
			{
				name: "Hero",
				tagName: "tb-hero",
				kind: "section",
				publishedVersion: 1,
				draftVersion: 2,
			},
			{
				name: "Card",
				tagName: "tb-card",
				kind: "section",
				publishedVersion: null,
				draftVersion: 1,
			},
		]);
		expect(summary.collections).toEqual([{ name: "courses", recordCount: 2 }]);
	});

	it("hides soft-deleted components", async () => {
		await saveHero(db);
		const component = [...db.components.values()][0];
		component.deletedAt = new Date();
		const summary = await listLibrary(db.stub as unknown as PrismaDb, {
			projectId: PROJECT,
		});
		expect(summary.components).toEqual([]);
	});
});

describe("publishTurnComponentDrafts", () => {
	let db: ReturnType<typeof makePrismaStub>;
	let env: ReturnType<typeof makeEnv>;

	beforeEach(() => {
		db = makePrismaStub();
		env = makeEnv();
	});

	it("publishes the latest draft per component and reports failures without aborting", async () => {
		const hero = (await saveHero(db)) as Extract<
			SaveComponentDraftResult,
			{ ok: true }
		>;
		const card = (await saveComponentDraft(db.stub as unknown as PrismaDb, {
			projectId: PROJECT,
			input: {
				name: "Card",
				tagName: "tb-card",
				js: COMPONENT_JS.replace("tb-hero", "tb-card"),
			},
		})) as Extract<SaveComponentDraftResult, { ok: true }>;
		// Corrupt the card draft so its publish fails validation — the hero
		// publish must still go through.
		const cardVersion = db.versions.get(card.versionId);
		if (!cardVersion) throw new Error("missing card version");
		cardVersion.js = "const x = 1;";

		const outcome = await publishTurnComponentDrafts(
			db.stub as unknown as PrismaDb,
			env,
			{
				turnId: "turn-1",
				drafts: [
					{ componentId: hero.componentId, versionId: hero.versionId },
					{ componentId: card.componentId, versionId: card.versionId },
				],
			},
		);
		expect(outcome.published).toEqual([
			{ componentId: hero.componentId, version: 1, repinned: 0 },
		]);
		expect(outcome.failed).toHaveLength(1);
		expect(outcome.failed[0].error).toContain("component draft rejected");
		// The hero version flipped to published; the card stayed draft.
		expect(db.versions.get(hero.versionId)?.status).toBe("published");
		expect(db.components.get(hero.componentId)?.publishedVersionId).toBe(
			hero.versionId,
		);
		expect(db.versions.get(card.versionId)?.status).toBe("draft");
	});

	it("collapses repeated saves to the last draft version", async () => {
		const first = (await saveHero(db)) as Extract<
			SaveComponentDraftResult,
			{ ok: true }
		>;
		const second = (await saveHero(db, {
			changeNote: "v2",
		})) as Extract<SaveComponentDraftResult, { ok: true }>;

		const outcome = await publishTurnComponentDrafts(
			db.stub as unknown as PrismaDb,
			env,
			{
				turnId: "turn-1",
				drafts: [
					{ componentId: first.componentId, versionId: first.versionId },
					{ componentId: second.componentId, versionId: second.versionId },
				],
			},
		);
		expect(outcome.published).toEqual([
			{ componentId: second.componentId, version: 2, repinned: 0 },
		]);
		expect(outcome.failed).toEqual([]);
		// v1 was never published (deduped): it remains an orphan draft while
		// v2 is the component's single published version.
		expect(db.versions.get(first.versionId)?.status).toBe("draft");
		expect(db.versions.get(second.versionId)?.status).toBe("published");
	});

	it("re-points the just-retired version's page blocks and template slots", async () => {
		const hero = (await saveHero(db)) as Extract<
			SaveComponentDraftResult,
			{ ok: true }
		>;
		// Publish v1, then seed pins: a page block and a template slot pin
		// v1 (the live version), another page block pins an unrelated OLDER
		// version id (a retired v0 that a previous turn never re-pointed).
		await publishTurnComponentDrafts(db.stub as unknown as PrismaDb, env, {
			turnId: "turn-1",
			drafts: [{ componentId: hero.componentId, versionId: hero.versionId }],
		});
		db.pageBlocks.set("block-live", {
			id: "block-live",
			pageId: "page-1",
			ordinal: 0,
			componentVersionId: hero.versionId,
		});
		db.templateSlots.set("slot-live", {
			id: "slot-live",
			templateId: "tpl-1",
			ordinal: 0,
			componentVersionId: hero.versionId,
		});
		const staleVersion = {
			id: "v-stale-0",
			componentId: hero.componentId,
			version: 0,
			status: "retired",
			js: COMPONENT_JS,
			html: null,
			css: null,
			shadowMode: "light",
			apiSchema: null,
			defaults: null,
			changeNote: null,
			createdTurnId: null,
		};
		db.versions.set(staleVersion.id, staleVersion);
		db.pageBlocks.set("block-old", {
			id: "block-old",
			pageId: "page-2",
			ordinal: 0,
			componentVersionId: staleVersion.id,
		});

		// This turn saves and publishes v2 — retiring v1.
		const second = await saveHero(db, { changeNote: "v2" });
		const outcome = await publishTurnComponentDrafts(
			db.stub as unknown as PrismaDb,
			env,
			{
				turnId: "turn-1",
				drafts: [
					{
						componentId: hero.componentId,
						versionId: (second as { versionId: string }).versionId,
					},
				],
			},
		);
		expect(outcome.published).toEqual([
			{
				componentId: hero.componentId,
				version: 2,
				repinned: 2,
			},
		]);
		// The retired v1's pins moved to v2 — the turn repaired its own
		// fallout so the next publication still renders the blocks.
		expect(db.pageBlocks.get("block-live")?.componentVersionId).toBe(
			(second as { versionId: string }).versionId,
		);
		expect(db.templateSlots.get("slot-live")?.componentVersionId).toBe(
			(second as { versionId: string }).versionId,
		);
		// The unrelated older pin is untouched (manual re-pin model).
		expect(db.pageBlocks.get("block-old")?.componentVersionId).toBe(
			staleVersion.id,
		);
	});
});

describe("componentDraftPreviewBase", () => {
	it("matches the library demo-doc lookup contract", () => {
		// save_component uploads the harness under draftFileName(BASE) and
		// component-library resolves demoDocUrl from draftFileName(BASE) —
		// both sides call THIS helper, so the names must agree for the same
		// (name, version) pair. A suffix here would break the Demo link.
		const base = componentDraftPreviewBase("My Pricing Card", 3);
		expect(base).toBe("My Pricing Card-v3");
		expect(draftFileName(base)).toBe(draftFileName(base));
		expect(draftFileName(base)).toBe("my-pricing-card-v3.html");
	});

	it("truncates long library names to the shared cap", () => {
		const base = componentDraftPreviewBase("x".repeat(80), 1);
		expect(base).toBe(`${"x".repeat(40)}-v1`);
	});
});

describe("componentPreviewHtml", () => {
	it("embeds the fragment, css and escaped element source", () => {
		const html = componentPreviewHtml({
			js: 'class TbX extends HTMLElement { connectedCallback() { this.innerHTML = "</script><script>x</script>"; } }\ncustomElements.define("tb-x", TbX);',
			css: "p { color: red }",
			html: "<tb-x></tb-x>",
		});
		expect(html).toContain("<tb-x></tb-x>");
		expect(html).toContain("p { color: red }");
		// Literal </script inside the source cannot terminate the embedding
		// script early.
		expect(html).toContain("<\\/script");
		expect(html).not.toMatch(/<\/script><script>x/);
		expect(html).toContain('customElements.define("tb-x", TbX);');
	});

	it("runs the runtime error bridge in its own script tag before the element source", () => {
		const html = componentPreviewHtml({
			js: 'customElements.define("tb-x", class extends HTMLElement {});',
		});
		// The collector is what both the smoke test (window.__tbHarness) and
		// the in-chat test drive (postMessage) read — it must survive even a
		// syntax error in the component source, hence its own script tag.
		expect(html).toContain("window.__tbHarness");
		const bridgeIndex = html.indexOf("window.__tbHarness");
		const sourceIndex = html.indexOf('customElements.define("tb-x"');
		expect(bridgeIndex).toBeLessThan(sourceIndex);
		const scriptTags = html.match(/<script>/g)?.length ?? 0;
		expect(scriptTags).toBe(2);
	});

	it("escapes the document title", () => {
		// Model-supplied names interpolate into <title> — markup injection
		// there must not reach the document head.
		const html = buildComponentHarnessDoc({
			js: 'customElements.define("tb-x", class extends HTMLElement {});',
			title: "Evil</title><script>alert(1)</script>",
		});
		expect(html).toContain(
			"<title>Evil&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;</title>",
		);
		expect(html).toContain('customElements.define("tb-x"');
	});

	it("installs the collector even when the fragment owns the __tbHarness window name", () => {
		// Browsers expose elements with IDs as named window properties: a
		// statically valid `<div id="__tbHarness">` must not suppress the
		// bridge (a truthiness guard would skip the install and the smoke
		// evaluator would then read an empty error list).
		const html = buildComponentHarnessDoc({
			js: 'console.error("should be captured");\ncustomElements.define("tb-x", class extends HTMLElement {});',
			html: '<div id="__tbHarness"></div>',
		});
		expect(html).toContain('id="__tbHarness"');
		// No early-return guard on the window property.
		expect(html).not.toMatch(/if\s*\(\s*window\.__tbHarness\s*\)\s*return/);
		// The install is an unconditional assignment: an own property
		// shadows the named-property element in every browser.
		expect(html).toMatch(/window\.__tbHarness\s*=\s*\{\s*errors:\s*\[\]/);
	});
});
