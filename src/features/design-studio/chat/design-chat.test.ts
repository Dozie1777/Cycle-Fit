import { describe, expect, it } from "vitest";
import { TB_COMPONENT_SKELETON } from "@/features/design-studio/tools/component-skeleton";
import type { LibrarySummary } from "@/features/design-studio/tools/component-tools";
import type { PagesSummary } from "@/features/design-studio/tools/page-tools";
import {
	buildLibraryContextText,
	designSystemPrompt,
	draftFileName,
	extractHtml,
	LIBRARY_CONTEXT_CHAR_LIMIT,
} from "./design-chat-prompt";

/** A full brand kit fixture (KUK-898 injection tests). */
function brandKitFixture() {
	return {
		name: "Acme brand",
		palettes: [
			{
				mode: "light",
				colors: [
					{ role: "background", value: "#ffffff" },
					{ role: "foreground", value: "#111111" },
					{ role: "primary", value: "#2563eb" },
				],
			},
			{
				mode: "dark",
				colors: [
					{ role: "background", value: "#0b1120" },
					{ role: "foreground", value: "#e2e8f0" },
				],
			},
		],
		typography: [
			{ role: "heading", stack: "Georgia, serif" },
			{ role: "body", stack: "Inter, sans-serif" },
		],
		fonts: [{ family: "Inter", source: "google", weights: "400;700" }],
	};
}

describe("extractHtml", () => {
	it("extracts a full document from raw text", () => {
		const html = "<!doctype html><html><body>hi</body></html>";
		expect(extractHtml(`Here is the design:\n${html}`)).toBe(html);
	});

	it("unwraps markdown code fences", () => {
		const html = '<!doctype html>\n<html lang="en">\n</html>';
		const text = `Done.\n\n\`\`\`html\n${html}\n\`\`\`\n`;
		expect(extractHtml(text)).toBe(html);
	});

	it("matches case-insensitively", () => {
		const html = "<!DOCTYPE HTML><HTML><BODY></BODY></HTML>";
		expect(extractHtml(html)).toBe(html);
	});

	it("returns null when there is no complete document", () => {
		expect(extractHtml("just text, no html")).toBeNull();
		expect(extractHtml("<!doctype html><body>unterminated")).toBeNull();
		expect(extractHtml("<html><body>no doctype</body></html>")).toBeNull();
	});

	it("takes the last document when several appear", () => {
		const first = "<!doctype html><html><body>v1</body></html>";
		const second = "<!doctype html><html><body>v2</body></html>";
		expect(extractHtml(`${first} and then ${second}`)).toBe(second);
	});
});

describe("draftFileName", () => {
	it("normalizes section names into safe html file names", () => {
		expect(draftFileName("hero")).toBe("hero.html");
		expect(draftFileName("Hero Section")).toBe("hero-section.html");
		expect(draftFileName("pricing.html")).toBe("pricing.html");
	});

	it("neutralizes traversal and rejects hidden or oversized names", () => {
		// Traversal sequences collapse to a leading dot, which is rejected.
		expect(draftFileName("../../etc/passwd")).toBeNull();
		expect(draftFileName("..\\..\\win.ini")).toBeNull();
		expect(draftFileName(".hidden")).toBeNull();
		expect(draftFileName("x".repeat(80))).toBeNull();
		expect(draftFileName("   ")).toBeNull();
	});

	it("appends the requested extension (html default, svg for wireframes)", () => {
		expect(draftFileName("hero", "html")).toBe("hero.html");
		expect(draftFileName("hero", "svg")).toBe("hero.svg");
		expect(draftFileName("hero.svg", "svg")).toBe("hero.svg");
		expect(draftFileName("hero.svg", "html")).toBe("hero.svg.html");
	});
});

