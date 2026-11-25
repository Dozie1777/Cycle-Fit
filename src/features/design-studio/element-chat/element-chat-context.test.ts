// Unit tests for the per-element context builders (KUK-943). The builders
// take the prisma client as a parameter (no runtime db import), so a plain
// stub covers every read — same pattern as campaign-asset-context.test.ts.
import { describe, expect, it } from "vitest";
import {
	buildElementContext,
	ELEMENT_CONTEXT_TOTAL_CAP,
	ElementContextNotFoundError,
} from "./element-chat-context";

type Block = Record<string, unknown> | null;

/** A prisma stub whose model methods resolve `overrides[model]`. */
function makePrisma(overrides: Record<string, Block | Block[] | number> = {}) {
	const stub = new Proxy(
		{},
		{
			get: (_target, model: string) => ({
				findFirst: async () => overrides[model] ?? null,
				findMany: async () => overrides[model] ?? [],
				findUnique: async () => overrides[model] ?? null,
				count: async () => overrides[model] ?? 0,
			}),
		},
	);
	return stub as never;
}

const PROJECT = "p-1";

const version = (n: number, extra: Record<string, unknown> = {}) => ({
	id: `v-${n}`,
	version: n,
	status: n === 2 ? "published" : "draft",
	js: `class extends HTMLElement {} // v${n}`,
	html: `<div>v${n}</div>`,
	css: `:host{color:var(--tb-primary)}`,
	shadowMode: "light",
	apiSchema: '{"attributes":{"title":{"type":"string"}}}',
	defaults: '{"title":"Hello"}',
	changeNote: `v${n} note`,
	...extra,
});

const componentFixture = (projectId = PROJECT) => ({
	id: "c-hero",
	projectId,
	name: "Hero",
	tagName: "tb-hero",
	kind: "section",
	publishedVersionId: "v-2",
	versions: [version(3)],
	publishedVersion: version(2),
});

const pageBlockFixture = (path: string, block: Record<string, unknown>) => ({
	page: { path, title: null },
	...block,
});

describe("component builder", () => {
	it("carries the component's identity, versions and content", async () => {
		const prisma = makePrisma({
			component: componentFixture(),
			pageBlock: [pageBlockFixture("/", { componentVersionId: "v-2" })],
		});
		const prompt = await buildElementContext(
			prisma,
			PROJECT,
			"component",
			"c-hero",
		);
		expect(prompt).toContain("component Hero");
		expect(prompt).toContain("`tb-hero`");
		expect(prompt).toContain("Kind: section");
		expect(prompt).toContain("Latest: v3 (draft)");
		expect(prompt).toContain("published v2");
		expect(prompt).toContain("// v3");
		expect(prompt).toContain('{"attributes":{"title":{"type":"string"}}}');
		expect(prompt).toContain('{"title":"Hello"}');
		// Neighbors: page paths only.
		expect(prompt).toContain("## Pages using this component");
		expect(prompt).toContain("- /");
	});

	it("does NOT contain other components' sources or page-block dumps", async () => {
		const prisma = makePrisma({
			component: componentFixture(),
			pageBlock: [pageBlockFixture("/", { componentVersionId: "v-2" })],
		});
		const prompt = await buildElementContext(
			prisma,
			PROJECT,
			"component",
			"c-hero",
		);
		// No other element's internals leak in: no pricing-table sources,
		// no other component versions beyond the latest + published.
		expect(prompt).not.toContain("PricingTable");
		expect(prompt).not.toContain("tb-pricing");
		expect(prompt).not.toContain("propsOverrides");
		expect(prompt).not.toContain("sourceHtml");
		// Only versions 3 and 2 — no draft history.
		expect(prompt).not.toContain("v1");
	});

	it("truncates oversized source fields to the per-field cap", async () => {
		const big = "x".repeat(20_000);
		const prisma = makePrisma({
			component: {
				...componentFixture(),
				publishedVersion: null,
				versions: [version(1, { js: big, html: big, css: big })],
			},
			pageBlock: [],
		});
		const prompt = await buildElementContext(
			prisma,
			PROJECT,
			"component",
			"c-hero",
		);
		expect(prompt).toContain(`${"x".repeat(4_096)}…`);
		expect(prompt.length).toBeLessThanOrEqual(ELEMENT_CONTEXT_TOTAL_CAP);
	});
});

