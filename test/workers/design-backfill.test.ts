// Worker tests for KUK-930: legacy designs (monolithic self-contained HTML,
// no Page/Publication rows) keep serving exactly as before — site/preview,
// admin detail with draft-derived sections, R2-key version lists, and
// restore — and the admin-triggered backfill procedure (designs.backfill)
// converts one into first-class building blocks (Page + one-off sourceHtml
// blocks, derived tokens, initial publication) without touching a single
// legacy R2 artifact.
import { env } from "cloudflare:workers";
import { launch } from "@cloudflare/playwright";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createAdminSession,
	createUserSession,
	type TestSession,
} from "../helpers/auth";
import {
	createDesign,
	createProject,
	putDesignFile,
} from "../helpers/fixtures";
import { startWorkerRequest } from "../helpers/request";
import {
	createTrpcTestClient,
	type TrpcTestClient,
	trpcErrorCode,
	trpcErrorMessage,
} from "../helpers/trpc";

vi.mock("@cloudflare/playwright", () => ({ launch: vi.fn() }));

afterEach(() => {
	vi.clearAllMocks();
	vi.restoreAllMocks();
});

function mockPreview(bytes = Uint8Array.from([5, 6, 7, 8])) {
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

const SECTION_HERO = `<section data-section="hero"><h1>Legacy hero</h1></section>`;
const SECTION_FEATURES = `<section data-section="features" class="wrap"><p>three features</p></section>`;
const SECTION_FOOTER = `<footer data-section='footer'><small>bye</small></footer>`;
const LEGACY_HEAD_STYLE = `<style>:root { --primary: #7c3aed; --font-heading: 'Inter', sans-serif; --spacing-md: 16px; }</style>`;
const LEGACY_HEAD_LINK = `<link rel="stylesheet" href="https://example.com/legacy.css">`;
// Head assets become the first block (style/link render document-wide from
// the body), then one block per top-level body segment in order — including
// the unmarked <main> wrapper (raw segment carrying its complete markup).
const HEAD_ASSETS = `${LEGACY_HEAD_STYLE}\n${LEGACY_HEAD_LINK}`;
const RAW_MAIN = `<main><p>unmarked filler</p></main>`;
const LEGACY_HTML = `<!doctype html>
<html>
<head><title>Legacy Landing</title>${LEGACY_HEAD_STYLE}${LEGACY_HEAD_LINK}</head>
<body>
${SECTION_HERO}
<main><p>unmarked filler</p></main>
${SECTION_FEATURES}
${SECTION_FOOTER}
</body>
</html>`;
const SCRIPT_HTML = `<!doctype html>
<html>
<head><title>With script</title>${LEGACY_HEAD_STYLE}<script>console.log("head")</script></head>
<body>
${SECTION_HERO}
<script>console.log("body")</script>
</body>
</html>`;
const SECTIONLESS_HTML =
	"<!doctype html><html><head><title>Flat</title></head><body><p>no markers</p></body></html>";

function adminClient(session: TestSession): TrpcTestClient {
	return createTrpcTestClient(session.headers);
}

async function seedLegacyDesign(options: {
	projectId: string;
	html?: string;
}): Promise<{ designId: string; html: string }> {
	const html = options.html ?? LEGACY_HTML;
	const design = await createDesign({ projectId: options.projectId });
	await putDesignFile(design.id, "index.html", html, "text/html");
	await putDesignFile(design.id, "preview.png", "png", "image/png");
	await putDesignFile(design.id, "drafts/hero.html", SECTION_HERO, "text/html");
	await putDesignFile(design.id, "versions/1/index.html", html, "text/html");
	await putDesignFile(design.id, "versions/1/preview.png", "png", "image/png");
	return { designId: design.id, html };
}

async function objectFingerprint(key: string) {
	const head = await env.DESIGNS.head(key);
	if (!head) return null;
	return {
		size: head.size,
		uploaded: head.uploaded.toISOString(),
		checksum: head.httpEtag,
	};
}

async function seedPageRow(input: {
	projectId: string;
	designId: string;
	path?: string;
	status?: string;
}): Promise<string> {
	const id = crypto.randomUUID();
	const now = new Date().toISOString();
	await env.DB.prepare(
		`INSERT INTO "Page"
			(id, projectId, designId, path, title, status, createdAt, updatedAt)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			id,
			input.projectId,
			input.designId,
			input.path ?? "/",
			"Partial attempt",
			input.status ?? "published",
			now,
			now,
		)
		.run();
	return id;
}

async function seedPageBlockRow(
	pageId: string,
	ordinal: number,
	sourceHtml: string,
): Promise<string> {
	const id = crypto.randomUUID();
	await env.DB.prepare(
		`INSERT INTO "PageBlock" (id, pageId, ordinal, sourceHtml) VALUES (?, ?, ?, ?)`,
	)
		.bind(id, pageId, ordinal, sourceHtml)
		.run();
	return id;
}

async function seedPublicationRow(input: {
	designId: string;
	version: number;
}): Promise<string> {
	const id = crypto.randomUUID();
	await env.DB.prepare(
		`INSERT INTO "Publication"
			(id, designId, version, "renderedR2Key", createdAt)
			VALUES (?, ?, ?, ?, ?)`,
	)
		.bind(
			id,
			input.designId,
			input.version,
			`designs/${input.designId}/publications/${input.version}`,
			new Date().toISOString(),
		)
		.run();
	return id;
}

describe("legacy designs keep working without conversion (KUK-930)", () => {
	it("serves the monolithic site, preview, detail sections, and R2 version list unchanged", async () => {
		const project = await createProject();
		const { designId } = await seedLegacyDesign({ projectId: project.id });

		// Public site route: the root-level monolithic document, byte-for-byte.
		const site = await startWorkerRequest(`/designs/${designId}/site`);
		expect(site.status).toBe(200);
		expect(await site.text()).toBe(LEGACY_HTML);

		const preview = await startWorkerRequest(`/designs/${designId}/preview`);
		expect(preview.status).toBe(200);
		expect(await preview.text()).toBe("png");

		// Admin detail: sections still emerge from drafts/*.html.
		const session = await createAdminSession();
		const detail = await adminClient(session).designs.get.query({
			projectId: designId,
		});
		expect(detail.hasIndex).toBe(true);
		expect(detail.sections).toEqual(["hero"]);

		// Version list is R2-key derived (no DB rows involved).
		const versions = await adminClient(session).designs.listVersions.query({
			projectId: designId,
		});
		expect(versions).toEqual([
			{ n: 1, createdAt: expect.any(String), hasPreview: true },
		]);

		// No building-block artifacts exist anywhere.
		const pages = await env.DB.prepare(
			'SELECT COUNT(*) AS c FROM "Page"',
		).first<{ c: number }>();
		const publications = await env.DB.prepare(
			'SELECT COUNT(*) AS c FROM "Publication"',
		).first<{ c: number }>();
		expect(pages?.c).toBe(0);
		expect(publications?.c).toBe(0);
	});

	it("restore appends an R2 version and creates no publication for a legacy design", async () => {
		mockPreview();
		const project = await createProject();
		const { designId } = await seedLegacyDesign({ projectId: project.id });
		const session = await createAdminSession();

		const restored = await adminClient(session).designs.restoreVersion.mutate({
			projectId: designId,
			n: 1,
		});
		expect(restored).toEqual({ version: 2 });

		const versions = await adminClient(session).designs.listVersions.query({
			projectId: designId,
		});
		expect(versions).toEqual([
			{ n: 2, createdAt: expect.any(String), hasPreview: true },
			{ n: 1, createdAt: expect.any(String), hasPreview: true },
		]);

		// The restore stays on the monolithic publish path: staged live HTML is
		// the original document, and no Publication row was created.
		const liveTurnId = await env.DB.prepare(
			'SELECT "liveTurnId" FROM "Design" WHERE "id" = ?',
		)
			.bind(designId)
			.first<{ liveTurnId: string | null }>()
			.then((row) => row?.liveTurnId);
		expect(
			await env.DESIGNS.get(
				`designs/${designId}/turns/${liveTurnId}/index.html`,
			).then((object) => object?.text()),
		).toBe(LEGACY_HTML);
		expect(
			await env.DB.prepare(
				'SELECT COUNT(*) AS c FROM "Publication" WHERE "designId" = ?',
			)
				.bind(designId)
				.first<{ c: number }>(),
		).toEqual({ c: 0 });
	});
});

describe("designs.backfill (KUK-930)", () => {
	it("converts a legacy design into a page, sourceHtml blocks, tokens, and publication 1", async () => {
		mockPreview();
		const project = await createProject();
		const { designId } = await seedLegacyDesign({ projectId: project.id });
		const fingerprints = {
			live: await objectFingerprint(`designs/${designId}/index.html`),
			draft: await objectFingerprint(`designs/${designId}/drafts/hero.html`),
			version: await objectFingerprint(
				`designs/${designId}/versions/1/index.html`,
			),
		};
		const session = await createAdminSession();

		const response = await adminClient(session).designs.backfill.mutate({
			projectId: project.id,
			designId,
		});
		expect(response).toEqual({
			ok: true,
			pageCount: 1,
			blockCount: 5,
			publicationVersion: 1,
		});

		// Page row: the container project, linked to the design, published.
		const page = await env.DB.prepare(
			`SELECT "id", "projectId", "designId", "path", "title", "status"
				FROM "Page" WHERE "designId" = ?`,
		)
			.bind(designId)
			.first<{
				id: string;
				projectId: string;
				designId: string;
				path: string;
				title: string;
				status: string;
			}>();
		expect(page).toMatchObject({
			projectId: project.id,
			designId,
			path: "/",
			title: "Legacy Landing",
			status: "published",
		});

		// Blocks in document order: head assets first (styling preserved), then
		// one one-off block per body segment — sections AND unmarked content.
		const blocks = await env.DB.prepare(
			`SELECT "ordinal", "sourceHtml", "componentVersionId", "templateId"
				FROM "PageBlock" WHERE "pageId" = ? ORDER BY "ordinal"`,
		)
			.bind(page?.id)
			.all<{
				ordinal: number;
				sourceHtml: string | null;
				componentVersionId: string | null;
				templateId: string | null;
			}>();
		expect(
			blocks.results.map((block) => ({
				ordinal: block.ordinal,
				sourceHtml: block.sourceHtml,
			})),
		).toEqual([
			{ ordinal: 0, sourceHtml: HEAD_ASSETS },
			{ ordinal: 1, sourceHtml: SECTION_HERO },
			{ ordinal: 2, sourceHtml: RAW_MAIN },
			{ ordinal: 3, sourceHtml: SECTION_FEATURES },
			{ ordinal: 4, sourceHtml: SECTION_FOOTER },
		]);
		// One-off blocks — never components or templates.
		expect(
			blocks.results.every(
				(block) =>
					block.componentVersionId === null && block.templateId === null,
			),
		).toBe(true);

		// Tokens derived from the document's :root custom properties into
		// DesignToken rows (the project had no DesignSystem before).
		const tokens = await env.DB.prepare(
			`SELECT "category", "role", "value" FROM "DesignToken" ORDER BY "category", "role"`,
		).all<{ category: string; role: string; value: string }>();
		expect(tokens.results).toEqual([
			{ category: "color", role: "primary", value: "#7c3aed" },
			{ category: "spacing", role: "md", value: "16px" },
			{ category: "typography", role: "heading", value: "'Inter', sans-serif" },
		]);
		const system = await env.DB.prepare(
			'SELECT "projectId" FROM "DesignSystem"',
		).first<{ projectId: string }>();
		expect(system).toEqual({ projectId: project.id });

		// Publication row: version 1, manifest records the page with no
		// component pins (sourceHtml blocks carry none).
		const publication = await env.DB.prepare(
			`SELECT "version", "renderedR2Key", "manifest" FROM "Publication" WHERE "designId" = ?`,
		)
			.bind(designId)
			.first<{
				version: number;
				renderedR2Key: string;
				manifest: string;
			}>();
		expect(publication?.version).toBe(1);
		expect(publication?.renderedR2Key).toBe(
			`designs/${designId}/publications/1`,
		);
		expect(JSON.parse(publication?.manifest ?? "null")).toMatchObject({
			pages: [{ path: "/", blocks: [] }],
		});

		// Legacy R2 artifacts remain untouched (read-only splitter).
		expect(await objectFingerprint(`designs/${designId}/index.html`)).toEqual(
			fingerprints.live,
		);
		expect(
			await objectFingerprint(`designs/${designId}/drafts/hero.html`),
		).toEqual(fingerprints.draft);
		expect(
			await objectFingerprint(`designs/${designId}/versions/1/index.html`),
		).toEqual(fingerprints.version);

		// Live pointer flipped to the publication; the site now serves the
		// composed page (each section inside its stamped block div).
		const liveTurnId = await env.DB.prepare(
			'SELECT "liveTurnId" FROM "Design" WHERE "id" = ?',
		)
			.bind(designId)
			.first<{ liveTurnId: string | null }>()
			.then((row) => row?.liveTurnId);
		expect(liveTurnId).toEqual(expect.any(String));
		const site = await startWorkerRequest(`/designs/${designId}/site`);
		expect(site.status).toBe(200);
		const servedHtml = await site.text();
		expect(servedHtml).toContain("<title>Legacy Landing</title>");
		expect(servedHtml).toContain(`<div data-block-id=`);
		// Original head styling survives: the verbatim <style> and <link> are
		// served (inside the head-assets block), and the unmarked body content
		// is preserved too.
		expect(servedHtml).toContain(LEGACY_HEAD_STYLE);
		expect(servedHtml).toContain(LEGACY_HEAD_LINK);
		expect(servedHtml).toContain("unmarked filler");
		// Document order preserved: head assets → hero → filler → features →
		// footer.
		const order = [
			servedHtml.indexOf(LEGACY_HEAD_STYLE),
			servedHtml.indexOf("Legacy hero"),
			servedHtml.indexOf("unmarked filler"),
			servedHtml.indexOf("three features"),
			servedHtml.indexOf("bye"),
		];
		expect(
			order.every(
				(index, position) =>
					index >= 0 && (position === 0 || index > order[position - 1]),
			),
		).toBe(true);
		expect(servedHtml).toContain(SECTION_HERO);
		expect(servedHtml).toContain(SECTION_FEATURES);
		expect(servedHtml).toContain(SECTION_FOOTER);
		// Composed output contains no component bundle imports (no pins).
		expect(servedHtml).not.toContain('type="module"');
	});

	it("refuses a second backfill when the project already has pages", async () => {
		mockPreview();
		const project = await createProject();
		const { designId } = await seedLegacyDesign({ projectId: project.id });
		const session = await createAdminSession();
		const client = adminClient(session);
		await client.designs.backfill.mutate({
			projectId: project.id,
			designId,
		});

		const second = await trpcErrorCode(() =>
			client.designs.backfill.mutate({ projectId: project.id, designId }),
		);
		expect(second).toBe("CONFLICT");
		expect(
			await trpcErrorMessage(() =>
				client.designs.backfill.mutate({ projectId: project.id, designId }),
			),
		).toBe("already has pages");

		// Still exactly one page / three blocks / one publication.
		const pages = await env.DB.prepare(
			'SELECT COUNT(*) AS c FROM "Page" WHERE "projectId" = ?',
		)
			.bind(project.id)
			.first<{ c: number }>();
		expect(pages?.c).toBe(1);
		const publications = await env.DB.prepare(
			'SELECT COUNT(*) AS c FROM "Publication" WHERE "designId" = ?',
		)
			.bind(designId)
			.first<{ c: number }>();
		expect(publications?.c).toBe(1);
	});

	it("refuses a design without data-section markers cleanly", async () => {
		mockPreview();
		const project = await createProject();
		const { designId } = await seedLegacyDesign({
			projectId: project.id,
			html: SECTIONLESS_HTML,
		});
		const session = await createAdminSession();
		const response = await adminClient(session).designs.backfill.mutate({
			projectId: project.id,
			designId,
		});
		expect(response).toEqual({
			ok: false,
			reason: "no sections",
		});
		// Nothing was fabricated.
		expect(
			await env.DB.prepare('SELECT COUNT(*) AS c FROM "Page"').first(),
		).toEqual({ c: 0 });
		expect(
			await env.DB.prepare('SELECT COUNT(*) AS c FROM "DesignSystem"').first(),
		).toEqual({ c: 0 });
		expect(
			await env.DB.prepare('SELECT COUNT(*) AS c FROM "Publication"').first(),
		).toEqual({ c: 0 });
	});

	it("refuses a document containing script tags with reason 'contains scripts'", async () => {
		mockPreview();
		const project = await createProject();
		const { designId } = await seedLegacyDesign({
			projectId: project.id,
			html: SCRIPT_HTML,
		});
		const session = await createAdminSession();
		const response = await adminClient(session).designs.backfill.mutate({
			projectId: project.id,
			designId,
		});
		expect(response).toEqual({
			ok: false,
			reason: "contains scripts",
		});
		// Nothing was created — behavior cannot be preserved losslessly, so no
		// lossy conversion happens either.
		expect(
			await env.DB.prepare('SELECT COUNT(*) AS c FROM "Page"').first(),
		).toEqual({ c: 0 });
		expect(
			await env.DB.prepare('SELECT COUNT(*) AS c FROM "Publication"').first(),
		).toEqual({ c: 0 });
		expect(
			await env.DB.prepare('SELECT COUNT(*) AS c FROM "DesignSystem"').first(),
		).toEqual({ c: 0 });
	});

	it("refuses inline event handlers and javascript: URLs too (over-approximated guard)", async () => {
		mockPreview();
		const project = await createProject();
		for (const html of [
			`<section data-section="hero"><button onclick="alert(1)">Go</button></section>`,
			`<section data-section="hero"><a href="javascript:void(0)">Go</a></section>`,
		]) {
			const { designId } = await seedLegacyDesign({
				projectId: project.id,
				html,
			});
			const session = await createAdminSession();
			const response = await adminClient(session).designs.backfill.mutate({
				projectId: project.id,
				designId,
			});
			expect(response).toEqual({
				ok: false,
				reason: "contains scripts",
			});
		}
		expect(
			await env.DB.prepare('SELECT COUNT(*) AS c FROM "Page"').first(),
		).toEqual({ c: 0 });
		expect(
			await env.DB.prepare('SELECT COUNT(*) AS c FROM "Publication"').first(),
		).toEqual({ c: 0 });
	});

	it("accepts cuid project ids (real projects mint cuid, not uuid)", async () => {
		mockPreview();
		const bytes = crypto.getRandomValues(new Uint8Array(12));
		const projectId = `c${Array.from(bytes)
			.map((byte) => byte.toString(16).padStart(2, "0"))
			.join("")}`;
		await createProject({ id: projectId });
		const { designId } = await seedLegacyDesign({ projectId });
		const session = await createAdminSession();

		const response = await adminClient(session).designs.backfill.mutate({
			projectId,
			designId,
		});
		expect(response).toMatchObject({ ok: true, pageCount: 1 });
	});
});

it("resumes an incomplete prior attempt, but only with explicit force", async () => {
	mockPreview();
	const project = await createProject();
	const { designId } = await seedLegacyDesign({ projectId: project.id });
	// Simulate a crashed first attempt: a page + one block, no Publication.
	const partialPageId = await seedPageRow({
		projectId: project.id,
		designId,
	});
	const partialBlockId = await seedPageBlockRow(partialPageId, 0, SECTION_HERO);
	const session = await createAdminSession();
	const client = adminClient(session);
	const backfill = (body: { force?: boolean } = {}) =>
		client.designs.backfill.mutate({
			projectId: project.id,
			designId,
			...body,
		});

	// Without force the incomplete attempt is refused, not silently replaced.
	const noForceCode = await trpcErrorCode(() => backfill());
	expect(noForceCode).toBe("CONFLICT");
	expect(await trpcErrorMessage(() => backfill())).toBe("incomplete backfill");
	// The partial page data is untouched.
	expect(
		await env.DB.prepare('SELECT "sourceHtml" FROM "PageBlock" WHERE "id" = ?')
			.bind(partialBlockId)
			.first<{ sourceHtml: string | null }>(),
	).toEqual({ sourceHtml: SECTION_HERO });

	const response = await backfill({ force: true });
	expect(response).toEqual({
		ok: true,
		pageCount: 1,
		blockCount: 5,
		publicationVersion: 1,
	});

	// Exactly one page remains, carrying the FULL conversion.
	const pages = await env.DB.prepare(
		'SELECT "id" FROM "Page" WHERE "designId" = ?',
	)
		.bind(designId)
		.all<{ id: string }>();
	expect(pages.results).toHaveLength(1);
	const blocks = await env.DB.prepare(
		'SELECT "sourceHtml" FROM "PageBlock" WHERE "pageId" = ? ORDER BY "ordinal"',
	)
		.bind(pages.results[0]?.id)
		.all<{ sourceHtml: string | null }>();
	expect(blocks.results.map((block) => block.sourceHtml)).toEqual([
		HEAD_ASSETS,
		SECTION_HERO,
		RAW_MAIN,
		SECTION_FEATURES,
		SECTION_FOOTER,
	]);
	expect(
		await env.DB.prepare(
			'SELECT "version" FROM "Publication" WHERE "designId" = ?',
		)
			.bind(designId)
			.first<{ version: number }>(),
	).toEqual({ version: 1 });
});

it("validation refusals never touch the partial attempt; force completes a repaired retry", async () => {
	mockPreview();
	const project = await createProject();
	// A crashed attempt over a script-containing document.
	const { designId } = await seedLegacyDesign({
		projectId: project.id,
		html: SCRIPT_HTML,
	});
	const partialPageId = await seedPageRow({
		projectId: project.id,
		designId,
	});
	const partialBlockId = await seedPageBlockRow(partialPageId, 0, SECTION_HERO);
	const session = await createAdminSession();
	const client = adminClient(session);
	const backfill = (body: { force?: boolean } = {}) =>
		client.designs.backfill.mutate({
			projectId: project.id,
			designId,
			...body,
		});

	// Script document → refusal BEFORE any row is touched: the partial page
	// data survives the refusal.
	const refused = await backfill();
	expect(refused).toEqual({
		ok: false,
		reason: "contains scripts",
	});
	expect(
		await env.DB.prepare('SELECT "sourceHtml" FROM "PageBlock" WHERE "id" = ?')
			.bind(partialBlockId)
			.first<{ sourceHtml: string | null }>(),
	).toEqual({ sourceHtml: SECTION_HERO });

	// The admin repairs the document (republishes a clean HTML); validation
	// now passes, but the incomplete attempt still needs explicit force.
	await putDesignFile(designId, "index.html", LEGACY_HTML, "text/html");
	const noForceCode = await trpcErrorCode(() => backfill());
	expect(noForceCode).toBe("CONFLICT");
	expect(await trpcErrorMessage(() => backfill())).toBe("incomplete backfill");
	expect(
		await env.DB.prepare('SELECT "sourceHtml" FROM "PageBlock" WHERE "id" = ?')
			.bind(partialBlockId)
			.first<{ sourceHtml: string | null }>(),
	).toEqual({ sourceHtml: SECTION_HERO });

	// Force replaces the partial attempt with the full conversion.
	const forced = await backfill({ force: true });
	expect(forced).toEqual({
		ok: true,
		pageCount: 1,
		blockCount: 5,
		publicationVersion: 1,
	});
	expect(
		await env.DB.prepare(
			'SELECT COUNT(*) AS c FROM "Page" WHERE "designId" = ?',
		)
			.bind(designId)
			.first<{ c: number }>(),
	).toEqual({ c: 1 });
	expect(
		await env.DB.prepare('SELECT COUNT(*) AS c FROM "PageBlock"').first<{
			c: number;
		}>(),
	).toEqual({ c: 5 });
});

it("authored draft pages are refused without force and survive; force replaces them", async () => {
	mockPreview();
	const project = await createProject();
	const { designId } = await seedLegacyDesign({ projectId: project.id });
	// KUK-925's compose_page authors DRAFT pages legitimately (designId set,
	// no publication) — backfill must never eat them implicitly.
	const draftPageId = await seedPageRow({
		projectId: project.id,
		designId,
		path: "/landing",
		status: "draft",
	});
	const session = await createAdminSession();
	const client = adminClient(session);
	const backfill = (body: { force?: boolean } = {}) =>
		client.designs.backfill.mutate({
			projectId: project.id,
			designId,
			...body,
		});

	const refusedCode = await trpcErrorCode(() => backfill());
	expect(refusedCode).toBe("CONFLICT");
	expect(await trpcErrorMessage(() => backfill())).toBe("incomplete backfill");
	// The authored draft survives.
	expect(
		await env.DB.prepare('SELECT "status" FROM "Page" WHERE "id" = ?')
			.bind(draftPageId)
			.first<{ status: string }>(),
	).toEqual({ status: "draft" });
	expect(
		await env.DB.prepare('SELECT COUNT(*) AS c FROM "Publication"').first<{
			c: number;
		}>(),
	).toEqual({ c: 0 });

	// Explicit force replaces the draft state with the conversion.
	const forced = await backfill({ force: true });
	expect(forced).toEqual({
		ok: true,
		pageCount: 1,
		blockCount: 5,
		publicationVersion: 1,
	});
	expect(
		await env.DB.prepare('SELECT COUNT(*) AS c FROM "Page" WHERE "id" = ?')
			.bind(draftPageId)
			.first<{ c: number }>(),
	).toEqual({ c: 0 });
});

it("refuses when a publication already exists (completed backfill) — even with force", async () => {
	const project = await createProject();
	const { designId } = await seedLegacyDesign({ projectId: project.id });
	const pageId = await seedPageRow({ projectId: project.id, designId });
	await seedPageBlockRow(pageId, 0, SECTION_HERO);
	await seedPublicationRow({ designId, version: 1 });
	const session = await createAdminSession();
	const client = adminClient(session);
	const backfill = (body: { force?: boolean } = {}) =>
		client.designs.backfill.mutate({
			projectId: project.id,
			designId,
			...body,
		});

	const code = await trpcErrorCode(() => backfill());
	expect(code).toBe("CONFLICT");
	expect(await trpcErrorMessage(() => backfill())).toBe("already has pages");
	// Force never overrides a completed backfill (re-converting would
	// silently rewrite the live site).
	const forcedCode = await trpcErrorCode(() => backfill({ force: true }));
	expect(forcedCode).toBe("CONFLICT");
	expect(await trpcErrorMessage(() => backfill({ force: true }))).toBe(
		"already has pages",
	);
	// The completed state is untouched.
	expect(
		await env.DB.prepare('SELECT COUNT(*) AS c FROM "Page"').first(),
	).toEqual({ c: 1 });
	expect(launch).not.toHaveBeenCalled();
});

it("refuses when the project has pages belonging to another design", async () => {
	mockPreview();
	const project = await createProject();
	const { designId } = await seedLegacyDesign({ projectId: project.id });
	// Another design's page in the same container — never touched.
	const otherDesign = await createDesign({ projectId: project.id });
	const otherPageId = await seedPageRow({
		projectId: project.id,
		designId: otherDesign.id,
	});
	const session = await createAdminSession();
	const client = adminClient(session);

	const code = await trpcErrorCode(() =>
		client.designs.backfill.mutate({ projectId: project.id, designId }),
	);
	expect(code).toBe("CONFLICT");
	expect(
		await trpcErrorMessage(() =>
			client.designs.backfill.mutate({ projectId: project.id, designId }),
		),
	).toBe("already has pages");
	const page = await env.DB.prepare(
		'SELECT "designId" FROM "Page" WHERE "id" = ?',
	)
		.bind(otherPageId)
		.first<{ designId: string }>();
	expect(page).toEqual({ designId: otherDesign.id });
	expect(
		await env.DB.prepare('SELECT COUNT(*) AS c FROM "Publication"').first(),
	).toEqual({ c: 0 });
});

it("keeps unmarked wrappers whole: one block carries the complete <main>", async () => {
	mockPreview();
	const project = await createProject();
	const wrapperHtml = `<!doctype html>
<html>
<head><title>Wrapped</title>${LEGACY_HEAD_STYLE}</head>
<body>
<main><section data-section="hero"><h1>Inside main</h1></section><p>tail content</p></main>
</body>
</html>`;
	const { designId } = await seedLegacyDesign({
		projectId: project.id,
		html: wrapperHtml,
	});
	const session = await createAdminSession();
	const response = await adminClient(session).designs.backfill.mutate({
		projectId: project.id,
		designId,
	});
	// Head-assets block + the complete <main> wrapper (the nested marker
	// does not fragment the wrapper).
	expect(response).toEqual({
		ok: true,
		pageCount: 1,
		blockCount: 2,
		publicationVersion: 1,
	});
	const page = await env.DB.prepare(
		'SELECT "id" FROM "Page" WHERE "designId" = ?',
	)
		.bind(designId)
		.first<{ id: string }>();
	const blocks = await env.DB.prepare(
		'SELECT "sourceHtml" FROM "PageBlock" WHERE "pageId" = ? ORDER BY "ordinal"',
	)
		.bind(page?.id)
		.all<{ sourceHtml: string | null }>();
	expect(blocks.results.map((block) => block.sourceHtml)).toEqual([
		LEGACY_HEAD_STYLE,
		`<main><section data-section="hero"><h1>Inside main</h1></section><p>tail content</p></main>`,
	]);

	// The served page keeps the structure: <main> wraps the section and
	// the tail, in order.
	const site = await startWorkerRequest(`/designs/${designId}/site`);
	const served = await site.text();
	expect(served).toContain("<main>");
	const mainStart = served.indexOf("<main>");
	const sectionStart = served.indexOf("Inside main");
	const tailStart = served.indexOf("tail content");
	expect(mainStart).toBeGreaterThanOrEqual(0);
	expect(sectionStart).toBeGreaterThan(mainStart);
	expect(tailStart).toBeGreaterThan(sectionStart);
});

it("backfills a void-element section without swallowing following content", async () => {
	mockPreview();
	const project = await createProject();
	const voidHtml = `<!doctype html>
<html>
<head><title>Void hero</title></head>
<body>
<img data-section="hero" src="hero.png">
<section data-section="features">three features</section>
<p>after everything</p>
</body>
</html>`;
	const { designId } = await seedLegacyDesign({
		projectId: project.id,
		html: voidHtml,
	});
	const session = await createAdminSession();
	const response = await adminClient(session).designs.backfill.mutate({
		projectId: project.id,
		designId,
	});
	// No head assets (title only) → blocks start with the body segments:
	// the void <img> section, the marked section, and the tail paragraph.
	expect(response).toEqual({
		ok: true,
		pageCount: 1,
		blockCount: 3,
		publicationVersion: 1,
	});
	const page = await env.DB.prepare(
		'SELECT "id" FROM "Page" WHERE "designId" = ?',
	)
		.bind(designId)
		.first<{ id: string }>();
	const blocks = await env.DB.prepare(
		'SELECT "sourceHtml" FROM "PageBlock" WHERE "pageId" = ? ORDER BY "ordinal"',
	)
		.bind(page?.id)
		.all<{ sourceHtml: string | null }>();
	expect(blocks.results.map((block) => block.sourceHtml)).toEqual([
		`<img data-section="hero" src="hero.png">`,
		`<section data-section="features">three features</section>`,
		`<p>after everything</p>`,
	]);

	const site = await startWorkerRequest(`/designs/${designId}/site`);
	const served = await site.text();
	expect(served).toContain(`<img data-section="hero" src="hero.png">`);
	expect(served).toContain("three features");
	expect(served).toContain("after everything");
	expect(served.indexOf("hero.png")).toBeLessThan(
		served.indexOf("three features"),
	);
	expect(served.indexOf("three features")).toBeLessThan(
		served.indexOf("after everything"),
	);
});

it("refuses entity-encoded javascript: URLs (decoded before the scheme test)", async () => {
	mockPreview();
	const project = await createProject();
	// `jav&#x61;script:` decodes to `javascript:` in the browser — a raw
	// source check alone would pass it.
	const entityHtml = `<!doctype html>
<html>
<head><title>Encoded</title></head>
<body>
<section data-section="hero"><a href="jav&#x61;script:alert(1)">Go</a></section>
</body>
</html>`;
	const { designId } = await seedLegacyDesign({
		projectId: project.id,
		html: entityHtml,
	});
	const session = await createAdminSession();
	const response = await adminClient(session).designs.backfill.mutate({
		projectId: project.id,
		designId,
	});
	expect(response).toEqual({
		ok: false,
		reason: "contains scripts",
	});
	// Nothing was created.
	expect(
		await env.DB.prepare('SELECT COUNT(*) AS c FROM "Page"').first(),
	).toEqual({ c: 0 });
	expect(
		await env.DB.prepare('SELECT COUNT(*) AS c FROM "Publication"').first(),
	).toEqual({ c: 0 });
});

it("carries the viewport meta and base tag into the head-assets block", async () => {
	mockPreview();
	const project = await createProject();
	const VIEWPORT_META = `<meta name="viewport" content="width=device-width, initial-scale=1">`;
	const BASE_TAG = `<base href="/legacy/">`;
	const viewportHtml = `<!doctype html>
<html>
<head>
<title>Responsive legacy</title>
<meta charset="utf-8">
<meta name="description" content="legacy page">
${VIEWPORT_META}
${BASE_TAG}
${LEGACY_HEAD_STYLE}
</head>
<body>
${SECTION_HERO}
</body>
</html>`;
	const { designId } = await seedLegacyDesign({
		projectId: project.id,
		html: viewportHtml,
	});
	const session = await createAdminSession();
	const response = await adminClient(session).designs.backfill.mutate({
		projectId: project.id,
		designId,
	});
	// Head-assets block (viewport meta + base + style, document order) +
	// the hero section; the charset and description metas are dropped.
	expect(response).toEqual({
		ok: true,
		pageCount: 1,
		blockCount: 2,
		publicationVersion: 1,
	});
	const page = await env.DB.prepare(
		'SELECT "id" FROM "Page" WHERE "designId" = ?',
	)
		.bind(designId)
		.first<{ id: string }>();
	const blocks = await env.DB.prepare(
		'SELECT "sourceHtml" FROM "PageBlock" WHERE "pageId" = ? ORDER BY "ordinal"',
	)
		.bind(page?.id)
		.all<{ sourceHtml: string | null }>();
	expect(blocks.results.map((block) => block.sourceHtml)).toEqual([
		`${VIEWPORT_META}\n${BASE_TAG}\n${LEGACY_HEAD_STYLE}`,
		SECTION_HERO,
	]);

	// The served composed page carries the original viewport declaration
	// and base (mobile layout + relative-URL behavior preserved).
	const site = await startWorkerRequest(`/designs/${designId}/site`);
	const served = await site.text();
	expect(served).toContain(VIEWPORT_META);
	expect(served).toContain(BASE_TAG);
	expect(served).not.toContain('name="description"');
	expect(served).not.toContain("utf-8");
});

it("requires an admin session, a known project/design pair, and valid ids", async () => {
	const project = await createProject();
	const { designId } = await seedLegacyDesign({ projectId: project.id });

	const anonymous = createTrpcTestClient();
	const backfillAnon = () =>
		anonymous.designs.backfill.mutate({
			projectId: project.id,
			designId,
		});
	expect(await trpcErrorCode(backfillAnon)).toBe("UNAUTHORIZED");
	expect(await trpcErrorMessage(backfillAnon)).toBe("unauthorized");

	const nonAdmin = adminClient(await createUserSession("user"));
	expect(
		await trpcErrorCode(() =>
			nonAdmin.designs.backfill.mutate({ projectId: project.id, designId }),
		),
	).toBe("FORBIDDEN");

	const session = await createAdminSession();
	const client = adminClient(session);
	// Design filed elsewhere than the input project → out of scope.
	const other = await createProject();
	const mismatchCall = () =>
		client.designs.backfill.mutate({ projectId: other.id, designId });
	expect(await trpcErrorCode(mismatchCall)).toBe("NOT_FOUND");
	expect(await trpcErrorMessage(mismatchCall)).toBe("not found");

	const invalidCall = () =>
		client.designs.backfill.mutate({
			projectId: project.id,
			designId: "not-a-uuid",
		});
	expect(await trpcErrorCode(invalidCall)).toBe("BAD_REQUEST");
});