describe("designSystemPrompt", () => {
	it("embeds the brief, tools and interactive question guidance", () => {
		const prompt = designSystemPrompt({
			prompt: "A bakery landing page",
			siteUrl: "https://example.com/designs/abc/site",
		});
		expect(prompt).toContain("A bakery landing page");
		expect(prompt).toContain("https://example.com/designs/abc/site");
		expect(prompt).toContain("publish_design");
		expect(prompt).toContain("preview_section");
		expect(prompt).toContain("propose_design");
		expect(prompt).toContain("ask_user");
		expect(prompt).toContain("wireframe");
	});

	it("describes the conversational, section-by-section process", () => {
		const prompt = designSystemPrompt({
			prompt: "x",
			siteUrl: "https://example.com/x",
		});
		expect(prompt).toContain("clarifying questions");
		expect(prompt).toContain("Real copy, one section at a time");
		expect(prompt).toContain("just conversation");
	});

	it("ends the turn at ask_user and waits for the button answer", () => {
		const prompt = designSystemPrompt({
			prompt: "x",
			siteUrl: "https://example.com/x",
		});
		expect(prompt).toContain("ends the turn");
		expect(prompt).toContain("nothing may follow it");
	});

	it("tells the model about the turn time budget so it front-loads the artifact", () => {
		const prompt = designSystemPrompt({
			prompt: "x",
			siteUrl: "https://example.com/x",
		});
		expect(prompt).toContain("Time budget");
		expect(prompt).toContain("40 minutes");
		expect(prompt).toContain("Front-load the artifact");
		expect(prompt).toContain("One deliverable per turn");
	});

	it("asks for real section copy and treats ideas as directions, not text", () => {
		const prompt = designSystemPrompt({
			prompt: "x",
			siteUrl: "https://example.com/x",
		});
		expect(prompt).toContain("ACTUAL text content");
		expect(prompt).toContain("never lorem ipsum");
		expect(prompt).toContain("An idea is not copy");
		expect(prompt).toContain("suggestions per slot");
	});

	it("guides early low-fidelity SVG wireframes before styled sections", () => {
		const prompt = designSystemPrompt({
			prompt: "x",
			siteUrl: "https://example.com/x",
		});
		expect(prompt).toContain("low-fidelity");
		expect(prompt).toContain("content placement");
	});

	it("searches the web via browser navigation to DuckDuckGo", () => {
		const prompt = designSystemPrompt({
			prompt: "x",
			siteUrl: "https://example.com/x",
		});
		expect(prompt).toContain("duckduckgo.com/?q=");
		expect(prompt).toContain("browser_navigate");
		expect(prompt).not.toContain("web_search");
	});

	it("recommends palettes and font pairings as interactive pickers", () => {
		const prompt = designSystemPrompt({
			prompt: "x",
			siteUrl: "https://example.com/x",
		});
		expect(prompt).toContain("style_options");
		expect(prompt).toContain("font pairings");
		expect(prompt).toContain("font-family stacks");
	});

	it("keeps research analysis-only: no copied assets, screenshots or base64", () => {
		const prompt = designSystemPrompt({
			prompt: "x",
			siteUrl: "https://example.com/x",
		});
		expect(prompt).toContain("Never copy assets from references");
		expect(prompt).toContain("public URL");
		expect(prompt).toContain("browser_take_screenshot");
		expect(prompt).toContain("base64");
		expect(prompt).toContain("Ignore heavy assets");
	});

	it("derives palette and typography from the page, not stylesheet side-quests", () => {
		const prompt = designSystemPrompt({
			prompt: "x",
			siteUrl: "https://example.com/x",
		});
		expect(prompt).toContain(":root");
		expect(prompt).toContain("separate stylesheet files");
		expect(prompt).toContain("getComputedStyle");
		expect(prompt).toContain("estimate the palette from actual usage");
	});
});

