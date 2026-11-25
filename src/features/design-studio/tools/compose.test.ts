// Unit tests for the composition engine (KUK-920) — pure resolver + thin
// Prisma loader, all in-memory fixtures, no database. Fixtures are plain
// objects shaped like the Prisma rows the loaders fetch.
import { describe, expect, it, vi } from "vitest";
import {
	type ComposeBlockRow,
	type ComposeInput,
	type ComposeVersionRow,
	componentBundlePath,
	composePage,
	loadComposeInputs,
	loadComposePageByPath,
	renderFontLinks,
	renderTokenCss,
	tokenCssVariable,
} from "./compose";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let versionSeq = 0;
function version(
	overrides: Partial<ComposeVersionRow> = {},
): ComposeVersionRow {
	versionSeq += 1;
	return {
		id: `cv-${versionSeq}`,
		componentId: "comp-hero",
		version: 1,
		status: "published",
		tagName: "tb-hero",
		apiSchema: JSON.stringify({
			attributes: {
				heading: { type: "string", description: "headline" },
				cta: { type: "string", description: "call to action" },
			},
			slots: ["default"],
			events: ["click"],
		}),
		defaults: JSON.stringify({ heading: "Default heading" }),
		...overrides,
	};
}

function block(
	overrides: Partial<ComposeBlockRow> & { id: string },
): ComposeBlockRow {
	return {
		ordinal: 0,
		propsOverrides: null,
		dataBindings: null,
		...overrides,
	};
}

function coursesRecords(): { ordinal: number; data: string }[] {
	return [
		{
			ordinal: 0,
			data: JSON.stringify({ title: "Intro to SQL", price: "$49" }),
		},
		{
			ordinal: 1,
			data: JSON.stringify({ title: "Advanced SQL", price: "$99" }),
		},
		{
			ordinal: 2,
			data: JSON.stringify({ title: "Free preview", price: "$0" }),
		},
	];
}

const tokens = {
	color: [
		{ category: "color", role: "background", value: "#ffffff" },
		{ category: "color", role: "primary", value: "#2563eb" },
		{ category: "color", role: "dark-background", value: "#0a0a0a" },
	],
	font: [
		{
			category: "font",
			role: "Inter",
			value: JSON.stringify({
				source: "google",
				url: null,
				weights: "400;700",
				italic: false,
			}),
		},
	],
	spacing: [{ category: "spacing", role: "md", value: "16px" }],
	typography: [
		{ category: "typography", role: "heading", value: "Georgia, serif" },
	],
};

