// Worker tests for the KUK-928 studio building-block tRPC surface: the page
// composer (designs.pages.list/create/update/delete/replaceBlocks), the
// project data collections + records (projects.data.*), templates
// (projects.templates.*) and flows (projects.flows.*) — all over real D1.
// Auth (UNAUTHORIZED/FORBIDDEN) for every procedure lives in
// authorization-matrix.test.ts; these tests cover behavior, fencing and the
// model-correctable validations.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type {
	DataCollections,
	DesignPages,
	Flows,
	Templates,
} from "@/client/api-types";
import { createAdminSession, type TestSession } from "../helpers/auth";
import { createDesign, createProject } from "../helpers/fixtures";
import {
	createTrpcTestClient,
	type TrpcTestClient,
	trpcErrorCode,
	trpcErrorMessage,
} from "../helpers/trpc";

const COMPONENT_JS =
	'class TbHero extends HTMLElement {\n\tconnectedCallback() {\n\t\tif (!this.hasAttribute("data-ssr")) this.innerHTML = "<p>hero</p>";\n\t}\n}\ncustomElements.define("tb-hero", TbHero);';

const nowIso = () => new Date().toISOString();

function adminClient(session: TestSession): TrpcTestClient {
	return createTrpcTestClient(session.headers);
}

async function seedComponent(
	projectId: string,
	overrides: {
		name?: string;
		tagName?: string;
		publishedVersionId?: string | null;
	} = {},
): Promise<string> {
	const id = crypto.randomUUID();
	await env.DB.prepare(
		`INSERT INTO "Component"
			(id, projectId, name, kind, tagName, publishedVersionId, deletedAt, createdAt, updatedAt)
			VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
	)
		.bind(
			id,
			projectId,
			overrides.name ?? "Hero",
			"section",
			overrides.tagName ?? "tb-hero",
			overrides.publishedVersionId ?? null,
			nowIso(),
			nowIso(),
		)
		.run();
	return id;
}

async function seedVersion(
	componentId: string,
	version: number,
	status: string,
): Promise<string> {
	const id = crypto.randomUUID();
	await env.DB.prepare(
		`INSERT INTO "ComponentVersion"
			(id, componentId, version, status, js, createdAt)
			VALUES (?, ?, ?, ?, ?, ?)`,
	)
		.bind(id, componentId, version, status, COMPONENT_JS, nowIso())
		.run();
	return id;
}

/** A component with one published version (v1) wired to publishedVersionId. */
async function seedPublishedComponent(
	projectId: string,
	name = "Hero",
	tagName = "tb-hero",
): Promise<{ componentId: string; versionId: string }> {
	const componentId = await seedComponent(projectId, { name, tagName });
	const versionId = await seedVersion(componentId, 1, "published");
	await env.DB.prepare(
		`UPDATE "Component" SET publishedVersionId = ? WHERE id = ?`,
	)
		.bind(versionId, componentId)
		.run();
	return { componentId, versionId };
}

async function seedPage(
	projectId: string,
	designId: string,
	path: string,
	title = `Page ${path}`,
): Promise<string> {
	const id = crypto.randomUUID();
	await env.DB.prepare(
		`INSERT INTO "Page"
			(id, projectId, designId, path, title, status, createdAt, updatedAt)
			VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)`,
	)
		.bind(id, projectId, designId, path, title, nowIso(), nowIso())
		.run();
	return id;
}

async function seedBlock(
	pageId: string,
	ordinal: number,
	fields: {
		componentVersionId?: string | null;
		templateId?: string | null;
		sourceHtml?: string | null;
		propsOverrides?: string | null;
		dataBindings?: string | null;
	} = {},
): Promise<string> {
	const id = crypto.randomUUID();
	await env.DB.prepare(
		`INSERT INTO "PageBlock"
			(id, pageId, ordinal, componentVersionId, templateId, sourceHtml, propsOverrides, dataBindings)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			id,
			pageId,
			ordinal,
			fields.componentVersionId ?? null,
			fields.templateId ?? null,
			fields.sourceHtml ?? null,
			fields.propsOverrides ?? null,
			fields.dataBindings ?? null,
		)
		.run();
	return id;
}

async function seedCollection(
	projectId: string,
	name: string,
): Promise<string> {
	const id = crypto.randomUUID();
	await env.DB.prepare(
		`INSERT INTO "DataCollection" (id, projectId, name, createdAt, updatedAt)
			VALUES (?, ?, ?, ?, ?)`,
	)
		.bind(id, projectId, name, nowIso(), nowIso())
		.run();
	return id;
}

