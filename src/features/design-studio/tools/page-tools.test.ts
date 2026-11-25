// Unit tests for the KUK-925 agent-tool operations (page-tools.ts). A small
// in-memory prisma stub implements exactly the reads/writes the operations
// perform (same stub style as component-tools.test.ts): the client type is
// derived from the functions' parameters and the stub is cast — no runtime
// mock needed.
import { beforeEach, describe, expect, it } from "vitest";
import {
	bindDataTool,
	composePageTool,
	defineFlowTool,
	defineTemplateTool,
	listPagesTool,
	type PageToolFailure,
} from "./page-tools";

type PrismaDb = Parameters<typeof composePageTool>[0];

const PROJECT = "proj-1";

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
	apiSchema: string | null;
	defaults: string | null;
};

type PageRow = {
	id: string;
	projectId: string;
	designId: string | null;
	path: string;
	title: string;
	status: string;
};

type PageBlockRow = {
	id: string;
	pageId: string;
	ordinal: number;
	componentVersionId: string | null;
	templateId: string | null;
	sourceHtml: string | null;
	propsOverrides: string | null;
	dataBindings: string | null;
};

type TemplateRow = { id: string; projectId: string; name: string };
type TemplateSlotRow = {
	id: string;
	templateId: string;
	ordinal: number;
	componentVersionId: string | null;
	propsOverrides: string | null;
};
type FlowRow = { id: string; projectId: string; name: string };
type FlowStepRow = {
	id: string;
	flowId: string;
	ordinal: number;
	pageId: string;
	entryAction: string | null;
	exitTarget: string | null;
};
type CollectionRow = { id: string; projectId: string; name: string };

/**
 * In-memory prisma stub: rows live in Maps keyed by id; the query methods
 * implement exactly the shapes page-tools.ts issues (unique-by-composite-key
 * lookups, in-list scans, _count selects for listPagesTool).
 */