function input(overrides: Partial<ComposeInput> = {}): ComposeInput {
	const hero = version();
	return {
		projectId: "p1",
		page: {
			path: "/",
			title: "Home",
			blocks: [
				block({
					id: "b1",
					ordinal: 0,
					componentVersionId: hero.id,
					propsOverrides: JSON.stringify({
						heading: "Welcome",
						cta: "Buy now",
					}),
					dataBindings: JSON.stringify({
						items: {
							collection: "courses",
							limit: 2,
							filter: { price: "$49" },
						},
					}),
				}),
			],
		},
		componentVersions: { [hero.id]: hero },
		templateSlots: {},
		collectionRecords: { courses: coursesRecords() },
		tokens,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Pure resolver — full-document snapshot
// ---------------------------------------------------------------------------

describe("composePage", () => {
	it("renders component blocks + template expansion + sourceHtml + data bindings", () => {
		const hero = version();
		const card = version({
			componentId: "comp-card",
			tagName: "tb-card",
			apiSchema: JSON.stringify({
				attributes: { title: { type: "string" } },
				slots: [],
			}),
			defaults: JSON.stringify({ title: "Card title" }),
		});
		const result = composePage(
			input({
				page: {
					path: "/",
					title: "Home — Acme",
					blocks: [
						block({
							id: "b2",
							ordinal: 1,
							templateId: "tpl-1",
							propsOverrides: JSON.stringify({ title: "Overridden card" }),
						}),
						block({
							id: "b1",
							ordinal: 0,
							componentVersionId: hero.id,
							propsOverrides: JSON.stringify({ heading: "Welcome" }),
							dataBindings: JSON.stringify({
								items: {
									collection: "courses",
									limit: 2,
									filter: { price: "$49" },
								},
							}),
						}),
						block({
							id: "b3",
							ordinal: 2,
							sourceHtml: '<section class="promo">\n\t<p>Sale!</p>\n</section>',
						}),
					],
				},
				componentVersions: { [hero.id]: hero, [card.id]: card },
				templateSlots: {
					"tpl-1": [
						{
							templateId: "tpl-1",
							ordinal: 0,
							componentVersionId: card.id,
							propsOverrides: null,
						},
					],
				},
			}),
		);
		expect(result.errors).toEqual([]);
		expect(result.html).toBe(
			[
				"<!doctype html>",
				"<html>",
				"<head>",
				"<title>Home — Acme</title>",
				'<link rel="preconnect" href="https://fonts.googleapis.com">',
				'<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
				'<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap">',
				"<style>",
				":root {",
				"\t--tb-color-background: #ffffff;",
				"\t--tb-color-dark-background: #0a0a0a;",
				"\t--tb-color-primary: #2563eb;",
				"\t--tb-spacing-md: 16px;",
				"\t--tb-typography-heading: Georgia, serif;",
				"}",
				"</style>",
				'<script type="module">',
				'import "/projects/p1/components/comp-card/v1.js";',
				'import "/projects/p1/components/comp-hero/v1.js";',
				"</script>",
				"</head>",
				"<body>",
				'<tb-hero data-block-id="b1" heading="Welcome">',
				'\t<script type="application/json" slot="data" data-collection="courses">{"items":[{"title":"Intro to SQL","price":"$49"}]}</script>',
				"</tb-hero>",
				'<tb-card title="Overridden card"></tb-card>',
				'<div data-block-id="b3">',
				'<section class="promo">',
				"\t<p>Sale!</p>",
				"</section>",
				"</div>",
				"</body>",
				"</html>",
			].join("\n"),
		);
	});

	it("merges defaults under propsOverrides and emits attributes sorted", () => {
		const hero = version({
			apiSchema: JSON.stringify({
				attributes: {
					alpha: { type: "string" },
					cta: { type: "string" },
					heading: { type: "string" },
					zeta: { type: "string" },
				},
			}),
			defaults: JSON.stringify({
				heading: "Default",
				zeta: "z",
				cta: "Default CTA",
			}),
		});
		const result = composePage(
			input({
				page: {
					path: "/",
					title: "Home",
					blocks: [
						block({
							id: "b1",
							componentVersionId: hero.id,
							propsOverrides: JSON.stringify({ cta: "Overridden", alpha: "a" }),
						}),
					],
				},
				componentVersions: { [hero.id]: hero },
			}),
		);
		expect(result.errors).toEqual([]);
		expect(result.html).toContain(
			'<tb-hero data-block-id="b1" alpha="a" cta="Overridden" heading="Default" zeta="z"></tb-hero>',
		);
	});

	it("expands template slots in ordinal order with block-level overrides winning", () => {
		const card = version({
			componentId: "comp-card",
			tagName: "tb-card",
			apiSchema: JSON.stringify({
				attributes: { title: { type: "string" }, tone: { type: "string" } },
			}),
			defaults: null,
		});
		const result = composePage(
			input({
				page: {
					path: "/",
					title: "Home",
					blocks: [
						block({
							id: "b1",
							templateId: "tpl-1",
							propsOverrides: JSON.stringify({ title: "Block title" }),
						}),
					],
				},
				componentVersions: { [card.id]: card },
				templateSlots: {
					"tpl-1": [
						{
							templateId: "tpl-1",
							ordinal: 1,
							componentVersionId: card.id,
							propsOverrides: JSON.stringify({
								title: "Slot B title",
								tone: "Slot tone",
							}),
						},
						{
							templateId: "tpl-1",
							ordinal: 0,
							componentVersionId: card.id,
							propsOverrides: JSON.stringify({ title: "Slot A title" }),
						},
					],
				},
			}),
		);
		expect(result.errors).toEqual([]);
		// Slots in ordinal order; block override wins over the slot's title,
		// slot-only props pass through; no data-block-id on expanded slots.
		// Attributes are sorted alphabetically (title < tone).
		expect(result.html).toContain(
			'<tb-card title="Block title"></tb-card>\n<tb-card title="Block title" tone="Slot tone"></tb-card>',
		);
	});

	it("wraps sourceHtml in a data-block-id div verbatim", () => {
		const result = composePage(
			input({
				page: {
					path: "/",
					title: "Home",
					blocks: [block({ id: "b1", sourceHtml: "  <p>Hi &amp; bye</p>  " })],
				},
				tokens: {},
			}),
		);
		expect(result.errors).toEqual([]);
		expect(result.html).toContain(
			'<div data-block-id="b1">\n<p>Hi &amp; bye</p>\n</div>',
		);
	});

	it("applies limit and equality filter to bound records in ordinal order", () => {
		const hero = version();
		const result = composePage(
			input({
				page: {
					path: "/",
					title: "Home",
					blocks: [
						block({
							id: "b1",
							componentVersionId: hero.id,
							dataBindings: JSON.stringify({
								items: { collection: "courses", limit: 2 },
							}),
						}),
					],
				},
				componentVersions: { [hero.id]: hero },
			}),
		);
		expect(result.errors).toEqual([]);
		expect(result.html).toContain(
			'{"items":[{"title":"Intro to SQL","price":"$49"},{"title":"Advanced SQL","price":"$99"}]}',
		);
	});

	it("escapes attribute values and the title", () => {
		const hero = version({ apiSchema: null, defaults: null });
		const result = composePage(
			input({
				page: {
					path: "/",
					title: 'A <b>bold</b> & "quoted" page',
					blocks: [
						block({
							id: "b1",
							componentVersionId: hero.id,
							propsOverrides: JSON.stringify({ heading: 'say "hi" <now>' }),
						}),
					],
				},
				componentVersions: { [hero.id]: hero },
				tokens: {},
			}),
		);
		expect(result.errors).toEqual([]);
		expect(result.html).toContain(
			'<title>A &lt;b&gt;bold&lt;/b&gt; &amp; "quoted" page</title>',
		);
		expect(result.html).toContain(
			'<tb-hero data-block-id="b1" heading="say &quot;hi&quot; &lt;now&gt;"></tb-hero>',
		);
	});

	it("omits preconnects and font links when no font tokens exist", () => {
		const hero = version();
		const result = composePage(
			input({
				page: {
					path: "/",
					title: "Home",
					blocks: [block({ id: "b1", componentVersionId: hero.id })],
				},
				componentVersions: { [hero.id]: hero },
				tokens: {
					color: [{ category: "color", role: "primary", value: "#fff" }],
				},
			}),
		);
		expect(result.errors).toEqual([]);
		expect(result.html).not.toContain("preconnect");
		expect(result.html).toContain(
			"<style>\n:root {\n\t--tb-color-primary: #fff;\n}\n</style>",
		);
	});

	it("imports each distinct bundle path once, sorted", () => {
		const a1 = version({ id: "a1", componentId: "comp-a", version: 1 });
		const a2 = version({
			id: "a2",
			componentId: "comp-a",
			version: 2,
			apiSchema: null,
			defaults: null,
		});
		const b1 = version({ id: "b1v", componentId: "comp-b", version: 1 });
		const result = composePage(
			input({
				page: {
					path: "/",
					title: "Home",
					blocks: [
						block({ id: "x1", ordinal: 0, componentVersionId: "a2" }),
						block({ id: "x2", ordinal: 1, componentVersionId: "a1" }),
						block({ id: "x3", ordinal: 2, componentVersionId: "b1v" }),
					],
				},
				componentVersions: { a1, a2, b1v: b1 },
				tokens: {},
			}),
		);
		expect(result.errors).toEqual([]);
		expect(result.html).toContain(
			[
				'<script type="module">',
				'import "/projects/p1/components/comp-a/v1.js";',
				'import "/projects/p1/components/comp-a/v2.js";',
				'import "/projects/p1/components/comp-b/v1.js";',
				"</script>",
			].join("\n"),
		);
	});

	it("is deterministic — two calls produce byte-identical output", () => {
		const first = composePage(input());
		const second = composePage(input());
		expect(first).toEqual(second);
		expect(first.html).toBe(second.html);
	});
});

// ---------------------------------------------------------------------------
// Error collection
// ---------------------------------------------------------------------------

describe("composePage errors", () => {
	it("skips blocks with a missing pin, unpublished pin, or no source", () => {
		const hero = version({ id: "draft", status: "draft" });
		const result = composePage(
			input({
				page: {
					path: "/",
					title: "Home",
					blocks: [
						block({ id: "missing", ordinal: 0, componentVersionId: "nope" }),
						block({
							id: "unpublished",
							ordinal: 1,
							componentVersionId: "draft",
						}),
						block({ id: "empty", ordinal: 2 }),
					],
				},
				componentVersions: { draft: hero },
			}),
		);
		expect(result.errors).toEqual([
			'block "missing": pinned component version "nope" not found',
			'block "unpublished": component "tb-hero" version 1 is "draft", not published; block skipped',
			'block "empty": no source set (exactly one of componentVersionId/templateId/sourceHtml is required); block skipped',
		]);
		expect(result.html).toContain("<body>\n</body>");
	});

	it("reports multiple sources and renders the highest-priority one", () => {
		const hero = version();
		const result = composePage(
			input({
				page: {
					path: "/",
					title: "Home",
					blocks: [
						block({
							id: "b1",
							componentVersionId: hero.id,
							sourceHtml: "<p>ignored</p>",
						}),
					],
				},
				componentVersions: { [hero.id]: hero },
				tokens: {},
			}),
		);
		expect(result.errors).toEqual([
			'block "b1": multiple sources set (componentVersionId, sourceHtml); using componentVersionId',
		]);
		expect(result.html).toContain(
			'<tb-hero data-block-id="b1" heading="Default heading"></tb-hero>',
		);
		expect(result.html).not.toContain("<p>ignored</p>");
	});

	it("skips blocks with malformed propsOverrides/dataBindings/apiSchema JSON", () => {
		const brokenSchema = version({
			id: "broken-schema",
			apiSchema: "{not json",
		});
		const ok = version({ id: "ok" });
		const result = composePage(
			input({
				page: {
					path: "/",
					title: "Home",
					blocks: [
						block({
							id: "props",
							ordinal: 0,
							componentVersionId: "ok",
							propsOverrides: "{oops",
						}),
						block({
							id: "bindings",
							ordinal: 1,
							componentVersionId: "ok",
							dataBindings: "[1,2]",
						}),
						block({
							id: "schema",
							ordinal: 2,
							componentVersionId: "broken-schema",
						}),
					],
				},
				componentVersions: { ok, "broken-schema": brokenSchema },
				tokens: {},
			}),
		);
		expect(result.errors).toEqual([
			'block "props": malformed propsOverrides JSON; block skipped',
			'block "bindings": malformed dataBindings JSON; block skipped',
			'block "schema": component "tb-hero" version 1 has malformed apiSchema JSON; block skipped',
		]);
	});

	it("renders the element but skips unknown attributes and non-string values", () => {
		const hero = version();
		const result = composePage(
			input({
				page: {
					path: "/",
					title: "Home",
					blocks: [
						block({
							id: "b1",
							componentVersionId: hero.id,
							propsOverrides: JSON.stringify({
								bogus: "x",
								cta: 42,
								heading: "ok",
							}),
						}),
					],
				},
				componentVersions: { [hero.id]: hero },
				tokens: {},
			}),
		);
		expect(result.errors).toEqual([
			'block "b1": unknown attribute "bogus" for component "tb-hero"; skipped',
			'block "b1": attribute "cta" must be a string (apiSchema attributes are strings); skipped',
		]);
		expect(result.html).toContain(
			'<tb-hero data-block-id="b1" heading="ok"></tb-hero>',
		);
	});

	it("accepts any string prop when the schema does not constrain attributes", () => {
		const hero = version({
			apiSchema: JSON.stringify({ slots: ["default"] }),
			defaults: null,
		});
		const result = composePage(
			input({
				page: {
					path: "/",
					title: "Home",
					blocks: [
						block({
							id: "b1",
							componentVersionId: hero.id,
							propsOverrides: JSON.stringify({ anything: "goes" }),
						}),
					],
				},
				componentVersions: { [hero.id]: hero },
				tokens: {},
			}),
		);
		expect(result.errors).toEqual([]);
		expect(result.html).toContain(
			'<tb-hero data-block-id="b1" anything="goes"></tb-hero>',
		);
	});

	it("skips bindings with unknown collections, malformed entries, and bad records", () => {
		const hero = version();
		const result = composePage(
			input({
				page: {
					path: "/",
					title: "Home",
					blocks: [
						block({
							id: "b1",
							componentVersionId: hero.id,
							dataBindings: JSON.stringify({
								bad: { collection: "ghosts" },
								malformed: { nope: true },
								ok: { collection: "broken" },
							}),
						}),
					],
				},
				componentVersions: { [hero.id]: hero },
				collectionRecords: {
					broken: [
						{ ordinal: 0, data: "{not json" },
						{ ordinal: 1, data: JSON.stringify({ title: "Fine" }) },
					],
				},
				tokens: {},
			}),
		);
		expect(result.errors).toEqual([
			'block "b1" (data binding "bad"): unknown collection "ghosts"; binding skipped',
			'block "b1": data binding "malformed" is malformed; skipped',
			'block "b1" (data binding "ok"): record at ordinal 0 has malformed JSON; skipped',
		]);
		expect(result.html).toContain('{"ok":[{"title":"Fine"}]}');
	});

	it("reports unknown/empty templates and slot problems", () => {
		const card = version({
			id: "card",
			componentId: "comp-card",
			tagName: "tb-card",
			apiSchema: null,
			defaults: null,
		});
		const unpublished = version({ id: "drafted", status: "retired" });
		const result = composePage(
			input({
				page: {
					path: "/",
					title: "Home",
					blocks: [
						block({ id: "unknown", ordinal: 0, templateId: "ghost" }),
						block({ id: "empty", ordinal: 1, templateId: "empty" }),
						block({ id: "partial", ordinal: 2, templateId: "mixed" }),
						block({
							id: "bound",
							ordinal: 3,
							templateId: "empty",
							dataBindings: '{"items":{"collection":"courses"}}',
						}),
					],
				},
				componentVersions: { card, drafted: unpublished },
				templateSlots: {
					empty: [],
					mixed: [
						{
							templateId: "mixed",
							ordinal: 0,
							componentVersionId: null,
							propsOverrides: null,
						},
						{
							templateId: "mixed",
							ordinal: 1,
							componentVersionId: "card",
							propsOverrides: null,
						},
						{
							templateId: "mixed",
							ordinal: 2,
							componentVersionId: "drafted",
							propsOverrides: null,
						},
					],
				},
				collectionRecords: { courses: coursesRecords() },
				tokens: {},
			}),
		);
		expect(result.errors).toEqual([
			'block "unknown": template "ghost" not found; block skipped',
			'block "empty": template "empty" has no slots; nothing rendered',
			'block "partial" (template "mixed" slot 0): no pinned component version; slot skipped',
			'block "partial" (template "mixed" slot 2): component "tb-hero" version 1 is "retired", not published; block skipped',
			'block "bound": data bindings on template blocks are not supported; ignored',
			'block "bound": template "empty" has no slots; nothing rendered',
		]);
		expect(result.html).toContain("<tb-card></tb-card>");
		expect(result.html).not.toContain("tb-hero");
	});

	it("reports malformed font token values without throwing", () => {
		const hero = version();
		const result = composePage(
			input({
				page: {
					path: "/",
					title: "Home",
					blocks: [block({ id: "b1", componentVersionId: hero.id })],
				},
				componentVersions: { [hero.id]: hero },
				tokens: {
					font: [
						{ category: "font", role: "Broken", value: "{oops" },
						{
							category: "font",
							role: "NoUrl",
							value: JSON.stringify({ source: "url", url: null }),
						},
						{
							category: "font",
							role: "Weird",
							value: JSON.stringify({
								source: "cdn",
								url: "https://cdn/x.css",
							}),
						},
					],
				},
			}),
		);
		expect(result.errors).toEqual([
			'font token "Broken": malformed JSON value; skipped',
			'font token "NoUrl": source "url" has no url; skipped',
			'font token "Weird": unknown font source "cdn"; skipped',
		]);
		expect(result.html).not.toContain("fonts.googleapis.com");
	});
});

// ---------------------------------------------------------------------------
// Token CSS + font links + conventions
// ---------------------------------------------------------------------------

describe("renderTokenCss", () => {
	it("emits sorted --tb-<category>-<role> variables, excluding the font category", () => {
		expect(
			renderTokenCss({
				typography: [
					{ category: "typography", role: "heading", value: "Georgia, serif" },
				],
				color: [
					{ category: "color", role: "primary", value: "#2563eb" },
					{ category: "color", role: "dark-primary", value: "#1d4ed8" },
					{ category: "color", role: "background", value: "#ffffff" },
				],
				font: [{ category: "font", role: "Inter", value: "{}" }],
			}),
		).toBe(
			[
				":root {",
				"\t--tb-color-background: #ffffff;",
				"\t--tb-color-dark-primary: #1d4ed8;",
				"\t--tb-color-primary: #2563eb;",
				"\t--tb-typography-heading: Georgia, serif;",
				"}",
			].join("\n"),
		);
	});

	it("returns an empty string when there are no CSS-variable tokens", () => {
		expect(renderTokenCss({})).toBe("");
		expect(
			renderTokenCss({
				font: [{ category: "font", role: "Inter", value: "{}" }],
			}),
		).toBe("");
	});
});

describe("renderFontLinks", () => {
	it("builds google css2 hrefs: weights, italic tuples, and the no-axis case", () => {
		const errors: string[] = [];
		const links = renderFontLinks(
			[
				{
					category: "font",
					role: "Inter",
					value: JSON.stringify({
						source: "google",
						url: null,
						weights: "400;700",
						italic: false,
					}),
				},
				{
					category: "font",
					role: "Playfair Display",
					value: JSON.stringify({
						source: "google",
						url: null,
						weights: "400",
						italic: true,
					}),
				},
				{
					category: "font",
					role: "Bare",
					value: JSON.stringify({
						source: "google",
						url: null,
						weights: null,
						italic: false,
					}),
				},
			],
			errors,
		);
		expect(errors).toEqual([]);
		// Sorted by role: Bare < Inter < Playfair Display.
		expect(links).toEqual([
			"https://fonts.googleapis.com/css2?family=Bare&display=swap",
			"https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap",
			"https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;1,400&display=swap",
		]);
	});

	it("skips system fonts, dedupes hrefs, and encodes family names", () => {
		const errors: string[] = [];
		const links = renderFontLinks(
			[
				{
					category: "font",
					role: "System Stack",
					value: JSON.stringify({
						source: "system",
						url: null,
						weights: null,
						italic: false,
					}),
				},
				{
					category: "font",
					role: "Inter",
					value: JSON.stringify({
						source: "google",
						url: null,
						weights: "400",
						italic: false,
					}),
				},
				{
					category: "font",
					role: "Inter",
					value: JSON.stringify({
						source: "google",
						url: null,
						weights: "400",
						italic: false,
					}),
				},
				{
					category: "font",
					role: "Source Sans 3",
					value: JSON.stringify({
						source: "google",
						url: null,
						weights: "400",
						italic: false,
					}),
				},
			],
			errors,
		);
		expect(errors).toEqual([]);
		expect(links).toEqual([
			"https://fonts.googleapis.com/css2?family=Inter:wght@400&display=swap",
			"https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400&display=swap",
		]);
	});

	it("passes url-source fonts through verbatim", () => {
		const errors: string[] = [];
		const links = renderFontLinks(
			[
				{
					category: "font",
					role: "Custom",
					value: JSON.stringify({
						source: "url",
						url: "https://cdn.example.com/font.css",
						weights: null,
						italic: false,
					}),
				},
			],
			errors,
		);
		expect(errors).toEqual([]);
		expect(links).toEqual(["https://cdn.example.com/font.css"]);
	});
});

describe("convention helpers", () => {
	it("componentBundlePath matches the KUK-923 serving convention", () => {
		expect(componentBundlePath("p1", "comp-a", 3)).toBe(
			"/projects/p1/components/comp-a/v3.js",
		);
	});

	it("tokenCssVariable matches the --tb-<category>-<role> convention", () => {
		expect(tokenCssVariable("color", "primary")).toBe("--tb-color-primary");
		expect(tokenCssVariable("color", "dark-primary")).toBe(
			"--tb-color-dark-primary",
		);
		expect(tokenCssVariable("spacing", "md")).toBe("--tb-spacing-md");
	});
});

// ---------------------------------------------------------------------------
// Loader (stubbed Prisma, no database)
// ---------------------------------------------------------------------------

function makePrismaStub(page: unknown) {
	return {
		page: {
			findUnique: vi.fn(async (_args: unknown) => page),
		},
		templateSlot: {
			findMany: vi.fn(async () => [
				{
					templateId: "tpl-1",
					ordinal: 0,
					componentVersionId: "card",
					propsOverrides: null,
				},
			]),
		},
		componentVersion: {
			// unknown[] — the loader maps raw Prisma rows (with nested
			// component.tagName) into ComposeVersionRows; fixtures mimic that.
			findMany: vi.fn(async (_args: unknown): Promise<unknown[]> => []),
		},
		dataCollection: {
			findMany: vi.fn(async () => [
				{
					name: "courses",
					records: [
						{
							ordinal: 0,
							data: JSON.stringify({ title: "Intro to SQL", price: "$49" }),
						},
					],
				},
			]),
		},
		designSystem: {
			findUnique: vi.fn(async () => ({
				id: "ds-1",
				tokens: [
					{
						id: "t1",
						systemId: "ds-1",
						category: "color",
						role: "primary",
						value: "#2563eb",
					},
				],
			})),
		},
	};
}

describe("loadComposeInputs", () => {
	it("fetches the rows, joins tagNames, and delegates to composePage", async () => {
		const hero = version({ id: "hero" });
		const prisma = makePrismaStub({
			id: "page-1",
			projectId: "p1",
			path: "/",
			title: "Home",
			blocks: [
				{
					id: "b1",
					ordinal: 0,
					componentVersionId: "hero",
					templateId: null,
					sourceHtml: null,
					propsOverrides: null,
					dataBindings: null,
				},
				{
					id: "b2",
					ordinal: 1,
					componentVersionId: null,
					templateId: "tpl-1",
					sourceHtml: null,
					propsOverrides: null,
					dataBindings: null,
				},
			],
		});
		prisma.componentVersion.findMany.mockResolvedValue([
			// Raw Prisma row shape — tagName comes from the nested component.
			{ ...hero, component: { tagName: "tb-hero" } },
			{
				id: "card",
				componentId: "comp-card",
				version: 1,
				status: "published",
				apiSchema: null,
				defaults: null,
				component: { tagName: "tb-card" },
			},
		]);
		const result = await loadComposeInputs(prisma as never, "page-1");
		expect(prisma.page.findUnique).toHaveBeenCalledWith(
			expect.objectContaining({ where: { id: "page-1" } }),
		);
		expect(prisma.componentVersion.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: { in: ["hero", "card"] } },
			}),
		);
		expect(result.errors).toEqual([]);
		// The page block rendered as a component; the template expanded.
		expect(result.html).toContain(
			'<tb-hero data-block-id="b1" heading="Default heading"></tb-hero>',
		);
		expect(result.html).toContain("<tb-card></tb-card>");
		// Tokens came through getProjectTokens' grouping.
		expect(result.html).toContain("--tb-color-primary: #2563eb;");
	});

	it("throws only when the page row is missing", async () => {
		const prisma = makePrismaStub(null);
		await expect(loadComposeInputs(prisma as never, "ghost")).rejects.toThrow(
			'compose: page "ghost" not found',
		);
	});

	it("loads only the collections referenced by the page's data bindings", async () => {
		const prisma = makePrismaStub({
			id: "page-1",
			projectId: "p1",
			path: "/",
			title: "Home",
			blocks: [
				block({
					id: "b1",
					ordinal: 0,
					componentVersionId: "hero",
					dataBindings: JSON.stringify({
						items: { collection: "courses" },
						authors: { collection: "users" },
					}),
				}),
			],
		});
		await loadComposeInputs(prisma as never, "page-1");
		expect(prisma.dataCollection.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { projectId: "p1", name: { in: ["courses", "users"] } },
			}),
		);
	});

	it("loads no collections when no block binds data", async () => {
		const prisma = makePrismaStub({
			id: "page-1",
			projectId: "p1",
			path: "/",
			title: "Home",
			blocks: [block({ id: "b1", ordinal: 0, componentVersionId: "hero" })],
		});
		await loadComposeInputs(prisma as never, "page-1");
		expect(prisma.dataCollection.findMany).not.toHaveBeenCalled();
	});
});