describe("designSystemPrompt brand kit injection (KUK-898)", () => {
	it("no-kit golden: the prompt is unchanged — derive-from-page + style_options as before", () => {
		const prompt = designSystemPrompt({
			prompt: "x",
			siteUrl: "https://example.com/x",
		});
		// Golden snapshot: pins the kit-less prompt against regressions.
		expect(prompt).toMatchSnapshot("no-kit design system prompt");
		expect(prompt).not.toContain("Brand kit");
		expect(prompt).toContain("pinned CDN URL");
		expect(prompt).toContain(
			"No external fonts,\n  images, tracking or analytics",
		);
		expect(prompt).toContain("2-4 palettes and/or 2-4 font pairings");
		expect(prompt).toContain("2-4 coherent color palettes");
	});

	it("injects the brand kit section: verbatim tokens, font head, dark overrides", () => {
		const prompt = designSystemPrompt({
			prompt: "x",
			siteUrl: "https://example.com/x",
			brandKit: brandKitFixture(),
		});
		expect(prompt).toContain("## Brand kit: Acme brand");
		expect(prompt).toContain("--background: #ffffff;");
		expect(prompt).toContain("--font-heading: Georgia, serif;");
		expect(prompt).toContain("--font-body: Inter, sans-serif;");
		expect(prompt).toContain(
			'rel="preconnect" href="https://fonts.googleapis.com"',
		);
		expect(prompt).toContain("family=Inter:wght@400;700");
		// Dark palette overrides ride along with the light root.
		expect(prompt).toContain("@media (prefers-color-scheme: dark)");
		expect(prompt).toContain(".dark {");
		// The kit sits after the brief, before the chat-formatting rules.
		expect(prompt.indexOf("## Brand kit")).toBeGreaterThan(
			prompt.indexOf("# The design brief"),
		);
		expect(prompt.indexOf("## Brand kit")).toBeLessThan(
			prompt.indexOf("# Chat formatting"),
		);
	});

	it("amends the external-assets contract: pinned CDN scripts allowed, fonts/images stay self-contained", () => {
		const prompt = designSystemPrompt({
			prompt: "x",
			siteUrl: "https://example.com/x",
			brandKit: brandKitFixture(),
		});
		// KUK-936-style amendment (owner request): published documents may
		// load well-known libraries from a pinned CDN URL — the publish
		// sandbox isolates them — while fonts, images and tracking stay
		// self-contained.
		expect(prompt).toContain("pinned CDN URL");
		expect(prompt).toContain("brand-kit font stylesheets");
		expect(prompt).not.toContain("(no fonts, images, CDNs or analytics)");
		expect(prompt).toContain("Publications allow");
	});

	it("skips palette/font style options when a kit exists, wireframes stay", () => {
		const prompt = designSystemPrompt({
			prompt: "x",
			siteUrl: "https://example.com/x",
			brandKit: brandKitFixture(),
		});
		expect(prompt).toContain("the brand kit below fixes the palette and");
		expect(prompt).toContain(
			"never offer color palettes or font pairings that would",
		);
		expect(prompt).toContain("do not offer color palettes or font pairings");
		expect(prompt).toContain("layout wireframes are still welcome");
		expect(prompt).not.toContain("2-4 palettes and/or 2-4 font pairings");
	});

	it("a kit with nothing to emit behaves like no kit", () => {
		const prompt = designSystemPrompt({
			prompt: "x",
			siteUrl: "https://example.com/x",
			brandKit: {
				name: "Empty kit",
				palettes: [],
				typography: [],
				fonts: [{ family: "Arial", source: "system" }],
			},
		});
		expect(prompt).not.toContain("Brand kit");
		expect(prompt).toContain("pinned CDN URL");
		expect(prompt).toContain(
			"No external fonts,\n  images, tracking or analytics",
		);
	});
});

describe("designSystemPrompt building blocks (KUK-924)", () => {
	const prompt = () =>
		designSystemPrompt({ prompt: "x", siteUrl: "https://example.com/x" });

	it("embeds the canonical component skeleton verbatim", () => {
		// String containment is the budget guard: the skeleton must ride in
		// the prompt unmodified (the validator's conventions reference it).
		expect(prompt()).toContain(TB_COMPONENT_SKELETON);
	});

	it("adds the building blocks section with the three agent tools", () => {
		const text = prompt();
		expect(text).toContain("# Building blocks (reusable components)");
		expect(text).toContain("list_components");
		expect(text).toContain("save_component");
		expect(text).toContain("seed_data");
		// The conventions the validator enforces, named in the prompt.
		expect(text).toContain('script type="application/json" slot="data"');
		expect(text).toContain('hasAttribute("data-ssr")');
		expect(text).toContain("tb-font");
		expect(text).toContain("shadowMode");
	});

	it("precedes the skills section when skills are appended", () => {
		const text = designSystemPrompt({
			prompt: "x",
			siteUrl: "https://example.com/x",
			skills: [
				{
					name: "Design critique",
					slug: "design-critique",
					description: "Structured design feedback.",
				},
			],
		});
		expect(text.indexOf("# Building blocks")).toBeGreaterThan(-1);
		expect(text.indexOf("# Building blocks")).toBeLessThan(
			text.indexOf("# Available skills"),
		);
	});
});

describe("designSystemPrompt pages section (KUK-925)", () => {
	const prompt = () =>
		designSystemPrompt({ prompt: "x", siteUrl: "https://example.com/x" });

	it("adds the composition model with the five agent tools", () => {
		const text = prompt();
		expect(text).toContain("# Pages (composition model)");
		expect(text).toContain("compose_page");
		expect(text).toContain("bind_data");
		expect(text).toContain("define_template");
		expect(text).toContain("define_flow");
		expect(text).toContain("list_pages");
	});

	it("explains the publish semantics and the sourceHtml escape hatch", () => {
		const text = prompt();
		expect(text).toContain("publish: true");
		expect(text).toContain("only published pages");
		expect(text).toContain("sourceHtml");
		expect(text).toContain("escape hatch");
	});

	it("keeps the section tight and after the building blocks section", () => {
		const text = prompt();
		const blocks = text.indexOf("# Building blocks (reusable components)");
		const pages = text.indexOf("# Pages (composition model)");
		expect(pages).toBeGreaterThan(blocks);
		// Budget guard: the whole addition must stay a few hundred characters
		// past the section header (the prompt rides in every chat turn).
		const section = text.slice(pages, text.indexOf("##", pages + 4));
		expect(section.length).toBeLessThan(1_200);
	});
});

