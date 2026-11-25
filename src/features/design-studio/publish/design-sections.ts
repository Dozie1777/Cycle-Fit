// Pure body/head splitting for the legacy-design backfill (KUK-930):
// segments a monolithic document at its genuine top-level body boundaries —
// the markup contract the selection bridge targets (see
// server/handlers/design-files.ts) — plus the document's head style/link
// assets and the extracted-token → DesignToken row mapping. Standalone
// module (no cloudflare:/prisma imports) so unit tests can load it in plain
// vitest; the orchestration lives in ./design-backfill.

import type { DesignTokens } from "@/features/design-studio/assets/design-files";

/** One top-level `[data-section]` element extracted from a document. */
export type DesignSection = {
	/**
	 * The `data-section` attribute value (the section name the selection
	 * bridge reports), null for a bare `data-section` attribute.
	 */
	name: string | null;
	/** The element's outer HTML, verbatim from the source document. */
	html: string;
};

/**
 * One ordered top-level body segment of a legacy document (KUK-930 review
 * round 2): ONE segment per top-level body child. "section" iff the
 * segment's own top-level element carries a `data-section` attribute
 * DIRECTLY (nested markers do not retype the segment); "raw" for top-level
 * text runs with non-whitespace content — unmarked elements are raw
 * segments carrying their COMPLETE outer HTML, so structure and CSS
 * selectors survive backfill verbatim (no splitting inside an element).
 */
export type BodySegment =
	| { type: "section"; name: string | null; html: string }
	| { type: "raw"; html: string };

/** An opening tag with its raw attribute string (`<tag ATTRS>`). */
// One pattern, two engines: the sticky walker matches ONLY at the scan
// cursor (a `<` that does not open a tag must not jump ahead); the global
// scanner sweeps the whole document for hasDataSectionMarkers.
const OPEN_TAG_PATTERN =
	"<([a-zA-Z][a-zA-Z0-9]*)((?:\"[^\"]*\"|'[^']*'|[^\"'>])*)>";
/** Sticky: the splitBody walker anchors at the current cursor. */
const OPEN_TAG_RE = new RegExp(OPEN_TAG_PATTERN, "y");
/** Global: document-wide scans. */
const SCAN_TAG_RE = new RegExp(OPEN_TAG_PATTERN, "g");

/**
 * Finds a `data-section` attribute in a raw attribute string. Mirrors the
 * selection bridge's `closest("[data-section]")` contract: the attribute may
 * be bare or valued, double- or single-quoted, or unquoted. Returns the
 * value ("" for a bare attribute or an empty value), or null when the
 * attribute is absent.
 */
