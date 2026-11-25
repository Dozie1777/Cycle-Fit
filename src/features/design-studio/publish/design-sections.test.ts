// Unit tests for the KUK-930 backfill splitter: pure HTML body/head
// extraction (attribute scanning, no parser — the same markup contract the
// selection bridge targets) and the extracted-token → DesignToken row
// mapping.
import { describe, expect, it } from "vitest";
import {
	classifyTokenName,
	decodeHtmlEntities,
	extractHeadAssets,
	hasDataSectionMarkers,
	htmlTokensToTokenRows,
	splitBody,
	splitSections,
} from "./design-sections";

const doc = (body: string, head = "<title>T</title>") =>
	`<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

describe("splitSections", () => {
	it("splits top-level data-section elements in document order", () => {
		const html = doc(`
<section data-section="hero"><h1>Hero</h1></section>
<section data-section="pricing" class="wrap"><p>$9</p></section>
<footer data-section='footer'>bye</footer>`);
		const sections = splitSections(html);
		expect(sections.map((s) => s.name)).toEqual(["hero", "pricing", "footer"]);
		expect(sections[0].html).toBe(
			`<section data-section="hero"><h1>Hero</h1></section>`,
		);
		expect(sections[1].html).toBe(
			`<section data-section="pricing" class="wrap"><p>$9</p></section>`,
		);
		expect(sections[2].html).toBe(`<footer data-section='footer'>bye</footer>`);
	});

	it("supports bare data-section attributes and keeps head/body noise out", () => {
		const html = doc(
			`<div data-section><p>intro</p></div><span>not a section</span>`,
		);
		const sections = splitSections(html);
		expect(sections).toHaveLength(1);
		expect(sections[0].name).toBeNull();
		expect(sections[0].html).toBe(`<div data-section><p>intro</p></div>`);
	});

	it("keeps only top-level sections: nested data-section elements are skipped", () => {
		const html = doc(`
<section data-section="outer">
  <div data-section="inner">nested</div>
  <span>rest</span>
</section>
<section data-section="after">next</section>`);
		const sections = splitSections(html);
		expect(sections.map((s) => s.name)).toEqual(["outer", "after"]);
		expect(sections[0].html).toContain("nested");
		expect(sections[0].html).toContain("</section>");
	});

	it("bounds an element across same-name nested elements", () => {
		const html = doc(`
<div data-section="a"><div><div>x</div></div></div><div data-section="b">z</div>`);
		const sections = splitSections(html);
		expect(sections.map((s) => s.name)).toEqual(["a", "b"]);
		expect(sections[0].html).toBe(
			`<div data-section="a"><div><div>x</div></div></div>`,
		);
	});

	it("tolerates malformed HTML: an unclosed element stays open to the body end (never split)", () => {
		const html = doc(
			`<section data-section="a"><p>open<section data-section="b">x`,
		);
		const segments = splitBody(html);
		// Parser semantics: the unclosed <section data-section="a"> nests the
		// following same-name element — no splitting inside an element, ever.
		expect(segments).toHaveLength(1);
		expect(segments[0]?.type).toBe("section");
		expect(segments[0]?.html).toBe(
			`<section data-section="a"><p>open<section data-section="b">x`,
		);
	});

	it("returns [] when the document has no data-section markers", () => {
		expect(splitSections(doc(`<main><p>monolithic</p></main>`))).toEqual([]);
		expect(splitSections("")).toEqual([]);
	});

	it("does not mistake lookalike attributes for data-section", () => {
		const html = doc(
			`<section data-section-name="a">x</section><section data-section="b">y</section>`,
		);
		const sections = splitSections(html);
		expect(sections.map((s) => s.name)).toEqual(["b"]);
	});

	it("handles quoted values containing angle-bracket-free markup characters", () => {
		const html = doc(`<section data-section="hero > intro">x</section>`);
		expect(splitSections(html).map((s) => s.name)).toEqual(["hero > intro"]);
	});
});

describe("splitBody", () => {
	it("yields ordered section and raw segments, skipping whitespace-only gaps", () => {
		const html = doc(`