function makePrismaStub() {
	const components = new Map<string, ComponentRow>();
	const versions = new Map<string, VersionRow>();
	const pages = new Map<string, PageRow>();
	const blocks = new Map<string, PageBlockRow>();
	const templates = new Map<string, TemplateRow>();
	const templateSlots = new Map<string, TemplateSlotRow>();
	const flows = new Map<string, FlowRow>();
	const flowSteps = new Map<string, FlowStepRow>();
	const collections = new Map<string, CollectionRow>();
	let seq = 0;

	const byProjectName = <T extends { projectId: string; name: string }>(
		map: Map<string, T>,
		projectId: string,
		name: string,
	): T | null => {
		for (const row of map.values()) {
			if (row.projectId === projectId && row.name === name) return row;
		}
		return null;
	};

	const stub = {
		component: {
			async findUnique(args: {
				where: { projectId_name: { projectId: string; name: string } };
			}) {
				return byProjectName(
					components,
					args.where.projectId_name.projectId,
					args.where.projectId_name.name,
				);
			},
		},
		componentVersion: {
			async findFirst(args: {
				where: { componentId: string; version: number };
			}) {
				for (const row of versions.values()) {
					if (
						row.componentId === args.where.componentId &&
						row.version === args.where.version
					) {
						return row;
					}
				}
				return null;
			},
			async findUnique(args: { where: { id: string } }) {
				return versions.get(args.where.id) ?? null;
			},
			async findMany(args: {
				where: { id: { in: string[] } };
				select?: { id?: boolean; apiSchema?: boolean; component?: unknown };
			}) {
				return [...versions.values()]
					.filter((row) => args.where.id.in.includes(row.id))
					.map((row) => ({
						id: row.id,
						apiSchema: row.apiSchema,
						...(args.select?.component
							? {
									component: {
										tagName: components.get(row.componentId)?.tagName ?? "",
									},
								}
							: {}),
					}));
			},
		},
		page: {
			async findUnique(args: {
				where: { projectId_path: { projectId: string; path: string } };
			}) {
				for (const row of pages.values()) {
					if (
						row.projectId === args.where.projectId_path.projectId &&
						row.path === args.where.projectId_path.path
					) {
						return row;
					}
				}
				return null;
			},
			async findMany(args: {
				where: { projectId: string; path?: { in: string[] } };
				select?: { _count?: { select: { blocks: true } } };
			}) {
				const rows = [...pages.values()].filter(
					(row) =>
						row.projectId === args.where.projectId &&
						(!args.where.path || args.where.path.in.includes(row.path)),
				);
				if (args.select?._count) {
					return rows.map((row) => ({
						...row,
						_count: {
							blocks: [...blocks.values()].filter(
								(block) => block.pageId === row.id,
							).length,
						},
					}));
				}
				return rows;
			},
			async create(args: { data: Partial<PageRow> }) {
				const row = {
					id: `page-${++seq}`,
					projectId: "",
					designId: null,
					path: "/",
					title: "",
					status: "draft",
					...args.data,
				} as PageRow;
				pages.set(row.id, row);
				return row;
			},
			async update(args: { where: { id: string }; data: Partial<PageRow> }) {
				const row = pages.get(args.where.id);
				if (row) Object.assign(row, args.data);
				return row;
			},
			async delete(args: { where: { id: string } }) {
				const row = pages.get(args.where.id) ?? null;
				pages.delete(args.where.id);
				return row;
			},
		},
		pageBlock: {
			async findUnique(args: {
				where: { pageId_ordinal: { pageId: string; ordinal: number } };
			}) {
				for (const row of blocks.values()) {
					if (
						row.pageId === args.where.pageId_ordinal.pageId &&
						row.ordinal === args.where.pageId_ordinal.ordinal
					) {
						return row;
					}
				}
				return null;
			},
			async update(args: {
				where: { id: string };
				data: Partial<PageBlockRow>;
			}) {
				const row = blocks.get(args.where.id);
				if (row) Object.assign(row, args.data);
				return row;
			},
		},
		template: {
			async findUnique(args: {
				where: { projectId_name: { projectId: string; name: string } };
			}) {
				return byProjectName(
					templates,
					args.where.projectId_name.projectId,
					args.where.projectId_name.name,
				);
			},
			async create(args: { data: { projectId: string; name: string } }) {
				const row = { id: `tpl-${++seq}`, ...args.data };
				templates.set(row.id, row);
				return row;
			},
			async delete(args: { where: { id: string } }) {
				const row = templates.get(args.where.id) ?? null;
				templates.delete(args.where.id);
				return row;
			},
			async findMany(args: { where: { projectId: string } }) {
				return [...templates.values()]
					.filter((row) => row.projectId === args.where.projectId)
					.map((row) => ({
						name: row.name,
						_count: {
							slots: [...templateSlots.values()].filter(
								(slot) => slot.templateId === row.id,
							).length,
						},
					}));
			},
		},
		templateSlot: {
			async findMany(args: { where: { templateId: string } }) {
				return [...templateSlots.values()]
					.filter((row) => row.templateId === args.where.templateId)
					.sort((a, b) => a.ordinal - b.ordinal)
					.map((row) => ({
						ordinal: row.ordinal,
						componentVersionId: row.componentVersionId,
						propsOverrides: row.propsOverrides,
					}));
			},
		},
		flow: {
			async findUnique(args: {
				where: { projectId_name: { projectId: string; name: string } };
			}) {
				return byProjectName(
					flows,
					args.where.projectId_name.projectId,
					args.where.projectId_name.name,
				);
			},
			async create(args: { data: { projectId: string; name: string } }) {
				const row = { id: `flow-${++seq}`, ...args.data };
				flows.set(row.id, row);
				return row;
			},
			async delete(args: { where: { id: string } }) {
				const row = flows.get(args.where.id) ?? null;
				flows.delete(args.where.id);
				return row;
			},
			async findMany(args: { where: { projectId: string } }) {
				return [...flows.values()]
					.filter((row) => row.projectId === args.where.projectId)
					.map((row) => ({
						name: row.name,
						_count: {
							steps: [...flowSteps.values()].filter(
								(step) => step.flowId === row.id,
							).length,
						},
					}));
			},
		},
		dataCollection: {
			async findMany(args: {
				where: { projectId: string; name: { in: string[] } };
			}) {
				return [...collections.values()].filter(
					(row) =>
						row.projectId === args.where.projectId &&
						args.where.name.in.includes(row.name),
				);
			},
		},
	};
	const fakeD1 = makeFakeD1({ blocks, templateSlots, flowSteps });
	return {
		stub,
		components,
		versions,
		pages,
		blocks,
		templates,
		templateSlots,
		flows,
		flowSteps,
		collections,
		/**
		 * Fake raw D1Database for the atomic replace-all batches: prepare()
		 * .bind() captures SQL+params, batch() validates ALL statements first
		 * (unique constraints) then applies — modeling D1's atomic batches (a
		 * throw applies nothing; the snapshot is restored). `breakNextBatch`
		 * forces the next batch to fail with an arbitrary error.
		 */
		d1: fakeD1.fake as unknown as D1Database,
		breakNextBatch: fakeD1.breakNextBatch,
	};
}

/**
 * Fake D1Database over the stub's row maps: applies the page-tools batch
 * shape (DELETE by parent column + INSERTs) with unique-constraint checks;
 * any throw rolls the whole batch back to the pre-batch snapshot.
 */
