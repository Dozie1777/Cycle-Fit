// Worker tests for the KUK-925 agent-tool operations (page-tools.ts): the
// lib functions against real D1 migrations, plus the actual chat-tool path
// through runDesignChatTurn with a mocked model — the full agent loop from
// the acceptance criteria: save_component → publish_design (auto-publishes
// the draft) → compose_page → bind_data → publish_design, with
// createPublication rendering the composed page and its bound data.
import {
	createExecutionContext,
	waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { createMCPClient } from "@ai-sdk/mcp";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { MockLanguageModelV3 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkersAI } from "workers-ai-provider";
import { createPublication } from "@/features/design-studio/publish/design-publish";
import { renderDesignPreview } from "@/features/design-studio/publish/design-render";
import {
	publishTurnComponentDrafts,
	saveComponentDraft,
	seedDataCollection,
} from "@/features/design-studio/tools/component-tools";
import {
	bindDataTool,
	composePageTool,
	defineFlowTool,
	defineTemplateTool,
	listPagesTool,
} from "@/features/design-studio/tools/page-tools";
import { getPrisma } from "../../src/lib/db";
import { createAdminSession, type TestSession } from "../helpers/auth";
import { createDesign, createProject } from "../helpers/fixtures";
import { TEST_ORIGIN } from "../helpers/request";

vi.mock("@ai-sdk/mcp", () => ({ createMCPClient: vi.fn() }));
vi.mock("workers-ai-provider", () => ({ createWorkersAI: vi.fn() }));
vi.mock("../../src/features/design-studio/publish/design-render", () => ({
	renderDesignPreview: vi.fn(),
}));

const usage = {
	inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
	outputTokens: { total: 0, text: 0, reasoning: 0 },
};

function immediateTextStream(
	text: string,
): ReadableStream<LanguageModelV3StreamPart> {
	return new ReadableStream({
		start(controller) {
			controller.enqueue({ type: "stream-start", warnings: [] });
			controller.enqueue({
				type: "response-metadata",
				id: "response-id",
				modelId: "test-model",
				timestamp: new Date(0),
			});
			controller.enqueue({ type: "text-start", id: "text-id" });
			controller.enqueue({
				type: "text-delta",
				id: "text-id",
				delta: text,
			});
			controller.enqueue({ type: "text-end", id: "text-id" });
			controller.enqueue({
				type: "finish",
				finishReason: { unified: "stop", raw: undefined },
				usage,
			});
			controller.close();
		},
	});
}

function toolCallStream(call: {
	toolName: string;
	input: unknown;
	id: string;
}): ReadableStream<LanguageModelV3StreamPart> {
	return new ReadableStream({
		start(controller) {
			controller.enqueue({ type: "stream-start", warnings: [] });
			controller.enqueue({
				type: "response-metadata",
				id: "response-id",
				modelId: "test-model",
				timestamp: new Date(0),
			});
			controller.enqueue({
				type: "tool-call",
				toolCallId: call.id,
				toolName: call.toolName,
				input: JSON.stringify(call.input),
			});
			controller.enqueue({
				type: "finish",
				finishReason: { unified: "tool-calls", raw: undefined },
				usage,
			});
			controller.close();
		},
	});
}

/**
 * One tool call per streamText step (each doStream invocation is a step),
 * then a final text step — mirrors how the design-chat route test drives
 * tool executes through the real chat pipeline.
 */
function multiToolCallModel(
	calls: Array<{ toolName: string; input: unknown }>,
) {
	let step = 0;
	return new MockLanguageModelV3({
		doStream: async () => {
			step += 1;
			const call = calls[step - 1];
			if (!call) return { stream: immediateTextStream("tool finished") };
			return { stream: toolCallStream({ ...call, id: `tool-call-${step}` }) };
		},
	});
}

function mockMcpClient() {
	const client = {
		tools: vi.fn(async () => ({})),
		close: vi.fn(async () => {}),
	};
	vi.mocked(createMCPClient).mockResolvedValue(client as never);
	return client;
}

async function dispatchChat(
	projectId: string,
	body: unknown,
	session: TestSession,
) {
	const { default: worker } = await import("../../src/server");
	const ctx = createExecutionContext();
	const response = await worker.fetch(
		new Request(new URL(`/designs/${projectId}/chat`, TEST_ORIGIN), {
			method: "POST",
			headers: {
				"content-type": "application/json",
				cookie: session.cookie,
			},
			body: JSON.stringify(body),
		}),
		env,
		ctx,
	);
	return { response, ctx };
}

const prisma = () => getPrisma(env);

const COMPONENT_JS =
	'class TbHero extends HTMLElement {\n\tconnectedCallback() {\n\t\tif (this.hasAttribute("data-ssr")) return;\n\t\tthis.innerHTML = "<p>hero</p>";\n\t}\n}\ncustomElements.define("tb-hero", TbHero);';

async function claimTurn(designId: string, turnId: string) {
	await env.DB.prepare(
		'UPDATE "Design" SET "activeTurnId" = ?, "turnClaimedAt" = ? WHERE "id" = ?',
	)
		.bind(turnId, new Date().toISOString(), designId)
		.run();
}

async function pageRows(projectId: string) {
	const rows = await env.DB.prepare(
		'SELECT "id", "path", "title", "status", "designId" FROM "Page" WHERE "projectId" = ? ORDER BY "path"',
	)
		.bind(projectId)
		.all<Record<string, unknown>>();
	return rows.results;
}

async function blockRows(pageId: string) {
	const rows = await env.DB.prepare(
		'SELECT "ordinal", "componentVersionId", "templateId", "sourceHtml", "propsOverrides", "dataBindings" FROM "PageBlock" WHERE "pageId" = ? ORDER BY "ordinal"',
	)
		.bind(pageId)
		.all<Record<string, unknown>>();
	return rows.results;
}

async function snapshotPageHtml(
	designId: string,
	version: number,
	pagePath: string,
): Promise<string | undefined> {
	const { publicationPageSegment } = await import(
		"@/features/design-studio/publish/publication-segment"
	);
	const key = `designs/${designId}/publications/${version}/pages/${publicationPageSegment(pagePath)}/index.html`;
	const obj = await env.DESIGNS.get(key);
	return obj ? await obj.text() : undefined;
}

beforeEach(() => {
	mockMcpClient();
	vi.mocked(renderDesignPreview).mockResolvedValue(Uint8Array.from([1, 2, 3]));
});

afterEach(() => {
	vi.clearAllMocks();
	vi.restoreAllMocks();
});

describe("agent loop against real D1: save → publish → compose → bind → publication", () => {
	it("pins the published draft, renders the bound data into the publication", async () => {
		const project = await createProject();
		const design = await createDesign({ projectId: project.id });
		await claimTurn(design.id, "turn-1");

		// save_component (KUK-924) …
		const hero = await saveComponentDraft(prisma(), {
			projectId: project.id,
			turnId: "turn-1",
			input: {
				name: "Hero",
				tagName: "tb-hero",
				js: COMPONENT_JS,
				apiSchema: { attributes: { heading: { type: "string" } } },
				defaults: { heading: "Hello" },
			},
		});
		if (!hero.ok) throw new Error("hero save failed");
		// … publish the turn drafts (the publish_design auto-publish step) …
		const published = await publishTurnComponentDrafts(prisma(), env, {
			turnId: "turn-1",
			drafts: [{ componentId: hero.componentId, versionId: hero.versionId }],
		});
		expect(published.published).toEqual([
			{ componentId: hero.componentId, version: 1, repinned: 0 },
		]);
		// … seed the dummy data (seed_data) …
		await seedDataCollection(prisma(), env.DB, {
			projectId: project.id,
			name: "courses",
			mode: "replace",
			records: [{ title: "Intro to SQL" }, { title: "Advanced SQL" }],
		});
		// … compose_page pinning the published version …
		const page = await composePageTool(prisma(), env.DB, {
			projectId: project.id,
			designId: design.id,
			path: "/",
			title: "Home",
			publish: true,
			blocks: [
				{
					component: { name: "Hero" },
					propsOverrides: { heading: "Welcome" },
				},
			],
		});
		expect(page).toMatchObject({
			ok: true,
			page: { path: "/", status: "published", created: true },
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
		if (!page.ok) throw new Error("compose failed");
		const blocks = await blockRows(page.page.id);
		expect(blocks).toHaveLength(1);
		expect(blocks[0]).toMatchObject({
			ordinal: 0,
			componentVersionId: hero.versionId,
			propsOverrides: JSON.stringify({ heading: "Welcome" }),
		});
		// … bind_data on the block …
		const bound = await bindDataTool(prisma(), {
			projectId: project.id,
			path: "/",
			ordinal: 0,
			bindings: { items: { collection: "courses", limit: 2 } },
		});
		expect(bound).toMatchObject({ ok: true, ordinal: 0 });
		// … and createPublication renders the composed page with the records.
		const publication = await createPublication(prisma(), env, design.id, {
			turnId: "turn-1",
		});
		expect(publication?.version).toBe(1);
		const html = await snapshotPageHtml(design.id, 1, "/");
		expect(html).toContain("<!doctype html>");
		expect(html).toContain("<tb-hero");
		expect(html).toContain("data-block-id=");
		expect(html).toContain('heading="Welcome"');
		expect(html).toContain('data-collection="courses"');
		expect(html).toContain("Intro to SQL");
		expect(html).toContain("Advanced SQL");
		// The manifest records the exact pin at publish time.
		const row = await env.DB.prepare(
			'SELECT "manifest" FROM "Publication" WHERE "designId" = ?',
		)
			.bind(design.id)
			.first<{ manifest: string } | null>();
		const manifest = JSON.parse(row?.manifest ?? "{}") as {
			pages: Array<{
				path: string;
				blocks: Array<{
					componentVersionId: string;
					bundleUrl: string;
				}>;
			}>;
		};
		expect(manifest.pages[0]).toMatchObject({
			path: "/",
			blocks: [
				{
					componentVersionId: hero.versionId,
					bundleUrl: `/projects/${project.id}/components/${hero.componentId}/v1.js`,
				},
			],
		});
	});

	it("rejects pinning an unpublished draft with a model-correctable error", async () => {
		const project = await createProject();
		const hero = await saveComponentDraft(prisma(), {
			projectId: project.id,
			input: { name: "Hero", tagName: "tb-hero", js: COMPONENT_JS },
		});
		if (!hero.ok) throw new Error("hero save failed");
		const result = await composePageTool(prisma(), env.DB, {
			projectId: project.id,
			path: "/",
			title: "Home",
			blocks: [{ component: { name: "Hero" } }],
		});
		expect(result).toMatchObject({
			ok: false,
			errors: [
				expect.stringContaining(
					'component "Hero" has no published version — publish the component first',
				),
			],
		});
		expect(await pageRows(project.id)).toEqual([]);
	});
});

describe("define_template → compose_page with a template block", () => {
	it("expands the slots with block-level overrides winning", async () => {
		const project = await createProject();
		const design = await createDesign({ projectId: project.id });
		await claimTurn(design.id, "turn-1");
		const hero = await saveComponentDraft(prisma(), {
			projectId: project.id,
			turnId: "turn-1",
			input: {
				name: "Hero",
				tagName: "tb-hero",
				js: COMPONENT_JS,
				apiSchema: { attributes: { heading: { type: "string" } } },
				defaults: { heading: "Hello" },
			},
		});
		if (!hero.ok) throw new Error("hero save failed");
		await publishTurnComponentDrafts(prisma(), env, {
			turnId: "turn-1",
			drafts: [{ componentId: hero.componentId, versionId: hero.versionId }],
		});

		const template = await defineTemplateTool(prisma(), env.DB, {
			projectId: project.id,
			name: "Landing",
			slots: [
				{ component: { name: "Hero" }, propsOverrides: { heading: "Top" } },
				{ component: { name: "Hero" } },
			],
		});
		expect(template).toMatchObject({
			ok: true,
			template: { name: "Landing", slotCount: 2 },
		});

		// A bad block-level override is rejected at the tool boundary — it
		// merges into every slot and the slot's pinned apiSchema declares
		// heading as a string; nothing is written, so a later compose of the
		// page carries no composition errors and the publication succeeds.
		const bad = await composePageTool(prisma(), env.DB, {
			projectId: project.id,
			designId: design.id,
			path: "/",
			title: "Home",
			blocks: [{ template: "Landing", propsOverrides: { heading: 5 } }],
		});
		expect(bad).toMatchObject({
			ok: false,
			errors: [
				expect.stringContaining(
					'blocks[0] (template "Landing" slot 0): attribute "heading" must be a string',
				),
				expect.stringContaining(
					'blocks[0] (template "Landing" slot 1): attribute "heading" must be a string',
				),
			],
		});
		expect(await pageRows(project.id)).toEqual([]);

		const page = await composePageTool(prisma(), env.DB, {
			projectId: project.id,
			designId: design.id,
			path: "/",
			title: "Home",
			publish: true,
			blocks: [{ template: "Landing" }],
		});
		expect(page).toMatchObject({
			ok: true,
			blocks: [{ ordinal: 0, kind: "template", template: "Landing" }],
		});

		const publication = await createPublication(prisma(), env, design.id);
		expect(publication?.version).toBe(1);
		const html = await snapshotPageHtml(design.id, 1, "/");
		// Two slot elements, no block-level data-block-id on either.
		expect(html?.match(/<tb-hero/g)?.length).toBe(2);
		expect(html).not.toContain("data-block-id");
		// The slot's own override wins over the pinned version's default…
		expect(html).toContain('heading="Top"');
		// …and the untouched slot renders the default.
		expect(html).toContain('heading="Hello"');
	});
});

describe("define_flow across two pages", () => {
	it("creates ordered steps referencing the existing pages", async () => {
		const project = await createProject();
		const design = await createDesign({ projectId: project.id });
		await claimTurn(design.id, "turn-1");
		const hero = await saveComponentDraft(prisma(), {
			projectId: project.id,
			turnId: "turn-1",
			input: { name: "Hero", tagName: "tb-hero", js: COMPONENT_JS },
		});
		if (!hero.ok) throw new Error("hero save failed");
		await publishTurnComponentDrafts(prisma(), env, {
			turnId: "turn-1",
			drafts: [{ componentId: hero.componentId, versionId: hero.versionId }],
		});
		const home = await composePageTool(prisma(), env.DB, {
			projectId: project.id,
			path: "/",
			title: "Home",
			blocks: [{ component: { name: "Hero" } }],
		});
		const pricing = await composePageTool(prisma(), env.DB, {
			projectId: project.id,
			path: "/pricing",
			title: "Pricing",
			blocks: [{ component: { name: "Hero" } }],
		});
		if (!home.ok || !pricing.ok) throw new Error("pages failed");

		const flow = await defineFlowTool(prisma(), env.DB, {
			projectId: project.id,
			name: "To pricing",
			steps: [
				{ path: "/", exitTarget: "click .cta" },
				{ path: "/pricing", entryAction: "click .cta" },
			],
		});
		expect(flow).toMatchObject({
			ok: true,
			flow: { name: "To pricing", stepCount: 2 },
		});
		const rows = await env.DB.prepare(
			'SELECT "ordinal", "pageId", "entryAction", "exitTarget" FROM "FlowStep" ORDER BY "ordinal"',
		).all<{
			ordinal: number;
			pageId: string;
			entryAction: string | null;
			exitTarget: string | null;
		}>();
		expect(rows.results).toHaveLength(2);
		expect(rows.results[0]).toMatchObject({
			ordinal: 0,
			pageId: home.page.id,
			exitTarget: "click .cta",
		});
		expect(rows.results[1]).toMatchObject({
			ordinal: 1,
			pageId: pricing.page.id,
			entryAction: "click .cta",
		});

		// Unknown paths are rejected before anything is written.
		const bad = await defineFlowTool(prisma(), env.DB, {
			projectId: project.id,
			name: "Broken",
			steps: [{ path: "/ghost" }],
		});
		expect(bad).toMatchObject({
			ok: false,
			errors: [expect.stringContaining('no page at path "/ghost"')],
		});
	});
});

describe("compose_page publish semantics", () => {
	it("draft pages stay out of publications; publish:true includes them", async () => {
		const project = await createProject();
		const design = await createDesign({ projectId: project.id });
		await claimTurn(design.id, "turn-1");
		const hero = await saveComponentDraft(prisma(), {
			projectId: project.id,
			turnId: "turn-1",
			input: { name: "Hero", tagName: "tb-hero", js: COMPONENT_JS },
		});
		if (!hero.ok) throw new Error("hero save failed");
		await publishTurnComponentDrafts(prisma(), env, {
			turnId: "turn-1",
			drafts: [{ componentId: hero.componentId, versionId: hero.versionId }],
		});

		// Draft compose: no published pages → the publication is null.
		const draft = await composePageTool(prisma(), env.DB, {
			projectId: project.id,
			designId: design.id,
			path: "/",
			title: "Home",
			blocks: [{ component: { name: "Hero" } }],
		});
		expect(draft).toMatchObject({
			ok: true,
			page: { status: "draft" },
		});
		await expect(
			createPublication(prisma(), env, design.id),
		).resolves.toBeNull();

		// publish:true flips the page; the publication now includes it.
		const published = await composePageTool(prisma(), env.DB, {
			projectId: project.id,
			designId: design.id,
			path: "/",
			title: "Home",
			publish: true,
			blocks: [{ component: { name: "Hero" } }],
		});
		expect(published).toMatchObject({
			ok: true,
			page: { status: "published", created: false },
		});
		const publication = await createPublication(prisma(), env, design.id);
		expect(publication?.version).toBe(1);
		expect(await snapshotPageHtml(design.id, 1, "/")).toContain("<tb-hero");
	});

	it("lists pages, templates and flows", async () => {
		const project = await createProject();
		const design = await createDesign({ projectId: project.id });
		await claimTurn(design.id, "turn-1");
		const hero = await saveComponentDraft(prisma(), {
			projectId: project.id,
			turnId: "turn-1",
			input: { name: "Hero", tagName: "tb-hero", js: COMPONENT_JS },
		});
		if (!hero.ok) throw new Error("hero save failed");
		await publishTurnComponentDrafts(prisma(), env, {
			turnId: "turn-1",
			drafts: [{ componentId: hero.componentId, versionId: hero.versionId }],
		});
		await composePageTool(prisma(), env.DB, {
			projectId: project.id,
			designId: design.id,
			path: "/",
			title: "Home",
			blocks: [
				{ component: { name: "Hero" } },
				{ sourceHtml: "<footer>hi</footer>" },
			],
		});
		await defineTemplateTool(prisma(), env.DB, {
			projectId: project.id,
			name: "Landing",
			slots: [{ component: { name: "Hero" } }, { component: { name: "Hero" } }],
		});
		await defineFlowTool(prisma(), env.DB, {
			projectId: project.id,
			name: "Onboarding",
			steps: [{ path: "/" }],
		});
		const summary = await listPagesTool(prisma(), { projectId: project.id });
		expect(summary.pages).toEqual([
			{ path: "/", title: "Home", status: "draft", blockCount: 2 },
		]);
		expect(summary.templates).toEqual([{ name: "Landing", slotCount: 2 }]);
		expect(summary.flows).toEqual([{ name: "Onboarding", stepCount: 1 }]);
		// The authoring design workspace is attached to the page row.
		expect((await pageRows(project.id))[0]).toMatchObject({
			path: "/",
			designId: design.id,
		});
	});
});

describe("chat-tool path: compose_page + publish_design publication", () => {
	it("composes, previews, and publish_design snapshots the published page", async () => {
		const project = await createProject();
		const design = await createDesign({ projectId: project.id });
		vi.mocked(createWorkersAI).mockReturnValue(
			vi.fn(() =>
				multiToolCallModel([
					{
						toolName: "save_component",
						input: {
							name: "Hero",
							tagName: "tb-hero",
							js: COMPONENT_JS,
							apiSchema: JSON.stringify({
								attributes: { heading: { type: "string" } },
							}),
							defaults: JSON.stringify({ heading: "Hello" }),
						},
					},
					{
						toolName: "seed_data",
						input: {
							collection: "courses",
							records: [{ title: "Intro to SQL" }],
						},
					},
					// First publish: auto-publishes the Hero draft; no published
					// pages yet, so no publication snapshot is created.
					{
						toolName: "publish_design",
						input: {
							html: "<!doctype html><html><body><tb-hero></tb-hero></body></html>",
						},
					},
					{
						toolName: "compose_page",
						input: {
							path: "/",
							title: "Home",
							publish: true,
							blocks: [
								{
									component: { name: "Hero" },
									dataBindings: { items: { collection: "courses" } },
								},
							],
						},
					},
					// Second publish: the published page becomes the publication.
					{
						toolName: "publish_design",
						input: {
							html: "<!doctype html><html><body><p>legacy monolithic document kept as the live pointer</p></body></html>",
						},
					},
				]),
			) as never,
		);

		const session = await createAdminSession();
		const { response, ctx } = await dispatchChat(
			design.id,
			{ message: "build a page from the component and publish the site" },
			session,
		);
		expect(response.status).toBe(200);
		const wire = await response.text();
		await waitOnExecutionContext(ctx);
		expect(wire).not.toContain("chat turn failed");

		// The page exists, published, pinned to the published Hero version.
		const pages = await pageRows(project.id);
		expect(pages).toHaveLength(1);
		const page = pages[0];
		expect(page).toMatchObject({ path: "/", status: "published" });
		const blocks = await blockRows(page.id as string);
		expect(blocks).toHaveLength(1);
		expect(blocks[0].dataBindings).toBe(
			JSON.stringify({ items: { collection: "courses" } }),
		);
		const version = await env.DB.prepare(
			'SELECT "status" FROM "ComponentVersion" WHERE "id" = ?',
		)
			.bind(blocks[0].componentVersionId as string)
			.first<{ status: string } | null>();
		expect(version).toEqual({ status: "published" });

		// The compose_page tool rendered a draft preview doc through the
		// drafts file route (draftFileName("home-draft")).
		const preview = await env.DESIGNS.get(
			`designs/${design.id}/drafts/home-draft.html`,
		);
		const previewHtml = (await preview?.text()) ?? "";
		expect(previewHtml).toContain("<!doctype html>");
		expect(previewHtml).toContain("<tb-hero");
		expect(previewHtml).toContain("Intro to SQL");

		// The second publish_design snapshotted the page as Publication v1.
		const publication = await env.DB.prepare(
			'SELECT "version" FROM "Publication" WHERE "designId" = ?',
		)
			.bind(design.id)
			.first<{ version: number } | null>();
		expect(publication).toEqual({ version: 1 });
		const snapshotHtml = await snapshotPageHtml(design.id, 1, "/");
		expect(snapshotHtml).toContain("<tb-hero");
		expect(snapshotHtml).toContain("Intro to SQL");
		// The design ended the turn cleanly.
		expect(
			await env.DB.prepare('SELECT "status" FROM "Design" WHERE "id" = ?')
				.bind(design.id)
				.first<{ status: string } | null>(),
		).toEqual({ status: "ready" });
	});

	it("compose_page returns validation errors as tool output without failing the turn", async () => {
		const project = await createProject();
		const design = await createDesign({ projectId: project.id });
		vi.mocked(createWorkersAI).mockReturnValue(
			vi.fn(() =>
				multiToolCallModel([
					{
						toolName: "compose_page",
						input: {
							path: "/",
							title: "Home",
							blocks: [{ component: { name: "Ghost" } }],
						},
					},
				]),
			) as never,
		);

		const session = await createAdminSession();
		const { response, ctx } = await dispatchChat(
			design.id,
			{ message: "compose with an unknown component" },
			session,
		);
		await response.text();
		await waitOnExecutionContext(ctx);

		expect(await pageRows(project.id)).toEqual([]);
		// The turn still finalized (validation failures are tool output, not
		// turn failures).
		expect(
			await env.DB.prepare('SELECT "status" FROM "Design" WHERE "id" = ?')
				.bind(design.id)
				.first<{ status: string } | null>(),
		).toEqual({ status: "ready" });
	});

	it("republishing a component re-pins the turn's page blocks and the publication renders them", async () => {
		const project = await createProject();
		const design = await createDesign({ projectId: project.id });
		vi.mocked(createWorkersAI).mockReturnValue(
			vi.fn(() =>
				multiToolCallModel([
					{
						toolName: "save_component",
						input: {
							name: "Hero",
							tagName: "tb-hero",
							js: COMPONENT_JS,
							apiSchema: JSON.stringify({
								attributes: { heading: { type: "string" } },
							}),
							defaults: JSON.stringify({ heading: "Hello" }),
						},
					},
					// Publishes v1; no published pages yet → no publication.
					{
						toolName: "publish_design",
						input: {
							html: "<!doctype html><html><body><p>first publish before any page exists</p></body></html>",
						},
					},
					// compose_page pins the currently published v1.
					{
						toolName: "compose_page",
						input: {
							path: "/",
							title: "Home",
							publish: true,
							blocks: [{ component: { name: "Hero" } }],
						},
					},
					// v2 draft of the same component (same defaults so the
					// re-pinned block renders identically).
					{
						toolName: "save_component",
						input: {
							name: "Hero",
							tagName: "tb-hero",
							js: COMPONENT_JS,
							apiSchema: JSON.stringify({
								attributes: { heading: { type: "string" } },
							}),
							defaults: JSON.stringify({ heading: "Hello" }),
							changeNote: "tightened spacing",
						},
					},
					// Publishes v2 → retires v1 → the turn re-pins the block
					// BEFORE createPublication, so the snapshot renders it.
					{
						toolName: "publish_design",
						input: {
							html: "<!doctype html><html><body><p>second publish with a published page</p></body></html>",
						},
					},
				]),
			) as never,
		);

		const session = await createAdminSession();
		const { response, ctx } = await dispatchChat(
			design.id,
			{ message: "update the hero component and republish the site" },
			session,
		);
		expect(response.status).toBe(200);
		const wire = await response.text();
		await waitOnExecutionContext(ctx);
		expect(wire).not.toContain("chat turn failed");
		// The tool reported the re-pointed pin so the model sees the repair.
		expect(wire).toContain('"repinned":1');

		// The component has two versions: v2 published, v1 retired.
		const versions = await env.DB.prepare(
			'SELECT "id", "version", "status" FROM "ComponentVersion" ORDER BY "version"',
		).all<{ id: string; version: number; status: string }>();
		expect(versions.results).toHaveLength(2);
		const v2 = versions.results.find((v) => v.version === 2);
		const v1 = versions.results.find((v) => v.version === 1);
		if (!v2 || !v1) throw new Error("missing version rows");
		expect(v2.status).toBe("published");
		expect(v1.status).toBe("retired");

		// The block the turn composed against v1 now pins v2 (not a dangling
		// retired pin the composer would skip).
		const page = (await pageRows(project.id))[0];
		expect(page).toMatchObject({ path: "/", status: "published" });
		const blocks = await blockRows(page.id as string);
		expect(blocks).toHaveLength(1);
		expect(blocks[0].componentVersionId).toBe(v2.id);

		// The publication composed AFTER the re-pin renders the block and
		// its manifest records the fresh pin.
		const publication = await env.DB.prepare(
			'SELECT "version" FROM "Publication" WHERE "designId" = ?',
		)
			.bind(design.id)
			.first<{ version: number } | null>();
		expect(publication).toEqual({ version: 1 });
		const snapshotHtml = await snapshotPageHtml(design.id, 1, "/");
		expect(snapshotHtml).toContain("<tb-hero");
		expect(snapshotHtml).toContain('heading="Hello"');
		const manifestRow = await env.DB.prepare(
			'SELECT "manifest" FROM "Publication" WHERE "designId" = ?',
		)
			.bind(design.id)
			.first<{ manifest: string } | null>();
		const manifest = JSON.parse(manifestRow?.manifest ?? "{}") as {
			pages: Array<{
				blocks: Array<{ componentVersionId: string; bundleUrl: string }>;
			}>;
		};
		expect(manifest.pages[0]?.blocks[0]).toMatchObject({
			componentVersionId: v2.id,
		});
		expect(manifest.pages[0]?.blocks[0].bundleUrl).toContain("/v2.js");
	});
});
