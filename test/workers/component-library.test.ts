// Worker tests for the KUK-927 component library inspector: the admin read
// surface (designs.components.list — timelines, pin counts, demo docs from
// the design's drafts, the design's pages with their pins), the single-block
// re-pin (designs.components.repin), and the design detail's
// latest-publication pointer (designs.get). Real D1 + R2 test bindings.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { ComponentLibrary } from "@/client/api-types";
import { designsKey } from "@/features/design-studio/assets/design-files";
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
		kind?: string;
		publishedVersionId?: string | null;
		deletedAt?: string | null;
	} = {},
): Promise<string> {
	const id = crypto.randomUUID();
	await env.DB.prepare(
		`INSERT INTO "Component"
			(id, projectId, name, kind, tagName, publishedVersionId, deletedAt, createdAt, updatedAt)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			id,
			projectId,
			overrides.name ?? "Hero",
			overrides.kind ?? "section",
			overrides.tagName ?? "tb-hero",
			overrides.publishedVersionId ?? null,
			overrides.deletedAt ?? null,
			nowIso(),
			nowIso(),
		)
		.run();
	return id;
}

async function seedVersion(
	componentId: string,
	version: number,
	overrides: {
		status?: string;
		changeNote?: string | null;
		createdTurnId?: string | null;
		previewR2Key?: string | null;
	} = {},
): Promise<string> {
	const id = crypto.randomUUID();
	await env.DB.prepare(
		`INSERT INTO "ComponentVersion"
			(id, componentId, version, status, js, changeNote, createdTurnId, previewR2Key, createdAt)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			id,
			componentId,
			version,
			overrides.status ?? "draft",
			COMPONENT_JS,
			overrides.changeNote ?? null,
			overrides.createdTurnId ?? null,
			overrides.previewR2Key ?? null,
			nowIso(),
		)
		.run();
	return id;
}

async function seedPage(
	projectId: string,
	designId: string,
	path: string,
): Promise<string> {
	const id = crypto.randomUUID();
	await env.DB.prepare(
		`INSERT INTO "Page"
			(id, projectId, designId, path, title, status, createdAt, updatedAt)
			VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)`,
	)
		.bind(id, projectId, designId, path, `Page ${path}`, nowIso(), nowIso())
		.run();
	return id;
}

async function seedBlock(
	pageId: string,
	ordinal: number,
	componentVersionId: string | null,
): Promise<string> {
	const id = crypto.randomUUID();
	await env.DB.prepare(
		`INSERT INTO "PageBlock" (id, pageId, ordinal, componentVersionId) VALUES (?, ?, ?, ?)`,
	)
		.bind(id, pageId, ordinal, componentVersionId)
		.run();
	return id;
}

function cuidProjectId(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(12));
	return `c${Array.from(bytes)
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("")}`;
}