function makeFakeD1(maps: {
	blocks: Map<string, PageBlockRow>;
	templateSlots: Map<string, TemplateSlotRow>;
	flowSteps: Map<string, FlowStepRow>;
}) {
	let breakNextBatch: Error | null = null;
	let batchSeq = 0;
	const applyStatement = ({
		sql,
		params,
	}: {
		sql: string;
		params: unknown[];
	}) => {
		if (sql.startsWith('DELETE FROM "PageBlock"')) {
			const pageId = params[0] as string;
			for (const [id, row] of [...maps.blocks.entries()]) {
				if (row.pageId === pageId) maps.blocks.delete(id);
			}
		} else if (sql.startsWith('INSERT INTO "PageBlock"')) {
			const [
				id,
				pageId,
				ordinal,
				componentVersionId,
				templateId,
				sourceHtml,
				propsOverrides,
				dataBindings,
			] = params as [
				string,
				string,
				number,
				string | null,
				string | null,
				string | null,
				string | null,
				string | null,
			];
			if (
				[...maps.blocks.values()].some(
					(row) => row.pageId === pageId && row.ordinal === ordinal,
				)
			) {
				throw new Error(
					"UNIQUE constraint failed: PageBlock.pageId, PageBlock.ordinal",
				);
			}
			maps.blocks.set(id as string, {
				id: id as string,
				pageId,
				ordinal,
				componentVersionId,
				templateId,
				sourceHtml,
				propsOverrides,
				dataBindings,
			});
		} else if (sql.startsWith('DELETE FROM "TemplateSlot"')) {
			const templateId = params[0] as string;
			for (const [id, row] of [...maps.templateSlots.entries()]) {
				if (row.templateId === templateId) maps.templateSlots.delete(id);
			}
		} else if (sql.startsWith('INSERT INTO "TemplateSlot"')) {
			const [id, templateId, ordinal, componentVersionId, propsOverrides] =
				params as [string, string, number, string | null, string | null];
			if (
				[...maps.templateSlots.values()].some(
					(row) => row.templateId === templateId && row.ordinal === ordinal,
				)
			) {
				throw new Error(
					"UNIQUE constraint failed: TemplateSlot.templateId, TemplateSlot.ordinal",
				);
			}
			maps.templateSlots.set(id, {
				id,
				templateId,
				ordinal,
				componentVersionId,
				propsOverrides,
			});
		} else if (sql.startsWith('DELETE FROM "FlowStep"')) {
			const flowId = params[0] as string;
			for (const [id, row] of [...maps.flowSteps.entries()]) {
				if (row.flowId === flowId) maps.flowSteps.delete(id);
			}
		} else if (sql.startsWith('INSERT INTO "FlowStep"')) {
			const [id, flowId, ordinal, pageId, entryAction, exitTarget] = params as [
				string,
				string,
				number,
				string,
				string | null,
				string | null,
			];
			if (
				[...maps.flowSteps.values()].some(
					(row) => row.flowId === flowId && row.ordinal === ordinal,
				)
			) {
				throw new Error(
					"UNIQUE constraint failed: FlowStep.flowId, FlowStep.ordinal",
				);
			}
			maps.flowSteps.set(id, {
				id,
				flowId,
				ordinal,
				pageId,
				entryAction,
				exitTarget,
			});
		} else {
			throw new Error(`fake D1: unsupported statement ${sql}`);
		}
	};
	const fake = {
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
			const snapshot = {
				blocks: new Map(maps.blocks),
				templateSlots: new Map(maps.templateSlots),
				flowSteps: new Map(maps.flowSteps),
			};
			try {
				for (const statement of statements) {
					applyStatement(statement);
				}
			} catch (error) {
				maps.blocks.clear();
				maps.templateSlots.clear();
				maps.flowSteps.clear();
				for (const [id, row] of snapshot.blocks) maps.blocks.set(id, row);
				for (const [id, row] of snapshot.templateSlots) {
					maps.templateSlots.set(id, row);
				}
				for (const [id, row] of snapshot.flowSteps) {
					maps.flowSteps.set(id, row);
				}
				throw error;
			}
			batchSeq += statements.length;
			return statements.map(() => ({ meta: { changes: 1, seq: batchSeq } }));
		},
	};
	return { fake, breakNextBatch: (error: Error) => fake.breakNextBatch(error) };
}

type Db = ReturnType<typeof makePrismaStub>;
const run = (db: Db) => db.stub as unknown as PrismaDb;

/** Directly seeds a library component (page-tools tests don't save drafts). */
function addComponent(
	db: Db,
	options: {
		name: string;
		tagName?: string;
		versions?: Array<{ version: number; status: string; apiSchema?: string }>;
		publishedVersion?: number;
		deleted?: boolean;
	},
): void {
	const component: ComponentRow = {
		id: `comp-${options.name}`,
		projectId: PROJECT,
		name: options.name,
		kind: "section",
		tagName: options.tagName ?? `tb-${options.name.toLowerCase()}`,
		publishedVersionId: null,
		createdTurnId: null,
		deletedAt: options.deleted ? new Date() : null,
	};
	for (const v of options.versions ?? []) {
		const row: VersionRow = {
			id: `v-${options.name}-${v.version}`,
			componentId: component.id,
			version: v.version,
			status: v.status,
			apiSchema: v.apiSchema ?? null,
			defaults: null,
		};
		db.versions.set(row.id, row);
		if (v.status === "published") {
			component.publishedVersionId = row.id;
		}
	}
	db.components.set(component.id, component);
}

function addCollection(db: Db, name: string): void {
	db.collections.set(`coll-${name}`, {
		id: `coll-${name}`,
		projectId: PROJECT,
		name,
	});
}

const HERO_SCHEMA = JSON.stringify({
	attributes: { heading: { type: "string" }, note: { type: "string" } },
});