<section data-section="hero"><h1>H</h1></section>
<main><p>unmarked filler</p></main>
<section data-section="pricing"><p>$9</p></section>
`);
		const segments = splitBody(html);
		expect(segments.map((s) => s.type)).toEqual(["section", "raw", "section"]);
		expect(segments[0]).toEqual({
			type: "section",
			name: "hero",
			html: `<section data-section="hero"><h1>H</h1></section>`,
		});
		// Top-level elements are complete segments (no surrounding text).
		expect(segments[1]).toEqual({
			type: "raw",
			html: `<main><p>unmarked filler</p></main>`,
		});
		expect(segments[2]).toEqual({
			type: "section",
			name: "pricing",
			html: `<section data-section="pricing"><p>$9</p></section>`,
		});
	});

	it("keeps leading and trailing raw content around the first/last section", () => {
		const html = doc(
			`<p>before</p><section data-section="a">x</section><p>after</p>`,
		);
		const segments = splitBody(html);
		expect(segments.map((s) => s.type)).toEqual(["raw", "section", "raw"]);
		expect(segments[0]).toEqual({ type: "raw", html: "<p>before</p>" });
		expect(segments[2]).toEqual({ type: "raw", html: "<p>after</p>" });
	});

	it("segments at genuine top-level boundaries: unmarked wrappers stay whole", () => {
		const html = doc(
			`<main><section data-section="hero"><h1>H</h1></section><p>tail</p></main><section data-section="solo">s</section>`,
		);
		const segments = splitBody(html);
		expect(segments).toHaveLength(2);
		// The <main> wrapper is ONE raw segment containing the marked section
		// AND the tail byte-for-byte — no fragmenting into <main> / </main>.
		expect(segments[0]).toEqual({
			type: "raw",
			html: `<main><section data-section="hero"><h1>H</h1></section><p>tail</p></main>`,
		});
		expect(segments[1]).toEqual({
			type: "section",
			name: "solo",
			html: `<section data-section="solo">s</section>`,
		});
	});

	it("types segments by DIRECT data-section only; nested markers stay inside", () => {
		const html = doc(
			`<div class="wrap"><section data-section="hero">h</section></div>`,
		);
		const segments = splitBody(html);
		expect(segments).toHaveLength(1);
		expect(segments[0]?.type).toBe("raw");
		expect(segments[0]?.html).toBe(
			`<div class="wrap"><section data-section="hero">h</section></div>`,
		);
		// …but nested markers still count document-wide for the refusal logic.
		expect(hasDataSectionMarkers(html)).toBe(true);
		expect(hasDataSectionMarkers(doc(`<p>none</p>`))).toBe(false);
	});

	it("void elements are immediately closed and never swallow following content", () => {
		const html = doc(
			`<img data-section="hero" src="hero.png"><section data-section="features">f</section><p>tail</p>`,
		);
		const segments = splitBody(html);
		expect(segments).toHaveLength(3);
		expect(segments[0]).toEqual({
			type: "section",
			name: "hero",
			html: `<img data-section="hero" src="hero.png">`,
		});
		expect(segments[1]).toEqual({
			type: "section",
			name: "features",
			html: `<section data-section="features">f</section>`,
		});
		expect(segments[2]).toEqual({ type: "raw", html: "<p>tail</p>" });
	});

	it("void elements with quoted attribute values containing > parse correctly", () => {
		const html = doc(
			`<img data-section="hero" alt="a > b" src="x.png"><p>after</p>`,
		);
		const segments = splitBody(html);
		expect(segments).toHaveLength(2);
		expect(segments[0]).toEqual({
			type: "section",
			name: "hero",
			html: `<img data-section="hero" alt="a > b" src="x.png">`,
		});
		expect(segments[1]).toEqual({ type: "raw", html: "<p>after</p>" });
	});

	it("comments and unmarked void elements become raw segments", () => {
		const html = doc(
			`<!-- banner --><br><section data-section="a">x</section>`,
		);
		const segments = splitBody(html);
		expect(segments).toHaveLength(3);
		// The comment accumulates in the text run, flushed when the <br>
		// element starts; the void <br> is its own immediately-closed segment.
		expect(segments[0]).toEqual({ type: "raw", html: "<!-- banner -->" });
		expect(segments[1]).toEqual({ type: "raw", html: "<br>" });
		expect(segments[2]).toEqual({
			type: "section",
			name: "a",
			html: `<section data-section="a">x</section>`,
		});
	});

	it("top-level text runs become raw segments", () => {
		const html = doc(`Hello <section data-section="a">x</section> world`);
		const segments = splitBody(html);
		expect(segments).toHaveLength(3);
		expect(segments[0]).toEqual({ type: "raw", html: "Hello " });
		expect(segments[2]).toEqual({ type: "raw", html: " world" });
	});

	it("does not end an element early at a close-tag-looking comment", () => {
		const html = doc(
			`<section data-section="a"><!-- </section> --><p>x</p></section><section data-section="b">y</section>`,
		);
		const segments = splitBody(html);
		expect(segments).toHaveLength(2);
		expect(segments[0]).toEqual({
			type: "section",
			name: "a",
			html: `<section data-section="a"><!-- </section> --><p>x</p></section>`,
		});
		expect(segments[1]).toEqual({
			type: "section",
			name: "b",
			html: `<section data-section="b">y</section>`,
		});
	});

	it("does not end an element early at close-tag-looking text inside <style>", () => {
		const html = doc(
			`<section data-section="a"><style>.x::after { content: "</section>" }</style><p>x</p></section>`,
		);
		const segments = splitBody(html);
		expect(segments).toHaveLength(1);
		expect(segments[0]).toEqual({
			type: "section",
			name: "a",
			html: `<section data-section="a"><style>.x::after { content: "</section>" }</style><p>x</p></section>`,
		});
	});

	it("raw-text content of <textarea> and <title> is inert for close-tag scanning", () => {
		const html = doc(
			`<section data-section="a"><textarea></section></textarea><p>x</p></section>`,
		);
		const segments = splitBody(html);
		expect(segments).toHaveLength(1);
		expect(segments[0]?.html).toBe(
			`<section data-section="a"><textarea></section></textarea><p>x</p></section>`,
		);
	});

	it("returns [] for an empty body", () => {
		expect(splitBody(doc(""))).toEqual([]);
	});

	it("returns raw-only segments when no data-section markers exist", () => {
		const segments = splitBody(doc(`<p>flat</p>`));
		expect(segments).toEqual([{ type: "raw", html: "<p>flat</p>" }]);
	});
});

describe("extractHeadAssets", () => {
	it("captures style and link tags verbatim, in document order", () => {
		const head = `<meta charset="utf-8"><title>T</title><style>:root { --primary: #7c3aed; }</style><script>console.log(1)</script><link rel="stylesheet" href="https://example.com/a.css"><style>.x{color:red}</style>`;
		const assets = extractHeadAssets(doc("body", head));
		expect(assets).toBe(
			`<style>:root { --primary: #7c3aed; }</style>\n<link rel="stylesheet" href="https://example.com/a.css">\n<style>.x{color:red}</style>`,
		);
	});

	it("carries the viewport meta and base tag; discards every other meta", () => {
		const head = `<meta charset="utf-8"><meta name="description" content="legacy"><meta name="viewport" content="width=device-width, initial-scale=1"><base href="/legacy/"><style>a{}</style>`;
		expect(extractHeadAssets(doc("", head))).toBe(
			`<meta name="viewport" content="width=device-width, initial-scale=1">\n<base href="/legacy/">\n<style>a{}</style>`,
		);
	});

	it("carries viewport metas with single quotes, unquoted values, or any attribute order", () => {
		for (const meta of [
			`<meta name='viewport' content='width=480'>`,
			`<meta content="width=480" name=viewport>`,
			`<meta NAME="VIEWPORT" content="width=480">`,
		]) {
			expect(extractHeadAssets(doc("", `${meta}`))).toBe(meta);
		}
	});

	it("skips script tags and non-viewport metas, returning only carried assets", () => {
		const head = `<meta charset="utf-8"><meta name="og:title" content="x"><script src="/x.js"></script><style>a{}</style>`;
		expect(extractHeadAssets(doc("", head))).toBe("<style>a{}</style>");
	});

	it("returns '' when there is no head region or no style/link tags", () => {
		expect(extractHeadAssets("<p>no head</p>")).toBe("");
		expect(
			extractHeadAssets(doc("<p>x</p>", "<title>only title</title>")),
		).toBe("");
	});
});