describe("page builder", () => {
	it("lists blocks in ordinal order with pins, templates and raw HTML", async () => {
		const prisma = makePrisma({
			page: {
				id: "pg-1",
				projectId: PROJECT,
				path: "/pricing",
				title: "Pricing",
				status: "draft",
				blocks: [
					{
						ordinal: 0,
						componentVersion: {
							version: 2,
							component: { tagName: "tb-hero" },
						},
						propsOverrides: '{"cta":"Buy"}',
						dataBindings: null,
						template: null,
						sourceHtml: null,
					},
					{
						ordinal: 1,
						componentVersion: null,
						template: { name: "Feature grid" },
						propsOverrides: null,
						dataBindings: '{"items":{"collection":"courses"}}',
						sourceHtml: null,
					},
					{
						ordinal: 2,
						componentVersion: null,
						template: null,
						sourceHtml: "<p>one-off</p>",
						propsOverrides: null,
						dataBindings: null,
					},
				],
				flowSteps: [{ flow: { name: "Checkout" } }],
			},
		});
		const prompt = await buildElementContext(prisma, PROJECT, "page", "pg-1");
		expect(prompt).toContain("page /pricing");
		expect(prompt).toContain("Title: Pricing");
		expect(prompt).toContain("Status: draft");
		expect(prompt).toContain('- #0: tb-hero v2 — props: {"cta":"Buy"}');
		expect(prompt).toContain('- #1: template "Feature grid"');
		expect(prompt).toContain('data: {"items":{"collection":"courses"}}');
		expect(prompt).toContain("- #2: raw HTML");
		expect(prompt).toContain("## Flows through this page");
		expect(prompt).toContain("- Checkout");
		// No component sources leak into a page prompt.
		expect(prompt).not.toContain("connectedCallback");
	});
});

describe("template builder", () => {
	it("lists slots in ordinal order with pinned versions and overrides", async () => {
		const prisma = makePrisma({
			template: {
				id: "tpl-1",
				projectId: PROJECT,
				name: "Feature grid",
				slots: [
					{
						ordinal: 0,
						componentVersion: {
							version: 4,
							component: { tagName: "tb-feature" },
						},
						propsOverrides: '{"columns":"3"}',
					},
					{ ordinal: 1, componentVersion: null, propsOverrides: null },
				],
			},
			pageBlock: [pageBlockFixture("/features", { templateId: "tpl-1" })],
		});
		const prompt = await buildElementContext(
			prisma,
			PROJECT,
			"template",
			"tpl-1",
		);
		expect(prompt).toContain("template Feature grid");
		expect(prompt).toContain("- Slot #0: tb-feature v4");
		expect(prompt).toContain('{"columns":"3"}');
		expect(prompt).toContain("- Slot #1: unpinned");
		expect(prompt).toContain("- /features");
	});
});

describe("data builder", () => {
	it("infers the shape, shows capped samples and discovering pages", async () => {
		const prisma = makePrisma({
			dataCollection: {
				id: "dc-1",
				projectId: PROJECT,
				name: "courses",
				records: [
					{ ordinal: 0, data: '{"title":"Intro","price":"$49"}' },
					{ ordinal: 1, data: '{"title":"Advanced","level":"hard"}' },
				],
			},
			dataRecord: 7,
			pageBlock: [
				pageBlockFixture("/catalog", {
					dataBindings: '{"items":{"collection":"courses"}}',
				}),
				pageBlockFixture("/other", { dataBindings: null }),
			],
		});
		const prompt = await buildElementContext(prisma, PROJECT, "data", "dc-1");
		expect(prompt).toContain('data collection "courses"');
		expect(prompt).toContain("Records: 7");
		expect(prompt).toContain("- title");
		expect(prompt).toContain("- price");
		expect(prompt).toContain("- level");
		expect(prompt).toContain('- #0: {"title":"Intro","price":"$49"}');
		expect(prompt).toContain("- /catalog");
		expect(prompt).not.toContain("/other");
	});

	it("caps samples at 5 records", async () => {
		const prisma = makePrisma({
			dataCollection: {
				id: "dc-1",
				projectId: PROJECT,
				name: "courses",
				records: Array.from({ length: 9 }, (_, i) => ({
					ordinal: i,
					data: `{"n":${i}}`,
				})),
			},
			dataRecord: 9,
			pageBlock: [],
		});
		const prompt = await buildElementContext(prisma, PROJECT, "data", "dc-1");
		expect(prompt).toContain("- #0:");
		expect(prompt).toContain("- #4:");
		expect(prompt).not.toContain("- #5:");
	});
});