describe("composePageTool", () => {
	let db: Db;

	beforeEach(() => {
		db = makePrismaStub();
		addComponent(db, {
			name: "Hero",
			versions: [
				{ version: 1, status: "published", apiSchema: HERO_SCHEMA },
				{ version: 2, status: "draft" },
			],
		});
		addComponent(db, {
			name: "Draft",
			versions: [{ version: 1, status: "draft" }],
		});
		addCollection(db, "courses");
	});

	const compose = (
		overrides: Partial<Parameters<typeof composePageTool>[2]> = {},
	) =>
		composePageTool(run(db), db.d1, {
			projectId: PROJECT,
			designId: "design-1",
			path: "/",
			title: "Home",
			blocks: [{ component: { name: "Hero" } }],
			...overrides,
		});

	it("creates a page pinning the component's default published version", async () => {
		const result = await compose();
		expect(result).toEqual({
			ok: true,
			page: {
				id: expect.any(String),
				path: "/",
				title: "Home",
				status: "draft",
				created: true,
			},
			blocks: [
				{
					ordinal: 0,
					kind: "component",
					component: "Hero",
					tagName: "tb-hero",
					version: 1,
				},
			],
		});
		const page = [...db.pages.values()][0];
		expect(page).toMatchObject({
			projectId: PROJECT,
			designId: "design-1",
			path: "/",
			title: "Home",
			status: "draft",
		});
		const block = [...db.blocks.values()][0];
		expect(block).toMatchObject({
			pageId: page.id,
			ordinal: 0,
			componentVersionId: "v-Hero-1",
			templateId: null,
			sourceHtml: null,
		});
	});

	it("updates the title on re-compose and keeps a published page published", async () => {
		await compose();
		const result = await compose({
			title: "Home sweet home",
			publish: false,
		});
		expect(result).toMatchObject({
			ok: true,
			page: { created: false, title: "Home sweet home", status: "draft" },
		});
		expect(db.pages.size).toBe(1);
	});

	it("replace-all: re-composing rewrites the blocks at array ordinals", async () => {
		await compose({
			blocks: [
				{ component: { name: "Hero" } },
				{ sourceHtml: "<footer>old</footer>" },
			],
		});
		const result = await compose({
			blocks: [{ sourceHtml: "<main>fresh</main>" }],
		});
		expect(result).toMatchObject({ ok: true });
		expect([...db.blocks.values()]).toHaveLength(1);
		const block = [...db.blocks.values()][0];
		expect(block).toMatchObject({
			ordinal: 0,
			sourceHtml: "<main>fresh</main>",
			componentVersionId: null,
		});
	});

	it("pins an explicit published version and rejects a retired one", async () => {
		const result = await compose({
			blocks: [{ component: { name: "Hero", version: 1 } }],
		});
		expect(result).toMatchObject({
			ok: true,
			blocks: [{ version: 1, kind: "component" }],
		});
		// Retire v1 the way a replacing publish would (v2 becomes the live
		// published version): the pin is now rejected — compose renders only
		// "published" rows, so a retired pin would be silently omitted from
		// publications. The error points at the currently published version.
		const v1 = db.versions.get("v-Hero-1");
		const v2 = db.versions.get("v-Hero-2");
		if (!v1 || !v2) throw new Error("missing hero version fixtures");
		v1.status = "retired";
		v2.status = "published";
		const hero = db.components.get("comp-Hero");
		if (!hero) throw new Error("missing hero component fixture");
		hero.publishedVersionId = "v-Hero-2";
		const retired = await compose({
			blocks: [{ component: { name: "Hero", version: 1 } }],
		});
		expect(retired).toMatchObject({
			ok: false,
			errors: [
				expect.stringContaining(
					'component "Hero" version 1 is retired and cannot render — pin version 2 (the currently published one) or omit version to use it',
				),
			],
		});
		// The currently published version still resolves (explicit and default).
		const explicit = await compose({
			blocks: [{ component: { name: "Hero", version: 2 } }],
		});
		expect(explicit).toMatchObject({ ok: true, blocks: [{ version: 2 }] });
		const published = await compose({
			blocks: [{ component: { name: "Hero" } }],
		});
		expect(published).toMatchObject({ ok: true, blocks: [{ version: 2 }] });
	});

	it("rejects a retired version when nothing is published anymore", async () => {
		addComponent(db, {
			name: "Old",
			versions: [{ version: 1, status: "retired" }],
		});
		const result = await compose({
			blocks: [{ component: { name: "Old", version: 1 } }],
		});
		expect(result).toMatchObject({
			ok: false,
			errors: [
				expect.stringContaining(
					"version 1 is retired and cannot render — publish the component first",
				),
			],
		});
	});

	it("rejects pinning a draft version with a clear error", async () => {
		const result = await compose({
			blocks: [{ component: { name: "Hero", version: 2 } }],
		});
		expect(result).toMatchObject({
			ok: false,
			status: 400,
			errors: [
				expect.stringContaining('component "Hero" version 2 is a draft'),
			],
		});
		expect(db.blocks.size).toBe(0);
	});

	it("409-style error when the component has no published version", async () => {
		const result = await compose({
			blocks: [{ component: { name: "Draft" } }],
		});
		expect(result).toMatchObject({
			ok: false,
			status: 400,
			errors: [
				expect.stringContaining(
					'component "Draft" has no published version — publish the component first',
				),
			],
		});
	});

	it("rejects unknown and soft-deleted components", async () => {
		const unknown = await compose({
			blocks: [{ component: { name: "Nope" } }],
		});
		expect(unknown).toMatchObject({
			ok: false,
			errors: [expect.stringContaining('unknown component "Nope"')],
		});
		addComponent(db, { name: "Gone", deleted: true });
		const deleted = await compose({
			blocks: [{ component: { name: "Gone" } }],
		});
		expect(deleted).toMatchObject({
			ok: false,
			errors: [expect.stringContaining('unknown component "Gone"')],
		});
	});

	it("rejects an unknown template and validates a known one", async () => {
		const unknown = await compose({
			blocks: [{ template: "Landing" }],
		});
		expect(unknown).toMatchObject({
			ok: false,
			errors: [expect.stringContaining('unknown template "Landing"')],
		});
		await defineTemplateTool(run(db), db.d1, {
			projectId: PROJECT,
			name: "Landing",
			slots: [{ component: { name: "Hero" } }],
		});
		const known = await compose({
			blocks: [{ template: "Landing", propsOverrides: { heading: "Hi" } }],
		});
		expect(known).toMatchObject({
			ok: true,
			blocks: [{ ordinal: 0, kind: "template", template: "Landing" }],
		});
		const block = [...db.blocks.values()][0];
		expect(block).toMatchObject({
			templateId: expect.any(String),
			propsOverrides: JSON.stringify({ heading: "Hi" }),
		});
	});

	it("validates template-block overrides against every slot's pinned apiSchema", async () => {
		await defineTemplateTool(run(db), db.d1, {
			projectId: PROJECT,
			name: "Landing",
			slots: [
				// Slot 0: pinned version declares heading as a string attribute.
				{ component: { name: "Hero" }, propsOverrides: { heading: "Top" } },
				{ component: { name: "Hero" } },
			],
		});

		// A bad block-level value merges into the slot's set (block wins) and
		// must be rejected here — compose would otherwise error and
		// createPublication would reject the whole publication.
		const nonString = await compose({
			blocks: [{ template: "Landing", propsOverrides: { heading: 5 } }],
		});
		expect(nonString).toMatchObject({
			ok: false,
			status: 400,
			errors: [
				// The override merges into EVERY slot — both are reported.
				expect.stringContaining(
					'blocks[0] (template "Landing" slot 0): attribute "heading" must be a string',
				),
				expect.stringContaining(
					'blocks[0] (template "Landing" slot 1): attribute "heading" must be a string',
				),
			],
		});
		const unknownKey = await compose({
			blocks: [{ template: "Landing", propsOverrides: { bogus: "x" } }],
		});
		expect(unknownKey).toMatchObject({
			ok: false,
			errors: [
				expect.stringContaining(
					'blocks[0] (template "Landing" slot 0): unknown attribute "bogus" for component "tb-hero"',
				),
				expect.stringContaining(
					'blocks[0] (template "Landing" slot 1): unknown attribute "bogus" for component "tb-hero"',
				),
			],
		});
		// Nothing was written on rejection.
		expect(db.blocks.size).toBe(0);

		// A valid override passes and is stored as the block's own overrides.
		const valid = await compose({
			blocks: [
				{ template: "Landing", propsOverrides: { heading: "Block wins" } },
			],
		});
		expect(valid).toMatchObject({ ok: true });
		const block = [...db.blocks.values()][0];
		expect(block.propsOverrides).toBe(
			JSON.stringify({ heading: "Block wins" }),
		);
	});

	it("tolerates overrides on slots whose pinned version has no apiSchema", async () => {
		addComponent(db, {
			name: "Plain",
			versions: [{ version: 1, status: "published" }],
		});
		await defineTemplateTool(run(db), db.d1, {
			projectId: PROJECT,
			name: "Bare",
			slots: [{ component: { name: "Plain" } }],
		});
		// No attributes key → key names unconstrained (compose tolerance);
		// any plain object passes.
		const result = await compose({
			blocks: [{ template: "Bare", propsOverrides: { anything: "goes" } }],
		});
		expect(result).toMatchObject({
			ok: true,
			blocks: [{ kind: "template", template: "Bare" }],
		});
		// Non-string values are still rejected — compose errors on them at
		// render, which would fail a publication.
		const nonString = await compose({
			blocks: [{ template: "Bare", propsOverrides: { anything: 5 } }],
		});
		expect(nonString).toMatchObject({
			ok: false,
			errors: [
				expect.stringContaining(
					'blocks[0] (template "Bare" slot 0): attribute "anything" must be a string',
				),
			],
		});
	});

	it("rejects empty sourceHtml and multi/absent sources", async () => {
		const empty = await compose({ blocks: [{ sourceHtml: "   " }] });
		expect(empty).toMatchObject({
			ok: false,
			errors: [
				expect.stringContaining("sourceHtml must be a non-empty HTML string"),
			],
		});
		const multi = await compose({
			blocks: [{ component: { name: "Hero" }, template: "Landing" }],
		});
		expect(multi).toMatchObject({
			ok: false,
			errors: [
				expect.stringContaining("multiple sources (component, template)"),
			],
		});
		const none = await compose({ blocks: [{ propsOverrides: {} }] });
		expect(none).toMatchObject({
			ok: false,
			errors: [expect.stringContaining("no source — set exactly one")],
		});
	});

	it("rejects unknown or non-string propsOverrides attributes against the apiSchema", async () => {
		const unknown = await compose({
			blocks: [{ component: { name: "Hero" }, propsOverrides: { bogus: "x" } }],
		});
		expect(unknown).toMatchObject({
			ok: false,
			errors: [
				expect.stringContaining(
					'unknown attribute "bogus" for component "tb-hero"',
				),
			],
		});
		const nonString = await compose({
			blocks: [{ component: { name: "Hero" }, propsOverrides: { heading: 5 } }],
		});
		expect(nonString).toMatchObject({
			ok: false,
			errors: [expect.stringContaining('attribute "heading" must be a string')],
		});
	});

	it("stores valid propsOverrides and dataBindings on component blocks", async () => {
		const result = await compose({
			blocks: [
				{
					component: { name: "Hero" },
					propsOverrides: { heading: "Welcome" },
					dataBindings: { items: { collection: "courses", limit: 6 } },
				},
			],
		});
		expect(result).toMatchObject({ ok: true });
		const block = [...db.blocks.values()][0];
		expect(block.propsOverrides).toBe(JSON.stringify({ heading: "Welcome" }));
		expect(block.dataBindings).toBe(
			JSON.stringify({ items: { collection: "courses", limit: 6 } }),
		);
	});

	it("rejects an unknown data collection", async () => {
		const result = await compose({
			blocks: [
				{
					component: { name: "Hero" },
					dataBindings: { items: { collection: "ghosts" } },
				},
			],
		});
		expect(result).toMatchObject({
			ok: false,
			errors: [
				expect.stringContaining(
					'unknown data collection "ghosts" — seed it with seed_data first',
				),
			],
		});
		expect(db.blocks.size).toBe(0);
	});

	it("rejects data bindings / overrides on template and html blocks", async () => {
		await defineTemplateTool(run(db), db.d1, {
			projectId: PROJECT,
			name: "Landing",
			slots: [{ component: { name: "Hero" } }],
		});
		const templateBindings = await compose({
			blocks: [
				{
					template: "Landing",
					dataBindings: { items: { collection: "courses" } },
				},
			],
		});
		expect(templateBindings).toMatchObject({
			ok: false,
			errors: [
				expect.stringContaining(
					"data bindings on template blocks are not supported",
				),
			],
		});
		const htmlOverrides = await compose({
			blocks: [{ sourceHtml: "<p>x</p>", propsOverrides: { heading: "x" } }],
		});
		expect(htmlOverrides).toMatchObject({
			ok: false,
			errors: [
				expect.stringContaining(
					"propsOverrides only apply to component blocks",
				),
			],
		});
	});

	it("rejects a bad path/title and validates first (nothing written)", async () => {
		const badPath = await compose({ path: "pricing" });
		expect(badPath).toMatchObject({ ok: false, status: 400 });
		const badTitle = await compose({ title: "   " });
		expect(badTitle).toMatchObject({ ok: false, status: 400 });
		// Validation failure with an existing page: nothing is rewritten.
		await compose();
		const before = [...db.blocks.values()].map((b) => b.ordinal);
		const failed = await compose({ blocks: [{ component: { name: "Nope" } }] });
		expect((failed as PageToolFailure).ok).toBe(false);
		expect([...db.blocks.values()].map((b) => b.ordinal)).toEqual(before);
		expect(db.pages.size).toBe(1);
	});

	it("publish:true flips the page to published (create and update)", async () => {
		const created = await compose({ publish: true });
		expect(created).toMatchObject({
			ok: true,
			page: { status: "published", created: true },
		});
		const second = await compose({ path: "/pricing", publish: true });
		expect(second).toMatchObject({
			ok: true,
			page: { status: "published" },
		});
	});
});