describe("decodeHtmlEntities", () => {
	it("decodes numeric references fully (decimal and hex, any case)", () => {
		expect(decodeHtmlEntities("jav&#x61;script&#58;alert(1)")).toBe(
			"javascript:alert(1)",
		);
		expect(decodeHtmlEntities("&#X3A;")).toBe(":");
		expect(decodeHtmlEntities("&#110;")).toBe("n");
	});

	it("decodes the smuggling-relevant named references explicitly", () => {
		expect(decodeHtmlEntities("javascript&colon;")).toBe("javascript:");
		expect(decodeHtmlEntities("&sol;&sol;")).toBe("//");
		expect(decodeHtmlEntities("java&NewLine;script&colon;")).toBe(
			"java\nscript:",
		);
		expect(decodeHtmlEntities("&Tab;")).toBe("\t");
		expect(decodeHtmlEntities("&lpar;&rpar;&comma;&period;")).toBe("(),.");
		expect(decodeHtmlEntities("&nbsp;&amp;&lt;&gt;&quot;&apos;")).toBe(
			"\u00a0&<>\"'",
		);
	});

	it("leaves unknown names, missing semicolons, and out-of-range code points verbatim", () => {
		expect(decodeHtmlEntities("&bogus;")).toBe("&bogus;");
		expect(decodeHtmlEntities("&colon")).toBe("&colon");
		expect(decodeHtmlEntities("&#x110000;")).toBe("&#x110000;");
		expect(decodeHtmlEntities("&#99999999999;")).toBe("&#99999999999;");
	});
});

