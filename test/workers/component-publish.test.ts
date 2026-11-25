// Worker tests for the KUK-921 publish pipeline: component publish/restore/
// retire through the designs.components tRPC procedures (real D1 + R2 test
// bindings) and createPublication over seeded Page/PageBlock rows — DB
// state, bundle objects (content-type + immutable header), manifest
// reproducibility, and legacy designs without pages left untouched.
import { env } from "cloudflare:workers";
import { launch } from "@cloudflare/playwright";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAdminSession, type TestSession } from "../helpers/auth";
import { createDesign, createProject } from "../helpers/fixtures";
import { startWorkerRequest } from "../helpers/request";
import {
	createTrpcTestClient,
	type TrpcTestClient,
	trpcErrorCode,
	trpcErrorMessage,
} from "../helpers/trpc";

vi.mock("@cloudflare/playwright", () => ({ launch: vi.fn() }));

const COMPONENT_JS =
	'class TbHero extends HTMLElement {\n\tconnectedCallback() {\n\t\tif (!this.hasAttribute("data-ssr")) this.innerHTML = "<p>hero</p>";\n\t}\n}\ncustomElements.define("tb-hero", TbHero);';
const COMPONENT_CSS = "p { color: var(--tb-color-primary); }";

function mockPreview(bytes = Uint8Array.from([9, 8, 7, 6])) {
	const page = {
		setContent: vi.fn(async () => {}),
		screenshot: vi.fn(async () => bytes),
	};
	const browser = {
		newPage: vi.fn(async () => page),
		close: vi.fn(async () => {}),
	};
	vi.mocked(launch).mockResolvedValue(browser as never);
	return { browser, page };
}

afterEach(() => {
	vi.clearAllMocks();
	vi.restoreAllMocks();
});

const nowIso = () => new Date().toISOString();

function adminClient(session: TestSession): TrpcTestClient {
	return createTrpcTestClient(session.headers);
}