describe("atomic replace-all writes (D1 batch)", () => {
	let db: Db;

	beforeEach(() => {
		db = makePrismaStub();
		addComponent(db, {
			name: "Hero",
			versions: [{ version: 1, status: "published" }],
		});
	});

	it("a failed compose batch leaves the previous blocks fully intact", async () => {
		await composePageTool(run(db), db.d1, {
			projectId: PROJECT,
			path: "/",
			title: "Home",
			blocks: [
				{ component: { name: "Hero" } },
				{ sourceHtml: "<footer>keep</footer>" },
			],
		});
		const before = [...db.blocks.values()].map((b) => b.ordinal);
		db.breakNextBatch(new Error("D1 write failed"));
		await expect(
			composePageTool(run(db), db.d1, {
				projectId: PROJECT,
				path: "/",
				title: "Home",
				blocks: [{ sourceHtml: "<main>fresh</main>" }],
			}),
		).rejects.toThrow("D1 write failed");
		// Nothing was deleted or half-inserted: the two original blocks
		// survive untouched (the batch's rollback restored the snapshot).
		expect([...db.blocks.values()].map((b) => b.ordinal)).toEqual(before);
		expect([...db.blocks.values()].find((b) => b.ordinal === 0)).toMatchObject({
			componentVersionId: "v-Hero-1",
		});
	});

	it("a failed compose batch removes the page row it just created", async () => {
		db.breakNextBatch(new Error("D1 write failed"));
		await expect(
			composePageTool(run(db), db.d1, {
				projectId: PROJECT,
				path: "/",
				title: "Home",
				blocks: [{ component: { name: "Hero" } }],
			}),
		).rejects.toThrow("D1 write failed");
		// An interrupted compose never leaves a blockless page behind.
		expect(db.pages.size).toBe(0);
		expect(db.blocks.size).toBe(0);
	});

	it("an empty block list clears the page in one batch", async () => {
		await composePageTool(run(db), db.d1, {
			projectId: PROJECT,
			path: "/",
			title: "Home",
			blocks: [{ component: { name: "Hero" } }],
		});
		const result = await composePageTool(run(db), db.d1, {
			projectId: PROJECT,
			path: "/",
			title: "Home",
			blocks: [],
		});
		expect(result).toMatchObject({ ok: true });
		expect(db.blocks.size).toBe(0);
	});

	it("a failed template redefine leaves the previous slots intact", async () => {
		await defineTemplateTool(run(db), db.d1, {
			projectId: PROJECT,
			name: "Landing",
			slots: [{ component: { name: "Hero" } }, { component: { name: "Hero" } }],
		});
		db.breakNextBatch(new Error("D1 write failed"));
		await expect(
			defineTemplateTool(run(db), db.d1, {
				projectId: PROJECT,
				name: "Landing",
				slots: [{ component: { name: "Hero" } }],
			}),
		).rejects.toThrow("D1 write failed");
		expect([...db.templateSlots.values()].map((s) => s.ordinal)).toEqual([
			0, 1,
		]);
		expect(db.templates.size).toBe(1);
	});

	it("a failed flow redefine leaves the previous steps intact", async () => {
		await composePageTool(run(db), db.d1, {
			projectId: PROJECT,
			path: "/",
			title: "Home",
			blocks: [{ component: { name: "Hero" } }],
		});
		await defineFlowTool(run(db), db.d1, {
			projectId: PROJECT,
			name: "Onboarding",
			steps: [{ path: "/" }, { path: "/" }],
		});
		db.breakNextBatch(new Error("D1 write failed"));
		await expect(
			defineFlowTool(run(db), db.d1, {
				projectId: PROJECT,
				name: "Onboarding",
				steps: [{ path: "/" }],
			}),
		).rejects.toThrow("D1 write failed");
		expect([...db.flowSteps.values()].map((s) => s.ordinal)).toEqual([0, 1]);
		expect(db.flows.size).toBe(1);
	});
});