describe("designSystemPrompt skills section", () => {
	it("appends the available-skills section when skills are passed", () => {
		const prompt = designSystemPrompt({
			prompt: "x",
			siteUrl: "https://example.com/x",
			skills: [
				{
					name: "Design critique",
					slug: "design-critique",
					description: "Structured design feedback.",
				},
			],
		});
		expect(prompt).toContain("# Available skills");
		expect(prompt).toContain("**Design critique**");
		expect(prompt).toContain("/design-critique");
		expect(prompt).toContain("load_skill");
	});

	it("omits the section entirely when no skills are enabled", () => {
		const prompt = designSystemPrompt({
			prompt: "x",
			siteUrl: "https://example.com/x",
		});
		expect(prompt).not.toContain("# Available skills");
	});
});

/** Fabricates a worst-case library: more rows than every injection cap. */
function oversizedSummaries(): {
	library: LibrarySummary;
	pages: PagesSummary;
} {
	return {
		library: {
			components: Array.from({ length: 40 }, (_, i) => ({
				name: `Component${i}`,
				tagName: `tb-component-${i}`,
				kind: "section",
				publishedVersion: 3,
				draftVersion: 4,
			})),
			collections: Array.from({ length: 20 }, (_, i) => ({
				name: `collection_${i}`,
				recordCount: 42,
			})),
		},
		pages: {
			pages: Array.from({ length: 30 }, (_, i) => ({
				path: `/page-${i}`,
				title: `Page ${i}`,
				status: "published",
				blockCount: 5,
			})),
			templates: Array.from({ length: 12 }, (_, i) => ({
				name: `Template${i}`,
				slotCount: 3,
			})),
			flows: Array.from({ length: 12 }, (_, i) => ({
				name: `Flow${i}`,
				stepCount: 2,
			})),
		},
	};
}

describe("buildLibraryContextText (KUK-926)", () => {
	it("returns empty for an empty library — the section is omitted entirely", () => {
		expect(
			buildLibraryContextText(
				{ components: [], collections: [] },
				{ pages: [], templates: [], flows: [] },
			),
		).toBe("");
	});

	it("lists components with kind, published version and draft awareness", () => {
		const text = buildLibraryContextText(
			{
				components: [
					{
						name: "Hero",
						tagName: "tb-hero",
						kind: "section",
						publishedVersion: 3,
						draftVersion: 4,
					},
					{
						name: "Nav",
						tagName: "tb-nav",
						kind: "layout",
						publishedVersion: 1,
						draftVersion: null,
					},
					{
						name: "DraftOnly",
						tagName: "tb-draft-only",
						kind: "element",
						publishedVersion: null,
						draftVersion: 2,
					},
				],
				collections: [],
			},
			{ pages: [], templates: [], flows: [] },
		);
		expect(text).toContain("# Project library (current state)");
		expect(text).toContain(
			"- Hero — tb-hero — section — published v3, draft v4 available",
		);
		expect(text).toContain("- Nav — tb-nav — layout — published v1");
		expect(text).toContain(
			"- DraftOnly — tb-draft-only — element — unpublished, draft v2 available",
		);
		// The header tells the model the injected state wins over memory.
		expect(text).toContain("Trust the state below over memory");
	});

	it("orders components, collections, pages, templates, flows", () => {
		const { library, pages } = oversizedSummaries();
		const text = buildLibraryContextText(library, pages);
		const components = text.indexOf("Components (");
		const collections = text.indexOf("Data collections (");
		const pagesList = text.indexOf("Pages (");
		const templates = text.indexOf("Templates (");
		const flows = text.indexOf("Flows (");
		expect(components).toBeGreaterThan(-1);
		expect(collections).toBeGreaterThan(components);
		expect(pagesList).toBeGreaterThan(collections);
		expect(templates).toBeGreaterThan(pagesList);
		expect(flows).toBeGreaterThan(templates);
	});

	it("stays under the token-budget cap even for 40 components / 20 collections / 30 pages", () => {
		const { library, pages } = oversizedSummaries();
		const text = buildLibraryContextText(library, pages);
		expect(text.length).toBeLessThan(LIBRARY_CONTEXT_CHAR_LIMIT);
	});

	it("truncates over-cap lists with an …and-N-more suffix", () => {
		const { library, pages } = oversizedSummaries();
		const text = buildLibraryContextText(library, pages);
		expect(text).toContain("… and 26 more"); // 40 components, 14 shown
		expect(text).toContain("… and 10 more"); // 20 collections, 10 shown
		expect(text).toContain("… and 18 more"); // 30 pages, 12 shown
		expect(text).toContain("… and 2 more"); // 12 templates, 10 shown
	});

	it("keeps small libraries verbatim — no truncation suffix", () => {
		const text = buildLibraryContextText(
			{
				components: [
					{
						name: "Hero",
						tagName: "tb-hero",
						kind: "section",
						publishedVersion: 1,
						draftVersion: null,
					},
				],
				collections: [{ name: "courses", recordCount: 6 }],
			},
			{
				pages: [
					{ path: "/", title: "Home", status: "published", blockCount: 3 },
				],
				templates: [],
				flows: [],
			},
		);
		expect(text).not.toContain("… and");
		expect(text).toContain("Components (1):");
		expect(text).toContain("- courses — 6 records");
		expect(text).toContain("- / — published — 3 blocks");
	});
});