describe("loadComposePageByPath", () => {
	it("addresses the page by (projectId, path) and composes like the id loader", async () => {
		const hero = version({ id: "hero" });
		const prisma = makePrismaStub({
			id: "page-1",
			projectId: "p1",
			path: "/pricing",
			title: "Pricing",
			blocks: [block({ id: "b1", ordinal: 0, componentVersionId: "hero" })],
		});
		prisma.componentVersion.findMany.mockResolvedValue([
			{ ...hero, component: { tagName: "tb-hero" } },
		]);
		const result = await loadComposePageByPath(
			prisma as never,
			"p1",
			"/pricing",
		);
		expect(prisma.page.findUnique).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { projectId_path: { projectId: "p1", path: "/pricing" } },
			}),
		);
		expect(result.errors).toEqual([]);
		expect(result.html).toContain('<tb-hero data-block-id="b1"');
	});

	it("throws when no page exists at that path", async () => {
		const prisma = makePrismaStub(null);
		await expect(
			loadComposePageByPath(prisma as never, "p1", "/ghost"),
		).rejects.toThrow('compose: page "/ghost" not found in project "p1"');
	});
});

// ---------------------------------------------------------------------------
// Content escaping (review regressions) — payloads embedded in script/style
// contexts must never be able to break out of their element
// ---------------------------------------------------------------------------

