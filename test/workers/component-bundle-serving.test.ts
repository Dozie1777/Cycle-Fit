// Worker tests for the KUK-923 serving surface: component bundles at the
// componentBundlePath contract routes and publication snapshots (time-travel
// pages) — real D1 + R2 test bindings, served through the Start routes.
//
// Bundle posture: v<n>.<ext> is served publicly only for published/retired
// versions of a live component in the path's project; drafts, cross-project
// paths, and soft-deleted components 404. Publication posture: the row's
// manifest is the page index — paths map through publicationPageSegment to
// the snapshot keys; unknown pages/versions 404.
import { env } from "cloudflare:workers";
import { launch } from "@cloudflare/playwright";
import { afterEach, describe, expect, it, vi } from "vitest";
import { publicationPageSegment } from "@/features/design-studio/publish/publication-segment";
import { createAdminSession } from "../helpers/auth";
import { createDesign, createProject } from "../helpers/fixtures";
import { startWorkerRequest } from "../helpers/request";
import { createTrpcTestClient } from "../helpers/trpc";

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

async function seedComponent(projectId: string): Promise<string> {
	const id = crypto.randomUUID();
	await env.DB.prepare(
		`INSERT INTO "Component"
			(id, projectId, name, kind, tagName, publishedVersionId, createdAt, updatedAt)
			VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
	)
		.bind(id, projectId, "Hero", "section", "tb-hero", nowIso(), nowIso())
		.run();
	return id;
}

async function seedVersion(
	componentId: string,
	version: number,
	overrides: { status?: string; css?: string | null } = {},
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
			COMPONENT_JS,
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
	componentVersionId: string,
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

async function publishVersion(
	projectId: string,
	componentId: string,
	versionId: string,
): Promise<void> {
	const session = await createAdminSession();
	await createTrpcTestClient(session.headers).designs.components.publish.mutate(
		{
			projectId,
			componentId,
			versionId,
		},
	);
}

async function softDeleteComponent(componentId: string): Promise<void> {
	await env.DB.prepare('UPDATE "Component" SET "deletedAt" = ? WHERE "id" = ?')
		.bind(nowIso(), componentId)
		.run();
}

describe("Component bundle serving (KUK-923)", () => {
	it("serves the published v1 bundle publicly with R2 metadata preserved", async () => {
		const project = await createProject();
		const componentId = await seedComponent(project.id);
		const v1 = await seedVersion(componentId, 1);
		await publishVersion(project.id, componentId, v1);

		const js = await startWorkerRequest(
			`/projects/${project.id}/components/${componentId}/v1.js`,
		);
		expect(js.status).toBe(200);
		expect(js.headers.get("content-type")).toBe("text/javascript");
		expect(js.headers.get("cache-control")).toBe(
			"public, max-age=31536000, immutable",
		);
		expect(js.headers.get("x-content-type-options")).toBe("nosniff");
		expect(js.headers.get("content-security-policy")).toContain("sandbox");
		// Sandboxed site pages (opaque origin) import bundles cross-origin —
		// without ACAO the module fetch is blocked and hydration never runs.
		expect(js.headers.get("access-control-allow-origin")).toBe("*");
		expect(await js.text()).toBe(COMPONENT_JS);

		const css = await startWorkerRequest(
			`/projects/${project.id}/components/${componentId}/v1.css`,
		);
		expect(css.status).toBe(200);
		expect(css.headers.get("content-type")).toBe("text/css");
		expect(css.headers.get("cache-control")).toBe(
			"public, max-age=31536000, immutable",
		);
		expect(await css.text()).toBe(COMPONENT_CSS);
	});

	it("never serves a draft version", async () => {
		const project = await createProject();
		const componentId = await seedComponent(project.id);
		const v1 = await seedVersion(componentId, 1);
		await publishVersion(project.id, componentId, v1);
		const _v2 = await seedVersion(componentId, 2);

		const draft = await startWorkerRequest(
			`/projects/${project.id}/components/${componentId}/v2.js`,
		);
		expect(draft.status).toBe(404);
		// Same for the draft's css, whether or not the R2 object exists.
		const draftCss = await startWorkerRequest(
			`/projects/${project.id}/components/${componentId}/v2.css`,
		);
		expect(draftCss.status).toBe(404);
	});

	it("404s a cross-project path; soft-deleted components keep serving snapshots", async () => {
		const project = await createProject();
		const componentId = await seedComponent(project.id);
		const v1 = await seedVersion(componentId, 1);
		await publishVersion(project.id, componentId, v1);

		const other = await createProject();
		const crossProject = await startWorkerRequest(
			`/projects/${other.id}/components/${componentId}/v1.js`,
		);
		expect(crossProject.status).toBe(404);

		// Deletion is soft precisely so existing publication snapshots keep
		// their pinned bytes — published/retired bundles stay servable after
		// a soft delete.
		await softDeleteComponent(componentId);
		const deleted = await startWorkerRequest(
			`/projects/${project.id}/components/${componentId}/v1.js`,
		);
		expect(deleted.status).toBe(200);
		expect(await deleted.text()).toBe(COMPONENT_JS);
	});

	it("keeps retired versions servable (existing publications pin them)", async () => {
		const project = await createProject();
		const componentId = await seedComponent(project.id);
		const v1 = await seedVersion(componentId, 1);
		await publishVersion(project.id, componentId, v1);
		const v2 = await seedVersion(componentId, 2);
		await publishVersion(project.id, componentId, v2);

		// v1 was retired by the v2 publish — both are servable.
		expect(await versionStatus(v1)).toBe("retired");
		const retired = await startWorkerRequest(
			`/projects/${project.id}/components/${componentId}/v1.js`,
		);
		expect(retired.status).toBe(200);
		expect(await retired.text()).toBe(COMPONENT_JS);
		const current = await startWorkerRequest(
			`/projects/${project.id}/components/${componentId}/v2.js`,
		);
		expect(current.status).toBe(200);
	});

	it("rejects file segments that are not v<n>.js|.css and unknown components", async () => {
		const project = await createProject();
		const componentId = await seedComponent(project.id);
		const v1 = await seedVersion(componentId, 1);
		await publishVersion(project.id, componentId, v1);

		for (const file of [
			"vX.js",
			"v1.php",
			"v01.js",
			"v0.js",
			"1.js",
			"v1",
			"index.html",
		]) {
			const response = await startWorkerRequest(
				`/projects/${project.id}/components/${componentId}/${file}`,
			);
			expect(response.status, file).toBe(404);
		}

		const unknownComponent = await startWorkerRequest(
			`/projects/${project.id}/components/${crypto.randomUUID()}/v1.js`,
		);
		expect(unknownComponent.status).toBe(404);
	});
});

async function versionStatus(versionId: string): Promise<string | null> {
	const row = await env.DB.prepare(
		'SELECT "status" FROM "ComponentVersion" WHERE "id" = ?',
	)
		.bind(versionId)
		.first<{ status: string }>();
	return row?.status ?? null;
}

describe("Publication page serving (KUK-923)", () => {
	async function seedTwoPagePublication(): Promise<{
		designId: string;
		version: number;
	}> {
		mockPreview();
		const { createPublication } = await import(
			"@/features/design-studio/publish/design-publish"
		);
		const { getPrisma } = await import("../../src/lib/db");
		const project = await createProject();
		const design = await createDesign({ projectId: project.id });
		const componentId = await seedComponent(project.id);
		const v1 = await seedVersion(componentId, 1);
		await publishVersion(project.id, componentId, v1);

		const homepage = await seedPage(project.id, design.id, "/", "published");
		await seedBlock(homepage, 0, v1);
		const pricing = await seedPage(
			project.id,
			design.id,
			"/pricing",
			"published",
		);
		await seedBlock(pricing, 0, v1);

		const result = await createPublication(getPrisma(env), env, design.id);
		if (!result) throw new Error("publication was not created");
		return { designId: design.id, version: result.version };
	}

	it("serves the live homepage via the site route and the snapshot pages via the publication route", async () => {
		const { designId, version } = await seedTwoPagePublication();

		// Homepage: live pointer (unchanged existing route).
		const site = await startWorkerRequest(`/designs/${designId}/site`);
		expect(site.status).toBe(200);
		const siteHtml = await site.text();
		expect(siteHtml).toContain("<tb-hero");

		// Version root: the snapshot's homepage (pages/index/index.html).
		const root = await startWorkerRequest(
			`/designs/${designId}/publication/${version}`,
		);
		expect(root.status).toBe(200);
		expect(root.headers.get("content-type")).toBe("text/html; charset=utf-8");
		expect(root.headers.get("content-security-policy")).toContain("sandbox");
		const snapshotHomepage = await env.DESIGNS.get(
			`designs/${designId}/publications/${version}/pages/index/index.html`,
		);
		expect(await root.text()).toBe((await snapshotHomepage?.text()) ?? "");

		// /pricing → pages/p/pricing/index.html (publicationPageSegment).
		const pricing = await startWorkerRequest(
			`/designs/${designId}/publication/${version}/pricing`,
		);
		expect(pricing.status).toBe(200);
		expect(pricing.headers.get("content-type")).toBe(
			"text/html; charset=utf-8",
		);
		const snapshotPricing = await env.DESIGNS.get(
			`designs/${designId}/publications/${version}/pages/p/pricing/index.html`,
		);
		expect(snapshotPricing).not.toBeNull();
		const pricingHtml = (await snapshotPricing?.text()) ?? "";
		expect(await pricing.text()).toBe(pricingHtml);
		// Distinct page: not the homepage's markup.
		expect(pricingHtml).not.toBe(siteHtml);

		// The live site route keeps serving the same homepage markup.
		expect(siteHtml).toBe(
			(await (
				await env.DESIGNS.get(
					`designs/${designId}/publications/${version}/pages/index/index.html`,
				)
			)?.text()) ?? "",
		);
	});

	it("404s unknown paths, unknown versions, and malformed versions", async () => {
		const { designId, version } = await seedTwoPagePublication();

		expect(
			(
				await startWorkerRequest(
					`/designs/${designId}/publication/${version}/nope`,
				)
			).status,
		).toBe(404);
		expect(
			(await startWorkerRequest(`/designs/${designId}/publication/999/pricing`))
				.status,
		).toBe(404);
		expect(
			(await startWorkerRequest(`/designs/${designId}/publication/0/pricing`))
				.status,
		).toBe(404);
		expect(
			(
				await startWorkerRequest(
					`/designs/${designId}/publication/not-a-number/pricing`,
				)
			).status,
		).toBe(404);
		// A version snapshot without a Publication row 404s even if R2 bytes
		// existed: guard against orphaned prefixes.
		await env.DESIGNS.put(
			`designs/${designId}/publications/7/pages/index/index.html`,
			"<html>orphan</html>",
			{ httpMetadata: { contentType: "text/html" } },
		);
		expect(
			(await startWorkerRequest(`/designs/${designId}/publication/7`)).status,
		).toBe(404);
	});

	it("serves exactly the manifest's pages — paths match publicationPageSegment", async () => {
		const { designId, version } = await seedTwoPagePublication();
		const row = await env.DB.prepare(
			'SELECT "manifest" FROM "Publication" WHERE "designId" = ? AND "version" = ?',
		)
			.bind(designId, version)
			.first<{ manifest: string }>();
		const manifest = JSON.parse(row?.manifest ?? "null") as {
			pages: { path: string; htmlR2Key: string }[];
		};
		expect(manifest.pages.map((page) => page.path).sort()).toEqual([
			"/",
			"/pricing",
		]);

		for (const page of manifest.pages) {
			// The served body for the page's site path is the manifest's
			// htmlR2Key object — the manifest is the publication index.
			const served = await startWorkerRequest(
				`/designs/${designId}/publication/${version}${page.path === "/" ? "" : page.path}`,
			);
			expect(served.status, page.path).toBe(200);
			const recorded = await env.DESIGNS.get(page.htmlR2Key);
			expect(await served.text()).toBe((await recorded?.text()) ?? "");
			// And the path→segment convention holds (injective mapping check).
			expect(page.htmlR2Key).toContain(
				`/pages/${publicationPageSegment(page.path)}/index.html`,
			);
		}
	});
});