describe("designSystemPrompt library context injection (KUK-926)", () => {
	it("injects the section after Pages and before Available skills", () => {
		const { library, pages } = oversizedSummaries();
		const text = designSystemPrompt({
			prompt: "x",
			siteUrl: "https://example.com/x",
			libraryContext: buildLibraryContextText(library, pages),
			skills: [
				{
					name: "Design critique",
					slug: "design-critique",
					description: "Structured design feedback.",
				},
			],
		});
		const section = text.indexOf("# Project library (current state)");
		expect(section).toBeGreaterThan(
			text.indexOf("# Pages (composition model)"),
		);
		expect(section).toBeLessThan(text.indexOf("# Available skills"));
		expect(text).toContain("tb-component-0");
	});

	it("omits the section entirely when no library context is passed", () => {
		const prompt = designSystemPrompt({
			prompt: "x",
			siteUrl: "https://example.com/x",
		});
		expect(prompt).not.toContain("# Project library");
		expect(prompt).not.toContain("# Available skills");
	});

	it("adds the authoring recap and turn workflow to Building blocks", () => {
		const prompt = designSystemPrompt({
			prompt: "x",
			siteUrl: "https://example.com/x",
		});
		// Attribute-vs-slot-vs-JSON-child recap.
		expect(prompt).toContain("Structure and visible markup live in `html`");
		expect(prompt).toContain("string `attributes`");
		// Turn workflow + manual re-pin model.
		expect(prompt).toContain("Turn workflow:");
		expect(prompt).toContain("publish_design` snapshots everything");
		expect(prompt).toContain("never\nchanges existing pages");
		expect(prompt).toContain("re-points the pins");
	});

	it("keeps the Building blocks prose and the injected section within budget", () => {
		const { library, pages } = oversizedSummaries();
		const text = designSystemPrompt({
			prompt: "x",
			siteUrl: "https://example.com/x",
			libraryContext: buildLibraryContextText(library, pages),
		});
		// Section end: the next top-level header (or end of prompt).
		const sectionEnd = (start: number): number => {
			const next = text.indexOf("\n# ", start + 4);
			return next === -1 ? text.length : next;
		};
		// Building blocks prose (everything but the verbatim skeleton) — the
		// KUK-926 additions must not balloon the section; the runtime-check
		// contract (KUK-test-drive) adds ~400 chars over the KUK-926 budget.
		const blocks = text.indexOf("# Building blocks (reusable components)");
		const skeleton = text.indexOf("Canonical skeleton");
		expect(skeleton - blocks).toBeLessThan(2_100);
		// Pages section guard unchanged (KUK-925).
		const pagesIdx = text.indexOf("# Pages (composition model)");
		expect(text.slice(pagesIdx, sectionEnd(pagesIdx)).length).toBeLessThan(
			1_200,
		);
		// The injected section rides under its cap.
		const libIdx = text.indexOf("# Project library (current state)");
		expect(text.slice(libIdx, sectionEnd(libIdx)).length).toBeLessThan(
			LIBRARY_CONTEXT_CHAR_LIMIT,
		);
	});
});