describe("content escaping", () => {
	it("escapes < in data-binding payloads so </script> cannot break out", () => {
		const hero = version({ defaults: null });
		const result = composePage(
			input({
				page: {
					path: "/",
					title: "Home",
					blocks: [
						block({
							id: "b1",
							ordinal: 0,
							componentVersionId: hero.id,
							propsOverrides: null,
							dataBindings: JSON.stringify({
								items: { collection: "courses" },
							}),
						}),
					],
				},
				componentVersions: { [hero.id]: hero },
				collectionRecords: {
					courses: [
						{
							ordinal: 0,
							data: JSON.stringify({ title: "Popup in </script> tags" }),
						},
					],
				},
			}),
		);
		expect(result.errors).toEqual([]);
		// The payload is byte-decodable JSON (the \u003c escape decodes to '<')
		// but the literal `</script>` sequence is gone from the document.
		expect(result.html).toContain(
			'{"items":[{"title":"Popup in \\u003c/script> tags"}]}',
		);
		expect(result.html).not.toContain("</script> tags");
	});

	it("escapes < in token values so </style> cannot break out of :root", () => {
		const css = renderTokenCss({
			color: [
				{
					category: "color",
					role: "primary",
					value: "red</style><img src=x onerror=alert(1)>",
				},
			],
		});
		// The value survives as CSS escapes; the style element cannot be closed
		// early because no literal `<` remains inside the block.
		expect(css).toContain("--tb-color-primary: red\\3c /style>\\3c img");
		expect(css).not.toContain("</style>");
		expect(css).not.toContain("<img");
	});

	it("percent-encodes quote and < in url-source font hrefs", () => {
		const links = renderFontLinks(
			[
				{
					category: "font",
					role: "Evil",
					value: JSON.stringify({
						source: "url",
						url: 'https://cdn/x.css"><script>alert(1)</script>',
						weights: null,
						italic: false,
					}),
				},
			],
			[],
		);
		expect(links).toEqual([
			"https://cdn/x.css%22%3E%3Cscript%3Ealert(1)%3C/script%3E",
		]);
	});
});