async function seedRecord(
	collectionId: string,
	ordinal: number,
	data: string,
): Promise<string> {
	const id = crypto.randomUUID();
	await env.DB.prepare(
		`INSERT INTO "DataRecord" (id, collectionId, ordinal, data)
			VALUES (?, ?, ?, ?)`,
	)
		.bind(id, collectionId, ordinal, data)
		.run();
	return id;
}

async function seedTemplate(projectId: string, name: string): Promise<string> {
	const id = crypto.randomUUID();
	await env.DB.prepare(
		`INSERT INTO "Template" (id, projectId, name, createdAt, updatedAt)
			VALUES (?, ?, ?, ?, ?)`,
	)
		.bind(id, projectId, name, nowIso(), nowIso())
		.run();
	return id;
}

async function seedSlot(
	templateId: string,
	ordinal: number,
	componentVersionId: string,
	propsOverrides: string | null = null,
): Promise<string> {
	const id = crypto.randomUUID();
	await env.DB.prepare(
		`INSERT INTO "TemplateSlot"
			(id, templateId, ordinal, componentVersionId, propsOverrides)
			VALUES (?, ?, ?, ?, ?)`,
	)
		.bind(id, templateId, ordinal, componentVersionId, propsOverrides)
		.run();
	return id;
}

async function seedFlow(projectId: string, name: string): Promise<string> {
	const id = crypto.randomUUID();
	await env.DB.prepare(
		`INSERT INTO "Flow" (id, projectId, name, createdAt, updatedAt)
			VALUES (?, ?, ?, ?, ?)`,
	)
		.bind(id, projectId, name, nowIso(), nowIso())
		.run();
	return id;
}

async function seedStep(
	flowId: string,
	ordinal: number,
	pageId: string,
): Promise<string> {
	const id = crypto.randomUUID();
	await env.DB.prepare(
		`INSERT INTO "FlowStep" (id, flowId, ordinal, pageId)
			VALUES (?, ?, ?, ?)`,
	)
		.bind(id, flowId, ordinal, pageId)
		.run();
	return id;
}

// ---------------------------------------------------------------------------
// Project id format regression: real projects mint Prisma cuid() ids — the
// procedures must not gate them with the design-id (uuid) regex.
// ---------------------------------------------------------------------------

function cuidProjectId(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(12));
	return `c${Array.from(bytes)
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("")}`;
}