describe("classifyTokenName / htmlTokensToTokenRows", () => {
	it("maps extracted colors to color rows and --font-* to typography", () => {
		expect(classifyTokenName("--primary", "color")).toEqual({
			category: "color",
			role: "primary",
		});
		expect(classifyTokenName("--font-heading", "other")).toEqual({
			category: "typography",
			role: "heading",
		});
		expect(classifyTokenName("--spacing-md", "other")).toEqual({
			category: "spacing",
			role: "md",
		});
		expect(classifyTokenName("--radius", "other")).toEqual({
			category: "radius",
			role: "default",
		});
		expect(classifyTokenName("--brand-accent", "other")).toEqual({
			category: "other",
			role: "brand-accent",
		});
	});

	it("converts extractDesignTokens output into rows without losing values", () => {
		const rows = htmlTokensToTokenRows({
			colors: [{ name: "--primary", value: "#7c3aed" }],
			other: [
				{ name: "--font-body", value: "Inter, sans-serif" },
				{ name: "--spacing-lg", value: "24px" },
			],
		});
		expect(rows).toEqual([
			{ category: "color", role: "primary", value: "#7c3aed" },
			{ category: "typography", role: "body", value: "Inter, sans-serif" },
			{ category: "spacing", role: "lg", value: "24px" },
		]);
	});
});