describe("designs.components.list", () => {
	it("returns UNAUTHORIZED without a session", async () => {
		const anonymous = createTrpcTestClient();
		expect(
			await trpcErrorCode(async () =>
				anonymous.designs.components.list.query({ projectId: "abc" }),
			),
		).toBe("UNAUTHORIZED");
	});

	it("rejects malformed project and design ids", async () => {
		const client = adminClient(await createAdminSession());
		expect(
			await trpcErrorCode(async () =>
				client.designs.components.list.query({ projectId: "not-a-uuid" }),
			),
		).toBe("BAD_REQUEST");
		const project = await createProject();
		expect(
			await trpcErrorCode(async () =>
				client.designs.components.list.query({
					projectId: project.id,
					designId: "not-a-uuid",
				}),
			),
		).toBe("BAD_REQUEST");
	});

	it("lists live components with full version timelines and pin counts", async () => {
		const project = await createProject();
		const componentId = await seedComponent(project.id);
		await seedVersion(componentId, 1, {
			status: "retired",
			changeNote: "first cut",
			createdTurnId: "turn-11111111-2222-3333-4444-555555555555",
		});
		const v2 = await seedVersion(componentId, 2, {
			status: "published",
			changeNote: "tightened spacing",
		});
		await seedVersion(componentId, 3, {
			status: "draft",
			changeNote: "wip",
			previewR2Key: "previews/hero-v3.png",
		});
		await env.DB.prepare(
			`UPDATE "Component" SET publishedVersionId = ? WHERE id = ?`,
		)
			.bind(v2, componentId)
			.run();
		const second = await seedComponent(project.id, {
			name: "Footer",
			tagName: "tb-footer",
			kind: "layout",
		});
		await seedVersion(second, 1, { status: "draft" });
		// A soft-deleted component stays out of the library.
		await seedComponent(project.id, {
			name: "Deleted",
			tagName: "tb-deleted",
			deletedAt: nowIso(),
		});
		const page = await seedPage(
			project.id,
			(await createDesign({ projectId: project.id })).id,
			"/",
		);
		await seedBlock(page, 0, v2);
		await seedBlock(page, 1, v2);

		const client = adminClient(await createAdminSession());
		const body = (await client.designs.components.list.query({
			projectId: project.id,
		})) as ComponentLibrary;
		expect(body.pages).toBeNull();
		expect(body.components.map((component) => component.name)).toEqual([
			"Footer",
			"Hero",
		]);

		const hero = body.components[1];
		expect(hero).toMatchObject({
			kind: "section",
			tagName: "tb-hero",
			publishedVersion: 2,
			draftVersion: 3,
		});
		expect(hero.versions.map((version) => version.version)).toEqual([3, 2, 1]);
		const published = hero.versions.find((version) => version.version === 2);
		expect(published).toMatchObject({ status: "published", pinCount: 2 });
		const draft = hero.versions.find((version) => version.version === 3);
		expect(draft).toMatchObject({
			status: "draft",
			changeNote: "wip",
			hasPngPreview: true,
			demoDocUrl: null,
		});
		const retired = hero.versions.find((version) => version.version === 1);
		expect(retired).toMatchObject({
			status: "retired",
			changeNote: "first cut",
			createdTurnId: "turn-11111111-2222-3333-4444-555555555555",
			pinCount: 0,
		});
	});

	it("links demo documents from the queried design's drafts and returns its pages", async () => {
		const project = await createProject();
		const design = await createDesign({ projectId: project.id });
		const componentId = await seedComponent(project.id);
		await seedVersion(componentId, 1, { status: "published" });
		await seedVersion(componentId, 2, { status: "draft" });
		// Only v1 got a demo doc from its authoring turn (KUK-924).
		await env.DESIGNS.put(
			designsKey(design.id, "drafts/hero-v1.html"),
			"<html><body><tb-hero data-ssr></tb-hero></body></html>",
			{ httpMetadata: { contentType: "text/html; charset=utf-8" } },
		);

		const client = adminClient(await createAdminSession());
		const body = (await client.designs.components.list.query({
			projectId: project.id,
			designId: design.id,
		})) as ComponentLibrary;
		expect(body.pages).not.toBeNull();
		const hero = body.components[0];
		expect(
			hero.versions.find((version) => version.version === 1)?.demoDocUrl,
		).toBe(`/designs/${design.id}/file/drafts/hero-v1.html`);
		expect(
			hero.versions.find((version) => version.version === 2)?.demoDocUrl,
		).toBeNull();
		expect(body.pages).toEqual([]);
	});

	it("returns the design's pages with pinned blocks for the re-pin affordance", async () => {
		const project = await createProject();
		const design = await createDesign({ projectId: project.id });
		const componentId = await seedComponent(project.id);
		const v1 = await seedVersion(componentId, 1, { status: "retired" });
		await seedVersion(componentId, 2, { status: "published" });
		const page = await seedPage(project.id, design.id, "/pricing");
		await seedBlock(page, 0, v1);
		await seedBlock(page, 1, null);

		const client = adminClient(await createAdminSession());
		const body = (await client.designs.components.list.query({
			projectId: project.id,
			designId: design.id,
		})) as ComponentLibrary;
		expect(body.pages).toEqual([
			{
				id: page,
				path: "/pricing",
				title: "Page /pricing",
				status: "draft",
				blocks: [
					{
						id: expect.any(String),
						ordinal: 0,
						kind: "component",
						componentVersionId: v1,
						componentId,
						componentName: "Hero",
						tagName: "tb-hero",
						version: 1,
						versionStatus: "retired",
					},
					{
						id: expect.any(String),
						ordinal: 1,
						kind: "html",
						componentVersionId: null,
						componentId: null,
						componentName: null,
						tagName: null,
						version: null,
						versionStatus: null,
					},
				],
			},
		]);
	});

	it("yields null pages for a designId from another project (no cross-project leak)", async () => {
		const project = await createProject();
		const otherProject = await createProject();
		const foreignDesign = await createDesign({ projectId: otherProject.id });

		const client = adminClient(await createAdminSession());
		const body = (await client.designs.components.list.query({
			projectId: project.id,
			designId: foreignDesign.id,
		})) as ComponentLibrary;
		expect(body.pages).toBeNull();
		// The library itself is still the requested project's.
		expect(body.components).toHaveLength(0);
	});
});