function dataSectionAttr(attrs: string): string | null {
	const match =
		/(?:^|\s)data-section(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?(?=$|\s|\/)/.exec(
			attrs,
		);
	if (!match) return null;
	return match[2] ?? match[3] ?? match[4] ?? "";
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * End offset of the element opened at `openEnd` with tag `tag` (lowercase):
 * the offset after the matching close tag, counting same-name nesting.
 * Heuristic on purpose — malformed HTML is tolerated (self-closing and
 * unclosed same-name elements included): when no matching close tag exists
 * the element extends to `fallbackEnd` (the body end — parser semantics: an
 * unclosed element is never split, it simply stays open).
 *
 * Close-tag-looking text that is INERT per the HTML grammar never ends the
 * element: comments (`<!-- … -->`, which may contain `</section>` verbatim)
 * are skipped whole, and the raw-text content of `style` / `textarea` /
 * `title` / `script` is skipped to the raw element's own real closing tag —
 * a `"</section>"` string inside a stylesheet must not terminate a marked
 * section prematurely.
 */
function elementEnd(
	html: string,
	tag: string,
	openEnd: number,
	openTagText: string,
	fallbackEnd: number,
): number {
	// HTML void elements have no closing tag: the open tag IS the element
	// (the XML-style `/>` form is equally terminal). Searching for a close
	// tag would swallow everything after e.g. `<img data-section …>`.
	if (VOID_ELEMENTS.has(tag) || openTagText.endsWith("/>")) {
		return openEnd;
	}
	const tokenRe = new RegExp(
		`<(\\/?)${escapeRegExp(tag)}(?=[\\s/>]|>)[^>]*>|<!--|<(style|textarea|title|script)\\b[^>]*>`,
		"gi",
	);
	tokenRe.lastIndex = openEnd;
	let depth = 1;
	for (;;) {
		const match = tokenRe.exec(html);
		if (match === null) return fallbackEnd;
		if (match[0] === "<!--") {
			// Comment: inert through its terminator (or the body end).
			const close = html.indexOf("-->", tokenRe.lastIndex);
			if (close === -1) return fallbackEnd;
			tokenRe.lastIndex = close + 3;
			continue;
		}
		if (match[3] !== undefined) {
			// Raw-text element (style/textarea/title/script): its content is
			// inert text — skip to the raw element's own closing tag.
			const from = tokenRe.lastIndex;
			const closeRe = new RegExp(
				`</${escapeRegExp(match[3].toLowerCase())}(?=[\\s/>]|>)[^>]*>`,
				"i",
			);
			const close = closeRe.exec(html.slice(from));
			if (!close) return fallbackEnd;
			tokenRe.lastIndex = from + close.index + close[0].length;
			continue;
		}
		if (match[1] === "/") {
			depth -= 1;
			if (depth === 0) return match.index + match[0].length;
			continue;
		}
		// A self-closing same-name element does not open a nesting level.
		if (!match[0].endsWith("/>")) depth += 1;
	}
}

/** Document body bounds: after `<body …>`, before `</body>` (doc edges when absent). */
function bodyBounds(html: string): { start: number; end: number } {
	const open = /<body\b[^>]*>/i.exec(html);
	const close = /<\/body\b/i.exec(html);
	return {
		start: open ? open.index + open[0].length : 0,
		end: close ? close.index : html.length,
	};
}

/**
 * HTML void elements: no closing tag exists, so their "end" is the open tag
 * itself (the XML-style `/>` form is handled separately in elementEnd).
 */
const VOID_ELEMENTS = new Set([
	"area",
	"base",
	"br",
	"col",
	"embed",
	"hr",
	"img",
	"input",
	"link",
	"meta",
	"param",
	"source",
	"track",
	"wbr",
]);

/**
 * Splits a legacy monolithic document into its ordered top-level body
 * segments (KUK-930 review round 2): ONE segment per TOP-LEVEL body child —
 * every top-level element (marked section, unmarked wrapper, anything)
 * becomes a single segment containing its COMPLETE outer HTML (a
 * `data-section` nested inside an unmarked wrapper stays inside that
 * wrapper's segment, so structure and CSS selectors are preserved
 * verbatim — no splitting inside an element, ever), and every top-level
 * TEXT RUN becomes a `raw` segment when non-whitespace.
 *
 * A segment is typed "section" iff its own top-level element carries a
 * `data-section` attribute DIRECTLY; nested markers do not retype the
 * segment (see hasDataSectionMarkers for the document-wide check the
 * backfill's refusal logic uses). Comments, stray close tags, and bare `<`
 * characters are tolerated as text. Malformed markup never throws: an
 * element with no matching close tag extends to the body end (parser
 * semantics — it is never split).
 *
 * Returns [] for an empty body. The `name` field on section segments is the
 * `data-section` attribute value (null for a bare attribute).
 */
export function splitBody(html: string): BodySegment[] {
	const bounds = bodyBounds(html);
	const segments: BodySegment[] = [];
	let cursor = bounds.start;
	// Start of the pending top-level text run (comments, stray close tags and
	// lone `<` characters accumulate into it).
	let textStart = cursor;
	const flushText = (end: number) => {
		const text = html.slice(textStart, end);
		if (!/^\s*$/.test(text)) {
			segments.push({ type: "raw", html: text });
		}
	};

	while (cursor < bounds.end) {
		if (html[cursor] !== "<") {
			cursor += 1;
			continue;
		}
		if (html.startsWith("<!--", cursor)) {
			// Comment: part of the text run; skip past its terminator.
			const close = html.indexOf("-->", cursor + 4);
			cursor = close === -1 ? bounds.end : close + 3;
			continue;
		}
		if (html.startsWith("</", cursor) || html.startsWith("<!", cursor)) {
			// Stray close tag / doctype: text up to its `>`.
			const gt = html.indexOf(">", cursor);
			cursor = gt === -1 ? bounds.end : gt + 1;
			continue;
		}
		OPEN_TAG_RE.lastIndex = cursor;
		const match = OPEN_TAG_RE.exec(html);
		if (match === null) {
			// `<` that does not open a tag (e.g. "a < b"): text.
			cursor += 1;
			continue;
		}
		// A top-level element: flush the pending text run, emit ONE segment
		// with the element's complete outer HTML, never splitting inside it.
		flushText(cursor);
		const tag = match[1].toLowerCase();
		const openEnd = cursor + match[0].length;
		const end = elementEnd(html, tag, openEnd, match[0], bounds.end);
		const sectionName = dataSectionAttr(match[2]);
		const elementHtml = html.slice(cursor, end);
		if (sectionName === null) {
			segments.push({ type: "raw", html: elementHtml });
		} else {
			segments.push({
				type: "section",
				name: sectionName === "" ? null : sectionName,
				html: elementHtml,
			});
		}
		cursor = end;
		textStart = cursor;
	}
	flushText(bounds.end);
	return segments;
}

/**
 * True when the document contains at least one `data-section` attribute
 * ANYWHERE (top-level or nested). The backfill's "no sections" refusal uses
 * this document-wide check, while segment typing follows only direct
 * top-level attributes (see splitBody).
 */
export function hasDataSectionMarkers(html: string): boolean {
	SCAN_TAG_RE.lastIndex = 0;
	for (;;) {
		const match = SCAN_TAG_RE.exec(html);
		if (match === null) return false;
		if (dataSectionAttr(match[2]) !== null) return true;
	}
}

/**
 * Splits a legacy monolithic document into its top-level `[data-section]`
 * elements' outer HTML, in document order — the splitBody segments whose
 * own top-level element carries the attribute directly. (A `data-section`
 * nested inside an unmarked wrapper is not top-level and does not appear
 * here; it stays inside the wrapper's raw segment.)
 */
export function splitSections(html: string): DesignSection[] {
	return splitBody(html)
		.filter(
			(segment): segment is Extract<BodySegment, { type: "section" }> =>
				segment.type === "section",
		)
		.map((segment) => ({ name: segment.name ?? null, html: segment.html }));
}

// ---------------------------------------------------------------------------
// Head assets (KUK-930 review round: styling must survive backfill)
// ---------------------------------------------------------------------------

/**
 * Matches verbatim `<style>…</style>` and `<link …>` tags, the
 * `<meta name="viewport" …>` declaration, and `<base …>` tags (KUK-930
 * review round 4: a converted responsive page must keep its viewport
 * declaration and relative-URL base — both are inert, validated-by-parser
 * content that preserves layout when carried verbatim into the head-assets
 * block). Other `<meta>`s and `<script>` are deliberately NOT matched
 * (scripts make the document un-backfillable; other metas carry no layout
 * or URL behavior).
 */
const HEAD_ASSET_RE =
	/<style\b[^>]*>[\s\S]*?<\/style\s*>|<link\b[^>]*\/?>|<meta\b[^>]*\/?>|<base\b[^>]*\/?>/gi;

/** Matches a meta tag that declares the viewport (name value, any quoting). */
const VIEWPORT_META_RE =
	/\bname\s*=\s*(?:"[^"]*viewport[^"]*"|'[^']*viewport[^']*'|[^\s>]*viewport[^\s>]*)/i;

/**
 * Extracts the document's `<head>` `<style>` and `<link>` tags verbatim plus
 * its viewport `<meta>` and `<base>` tags, in document order, joined with
 * newlines. Skips `<script>`, every non-viewport `<meta>`, and `<title>`.
 * "" when there is no `<head>…</head>` region or no carried tags.
 */
export function extractHeadAssets(html: string): string {
	const headMatch = /<head\b[^>]*>([\s\S]*?)<\/head\s*>/i.exec(html);
	const region = headMatch?.[1];
	if (!region) return "";
	const assets: string[] = [];
	HEAD_ASSET_RE.lastIndex = 0;
	for (;;) {
		const match = HEAD_ASSET_RE.exec(region);
		if (match === null) break;
		if (/^<meta\b/i.test(match[0]) && !VIEWPORT_META_RE.test(match[0])) {
			continue;
		}
		assets.push(match[0]);
	}
	return assets.join("\n");
}

// ---------------------------------------------------------------------------
// Minimal HTML-entity decoder (for URL-smuggling detection)
// ---------------------------------------------------------------------------

/**
 * The named references that matter for smuggling scheme strings past a
 * source-level check (colon/sol build "javascript:" and "//", NewLine/Tab
 * are stripped by the URL parser, comma/period/lpar/rpar dress up the
 * call). Deliberately minimal and explicit — not an entity table; the
 * decoder's only consumer is the backfill's executable-content guard.
 */
const NAMED_ENTITY_VALUES: Record<string, string> = {
	colon: ":",
	sol: "/",
	NewLine: "\n",
	Tab: "\t",
	comma: ",",
	period: ".",
	lpar: "(",
	rpar: ")",
	nbsp: "\u00a0",
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	aposs: "'",
	apos: "'",
};

/** Numeric (`&#…;`, `&#x…;`/`&#X…;`) and named (`&…;`) character references. */
const ENTITY_RE = /&(?:#([0-9xX][0-9a-fA-F]*)|([a-zA-Z][a-zA-Z0-9]*));/g;

/**
 * Decodes HTML character references: numeric references fully (decimal and
 * hex, either case prefix), the named references above explicitly; unknown
 * names and out-of-range code points are left verbatim. NOT a full entity
 * table — the guard must see what the BROWSER would see in an attribute
 * value, so `href="jav&#x61;script:…"` decodes to a matchable scheme string.
 */
export function decodeHtmlEntities(input: string): string {
	return input.replace(ENTITY_RE, (match, numeric, name) => {
		if (numeric !== undefined) {
			const hex = /^[xX]/.test(numeric);
			const code = Number.parseInt(
				hex ? numeric.slice(1) : numeric,
				hex ? 16 : 10,
			);
			if (Number.isSafeInteger(code) && code >= 0 && code <= 0x10ffff) {
				return String.fromCodePoint(code);
			}
			return match;
		}
		const named = NAMED_ENTITY_VALUES[name];
		return named !== undefined ? named : match;
	});
}

// ---------------------------------------------------------------------------
// Extracted-token → DesignToken row mapping
// ---------------------------------------------------------------------------

/** Non-color families an extracted custom-property name may carry. */
const NAME_FAMILIES = ["spacing", "radius", "shadow", "typography"] as const;

/**
 * Maps a custom-property name from extractDesignTokens' output back to a
 * [category, role] DesignToken pair. A name carrying a family prefix wins
 * (`--font-<role>` → typography, `--spacing-<role>` → spacing, … — the
 * inverse of designTokenRowsToDesignTokens' vocabulary); anything else falls
 * back to the caller's category ("color" for color-valued tokens, "other"
 * for the rest of the non-color values). Agent-authored either way, and
 * never written over an existing row.
 */
export function classifyTokenName(
	name: string,
	fallbackCategory: string,
): { category: string; role: string } {
	const bare = name.replace(/^--/, "").trim();
	if (bare.startsWith("font-") && bare.length > "font-".length) {
		return { category: "typography", role: bare.slice("font-".length) };
	}
	for (const family of NAME_FAMILIES) {
		if (bare === family) return { category: family, role: "default" };
		if (bare.startsWith(`${family}-`)) {
			const role = bare.slice(family.length + 1);
			if (role !== "") return { category: family, role };
		}
	}
	return { category: fallbackCategory, role: bare };
}

/** Pure mapping extractDesignTokens output → desired DesignToken rows. */
export function htmlTokensToTokenRows(tokens: DesignTokens): DesiredTokenRow[] {
	const rows: DesiredTokenRow[] = [];
	for (const color of tokens.colors) {
		const { category, role } = classifyTokenName(color.name, "color");
		if (role === "") continue;
		rows.push({ category, role, value: color.value });
	}
	for (const other of tokens.other) {
		const { category, role } = classifyTokenName(other.name, "other");
		if (role === "") continue;
		rows.push({ category, role, value: other.value });
	}
	return rows;
}

/** A [category, role, value] triple the backfill wants present. */
export type DesiredTokenRow = {
	category: string;
	role: string;
	value: string;
};