describe("bindDataTool", () => {
	let db: Db;

	beforeEach(() => {
		db = makePrismaStub();
		addComponent(db, {
			name: "Hero",
			versions: [{ version: 1, status: "published", apiSchema: HERO_SCHEMA }],
		});
		addCollection(db, "courses");
	});

	const bind = (overrides: Partial<Parameters<typeof bindDataTool>[1]> = {}) =>
		bindDataTool(run(db), {
			projectId: PROJECT,
			path: "/",
			ordinal: 0,
			bindings: { items: { collection: "courses" } },
			...overrides,
		});

	it("updates one component block's dataBindings", async () => {
		await composePageTool(run(db), db.d1, {
			projectId: PROJECT,
			path: "/",
			title: "Home",
			blocks: [{ component: { name: "Hero" } }, { sourceHtml: "<p>x</p>" }],
		});
		const result = await bind({
			bindings: { items: { collection: "courses", limit: 3 } },
		});
		expect(result).toMatchObject({ ok: true, ordinal: 0 });
		const block = [...db.blocks.values()].find(
			(b) => b.componentVersionId !== null,
		);
		expect(block?.dataBindings).toBe(
			JSON.stringify({ items: { collection: "courses", limit: 3 } }),
		);
	});

	it("404s for a missing page or block, rejects non-component blocks", async () => {
		const noPage = await bind({ path: "/missing" });
		expect(noPage).toMatchObject({
			ok: false,
			status: 404,
			errors: [expect.stringContaining('no page at path "/missing"')],
		});
		await composePageTool(run(db), db.d1, {
			projectId: PROJECT,
			path: "/",
			title: "Home",
			blocks: [{ sourceHtml: "<p>x</p>" }],
		});
		const noBlock = await bind({ ordinal: 5 });
		expect(noBlock).toMatchObject({ ok: false, status: 404 });
		const htmlBlock = await bind();
		expect(htmlBlock).toMatchObject({
			ok: false,
			status: 400,
			errors: [expect.stringContaining("not a component block")],
		});
	});

	it("rejects unknown collections without writing", async () => {
		await composePageTool(run(db), db.d1, {
			projectId: PROJECT,
			path: "/",
			title: "Home",
			blocks: [{ component: { name: "Hero" } }],
		});
		const result = await bind({
			bindings: { items: { collection: "ghosts" } },
		});
		expect(result).toMatchObject({
			ok: false,
			status: 400,
			errors: [expect.stringContaining('unknown data collection "ghosts"')],
		});
		const block = [...db.blocks.values()][0];
		expect(block.dataBindings).toBeNull();
	});
});