describe("project id format (cuid) regression", () => {
	it("accepts cuid project ids on the building-block procedures", async () => {
		const projectId = cuidProjectId();
		await createProject({ id: projectId });
		const design = await createDesign({ projectId });
		const client = adminClient(await createAdminSession());

		expect(
			(
				(await client.designs.pages.list.query({
					projectId,
					designId: design.id,
				})) as DesignPages
			).pages,
		).toEqual([]);
		expect(
			(
				(await client.projects.data.list.query({
					projectId,
				})) as DataCollections
			).collections,
		).toEqual([]);
		expect(
			(
				(await client.projects.templates.list.query({
					projectId,
				})) as Templates
			).templates,
		).toEqual([]);
		expect(
			((await client.projects.flows.list.query({ projectId })) as Flows).flows,
		).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Page composer procedures
// ---------------------------------------------------------------------------

describe("designs.pages.list", () => {
	it("returns UNAUTHORIZED without a session", async () => {
		const anonymous = createTrpcTestClient();
		expect(
			await trpcErrorCode(() =>
				anonymous.designs.pages.list.query({
					projectId: "abc",
					designId: "abc",
				}),
			),
		).toBe("UNAUTHORIZED");
	});

	it("rejects malformed ids and NOT_FOUNDs a foreign design", async () => {
		const client = adminClient(await createAdminSession());
		expect(
			await trpcErrorCode(() =>
				client.designs.pages.list.query({
					projectId: "bad",
					designId: "bad",
				}),
			),
		).toBe("BAD_REQUEST");
		const project = await createProject();
		const other = await createProject();
		const foreignDesign = await createDesign({ projectId: other.id });
		expect(
			await trpcErrorCode(() =>
				client.designs.pages.list.query({
					projectId: project.id,
					designId: foreignDesign.id,
				}),
			),
		).toBe("NOT_FOUND");
	});

	it("returns the design's pages with full block detail plus the project's templates", async () => {
		const project = await createProject();
		const design = await createDesign({ projectId: project.id });
		const { componentId, versionId } = await seedPublishedComponent(project.id);
		const templateId = await seedTemplate(project.id, "LandingHero");
		const page = await seedPage(project.id, design.id, "/pricing");
		const staleVersion = await seedVersion(componentId, 0, "retired");
		await seedBlock(page, 0, {
			componentVersionId: staleVersion,
			propsOverrides: '{"heading":"Hi"}',
			dataBindings: '{"items":{"collection":"courses","limit":6}}',
		});
		await seedBlock(page, 1, { templateId });
		await seedBlock(page, 2, { sourceHtml: "<marquee>hi</marquee>" });

		const client = adminClient(await createAdminSession());
		const body = (await client.designs.pages.list.query({
			projectId: project.id,
			designId: design.id,
		})) as DesignPages;
		expect(body.pages).toHaveLength(1);
		const composer = body.pages[0];
		expect(composer).toMatchObject({
			id: page,
			path: "/pricing",
			title: "Page /pricing",
			status: "draft",
		});
		expect(composer.blocks).toEqual([
			{
				id: expect.any(String),
				ordinal: 0,
				kind: "component",
				componentVersionId: staleVersion,
				componentId,
				componentName: "Hero",
				tagName: "tb-hero",
				version: 0,
				versionStatus: "retired",
				templateId: null,
				templateName: null,
				sourceHtml: null,
				propsOverrides: { heading: "Hi" },
				dataBindings: { items: { collection: "courses", limit: 6 } },
			},
			{
				id: expect.any(String),
				ordinal: 1,
				kind: "template",
				componentVersionId: null,
				componentId: null,
				componentName: null,
				tagName: null,
				version: null,
				versionStatus: null,
				templateId,
				templateName: "LandingHero",
				sourceHtml: null,
				propsOverrides: null,
				dataBindings: null,
			},
			{
				id: expect.any(String),
				ordinal: 2,
				kind: "html",
				componentVersionId: null,
				componentId: null,
				componentName: null,
				tagName: null,
				version: null,
				versionStatus: null,
				templateId: null,
				templateName: null,
				sourceHtml: "<marquee>hi</marquee>",
				propsOverrides: null,
				dataBindings: null,
			},
		]);
		// versionId (the published pin) is not on this page — only the
		// template picker rides along.
		expect(versionId).toBeTruthy();
	});
});

describe("designs.pages.create", () => {
	it("returns UNAUTHORIZED without a session", async () => {
		const anonymous = createTrpcTestClient();
		expect(
			await trpcErrorCode(() =>
				anonymous.designs.pages.create.mutate({
					projectId: "abc",
					designId: "abc",
					path: "/",
					title: "Page",
				}),
			),
		).toBe("UNAUTHORIZED");
	});

	it("creates a draft page attached to the design", async () => {
		const project = await createProject();
		const design = await createDesign({ projectId: project.id });
		const client = adminClient(await createAdminSession());
		const body = await client.designs.pages.create.mutate({
			projectId: project.id,
			designId: design.id,
			path: "/pricing",
			title: "Pricing",
		});
		expect(body.page).toMatchObject({
			path: "/pricing",
			title: "Pricing",
			status: "draft",
		});
		const stored = await env.DB.prepare(
			`SELECT projectId, designId, status FROM "Page" WHERE id = ?`,
		)
			.bind(body.page.id)
			.first<{ projectId: string; designId: string; status: string }>();
		expect(stored).toMatchObject({
			projectId: project.id,
			designId: design.id,
			status: "draft",
		});
	});

	it("rejects invalid path/title and CONFLICTs on duplicate project paths", async () => {
		const project = await createProject();
		const design = await createDesign({ projectId: project.id });
		const client = adminClient(await createAdminSession());
		const create = (input: { path: string; title: string }) =>
			client.designs.pages.create.mutate({
				projectId: project.id,
				designId: design.id,
				...input,
			});
		expect(
			await trpcErrorCode(() => create({ path: "pricing", title: "P" })),
		).toBe("BAD_REQUEST");
		expect(await trpcErrorCode(() => create({ path: "/p", title: "" }))).toBe(
			"BAD_REQUEST",
		);
		await seedPage(project.id, design.id, "/taken");
		const otherDesign = await createDesign({ projectId: project.id });
		// The duplicate check is project-wide, not just this design's pages.
		expect(
			await trpcErrorCode(() =>
				client.designs.pages.create.mutate({
					projectId: project.id,
					designId: otherDesign.id,
					path: "/taken",
					title: "Again",
				}),
			),
		).toBe("CONFLICT");
	});
});

describe("designs.pages.update and delete", () => {
	it("returns UNAUTHORIZED without a session", async () => {
		const anonymous = createTrpcTestClient();
		expect(
			await trpcErrorCode(() =>
				anonymous.designs.pages.update.mutate({
					projectId: "abc",
					designId: "abc",
					pageId: "abc",
					title: "X",
				}),
			),
		).toBe("UNAUTHORIZED");
	});

	it("renames title and path (CONFLICT when the target path is taken)", async () => {
		const project = await createProject();
		const design = await createDesign({ projectId: project.id });
		const page = await seedPage(project.id, design.id, "/old");
		await seedPage(project.id, design.id, "/taken");
		const client = adminClient(await createAdminSession());
		const renamed = await client.designs.pages.update.mutate({
			projectId: project.id,
			designId: design.id,
			pageId: page,
			path: "/new",
			title: "Renamed",
		});
		expect(renamed.page).toMatchObject({
			path: "/new",
			title: "Renamed",
		});
		expect(
			await trpcErrorCode(() =>
				client.designs.pages.update.mutate({
					projectId: project.id,
					designId: design.id,
					pageId: page,
					path: "/taken",
					title: "X",
				}),
			),
		).toBe("CONFLICT");
	});

	it("deletes the page and cascades its blocks and flow steps", async () => {
		const project = await createProject();
		const design = await createDesign({ projectId: project.id });
		const { versionId } = await seedPublishedComponent(project.id);
		const page = await seedPage(project.id, design.id, "/");
		const block = await seedBlock(page, 0, { componentVersionId: versionId });
		const flowId = await seedFlow(project.id, "Journey");
		const step = await seedStep(flowId, 0, page);
		const client = adminClient(await createAdminSession());
		await client.designs.pages.delete.mutate({
			projectId: project.id,
			designId: design.id,
			pageId: page,
		});
		expect(
			await env.DB.prepare(`SELECT id FROM "PageBlock" WHERE id = ?`)
				.bind(block)
				.first(),
		).toBeNull();
		expect(
			await env.DB.prepare(`SELECT id FROM "FlowStep" WHERE id = ?`)
				.bind(step)
				.first(),
		).toBeNull();
	});

	it("NOT_FOUNDs when the page belongs to another design or the design to another project", async () => {
		const project = await createProject();
		const design = await createDesign({ projectId: project.id });
		const page = await seedPage(project.id, design.id, "/");
		const otherProject = await createProject();
		const otherDesign = await createDesign({ projectId: otherProject.id });
		const client = adminClient(await createAdminSession());
		expect(
			await trpcErrorCode(() =>
				client.designs.pages.delete.mutate({
					projectId: otherProject.id,
					designId: otherDesign.id,
					pageId: page,
				}),
			),
		).toBe("NOT_FOUND");
	});
});

describe("designs.pages.replaceBlocks", () => {
	it("returns UNAUTHORIZED without a session", async () => {
		const anonymous = createTrpcTestClient();
		expect(
			await trpcErrorCode(() =>
				anonymous.designs.pages.replaceBlocks.mutate({
					projectId: "abc",
					designId: "abc",
					pageId: "abc",
					blocks: [],
				}),
			),
		).toBe("UNAUTHORIZED");
	});

	it("adds a component block pinning the published version by name+version", async () => {
		const project = await createProject();
		const design = await createDesign({ projectId: project.id });
		const { componentId, versionId } = await seedPublishedComponent(project.id);
		const page = await seedPage(project.id, design.id, "/");
		const client = adminClient(await createAdminSession());
		const body = await client.designs.pages.replaceBlocks.mutate({
			projectId: project.id,
			designId: design.id,
			pageId: page,
			blocks: [
				{ sourceHtml: "<p>keep</p>" },
				{
					component: { name: "Hero", version: 1 },
					propsOverrides: { heading: "Hi" },
				},
			],
		});
		const blocks = await env.DB.prepare(
			`SELECT ordinal, componentVersionId, sourceHtml, propsOverrides
			 FROM "PageBlock" WHERE pageId = ? ORDER BY ordinal`,
		)
			.bind(page)
			.all<{
				ordinal: number;
				componentVersionId: string | null;
				sourceHtml: string | null;
				propsOverrides: string | null;
			}>();
		expect(blocks.results).toHaveLength(2);
		expect(blocks.results[1]).toMatchObject({
			ordinal: 1,
			componentVersionId: versionId,
			propsOverrides: '{"heading":"Hi"}',
		});
		expect(body.blocks[1]).toEqual({
			ordinal: 1,
			kind: "component",
			component: "Hero",
			tagName: "tb-hero",
			version: 1,
		});
		expect(componentId).toBeTruthy();
	});

	it("reorders and deletes while preserving stale pins via componentVersionId", async () => {
		const project = await createProject();
		const design = await createDesign({ projectId: project.id });
		const { componentId } = await seedPublishedComponent(project.id);
		const retiredVersion = await seedVersion(componentId, 0, "retired");
		const page = await seedPage(project.id, design.id, "/");
		const stale = await seedBlock(page, 0, {
			componentVersionId: retiredVersion,
		});
		await seedBlock(page, 1, { sourceHtml: "<p>second</p>" });
		const client = adminClient(await createAdminSession());
		// Reorder: html first, stale pin second — the retired pin
		// passes through untouched (pins never move on their own).
		await client.designs.pages.replaceBlocks.mutate({
			projectId: project.id,
			designId: design.id,
			pageId: page,
			blocks: [
				{ sourceHtml: "<p>second</p>" },
				{ componentVersionId: retiredVersion },
			],
		});
		const blocks = await env.DB.prepare(
			`SELECT ordinal, componentVersionId, sourceHtml FROM "PageBlock"
			 WHERE pageId = ? ORDER BY ordinal`,
		)
			.bind(page)
			.all<{
				ordinal: number;
				componentVersionId: string | null;
				sourceHtml: string | null;
			}>();
		expect(blocks.results).toEqual([
			{ ordinal: 0, componentVersionId: null, sourceHtml: "<p>second</p>" },
			{ ordinal: 1, componentVersionId: retiredVersion, sourceHtml: null },
		]);
		expect(stale).toBeTruthy();
	});

	it("rejects unknown components, draft pins and bound template blocks", async () => {
		const project = await createProject();
		const design = await createDesign({ projectId: project.id });
		const componentId = await seedComponent(project.id);
		const draftVersion = await seedVersion(componentId, 1, "draft");
		const templateId = await seedTemplate(project.id, "Hero");
		const page = await seedPage(project.id, design.id, "/");
		const client = adminClient(await createAdminSession());
		const put = (blocks: unknown[]) =>
			client.designs.pages.replaceBlocks.mutate({
				projectId: project.id,
				designId: design.id,
				pageId: page,
				blocks,
			});
		expect(
			await trpcErrorCode(() =>
				put([{ component: { name: "Nope", version: 1 } }]),
			),
		).toBe("BAD_REQUEST");
		expect(
			await trpcErrorCode(() =>
				put([{ component: { name: "Hero", version: 1 } }]),
			),
		).toBe("BAD_REQUEST"); // draft pin
		expect(
			await trpcErrorCode(() =>
				put([{ template: "Hero", dataBindings: { items: {} } }]),
			),
		).toBe("BAD_REQUEST");
		expect(draftVersion).toBeTruthy();
		expect(templateId).toBeTruthy();
	});

	it("NOT_FOUNDs when the page is out of the design's scope", async () => {
		const project = await createProject();
		const design = await createDesign({ projectId: project.id });
		const otherProject = await createProject();
		const otherDesign = await createDesign({ projectId: otherProject.id });
		const page = await seedPage(project.id, design.id, "/");
		const client = adminClient(await createAdminSession());
		expect(
			await trpcErrorCode(() =>
				client.designs.pages.replaceBlocks.mutate({
					projectId: otherProject.id,
					designId: otherDesign.id,
					pageId: page,
					blocks: [],
				}),
			),
		).toBe("NOT_FOUND");
	});
});

// ---------------------------------------------------------------------------
// Data collection + record procedures
// ---------------------------------------------------------------------------

describe("projects.data", () => {
	it("returns UNAUTHORIZED without a session", async () => {
		const anonymous = createTrpcTestClient();
		expect(
			await trpcErrorCode(() =>
				anonymous.projects.data.list.query({ projectId: "abc" }),
			),
		).toBe("UNAUTHORIZED");
		expect(
			await trpcErrorCode(() =>
				anonymous.projects.data.create.mutate({ projectId: "abc", name: "x" }),
			),
		).toBe("UNAUTHORIZED");
	});

	it("lists collections with their records in ordinal order", async () => {
		const project = await createProject();
		const collectionId = await seedCollection(project.id, "courses");
		await seedRecord(collectionId, 1, '{"title":"Second"}');
		await seedRecord(collectionId, 0, '{"title":"First"}');
		const client = adminClient(await createAdminSession());
		const body = (await client.projects.data.list.query({
			projectId: project.id,
		})) as DataCollections;
		expect(body.collections).toEqual([
			{
				id: collectionId,
				name: "courses",
				records: [
					{ id: expect.any(String), ordinal: 0, data: '{"title":"First"}' },
					{ id: expect.any(String), ordinal: 1, data: '{"title":"Second"}' },
				],
			},
		]);
	});

	it("creates a collection (CONFLICT on duplicates, rejects bad names)", async () => {
		const project = await createProject();
		const client = adminClient(await createAdminSession());
		const created = await client.projects.data.create.mutate({
			projectId: project.id,
			name: "courses",
		});
		expect(created.collection).toMatchObject({ name: "courses" });
		expect(
			await trpcErrorCode(() =>
				client.projects.data.create.mutate({
					projectId: project.id,
					name: "courses",
				}),
			),
		).toBe("CONFLICT");
		expect(
			await trpcErrorCode(() =>
				client.projects.data.create.mutate({ projectId: project.id, name: "" }),
			),
		).toBe("BAD_REQUEST");
	});

	it("renames with a binding guard and duplicate check", async () => {
		const project = await createProject();
		const design = await createDesign({ projectId: project.id });
		const boundId = await seedCollection(project.id, "courses");
		const freeId = await seedCollection(project.id, "free");
		await seedCollection(project.id, "taken");
		const page = await seedPage(project.id, design.id, "/");
		await seedBlock(page, 0, {
			sourceHtml: "<p>x</p>",
			dataBindings: '{"items":{"collection":"courses"}}',
		});
		const client = adminClient(await createAdminSession());
		// A bound collection cannot be renamed at all: its blocks reference
		// it by name, so any rename would dangle them.
		expect(
			await trpcErrorCode(() =>
				client.projects.data.rename.mutate({
					projectId: project.id,
					collectionId: boundId,
					name: "lessons",
				}),
			),
		).toBe("CONFLICT");
		// An unbound collection renames freely, unless the target name is taken.
		expect(
			(
				await client.projects.data.rename.mutate({
					projectId: project.id,
					collectionId: freeId,
					name: "renamed",
				})
			).collection,
		).toMatchObject({ name: "renamed" });
		expect(
			await trpcErrorCode(() =>
				client.projects.data.rename.mutate({
					projectId: project.id,
					collectionId: freeId,
					name: "taken",
				}),
			),
		).toBe("CONFLICT");
	});

	it("deletes only when unbound (records cascade)", async () => {
		const project = await createProject();
		const design = await createDesign({ projectId: project.id });
		const boundId = await seedCollection(project.id, "bound");
		const freeId = await seedCollection(project.id, "free");
		await seedRecord(freeId, 0, "{}");
		const page = await seedPage(project.id, design.id, "/");
		await seedBlock(page, 0, {
			sourceHtml: "<p>x</p>",
			dataBindings: '{"items":{"collection":"bound"}}',
		});
		const client = adminClient(await createAdminSession());
		expect(
			await trpcErrorCode(() =>
				client.projects.data.delete.mutate({
					projectId: project.id,
					collectionId: boundId,
				}),
			),
		).toBe("CONFLICT");
		await client.projects.data.delete.mutate({
			projectId: project.id,
			collectionId: freeId,
		});
		expect(
			await env.DB.prepare(`SELECT id FROM "DataRecord" WHERE collectionId = ?`)
				.bind(freeId)
				.first(),
		).toBeNull();
	});

	it("replaces all records atomically (add, edit, delete, renumber)", async () => {
		const project = await createProject();
		const collectionId = await seedCollection(project.id, "courses");
		await seedRecord(collectionId, 0, '{"title":"First"}');
		await seedRecord(collectionId, 1, '{"title":"Second"}');
		const client = adminClient(await createAdminSession());
		const replaced = await client.projects.data.replaceRecords.mutate({
			projectId: project.id,
			collectionId,
			records: [{ title: "Edited" }, { title: "New" }],
		});
		expect(replaced).toMatchObject({ collectionId, count: 2 });
		const records = await env.DB.prepare(
			`SELECT ordinal, data FROM "DataRecord" WHERE collectionId = ? ORDER BY ordinal`,
		)
			.bind(collectionId)
			.all<{ ordinal: number; data: string }>();
		expect(records.results).toEqual([
			{ ordinal: 0, data: '{"title":"Edited"}' },
			{ ordinal: 1, data: '{"title":"New"}' },
		]);
		expect(
			await trpcErrorCode(() =>
				client.projects.data.replaceRecords.mutate({
					projectId: project.id,
					collectionId,
					records: [["not", "an", "object"]],
				}),
			),
		).toBe("BAD_REQUEST");
		// The failed write left the previous records intact.
		const after = await env.DB.prepare(
			`SELECT count(*) AS n FROM "DataRecord" WHERE collectionId = ?`,
		)
			.bind(collectionId)
			.first<{ n: number }>();
		expect(after?.n).toBe(2);
	});

	it("NOT_FOUNDs a foreign collection", async () => {
		const project = await createProject();
		const other = await createProject();
		const foreign = await seedCollection(other.id, "theirs");
		const client = adminClient(await createAdminSession());
		expect(
			await trpcErrorCode(() =>
				client.projects.data.delete.mutate({
					projectId: project.id,
					collectionId: foreign,
				}),
			),
		).toBe("NOT_FOUND");
	});
});

// ---------------------------------------------------------------------------
// Template procedures
// ---------------------------------------------------------------------------

describe("projects.templates", () => {
	it("returns UNAUTHORIZED without a session", async () => {
		const anonymous = createTrpcTestClient();
		expect(
			await trpcErrorCode(() =>
				anonymous.projects.templates.list.query({ projectId: "abc" }),
			),
		).toBe("UNAUTHORIZED");
		expect(
			await trpcErrorCode(() =>
				anonymous.projects.templates.define.mutate({
					projectId: "abc",
					body: { name: "T", slots: [] },
				}),
			),
		).toBe("UNAUTHORIZED");
	});

	it("lists templates with their ordered slots", async () => {
		const project = await createProject();
		const { componentId, versionId } = await seedPublishedComponent(project.id);
		const templateId = await seedTemplate(project.id, "LandingHero");
		await seedSlot(templateId, 0, versionId, '{"heading":"Hi"}');
		const client = adminClient(await createAdminSession());
		const body = (await client.projects.templates.list.query({
			projectId: project.id,
		})) as Templates;
		expect(body.templates).toEqual([
			{
				id: templateId,
				name: "LandingHero",
				slots: [
					{
						id: expect.any(String),
						ordinal: 0,
						componentVersionId: versionId,
						componentName: "Hero",
						tagName: "tb-hero",
						version: 1,
						versionStatus: "published",
						propsOverrides: { heading: "Hi" },
					},
				],
			},
		]);
		expect(componentId).toBeTruthy();
	});

	it("creates a template with slots and replaces them on redefine", async () => {
		const project = await createProject();
		const { versionId } = await seedPublishedComponent(project.id);
		const client = adminClient(await createAdminSession());
		const created = await client.projects.templates.define.mutate({
			projectId: project.id,
			body: {
				name: "LandingHero",
				slots: [{ component: { name: "Hero", version: 1 } }],
			},
		});
		expect(created.template).toMatchObject({
			name: "LandingHero",
			slotCount: 1,
		});
		// Redefine replaces the slot list.
		await client.projects.templates.define.mutate({
			projectId: project.id,
			body: {
				name: "LandingHero",
				slots: [
					{ component: { name: "Hero", version: 1 } },
					{
						component: { name: "Hero", version: 1 },
						propsOverrides: { heading: "Hi" },
					},
				],
			},
		});
		const slots = await env.DB.prepare(
			`SELECT ordinal FROM "TemplateSlot" WHERE templateId = ? ORDER BY ordinal`,
		)
			.bind(created.template.id)
			.all<{ ordinal: number }>();
		expect(slots.results).toHaveLength(2);
		expect(versionId).toBeTruthy();
	});

	it("rejects draft pins with a model-correctable error", async () => {
		const project = await createProject();
		const componentId = await seedComponent(project.id);
		await seedVersion(componentId, 1, "draft");
		const client = adminClient(await createAdminSession());
		expect(
			await trpcErrorMessage(() =>
				client.projects.templates.define.mutate({
					projectId: project.id,
					body: {
						name: "Drafty",
						slots: [{ component: { name: "Hero", version: 1 } }],
					},
				}),
			),
		).toContain("draft");
	});

	it("deletes unreferenced templates, CONFLICTs referenced ones", async () => {
		const project = await createProject();
		const design = await createDesign({ projectId: project.id });
		const { versionId } = await seedPublishedComponent(project.id);
		const referenced = await seedTemplate(project.id, "Used");
		await seedSlot(referenced, 0, versionId);
		const free = await seedTemplate(project.id, "Free");
		const page = await seedPage(project.id, design.id, "/");
		await seedBlock(page, 0, { templateId: referenced });
		const client = adminClient(await createAdminSession());
		expect(
			await trpcErrorCode(() =>
				client.projects.templates.delete.mutate({
					projectId: project.id,
					templateId: referenced,
				}),
			),
		).toBe("CONFLICT");
		await client.projects.templates.delete.mutate({
			projectId: project.id,
			templateId: free,
		});
	});
});

// ---------------------------------------------------------------------------
// Flow procedures
// ---------------------------------------------------------------------------

describe("projects.flows", () => {
	it("returns UNAUTHORIZED without a session", async () => {
		const anonymous = createTrpcTestClient();
		expect(
			await trpcErrorCode(() =>
				anonymous.projects.flows.list.query({ projectId: "abc" }),
			),
		).toBe("UNAUTHORIZED");
		expect(
			await trpcErrorCode(() =>
				anonymous.projects.flows.define.mutate({
					projectId: "abc",
					body: { name: "F", steps: [] },
				}),
			),
		).toBe("UNAUTHORIZED");
	});

	it("lists flows with ordered steps plus the project's pages", async () => {
		const project = await createProject();
		const design = await createDesign({ projectId: project.id });
		const first = await seedPage(project.id, design.id, "/");
		const second = await seedPage(project.id, design.id, "/pricing");
		const flowId = await seedFlow(project.id, "Checkout");
		await seedStep(flowId, 0, first);
		await seedStep(flowId, 1, second);
		const client = adminClient(await createAdminSession());
		const body = (await client.projects.flows.list.query({
			projectId: project.id,
		})) as Flows;
		expect(body.flows).toEqual([
			{
				id: flowId,
				name: "Checkout",
				steps: [
					{
						id: expect.any(String),
						ordinal: 0,
						pageId: first,
						pagePath: "/",
						pageTitle: "Page /",
						entryAction: null,
						exitTarget: null,
					},
					{
						id: expect.any(String),
						ordinal: 1,
						pageId: second,
						pagePath: "/pricing",
						pageTitle: "Page /pricing",
						entryAction: null,
						exitTarget: null,
					},
				],
			},
		]);
		expect(body.pages.map((page) => page.path)).toEqual(["/", "/pricing"]);
	});

	it("creates and redefines flows (steps validated against page paths)", async () => {
		const project = await createProject();
		const design = await createDesign({ projectId: project.id });
		await seedPage(project.id, design.id, "/");
		await seedPage(project.id, design.id, "/pricing");
		const client = adminClient(await createAdminSession());
		const created = await client.projects.flows.define.mutate({
			projectId: project.id,
			body: {
				name: "Checkout",
				steps: [
					{ path: "/", entryAction: "land", exitTarget: "click .cta" },
					{ path: "/pricing" },
				],
			},
		});
		expect(created.flow).toMatchObject({ name: "Checkout", stepCount: 2 });
		// Redefine replaces the step list.
		await client.projects.flows.define.mutate({
			projectId: project.id,
			body: { name: "Checkout", steps: [{ path: "/" }] },
		});
		const steps = await env.DB.prepare(
			`SELECT ordinal FROM "FlowStep" WHERE flowId = ? ORDER BY ordinal`,
		)
			.bind(created.flow.id)
			.all<{ ordinal: number }>();
		expect(steps.results).toHaveLength(1);
		// Unknown paths are rejected.
		expect(
			await trpcErrorCode(() =>
				client.projects.flows.define.mutate({
					projectId: project.id,
					body: { name: "Broken", steps: [{ path: "/nowhere" }] },
				}),
			),
		).toBe("BAD_REQUEST");
	});

	it("deletes a flow with its steps and NOT_FOUNDs foreign ones", async () => {
		const project = await createProject();
		const design = await createDesign({ projectId: project.id });
		const page = await seedPage(project.id, design.id, "/");
		const flowId = await seedFlow(project.id, "Checkout");
		const step = await seedStep(flowId, 0, page);
		const client = adminClient(await createAdminSession());
		await client.projects.flows.delete.mutate({
			projectId: project.id,
			flowId,
		});
		expect(
			await env.DB.prepare(`SELECT id FROM "FlowStep" WHERE id = ?`)
				.bind(step)
				.first(),
		).toBeNull();
		const other = await createProject();
		expect(
			await trpcErrorCode(() =>
				client.projects.flows.delete.mutate({
					projectId: other.id,
					flowId,
				}),
			),
		).toBe("NOT_FOUND");
	});
});
