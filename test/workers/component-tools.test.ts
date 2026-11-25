// Worker tests for the KUK-924 agent-tool operations: the component-tools
// lib functions against real D1 migrations, plus the actual chat-tool path
// (save_component → publish_design through runDesignChatTurn with a mocked
// model) asserting that publish_design auto-publishes the drafts the turn
// authored — the KUK-921 gap this ticket closes.
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
import { renderDesignPreview } from "@/features/design-studio/publish/design-render";
import {
	listLibrary,
	publishTurnComponentDrafts,
	saveComponentDraft,
	seedDataCollection,
} from "@/features/design-studio/tools/component-tools";
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

function streamPrefix(): LanguageModelV3StreamPart[] {
	return [
		{ type: "stream-start", warnings: [] },
		{
			type: "response-metadata",
			id: "response-id",
			modelId: "test-model",
			timestamp: new Date(0),
		},
		{ type: "text-start", id: "text-id" },
	];
}

function streamSuffix(): LanguageModelV3StreamPart[] {
	return [
		{ type: "text-end", id: "text-id" },
		{
			type: "finish",
			finishReason: { unified: "stop", raw: undefined },
			usage,
		},
	];
}

function immediateTextStream(
	text: string,
): ReadableStream<LanguageModelV3StreamPart> {
	return new ReadableStream({
		start(controller) {
			for (const chunk of [
				...streamPrefix(),
				{ type: "text-delta", id: "text-id", delta: text } as const,
				...streamSuffix(),
			]) {
				controller.enqueue(chunk);
			}
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

async function componentRows(projectId: string) {
	const rows = await env.DB.prepare(
		'SELECT "id", "name", "kind", "tagName", "publishedVersionId", "createdTurnId", "deletedAt" FROM "Component" WHERE "projectId" = ? ORDER BY "name"',
	)
		.bind(projectId)
		.all<Record<string, unknown>>();
	return rows;
}

async function versionRows(componentId: string) {
	const rows = await env.DB.prepare(
		'SELECT "version", "status", "js", "css", "shadowMode", "createdTurnId", "changeNote" FROM "ComponentVersion" WHERE "componentId" = ? ORDER BY "version"',
	)
		.bind(componentId)
		.all<Record<string, unknown>>();
	return rows.results;
}

async function recordRows(projectId: string, collectionName: string) {
	const rows = await env.DB.prepare(
		'SELECT "ordinal", "data" FROM "DataRecord" WHERE "collectionId" = (SELECT "id" FROM "DataCollection" WHERE "projectId" = ? AND "name" = ?) ORDER BY "ordinal"',
	)
		.bind(projectId, collectionName)
		.all<{ ordinal: number; data: string }>();
	return rows.results;
}

beforeEach(() => {
	mockMcpClient();
	vi.mocked(renderDesignPreview).mockResolvedValue(Uint8Array.from([1, 2, 3]));
});

afterEach(() => {
	vi.clearAllMocks();
	vi.restoreAllMocks();
});

describe("saveComponentDraft against real D1", () => {
	it("creates the component row and its first draft version", async () => {
		const project = await createProject();
		const result = await saveComponentDraft(prisma(), {
			projectId: project.id,
			turnId: "turn-1",
			input: {
				name: "Hero",
				tagName: "tb-hero",
				js: COMPONENT_JS,
				css: "p { color: var(--tb-text-primary); }",
				apiSchema: { attributes: { heading: { type: "string" } } },
			},
		});
		expect(result).toMatchObject({
			ok: true,
			version: 1,
			name: "Hero",
			tagName: "tb-hero",
			kind: "section",
		});

		const components = await componentRows(project.id);
		expect(components.results).toHaveLength(1);
		const component = components.results[0];
		expect(component).toMatchObject({
			name: "Hero",
			kind: "section",
			tagName: "tb-hero",
			createdTurnId: "turn-1",
			deletedAt: null,
		});
		expect(component.publishedVersionId).toBeNull();

		const versions = await versionRows(component.id as string);
		expect(versions).toEqual([
			{
				version: 1,
				status: "draft",
				js: COMPONENT_JS,
				css: "p { color: var(--tb-text-primary); }",
				shadowMode: "light",
				createdTurnId: "turn-1",
				changeNote: null,
			},
		]);
	});

	it("appends a second monotonic draft version on re-save", async () => {
		const project = await createProject();
		const first = await saveComponentDraft(prisma(), {
			projectId: project.id,
			input: { name: "Hero", tagName: "tb-hero", js: COMPONENT_JS },
		});
		const second = await saveComponentDraft(prisma(), {
			projectId: project.id,
			turnId: "turn-2",
			input: {
				name: "Hero",
				tagName: "tb-hero",
				js: COMPONENT_JS,
				changeNote: "tightened spacing",
			},
		});
		expect(first).toMatchObject({ ok: true, version: 1 });
		expect(second).toMatchObject({ ok: true, version: 2 });
		const versions = await versionRows(
			(first as { componentId: string }).componentId,
		);
		expect(versions.map((v) => v.version)).toEqual([1, 2]);
		expect(versions.map((v) => v.status)).toEqual(["draft", "draft"]);
	});

	it("returns validation errors verbatim and writes nothing", async () => {
		const project = await createProject();
		const result = await saveComponentDraft(prisma(), {
			projectId: project.id,
			input: { name: "Hero", tagName: "tb-hero", js: "const x = 1;" },
		});
		expect(result).toMatchObject({
			ok: false,
			status: 400,
			errors: expect.arrayContaining([
				expect.stringContaining("custom element class"),
			]),
		});
		expect((await componentRows(project.id)).results).toEqual([]);
	});
});

describe("seedDataCollection against real D1", () => {
	it("replace writes ordinals 0..n-1; append continues after the max", async () => {
		const project = await createProject();
		const replace = await seedDataCollection(prisma(), env.DB, {
			projectId: project.id,
			name: "courses",
			mode: "replace",
			records: [{ title: "Intro to SQL" }, { title: "Advanced SQL" }],
		});
		expect(replace).toMatchObject({
			ok: true,
			name: "courses",
			count: 2,
			mode: "replace",
		});
		expect(await recordRows(project.id, "courses")).toEqual([
			{ ordinal: 0, data: JSON.stringify({ title: "Intro to SQL" }) },
			{ ordinal: 1, data: JSON.stringify({ title: "Advanced SQL" }) },
		]);

		const append = await seedDataCollection(prisma(), env.DB, {
			projectId: project.id,
			name: "courses",
			records: [{ title: "Third course" }],
		});
		expect(append).toMatchObject({ ok: true, count: 1, mode: "append" });
		expect(await recordRows(project.id, "courses")).toEqual([
			{ ordinal: 0, data: JSON.stringify({ title: "Intro to SQL" }) },
			{ ordinal: 1, data: JSON.stringify({ title: "Advanced SQL" }) },
			{ ordinal: 2, data: JSON.stringify({ title: "Third course" }) },
		]);

		// Replacing again rewrites from ordinal 0.
		const rewrite = await seedDataCollection(prisma(), env.DB, {
			projectId: project.id,
			name: "courses",
			mode: "replace",
			records: [{ title: "Fresh" }],
		});
		expect(rewrite).toMatchObject({ ok: true, count: 1 });
		expect(await recordRows(project.id, "courses")).toEqual([
			{ ordinal: 0, data: JSON.stringify({ title: "Fresh" }) },
		]);
	});
});

describe("listLibrary against real D1", () => {
	it("summarizes components (published/draft versions) and collections", async () => {
		const project = await createProject();
		const design = await createDesign({ projectId: project.id });
		await claimTurn(design.id, "turn-1");
		const hero = await saveComponentDraft(prisma(), {
			projectId: project.id,
			turnId: "turn-1",
			input: { name: "Hero", tagName: "tb-hero", js: COMPONENT_JS },
		});
		if (!hero.ok) throw new Error("hero save failed");
		// Publish v1 through the real lifecycle (fenced by the turn lease).
		const published = await publishTurnComponentDrafts(prisma(), env, {
			turnId: "turn-1",
			drafts: [{ componentId: hero.componentId, versionId: hero.versionId }],
		});
		expect(published.published).toEqual([
			{ componentId: hero.componentId, version: 1, repinned: 0 },
		]);
		// v2 stays a draft.
		await saveComponentDraft(prisma(), {
			projectId: project.id,
			input: { name: "Hero", tagName: "tb-hero", js: COMPONENT_JS },
		});
		await seedDataCollection(prisma(), env.DB, {
			projectId: project.id,
			name: "courses",
			records: [{ title: "a" }],
		});

		const library = await listLibrary(prisma(), { projectId: project.id });
		expect(library.components).toEqual([
			{
				name: "Hero",
				tagName: "tb-hero",
				kind: "section",
				publishedVersion: 1,
				draftVersion: 2,
			},
		]);
		expect(library.collections).toEqual([{ name: "courses", recordCount: 1 }]);
	});
});

describe("publishTurnComponentDrafts with a real turn lease", () => {
	it("publishes leased drafts, reports failures without aborting", async () => {
		const project = await createProject();
		const design = await createDesign({ projectId: project.id });
		await claimTurn(design.id, "turn-x");
		const hero = await saveComponentDraft(prisma(), {
			projectId: project.id,
			turnId: "turn-x",
			input: { name: "Hero", tagName: "tb-hero", js: COMPONENT_JS },
		});
		if (!hero.ok) throw new Error("hero save failed");
		// Tamper the draft post-save so its publish fails validation.
		await env.DB.prepare(
			'UPDATE "ComponentVersion" SET "js" = ? WHERE "id" = ?',
		)
			.bind("const broken = 1;", hero.versionId)
			.run();
		const card = await saveComponentDraft(prisma(), {
			projectId: project.id,
			turnId: "turn-x",
			input: {
				name: "Card",
				tagName: "tb-card",
				js: COMPONENT_JS.replace("tb-hero", "tb-card"),
			},
		});
		if (!card.ok) throw new Error("card save failed");

		const outcome = await publishTurnComponentDrafts(prisma(), env, {
			turnId: "turn-x",
			drafts: [
				{ componentId: hero.componentId, versionId: hero.versionId },
				{ componentId: card.componentId, versionId: card.versionId },
			],
		});
		expect(outcome.published).toEqual([
			{ componentId: card.componentId, version: 1, repinned: 0 },
		]);
		expect(outcome.failed).toHaveLength(1);
		expect(outcome.failed[0].error).toContain("component draft rejected");

		// The card's version flipped to published, pointer moved, bundle
		// written; the hero draft stayed draft.
		expect(
			await env.DB.prepare(
				'SELECT "status" FROM "ComponentVersion" WHERE "id" = ?',
			)
				.bind(card.versionId)
				.first<{ status: string } | null>(),
		).toEqual({ status: "published" });
		expect(
			await env.DB.prepare(
				'SELECT "publishedVersionId" FROM "Component" WHERE "id" = ?',
			)
				.bind(card.componentId)
				.first<{ publishedVersionId: string | null } | null>(),
		).toEqual({ publishedVersionId: card.versionId });
		expect(
			await env.DESIGNS.head(`components/${card.componentId}/v1.js`),
		).not.toBeNull();
		expect(
			await env.DB.prepare(
				'SELECT "status" FROM "ComponentVersion" WHERE "id" = ?',
			)
				.bind(hero.versionId)
				.first<{ status: string } | null>(),
		).toEqual({ status: "draft" });
	});
});

describe("chat-tool path: save_component + publish_design auto-publish", () => {
	it("saves the draft, publishes it on publish_design, and previews it", async () => {
		const project = await createProject();
		const design = await createDesign({ projectId: project.id });
		const js = COMPONENT_JS;
		vi.mocked(createWorkersAI).mockReturnValue(
			vi.fn(() =>
				multiToolCallModel([
					{
						toolName: "save_component",
						input: {
							name: "Hero",
							kind: "section",
							tagName: "tb-hero",
							js,
							html: "<tb-hero></tb-hero>",
							css: "p { color: var(--tb-text-primary); }",
							changeNote: "initial hero",
						},
					},
					{
						toolName: "publish_design",
						input: {
							html: "<!doctype html><html><body><script type='module'>import '/x.js';</script><tb-hero></tb-hero></body></html>",
						},
					},
				]),
			) as never,
		);

		const session = await createAdminSession();
		const { response, ctx } = await dispatchChat(
			design.id,
			{ message: "build a hero component and publish the page" },
			session,
		);
		expect(response.status).toBe(200);
		const wire = await response.text();
		await waitOnExecutionContext(ctx);
		// The turn finished cleanly (no public error marker).
		expect(wire).not.toContain("chat turn failed");

		// The component draft was created…
		const components = await componentRows(project.id);
		expect(components.results).toHaveLength(1);
		const component = components.results[0];
		expect(component).toMatchObject({
			name: "Hero",
			tagName: "tb-hero",
			kind: "section",
		});

		// …and publish_design auto-published it (KUK-921 gap closed).
		const versions = await versionRows(component.id as string);
		expect(versions).toHaveLength(1);
		expect(versions[0]).toMatchObject({ version: 1, status: "published" });
		expect(component.publishedVersionId).not.toBeNull();
		const bundle = await env.DESIGNS.get(`components/${component.id}/v1.js`);
		expect(await bundle?.text()).toBe(js);

		// The draft preview doc was written through the drafts file route
		// pattern (draftFileName("hero-v1") → drafts/hero-v1.html).
		const preview = await env.DESIGNS.get(
			`designs/${design.id}/drafts/hero-v1.html`,
		);
		const previewHtml = (await preview?.text()) ?? "";
		expect(previewHtml).toContain("<!doctype html>");
		expect(previewHtml).toContain("<tb-hero></tb-hero>");
		expect(previewHtml).toContain("customElements.define");

		// The monolithic publish still ran: a version snapshot landed and the
		// live pointer moved; the design ended ready.
		const designRow = await env.DB.prepare(
			'SELECT "status", "activeTurnId", "liveTurnId" FROM "Design" WHERE "id" = ?',
		)
			.bind(design.id)
			.first<{
				status: string;
				activeTurnId: string | null;
				liveTurnId: string | null;
			} | null>();
		expect(designRow).toMatchObject({ status: "ready", activeTurnId: null });
		expect(designRow?.liveTurnId).not.toBeNull();
		expect(
			await env.DESIGNS.head(
				`designs/${design.id}/turns/${designRow?.liveTurnId}/index.html`,
			),
		).not.toBeNull();
	});

	it("save_component returns validation errors as tool output without writing", async () => {
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
							js: "const x = 1;",
						},
					},
				]),
			) as never,
		);

		const session = await createAdminSession();
		const { response, ctx } = await dispatchChat(
			design.id,
			{ message: "save something broken" },
			session,
		);
		await response.text();
		await waitOnExecutionContext(ctx);

		expect((await componentRows(project.id)).results).toEqual([]);
		// The turn still finalized (validation failures are tool output, not
		// turn failures).
		expect(
			await env.DB.prepare('SELECT "status" FROM "Design" WHERE "id" = ?')
				.bind(design.id)
				.first<{ status: string } | null>(),
		).toEqual({ status: "ready" });
	});
});