describe("flow builder", () => {
	it("lists ordered steps with page paths and action summaries", async () => {
		const prisma = makePrisma({
			flow: {
				id: "fl-1",
				projectId: PROJECT,
				name: "Checkout",
				steps: [
					{
						ordinal: 0,
						entryAction: null,
						exitTarget: "click .cta",
						page: { path: "/", title: "Home" },
					},
					{
						ordinal: 1,
						entryAction: "click .cta on previous step",
						exitTarget: "submit form",
						page: { path: "/checkout", title: null },
					},
				],
			},
		});
		const prompt = await buildElementContext(prisma, PROJECT, "flow", "fl-1");
		expect(prompt).toContain("flow Checkout");
		expect(prompt).toContain("- Step #0: / (Home)");
		expect(prompt).toContain("exit: click .cta");
		expect(prompt).toContain("- Step #1: /checkout");
		expect(prompt).toContain("enter: click .cta on previous step");
	});
});

describe("style footer (tokens + brand kit)", () => {
	it("appends the brand kit exactly once when one exists", async () => {
		const prisma = makePrisma({
			component: componentFixture(),
			pageBlock: [],
			brandKit: {
				id: "bk-1",
				name: "Acme brand",
				palettes: [
					{
						mode: "light",
						colors: [
							{ role: "background", value: "#ffffff" },
							{ role: "primary", value: "#2563eb" },
						],
					},
				],
				typography: [{ role: "heading", stack: "Georgia, serif" }],
				fonts: [],
			},
		});
		const prompt = await buildElementContext(
			prisma,
			PROJECT,
			"component",
			"c-hero",
		);
		expect(prompt.match(/## Brand kit: Acme brand/g)).toHaveLength(1);
		expect(prompt).toContain("--primary: #2563eb;");
	});

	it("appends design tokens once when the project has a token system", async () => {
		const prisma = makePrisma({
			flow: {
				id: "fl-1",
				projectId: PROJECT,
				name: "Checkout",
				steps: [],
			},
			designSystem: {
				id: "sys-1",
				tokens: [
					{ category: "color", role: "primary", value: "#2563eb" },
					{ category: "spacing", role: "md", value: "16px" },
				],
			},
		});
		const prompt = await buildElementContext(prisma, PROJECT, "flow", "fl-1");
		expect(prompt.match(/# Design tokens/g)).toHaveLength(1);
		expect(prompt).toContain("--primary: #2563eb;");
		expect(prompt).toContain("--spacing-md: 16px;");
	});

	it("omits the footer entirely for a style-less project", async () => {
		const prisma = makePrisma({
			flow: {
				id: "fl-1",
				projectId: PROJECT,
				name: "Checkout",
				steps: [],
			},
		});
		const prompt = await buildElementContext(prisma, PROJECT, "flow", "fl-1");
		expect(prompt).not.toContain("Brand kit");
		expect(prompt).not.toContain("# Design tokens");
	});
});

describe("not-found and cross-project guards", () => {
	it.each([
		"component",
		"page",
		"template",
		"data",
		"flow",
	] as const)("%s: throws a typed error for missing or foreign elements", async (elementType) => {
		// Empty stub: every find returns null — wrong-project ids (and
		// missing ones) must throw, not leak another project's rows.
		const prisma = makePrisma();
		await expect(
			buildElementContext(prisma, PROJECT, elementType, "missing"),
		).rejects.toBeInstanceOf(ElementContextNotFoundError);
	});
});