async function seedComponent(
	projectId: string,
	overrides: { publishedVersionId?: string | null } = {},
): Promise<string> {
	const id = crypto.randomUUID();
	await env.DB.prepare(
		`INSERT INTO "Component"
			(id, projectId, name, kind, tagName, publishedVersionId, createdAt, updatedAt)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			id,
			projectId,
			"Hero",
			"section",
			"tb-hero",
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
	overrides: { status?: string; js?: string; css?: string | null } = {},
): Promise<string> {
	const id = crypto.randomUUID();
	await env.DB.prepare(
		`INSERT INTO "ComponentVersion"
			(id, componentId, version, status, js, css, createdAt)
			VALUES (?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			id,
			componentId,
			version,
			overrides.status ?? "draft",
			overrides.js ?? COMPONENT_JS,
			overrides.css === undefined ? COMPONENT_CSS : overrides.css,
			nowIso(),
		)
		.run();
	return id;
}

async function seedPage(
	projectId: string,
	designId: string,
	path: string,
	status: string,
): Promise<string> {
	const id = crypto.randomUUID();
	await env.DB.prepare(
		`INSERT INTO "Page"
			(id, projectId, designId, path, title, status, createdAt, updatedAt)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			id,
			projectId,
			designId,
			path,
			`Page ${path}`,
			status,
			nowIso(),
			nowIso(),
		)
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
		`INSERT INTO "PageBlock"
			(id, pageId, ordinal, componentVersionId)
			VALUES (?, ?, ?, ?)`,
	)
		.bind(id, pageId, ordinal, componentVersionId)
		.run();
	return id;
}

async function componentRow(componentId: string) {
	return env.DB.prepare(
		'SELECT "publishedVersionId" FROM "Component" WHERE "id" = ?',
	)
		.bind(componentId)
		.first<{ publishedVersionId: string | null }>();
}

async function versionRow(versionId: string) {
	return env.DB.prepare(
		'SELECT "status", "version" FROM "ComponentVersion" WHERE "id" = ?',
	)
		.bind(versionId)
		.first<{ status: string; version: number }>();
}

async function bundleObject(key: string) {
	return env.DESIGNS.head(key);
}

function publishVersion(
	projectId: string,
	componentId: string,
	versionId: string,
	session: TestSession,
) {
	return adminClient(session).designs.components.publish.mutate({
		projectId,
		componentId,
		versionId,
	});
}

describe("designs.components publish/restore/retire", () => {
	it("publishes a draft through the procedure: DB state + immutable R2 bundles", async () => {
		const session = await createAdminSession();
		const project = await createProject();
		const componentId = await seedComponent(project.id);
		const v1 = await seedVersion(componentId, 1);
		mockPreview();

		const body = await publishVersion(project.id, componentId, v1, session);
		expect(body).toEqual({
			componentId,
			versionId: v1,
			version: 1,
			retiredVersionId: null,
		});

		expect(await componentRow(componentId)).toEqual({
			publishedVersionId: v1,
		});
		expect(await versionRow(v1)).toEqual({ status: "published", version: 1 });

		const js = await bundleObject(`components/${componentId}/v1.js`);
		expect(js).not.toBeNull();
		expect(js?.httpMetadata?.contentType).toBe("text/javascript");
		expect(js?.httpMetadata?.cacheControl).toBe(
			"public, max-age=31536000, immutable",
		);
		const jsBody = await env.DESIGNS.get(`components/${componentId}/v1.js`);
		expect(await jsBody?.text()).toBe(COMPONENT_JS);
		const css = await bundleObject(`components/${componentId}/v1.css`);
		expect(css?.httpMetadata?.contentType).toBe("text/css");
	});

	it("publishing v2 retires v1 without touching PageBlock pins", async () => {
		const session = await createAdminSession();
		const project = await createProject();
		const componentId = await seedComponent(project.id);
		const v1 = await seedVersion(componentId, 1);
		await publishVersion(project.id, componentId, v1, session);
		const v2 = await seedVersion(componentId, 2);

		// A page pinned to v1 before the second publish.
		const design = await createDesign({ projectId: project.id });
		const pageId = await seedPage(project.id, design.id, "/", "published");
		const blockId = await seedBlock(pageId, 0, v1);

		await publishVersion(project.id, componentId, v2, session);
		expect(await versionRow(v1)).toEqual({ status: "retired", version: 1 });
		expect(await versionRow(v2)).toEqual({ status: "published", version: 2 });
		expect(await componentRow(componentId)).toEqual({ publishedVersionId: v2 });
		// Manual re-pin: the block still points at v1.
		expect(
			await env.DB.prepare(
				'SELECT "componentVersionId" FROM "PageBlock" WHERE "id" = ?',
			)
				.bind(blockId)
				.first<{ componentVersionId: string } | null>(),
		).toEqual({ componentVersionId: v1 });
	});

	it("rejects a draft that fails validation with BAD_REQUEST and writes nothing", async () => {
		const session = await createAdminSession();
		const project = await createProject();
		const componentId = await seedComponent(project.id);
		const bad = await seedVersion(componentId, 1, { js: "const x = 1;" });

		const code = await trpcErrorCode(() =>
			publishVersion(project.id, componentId, bad, session),
		);
		expect(code).toBe("BAD_REQUEST");
		const message = await trpcErrorMessage(() =>
			publishVersion(project.id, componentId, bad, session),
		);
		expect(message).toContain("component draft rejected");
		expect(await versionRow(bad)).toEqual({ status: "draft", version: 1 });
		expect(await componentRow(componentId)).toEqual({
			publishedVersionId: null,
		});
		expect(await bundleObject(`components/${componentId}/v1.js`)).toBeNull();
	});

	it("refuses to double-publish with CONFLICT and rejects unknown versions with NOT_FOUND", async () => {
		const session = await createAdminSession();
		const project = await createProject();
		const componentId = await seedComponent(project.id);
		const v1 = await seedVersion(componentId, 1);
		await publishVersion(project.id, componentId, v1, session);
		expect(
			await trpcErrorCode(() =>
				publishVersion(project.id, componentId, v1, session),
			),
		).toBe("CONFLICT");

		expect(
			await trpcErrorCode(() =>
				publishVersion(project.id, componentId, crypto.randomUUID(), session),
			),
		).toBe("NOT_FOUND");
	});

	it("restore creates a new version copying the old content", async () => {
		const session = await createAdminSession();
		const project = await createProject();
		const componentId = await seedComponent(project.id);
		const v1 = await seedVersion(componentId, 1, { css: null });
		await publishVersion(project.id, componentId, v1, session);
		const v2 = await seedVersion(componentId, 2, { css: "/* v2 */" });
		await publishVersion(project.id, componentId, v2, session);

		const body = await adminClient(session).designs.components.restore.mutate({
			projectId: project.id,
			componentId,
			versionId: v1,
		});
		expect(body.version).toBe(3);

		// The new row copies v1's content (no css) and never mutates the source.
		const restored = await env.DB.prepare(
			'SELECT "version", "status", "js", "css", "changeNote" FROM "ComponentVersion" WHERE "id" = ?',
		)
			.bind(body.versionId)
			.first<{
				version: number;
				status: string;
				js: string;
				css: string | null;
				changeNote: string;
			}>();
		expect(restored).toEqual({
			version: 3,
			status: "published",
			js: COMPONENT_JS,
			css: null,
			changeNote: "restored from v1",
		});
		expect(await versionRow(v1)).toEqual({ status: "retired", version: 1 });
		expect(await componentRow(componentId)).toEqual({
			publishedVersionId: body.versionId,
		});
	});

	it("retire nulls the pointer without replacement", async () => {
		const session = await createAdminSession();
		const project = await createProject();
		const componentId = await seedComponent(project.id);
		const v1 = await seedVersion(componentId, 1);
		await publishVersion(project.id, componentId, v1, session);

		await adminClient(session).designs.components.retire.mutate({
			projectId: project.id,
			componentId,
		});
		expect(await componentRow(componentId)).toEqual({
			publishedVersionId: null,
		});
		expect(await versionRow(v1)).toEqual({ status: "retired", version: 1 });

		// Retiring again has nothing to retire.
		expect(
			await trpcErrorCode(() =>
				adminClient(session).designs.components.retire.mutate({
					projectId: project.id,
					componentId,
				}),
			),
		).toBe("CONFLICT");
	});

	it("requires an admin session and scope-matches the project", async () => {
		const project = await createProject();
		const componentId = await seedComponent(project.id);
		const v1 = await seedVersion(componentId, 1);

		const anonymous = createTrpcTestClient();
		expect(
			await trpcErrorCode(() =>
				anonymous.designs.components.publish.mutate({
					projectId: project.id,
					componentId,
					versionId: v1,
				}),
			),
		).toBe("UNAUTHORIZED");

		// Another project's scope must not see this component.
		const other = await createProject();
		const session = await createAdminSession();
		expect(
			await trpcErrorCode(() =>
				publishVersion(other.id, componentId, v1, session),
			),
		).toBe("NOT_FOUND");
	});
});

describe("createPublication (KUK-921)", () => {
	it("returns null and writes nothing for a legacy design without pages", async () => {
		const { createPublication } = await import(
			"@/features/design-studio/publish/design-publish"
		);
		const { getPrisma } = await import("../../src/lib/db");
		const project = await createProject();
		const design = await createDesign({ projectId: project.id });

		const result = await createPublication(getPrisma(env), env, design.id);
		expect(result).toBeNull();
		expect(
			await env.DESIGNS.list({
				prefix: `designs/${design.id}/publications/`,
			}),
		).toMatchObject({ objects: [] });
	});

	it("snapshots a seeded page: composed HTML, manifest, preview, live pointer", async () => {
		mockPreview();
		const session = await createAdminSession();
		const { createPublication } = await import(
			"@/features/design-studio/publish/design-publish"
		);
		const { getPrisma } = await import("../../src/lib/db");
		const project = await createProject();
		const design = await createDesign({ projectId: project.id });
		const componentId = await seedComponent(project.id);
		const v1 = await seedVersion(componentId, 1);

		// Publish the component through the real procedure so the bundle + DB
		// state are the production-shaped ones.
		await publishVersion(project.id, componentId, v1, session);

		const pageId = await seedPage(project.id, design.id, "/", "published");
		const blockId = await seedBlock(pageId, 0, v1);

		const result = await createPublication(getPrisma(env), env, design.id);
		if (!result) throw new Error("publication was not created");
		const { version, publicationId } = result;

		// Publication row with the manifest JSON on the column.
		const row = await env.DB.prepare(
			'SELECT "version", "renderedR2Key", "previewR2Key", "manifest" FROM "Publication" WHERE "designId" = ?',
		)
			.bind(design.id)
			.first<{
				version: number;
				renderedR2Key: string;
				previewR2Key: string;
				manifest: string;
			}>();
		expect(row?.version).toBe(version);
		expect(row?.renderedR2Key).toBe(
			`designs/${design.id}/publications/${version}`,
		);
		const manifest = JSON.parse(row?.manifest ?? "null") as {
			pages: {
				path: string;
				htmlR2Key: string;
				blocks: {
					blockId: string;
					componentVersionId: string;
					bundleUrl: string;
				}[];
			}[];
		};
		expect(manifest.pages).toHaveLength(1);
		expect(manifest.pages[0].path).toBe("/");
		expect(manifest.pages[0].blocks).toEqual([
			{
				blockId,
				componentVersionId: v1,
				bundleUrl: `/projects/${project.id}/components/${componentId}/v1.js`,
			},
		]);

		// Snapshot artifacts in R2.
		const snapshotObject = await env.DESIGNS.get(
			`designs/${design.id}/publications/${version}/index.html`,
		);
		const snapshotHtml = (await snapshotObject?.text()) ?? "";
		expect(snapshotHtml).toContain("<tb-hero");
		expect(snapshotHtml).toContain(
			`import "/projects/${project.id}/components/${componentId}/v1.js";`,
		);
		expect(
			await env.DESIGNS.head(
				`designs/${design.id}/publications/${version}/pages/index/index.html`,
			),
		).not.toBeNull();
		expect(
			await env.DESIGNS.head(
				`designs/${design.id}/publications/${version}/manifest.json`,
			),
		).not.toBeNull();
		const snapshotPreview = await env.DESIGNS.head(
			`designs/${design.id}/publications/${version}/preview.png`,
		);
		expect(snapshotPreview?.httpMetadata?.contentType).toBe("image/png");
		expect(row?.previewR2Key).toBe(
			`designs/${design.id}/publications/${version}/preview.png`,
		);

		// Live pointer committed to the staged turns prefix (serving parity).
		expect(
			await env.DB.prepare('SELECT "liveTurnId" FROM "Design" WHERE "id" = ?')
				.bind(design.id)
				.first<{ liveTurnId: string } | null>(),
		).toEqual({ liveTurnId: publicationId });
		const site = await startWorkerRequest(`/designs/${design.id}/site`);
		expect(site.status).toBe(200);
		expect(await site.text()).toBe(snapshotHtml);
	});

	it("is deterministic: two publications of the same pins share manifest pins", async () => {
		mockPreview();
		const { createPublication } = await import(
			"@/features/design-studio/publish/design-publish"
		);
		const { getPrisma } = await import("../../src/lib/db");
		const project = await createProject();
		const design = await createDesign({ projectId: project.id });
		const componentId = await seedComponent(project.id);
		// The pinned version must be published for compose to render the block.
		const v1 = await seedVersion(componentId, 1, { status: "published" });
		const pageId = await seedPage(project.id, design.id, "/", "published");
		await seedBlock(pageId, 0, v1);

		const first = await createPublication(getPrisma(env), env, design.id);
		const second = await createPublication(getPrisma(env), env, design.id);
		expect(first?.version).toBe(1);
		expect(second?.version).toBe(2);

		const manifests = await env.DB.prepare(
			'SELECT "version", "manifest" FROM "Publication" WHERE "designId" = ? ORDER BY "version"',
		)
			.bind(design.id)
			.all<{ version: number; manifest: string }>();
		const pins = manifests.results.map(
			(row) => JSON.parse(row.manifest).pages[0].blocks,
		);
		// Compose is pure: same pinned rows → identical pins (only the version
		// embedding in htmlR2Key differs).
		expect(pins[0]).toEqual(pins[1]);
		expect(JSON.parse(manifests.results[0].manifest).pages[0].path).toBe("/");
	});

	it("fails the publication when a page fails composition", async () => {
		mockPreview();
		const { createPublication } = await import(
			"@/features/design-studio/publish/design-publish"
		);
		const { getPrisma } = await import("../../src/lib/db");
		const project = await createProject();
		const design = await createDesign({ projectId: project.id });
		const componentId = await seedComponent(project.id);
		// Draft version: pinned but not published — a compose error.
		const draft = await seedVersion(componentId, 1, { status: "draft" });
		const pageId = await seedPage(project.id, design.id, "/", "published");
		await seedBlock(pageId, 0, draft);

		await expect(
			createPublication(getPrisma(env), env, design.id),
		).rejects.toThrow(/failed composition/);
		const rows = await env.DB.prepare(
			'SELECT "id" FROM "Publication" WHERE "designId" = ?',
		)
			.bind(design.id)
			.all();
		expect(rows.results).toEqual([]);
	});

	it("ignores draft pages (only published pages snapshot)", async () => {
		mockPreview();
		const { createPublication } = await import(
			"@/features/design-studio/publish/design-publish"
		);
		const { getPrisma } = await import("../../src/lib/db");
		const project = await createProject();
		const design = await createDesign({ projectId: project.id });
		const componentId = await seedComponent(project.id);
		const v1 = await seedVersion(componentId, 1);
		const pageId = await seedPage(project.id, design.id, "/", "draft");
		await seedBlock(pageId, 0, v1);

		const result = await createPublication(getPrisma(env), env, design.id);
		expect(result).toBeNull();
	});
});