describe("defineTemplateTool", () => {
	let db: Db;

	beforeEach(() => {
		db = makePrismaStub();
		addComponent(db, {
			name: "Hero",
			versions: [{ version: 1, status: "published", apiSchema: HERO_SCHEMA }],
		});
	});

	it("creates a template with pinned slots at array ordinals", async () => {
		const result = await defineTemplateTool(run(db), db.d1, {
			projectId: PROJECT,
			name: "Landing",
			slots: [
				{
					component: { name: "Hero" },
					propsOverrides: { heading: "Top" },
				},
				{ component: { name: "Hero", version: 1 } },
			],
		});
		expect(result).toEqual({
			ok: true,
			template: { id: expect.any(String), name: "Landing", slotCount: 2 },
		});
		const slots = [...db.templateSlots.values()].sort(
			(a, b) => a.ordinal - b.ordinal,
		);
		expect(slots).toHaveLength(2);
		expect(slots[0]).toMatchObject({
			ordinal: 0,
			componentVersionId: "v-Hero-1",
			propsOverrides: JSON.stringify({ heading: "Top" }),
		});
		expect(slots[1]).toMatchObject({ ordinal: 1 });
	});

	it("redefine replaces all slots", async () => {
		await defineTemplateTool(run(db), db.d1, {
			projectId: PROJECT,
			name: "Landing",
			slots: [{ component: { name: "Hero" } }, { component: { name: "Hero" } }],
		});
		const result = await defineTemplateTool(run(db), db.d1, {
			projectId: PROJECT,
			name: "Landing",
			slots: [{ component: { name: "Hero" } }],
		});
		expect(result).toMatchObject({ ok: true, template: { slotCount: 1 } });
		expect([...db.templateSlots.values()]).toHaveLength(1);
		expect([...db.templates.values()]).toHaveLength(1);
	});

	it("validates first: an unknown component writes nothing", async () => {
		const result = await defineTemplateTool(run(db), db.d1, {
			projectId: PROJECT,
			name: "Landing",
			slots: [{ component: { name: "Hero" } }, { component: { name: "Nope" } }],
		});
		expect(result).toMatchObject({
			ok: false,
			errors: [expect.stringContaining('unknown component "Nope"')],
		});
		expect(db.templates.size).toBe(0);
		expect(db.templateSlots.size).toBe(0);
	});
});