describe("project id format (cuid) regression", () => {
	it("accepts cuid project ids on the library surface", async () => {
		const projectId = cuidProjectId();
		await createProject({ id: projectId });
		const design = await createDesign({ projectId });

		const client = adminClient(await createAdminSession());
		const body = (await client.designs.components.list.query({
			projectId,
			designId: design.id,
		})) as ComponentLibrary;
		expect(body.components).toHaveLength(0);
		expect(body.pages).toEqual([]);
	});
});

describe("designs.components.repin", () => {
	async function seedScenario(options: { published?: boolean } = {}) {
		const project = await createProject();
		const design = await createDesign({ projectId: project.id });
		const componentId = await seedComponent(project.id);
		const v1 = await seedVersion(componentId, 1, { status: "retired" });
		const v2 =
			options.published === false
				? null
				: await seedVersion(componentId, 2, { status: "published" });
		if (v2) {
			await env.DB.prepare(
				`UPDATE "Component" SET publishedVersionId = ? WHERE id = ?`,
			)
				.bind(v2, componentId)
				.run();
		}
		const page = await seedPage(project.id, design.id, "/");
		const staleBlock = await seedBlock(page, 0, v1);
		return { project, design, componentId, v1, v2, page, staleBlock };
	}

	type RepinIds = {
		projectId: string;
		designId: string;
		pageId: string;
		blockId: string;
	};

	async function repin(
		ids: RepinIds,
		body: Record<string, unknown>,
		session: TestSession,
	) {
		return adminClient(session).designs.components.repin.mutate({
			...ids,
			...(body as { componentId?: string }),
		} as never);
	}

	it("returns UNAUTHORIZED without a session", async () => {
		const anonymous = createTrpcTestClient();
		expect(
			await trpcErrorCode(async () =>
				anonymous.designs.components.repin.mutate({
					projectId: "abc",
					designId: "abc",
					pageId: "abc",
					blockId: "abc",
					componentId: "abc",
				} as never),
			),
		).toBe("UNAUTHORIZED");
	});

	it("rejects malformed ids and bodies", async () => {
		const { project, design, page, staleBlock } = await seedScenario();
		const session = await createAdminSession();
		// Malformed project id.
		expect(
			await trpcErrorCode(async () =>
				repin(
					{
						projectId: "bad",
						designId: design.id,
						pageId: page,
						blockId: staleBlock,
					},
					{ componentId: "c" },
					session,
				),
			),
		).toBe("BAD_REQUEST");
		// Missing componentId.
		expect(
			await trpcErrorCode(async () =>
				repin(
					{
						projectId: project.id,
						designId: design.id,
						pageId: page,
						blockId: staleBlock,
					},
					{},
					session,
				),
			),
		).toBe("BAD_REQUEST");
	});

	it("re-points the block at the component's published version", async () => {
		const { project, design, componentId, page, staleBlock } =
			await seedScenario();
		const body = (await repin(
			{
				projectId: project.id,
				designId: design.id,
				pageId: page,
				blockId: staleBlock,
			},
			{ componentId },
			await createAdminSession(),
		)) as {
			id: string;
			pageId: string;
			ordinal: number;
			componentVersionId: string;
			version: number;
			componentName: string;
			tagName: string;
		};
		expect(body).toMatchObject({
			id: staleBlock,
			pageId: page,
			ordinal: 0,
			version: 2,
			componentName: "Hero",
			tagName: "tb-hero",
		});
		const stored = await env.DB.prepare(
			`SELECT componentVersionId FROM "PageBlock" WHERE id = ?`,
		)
			.bind(staleBlock)
			.first<{ componentVersionId: string }>();
		expect(stored?.componentVersionId).not.toBe(null);
		expect(body.componentVersionId).toBe(stored?.componentVersionId);
	});

	it("is idempotent when the block already pins the published version", async () => {
		const { project, design, componentId, v2, page } = await seedScenario();
		const block = await seedBlock(page, 1, v2);
		const body = (await repin(
			{
				projectId: project.id,
				designId: design.id,
				pageId: page,
				blockId: block,
			},
			{ componentId },
			await createAdminSession(),
		)) as { componentVersionId: string };
		expect(body).toMatchObject({ componentVersionId: v2 });
	});

	it("CONFLICTs when the component has no published version", async () => {
		const { project, design, componentId, page, staleBlock } =
			await seedScenario({ published: false });
		const code = await trpcErrorCode(async () =>
			repin(
				{
					projectId: project.id,
					designId: design.id,
					pageId: page,
					blockId: staleBlock,
				},
				{ componentId },
				await createAdminSession(),
			),
		);
		expect(code).toBe("CONFLICT");
	});

	it("CONFLICTs when the published pointer names a row that is no longer published", async () => {
		// A stale pointer (the pointed-at row was retired out-of-band) must
		// behave exactly like no published version: the re-pin can never pin
		// a non-renderable row.
		const { project, design, componentId, v2, page, staleBlock } =
			await seedScenario();
		await env.DB.prepare(
			`UPDATE "ComponentVersion" SET status = 'retired' WHERE id = ?`,
		)
			.bind(v2)
			.run();
		const code = await trpcErrorCode(async () =>
			repin(
				{
					projectId: project.id,
					designId: design.id,
					pageId: page,
					blockId: staleBlock,
				},
				{ componentId },
				await createAdminSession(),
			),
		);
		expect(code).toBe("CONFLICT");
		expect(
			await trpcErrorMessage(async () =>
				repin(
					{
						projectId: project.id,
						designId: design.id,
						pageId: page,
						blockId: staleBlock,
					},
					{ componentId },
					await createAdminSession(),
				),
			),
		).toContain("no published version");
		// The block's stale pin is untouched.
		const stored = await env.DB.prepare(
			`SELECT componentVersionId FROM "PageBlock" WHERE id = ?`,
		)
			.bind(staleBlock)
			.first<{ componentVersionId: string }>();
		expect(stored?.componentVersionId).not.toBe(v2);
	});

	it("NOT_FOUNDs when any path row is missing or out of scope", async () => {
		const { project, design, componentId, page, staleBlock } =
			await seedScenario();
		const session = await createAdminSession();

		// Wrong project: a different project's design id.
		const otherProject = await createProject();
		expect(
			await trpcErrorCode(async () =>
				repin(
					{
						projectId: otherProject.id,
						designId: design.id,
						pageId: page,
						blockId: staleBlock,
					},
					{ componentId },
					session,
				),
			),
		).toBe("NOT_FOUND");

		// Random ids anywhere in the chain.
		expect(
			await trpcErrorCode(async () =>
				repin(
					{
						projectId: project.id,
						designId: design.id,
						pageId: crypto.randomUUID(),
						blockId: staleBlock,
					},
					{ componentId },
					session,
				),
			),
		).toBe("NOT_FOUND");
		expect(
			await trpcErrorCode(async () =>
				repin(
					{
						projectId: project.id,
						designId: design.id,
						pageId: page,
						blockId: crypto.randomUUID(),
					},
					{ componentId },
					session,
				),
			),
		).toBe("NOT_FOUND");

		// A soft-deleted component cannot be pinned.
		const deletedId = await seedComponent(project.id, {
			name: "Deleted",
			tagName: "tb-deleted",
			deletedAt: nowIso(),
		});
		expect(
			await trpcErrorCode(async () =>
				repin(
					{
						projectId: project.id,
						designId: design.id,
						pageId: page,
						blockId: staleBlock,
					},
					{ componentId: deletedId },
					session,
				),
			),
		).toBe("NOT_FOUND");
	});
});

describe("designs.get publication pointer", () => {
	it("returns the latest publication (null without rows)", async () => {
		const design = await createDesign();
		const client = adminClient(await createAdminSession());

		const before = await client.designs.get.query({ projectId: design.id });
		expect(before.publication).toBeNull();

		await env.DB.prepare(
			`INSERT INTO "Publication" (id, designId, version, renderedR2Key, createdAt)
			 VALUES (?, ?, 2, 'designs/x/publications/2', ?)`,
		)
			.bind(crypto.randomUUID(), design.id, nowIso())
			.run();
		await env.DB.prepare(
			`INSERT INTO "Publication" (id, designId, version, renderedR2Key, createdAt)
			 VALUES (?, ?, 1, 'designs/x/publications/1', ?)`,
		)
			.bind(crypto.randomUUID(), design.id, nowIso())
			.run();

		const after = await client.designs.get.query({ projectId: design.id });
		expect(after.publication).toMatchObject({ version: 2 });
	});
});