describe("defineFlowTool", () => {
	let db: Db;

	beforeEach(() => {
		db = makePrismaStub();
		addComponent(db, {
			name: "Hero",
			versions: [{ version: 1, status: "published" }],
		});
	});

	async function seedPages() {
		await composePageTool(run(db), db.d1, {
			projectId: PROJECT,
			path: "/",
			title: "Home",
			blocks: [{ component: { name: "Hero" } }],
		});
		await composePageTool(run(db), db.d1, {
			projectId: PROJECT,
			path: "/pricing",
			title: "Pricing",
			blocks: [{ component: { name: "Hero" } }],
		});
	}

	it("creates a flow whose steps reference existing pages", async () => {
		await seedPages();
		const result = await defineFlowTool(run(db), db.d1, {
			projectId: PROJECT,
			name: "Onboarding",
			steps: [
				{ path: "/", exitTarget: "click .cta" },
				{ path: "/pricing", entryAction: "click .cta" },
			],
		});
		expect(result).toEqual({
			ok: true,
			flow: { id: expect.any(String), name: "Onboarding", stepCount: 2 },
		});
		const steps = [...db.flowSteps.values()].sort(
			(a, b) => a.ordinal - b.ordinal,
		);
		expect(steps[0]).toMatchObject({ ordinal: 0, exitTarget: "click .cta" });
		expect(steps[1]).toMatchObject({
			ordinal: 1,
			entryAction: "click .cta",
		});
	});

	it("rejects steps pointing at missing pages", async () => {
		await seedPages();
		const result = await defineFlowTool(run(db), db.d1, {
			projectId: PROJECT,
			name: "Onboarding",
			steps: [{ path: "/" }, { path: "/ghost" }],
		});
		expect(result).toMatchObject({
			ok: false,
			errors: [
				expect.stringContaining(
					'no page at path "/ghost" — compose it with compose_page first',
				),
			],
		});
		expect(db.flows.size).toBe(0);
		expect(db.flowSteps.size).toBe(0);
	});

	it("redefine replaces all steps", async () => {
		await seedPages();
		await defineFlowTool(run(db), db.d1, {
			projectId: PROJECT,
			name: "Onboarding",
			steps: [{ path: "/" }, { path: "/pricing" }],
		});
		const result = await defineFlowTool(run(db), db.d1, {
			projectId: PROJECT,
			name: "Onboarding",
			steps: [{ path: "/pricing" }],
		});
		expect(result).toMatchObject({ ok: true, flow: { stepCount: 1 } });
		expect([...db.flowSteps.values()]).toHaveLength(1);
		expect([...db.flows.values()]).toHaveLength(1);
	});
});

describe("listPagesTool", () => {
	let db: Db;

	beforeEach(() => {
		db = makePrismaStub();
		addComponent(db, {
			name: "Hero",
			versions: [{ version: 1, status: "published" }],
		});
	});

	it("summarizes pages, templates and flows with counts", async () => {
		await composePageTool(run(db), db.d1, {
			projectId: PROJECT,
			path: "/",
			title: "Home",
			blocks: [{ component: { name: "Hero" } }, { sourceHtml: "<p>x</p>" }],
		});
		await composePageTool(run(db), db.d1, {
			projectId: PROJECT,
			path: "/pricing",
			title: "Pricing",
			publish: true,
			blocks: [{ component: { name: "Hero" } }],
		});
		await defineTemplateTool(run(db), db.d1, {
			projectId: PROJECT,
			name: "Landing",
			slots: [{ component: { name: "Hero" } }, { component: { name: "Hero" } }],
		});
		await defineFlowTool(run(db), db.d1, {
			projectId: PROJECT,
			name: "Onboarding",
			steps: [{ path: "/" }, { path: "/pricing" }],
		});

		const summary = await listPagesTool(run(db), { projectId: PROJECT });
		expect(summary.pages).toEqual([
			{ path: "/", title: "Home", status: "draft", blockCount: 2 },
			{
				path: "/pricing",
				title: "Pricing",
				status: "published",
				blockCount: 1,
			},
		]);
		expect(summary.templates).toEqual([{ name: "Landing", slotCount: 2 }]);
		expect(summary.flows).toEqual([{ name: "Onboarding", stepCount: 2 }]);
	});

	it("returns empty lists for a fresh project", async () => {
		const summary = await listPagesTool(run(db), { projectId: PROJECT });
		expect(summary).toEqual({ pages: [], templates: [], flows: [] });
	});
});
