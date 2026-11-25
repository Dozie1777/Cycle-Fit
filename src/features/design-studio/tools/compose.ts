// Composition engine (KUK-920): the deterministic Page → HTML resolver that
// both the publish pipeline (KUK-921) and draft studio preview will call.
//
// The core is PURE: `composePage` takes already-loaded rows and returns the
// HTML document plus a list of collected errors — it never throws and never
// touches Prisma, R2, or a browser. Thin loaders (`loadComposeInputs`,
// `loadComposePageByPath`) fetch the rows and delegate; the loaders only
// throw when the page row itself is missing.
//
// Conventions this module OWNS (KUK-923 must serve / write to match):
//
// - Component bundle URLs — `componentBundlePath()`:
//     /projects/<projectId>/components/<componentId>/v<version>.js
//   The resolver imports exactly this path (once per distinct pinned version,
//   sorted) in a `<script type="module">` in <head>; KUK-923 serves exactly
//   this path from R2 keys of the same shape. Never hardcode the shape
//   elsewhere — import the helper.
//
// - Token CSS custom properties — `tokenCssVariable()`:
//     --tb-<category>-<role>
//   Emitted on `:root` (see `renderTokenCss`), sorted by category then role.
//   Dark-mode color roles are already stored with a `dark-` role prefix (see
//   DARK_ROLE_PREFIX in design-tokens.ts), so they render as
//   `--tb-color-dark-<role>`. Components reference tokens as
//   `var(--tb-color-primary)`, `var(--tb-spacing-md)`, … The "font" category
//   is EXCLUDED from the CSS block: its value is font loading metadata (JSON
//   {source, url, weights, italic}), rendered as <link> tags instead (see
//   `renderFontLinks`).
//
// - Font loading links: source "google" emits
//     <link rel="stylesheet"
//           href="https://fonts.googleapis.com/css2?family=<tokenRoleUrlEncoded>[:axis]&display=swap">
//   (the family is the token's role, URL-encoded with + for spaces; weights
//   as :wght@400;700, italic as :ital,wght@0,<w>;1,<w> tuples so the upright
//   faces load too, defaulting to weight 400 when no weights are stored)
//   plus fonts.googleapis.com / fonts.gstatic.com preconnects when any
//   google link is present. Source "url" emits the stored URL as a plain
//   stylesheet link. Source "system" emits nothing. Links are deduped and
//   sorted; one link per font token.
//
// - Data bindings render as a child of the component element:
//     <script type="application/json" slot="data" data-collection="<name>">
//       {"<bindingProp>":[<record>, …]}
//     </script>
//   The prop key is the binding's key in dataBindings; records come from the
//   pre-loaded DataCollection rows in ordinal order, with an optional limit
//   and a simple {key: value} equality filter over the record bodies.
//
// - One-off (sourceHtml) blocks are wrapped in a DIV stamped with the block
//   id: `<div data-block-id="…">…verbatim html…</div>`. Wrapping was chosen
//   over parsing/stamping the first element because it needs no HTML parser
//   (fully deterministic, no risk of mangling author markup) and supports
//   multi-root snippets.
//
// - Template blocks expand their slots in ordinal order with NO extra DOM
//   wrapper (the slot elements are siblings in the body). Slot props merge
//   under the block's own propsOverrides — block-level keys win. Data
//   bindings on a template block are not supported in v1 (they would need a
//   single target element): the field is reported as an error and ignored.
//   Expanded slot elements carry no data-block-id (they are not PageBlocks).
//
// Error policy: composePage never throws. Block-fatal problems (missing or
// unpublished pin, malformed apiSchema/propsOverrides/dataBindings JSON,
// unknown template, block with no source) skip the whole block. Attribute
// problems (unknown key vs apiSchema, non-string value) and data-binding
// problems (unknown collection, malformed filter/limit, malformed record
// JSON) are reported and only the offending prop/binding/record is skipped —
// the element still renders. Multi-source blocks (the handler should prevent
// them) render with the priority componentVersionId > templateId >
// sourceHtml and report the conflict.

import { getProjectTokens } from "@/features/design-studio/tokens/design-tokens";

// ---------------------------------------------------------------------------
// Structural row types (Prisma rows satisfy these; no generated-client import)
// ---------------------------------------------------------------------------

/** A DesignToken row (subset used for composition). */
export type ComposeTokenRow = {
	category: string;
	role: string;
	value: string;
};

/**
 * A pinned ComponentVersion row with its owning Component's tagName merged
 * in (the loaders do the join; fixtures provide it directly).
 */
export type ComposeVersionRow = {
	id: string;
	componentId: string;
	version: number;
	/** "draft" | "published" | "retired" — only "published" renders. */
	status: string;
	tagName: string;
	/** JSON contract: { attributes: {name: …}, slots: [name], events: [name] }. */
	apiSchema?: string | null;
	/** JSON of default attribute values. */
	defaults?: string | null;
};

/** A TemplateSlot row (subset used for composition). */
export type ComposeSlotRow = {
	templateId: string;
	ordinal: number;
	componentVersionId?: string | null;
	propsOverrides?: string | null;
};

/** A PageBlock row (subset used for composition). */
export type ComposeBlockRow = {
	id: string;
	ordinal: number;
	componentVersionId?: string | null;
	templateId?: string | null;
	sourceHtml?: string | null;
	propsOverrides?: string | null;
	dataBindings?: string | null;
};

/** A DataRecord row — `data` is the raw JSON string (D1/SQLite convention). */
export type ComposeRecordRow = {
	ordinal: number;
	data: string;
};

export type ComposeInput = {
	projectId: string;
	page: {
		/**
		 * Reserved: the page's site path is not referenced by the composed
		 * document in v1 (no canonical links / metadata yet). Kept in the
		 * input so KUK-921's publication manifest and future metadata
		 * emission do not change this contract.
		 */
		path: string;
		title: string;
		/** PageBlock rows; sorted by ordinal internally for determinism. */
		blocks: ComposeBlockRow[];
	};
	/** Pinned ComponentVersion rows (with tagName), keyed by version id. */
	componentVersions: Record<string, ComposeVersionRow>;
	/** TemplateSlot rows keyed by template id. */
	templateSlots: Record<string, ComposeSlotRow[]>;
	/** DataRecord rows keyed by collection name. */
	collectionRecords: Record<string, ComposeRecordRow[]>;
	/** DesignToken rows grouped by category (as getProjectTokens returns). */
	tokens: Record<string, ComposeTokenRow[]>;
};

export type ComposeResult = {
	/** The full HTML document ("<!doctype html>" … "</html>"). */
	html: string;
	/** Collected validation problems; the page still renders as far as possible. */
	errors: string[];
};

/** The one token category that is loading metadata, not a CSS value. */
export const FONT_CATEGORY = "font";

// ---------------------------------------------------------------------------
// URL + naming conventions (exported — KUK-921/923 build on these)
// ---------------------------------------------------------------------------

/**
 * The bundle URL convention for a pinned component version — KUK-923 serves
 * exactly this path (and writes R2 keys of the same shape). Never hardcode
 * the shape elsewhere.
 */
export function componentBundlePath(
	projectId: string,
	componentId: string,
	version: number,
): string {
	return `/projects/${projectId}/components/${componentId}/v${version}.js`;
}

/**
 * The CSS custom-property naming convention for design tokens: uniform
 * `--tb-<category>-<role>`. Dark-mode color roles carry the stored
 * `dark-<role>` form, rendering as `--tb-color-dark-<role>`. Components
 * reference tokens as var(--tb-color-primary), var(--tb-spacing-md), …
 */
export function tokenCssVariable(category: string, role: string): string {
	return `--tb-${category}-${role}`;
}

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

/** Deterministic (code-unit) string comparator — never localeCompare. */
function compareStrings(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

/** HTML-escapes a value going into a double-quoted attribute. */
function escapeHtmlAttr(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

/** HTML-escapes text content (element inner text like <title>). */
function escapeHtmlText(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

type Parsed<T> = { ok: true; value: T } | { ok: false };

/**
 * Parses a stored JSON string into a plain object. Blank/null is treated as
 * an empty object (the column is optional); anything else that is not a JSON
 * object is malformed.
 */
function parseJsonObject(
	raw: string | null | undefined,
): Parsed<Record<string, unknown>> {
	if (raw === null || raw === undefined || raw.trim() === "") {
		return { ok: true, value: {} };
	}
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return { ok: false };
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return { ok: false };
	}
	return { ok: true, value: value as Record<string, unknown> };
}

/**
 * Parses a ComponentVersion's apiSchema JSON into its declared attribute
 * names. `attributes` is {name: {type, description}, …}; a schema without an
 * `attributes` key (slots/events only, or no contract) returns null, meaning
 * "the schema does not constrain attributes" — prop validation is skipped
 * rather than rejecting every prop. An `attributes` key that is not a plain
 * object is malformed.
 */
function parseApiSchemaAttributes(
	raw: string | null | undefined,
): Parsed<Set<string> | null> {
	if (raw === null || raw === undefined || raw.trim() === "") {
		return { ok: true, value: null };
	}
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return { ok: false };
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return { ok: false };
	}
	const attributes = (value as Record<string, unknown>).attributes;
	if (attributes === undefined) return { ok: true, value: null };
	if (
		typeof attributes !== "object" ||
		attributes === null ||
		Array.isArray(attributes)
	) {
		return { ok: false };
	}
	return {
		ok: true,
		value: new Set(Object.keys(attributes as Record<string, unknown>)),
	};
}

/** A validated font-token value (loading metadata). The family is the token's role. */
type ParsedFont = {
	source: string;
	url: string | null;
	weights: string | null;
	italic: boolean;
};

function parseFontValue(value: unknown): ParsedFont | null {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return null;
	const v = value as Record<string, unknown>;
	if (typeof v.source !== "string") return null;
	return {
		source: v.source,
		url: typeof v.url === "string" ? v.url : null,
		weights: typeof v.weights === "string" ? v.weights : null,
		italic: v.italic === true,
	};
}

// ---------------------------------------------------------------------------
// Token CSS + font links
// ---------------------------------------------------------------------------

/**
 * Renders the design tokens as a `:root { … }` CSS block of `--tb-…`
 * custom properties (naming: tokenCssVariable). Categories and roles are
 * sorted; the "font" category is excluded (loading metadata, rendered as
 * <link> tags by renderFontLinks). Returns "" when no CSS-variable tokens
 * exist (the caller then omits the <style> tag entirely).
 */
export function renderTokenCss(
	tokens: Record<string, ComposeTokenRow[]>,
): string {
	const lines: string[] = [];
	for (const category of Object.keys(tokens).sort(compareStrings)) {
		if (category === FONT_CATEGORY) continue;
		const rows = tokens[category];
		if (!Array.isArray(rows)) continue;
		for (const row of [...rows].sort((a, b) =>
			compareStrings(a.role, b.role),
		)) {
			// `<` becomes the CSS escape \3c  (the trailing space terminates the
			// escape): a value containing `</style>` would otherwise close the
			// style element and inject markup into the document head.
			lines.push(
				`\t${tokenCssVariable(category, row.role)}: ${row.value.replaceAll("<", "\\3c ")};`,
			);
		}
	}
	if (lines.length === 0) return "";
	return `:root {\n${lines.join("\n")}\n}`;
}

/**
 * The css2 stylesheet href for one "google" font token (family = token role).
 * Weight semantics: stored weights (e.g. "400;700" or "100..900") load as
 * :wght@…; an italic font loads BOTH the upright and italic faces of each
 * weight as :ital,wght@0,<w>;1,<w> tuples (typography stacks use upright
 * too), defaulting to weight 400 when none are stored. `&display=swap` is
 * always appended.
 */
function googleFontsHref(family: string, font: ParsedFont): string {
	const encoded = encodeURIComponent(family).replaceAll("%20", "+");
	const weights = (font.weights ?? "")
		.split(";")
		.map((weight) => weight.trim())
		.filter((weight) => weight !== "");
	let axis = "";
	if (font.italic) {
		const effective = weights.length > 0 ? weights : ["400"];
		const tuples: string[] = [];
		for (const weight of effective) {
			tuples.push(`0,${weight}`, `1,${weight}`);
		}
		axis = `:ital,wght@${tuples.join(";")}`;
	} else if (weights.length > 0) {
		axis = `:wght@${weights.join(";")}`;
	}
	return `https://fonts.googleapis.com/css2?family=${encoded}${axis}&display=swap`;
}

/**
 * One font token row → its <link rel="stylesheet"> href, or null when the
 * token contributes no link ("system", or a problem reported into `errors`).
 */
function fontLinkHref(
	font: ParsedFont,
	role: string,
	errors: string[],
): string | null {
	switch (font.source) {
		case "system":
			return null;
		case "google":
			return googleFontsHref(role, font);
		case "url":
			if (font.url === null || font.url.trim() === "") {
				errors.push(`font token "${role}": source "url" has no url; skipped`);
				return null;
			}
			// Percent-encode the characters that could break out of the href
			// attribute or start a tag (`"`, `<`, `>`): the upstream validation
			// only enforces the https scheme, not these.
			return font.url
				.replace(/"/g, "%22")
				.replace(/</g, "%3C")
				.replace(/>/g, "%3E");
		default:
			errors.push(
				`font token "${role}": unknown font source "${font.source}"; skipped`,
			);
			return null;
	}
}

/**
 * Font-token rows → stylesheet <link> hrefs (sorted by family/role, deduped,
 * deterministic). Malformed JSON values, malformed loading info, and unknown
 * sources are reported into `errors` and skipped. Source "system" silently
 * contributes nothing.
 */
export function renderFontLinks(
	rows: ComposeTokenRow[],
	errors: string[],
): string[] {
	const links: string[] = [];
	const seen = new Set<string>();
	for (const row of [...rows].sort((a, b) => compareStrings(a.role, b.role))) {
		let value: unknown;
		try {
			value = JSON.parse(row.value);
		} catch {
			errors.push(`font token "${row.role}": malformed JSON value; skipped`);
			continue;
		}
		const font = parseFontValue(value);
		if (!font) {
			errors.push(
				`font token "${row.role}": malformed font loading info; skipped`,
			);
			continue;
		}
		const href = fontLinkHref(font, row.role, errors);
		if (href === null || seen.has(href)) continue;
		seen.add(href);
		links.push(href);
	}
	return links;
}

// ---------------------------------------------------------------------------
// Prop validation
// ---------------------------------------------------------------------------

/**
 * Validates merged default+override prop entries against the apiSchema's
 * attribute names and keeps string values only. `schemaAttrs === null` means
 * the schema does not constrain attributes — every string prop is accepted.
 * Unknown keys and non-string values are reported and skipped (the element
 * still renders with the remaining props). Keys are processed sorted so both
 * the output attribute order and the error order are deterministic.
 */
function validateProps(
	merged: Record<string, unknown>,
	schemaAttrs: Set<string> | null,
	label: string,
	tagName: string,
	errors: string[],
): Record<string, string> {
	const props: Record<string, string> = {};
	for (const key of Object.keys(merged).sort(compareStrings)) {
		if (schemaAttrs !== null && !schemaAttrs.has(key)) {
			errors.push(
				`${label}: unknown attribute "${key}" for component "${tagName}"; skipped`,
			);
			continue;
		}
		const value = merged[key];
		if (typeof value !== "string") {
			errors.push(
				`${label}: attribute "${key}" must be a string (apiSchema attributes are strings); skipped`,
			);
			continue;
		}
		props[key] = value;
	}
	return props;
}

// ---------------------------------------------------------------------------
// Data bindings
// ---------------------------------------------------------------------------

/** One validated dataBindings entry: { collection, limit?, filter? }. */
type DataBinding = {
	collection: string;
	limit: number | null;
	filter: Record<string, string | number | boolean> | null;
};

/** Validates one raw dataBindings entry; null when malformed. */
function parseDataBinding(raw: unknown): DataBinding | null {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw))
		return null;
	const v = raw as Record<string, unknown>;
	if (typeof v.collection !== "string" || v.collection === "") return null;
	let limit: number | null = null;
	if (v.limit !== undefined) {
		if (
			typeof v.limit !== "number" ||
			!Number.isInteger(v.limit) ||
			v.limit < 0
		) {
			return null;
		}
		limit = v.limit;
	}
	let filter: Record<string, string | number | boolean> | null = null;
	if (v.filter !== undefined) {
		if (
			typeof v.filter !== "object" ||
			v.filter === null ||
			Array.isArray(v.filter)
		) {
			return null;
		}
		filter = {};
		for (const [key, value] of Object.entries(
			v.filter as Record<string, unknown>,
		)) {
			if (
				typeof value !== "string" &&
				typeof value !== "number" &&
				typeof value !== "boolean"
			) {
				return null;
			}
			filter[key] = value;
		}
	}
	return { collection: v.collection, limit, filter };
}

/**
 * Resolves one binding's records: pre-loaded DataRecord rows in ordinal
 * order, each `data` JSON parsed (malformed records are reported and
 * skipped), then the {key: value} equality filter (strict === on primitives;
 * objects/arrays never match), then the optional limit. Returns null when
 * the collection is unknown (already reported) — the caller skips the
 * binding but keeps the element.
 */
function resolveBindingRecords(
	binding: DataBinding,
	ctx: ComposeContext,
	label: string,
): unknown[] | null {
	const rows = ctx.collectionRecords[binding.collection];
	if (!Array.isArray(rows)) {
		ctx.errors.push(
			`${label}: unknown collection "${binding.collection}"; binding skipped`,
		);
		return null;
	}
	const records: unknown[] = [];
	for (const row of [...rows].sort((a, b) => a.ordinal - b.ordinal)) {
		let data: unknown;
		try {
			data = JSON.parse(row.data);
		} catch {
			ctx.errors.push(
				`${label}: record at ordinal ${row.ordinal} has malformed JSON; skipped`,
			);
			continue;
		}
		if (binding.filter !== null) {
			let matches = true;
			if (typeof data === "object" && data !== null && !Array.isArray(data)) {
				for (const [key, value] of Object.entries(binding.filter)) {
					if ((data as Record<string, unknown>)[key] !== value) {
						matches = false;
						break;
					}
				}
			} else {
				matches = false;
			}
			if (!matches) continue;
		}
		records.push(data);
	}
	if (binding.limit !== null) {
		return records.slice(0, binding.limit);
	}
	return records;
}

// ---------------------------------------------------------------------------
// Block rendering
// ---------------------------------------------------------------------------

type ComposeContext = {
	projectId: string;
	versions: Record<string, ComposeVersionRow>;
	templateSlots: Record<string, ComposeSlotRow[]>;
	collectionRecords: Record<string, ComposeRecordRow[]>;
	errors: string[];
	/** Bundle paths of every published pinned version used on the page. */
	bundles: Set<string>;
};

function attr(name: string, value: string): string {
	return `${name}="${escapeHtmlAttr(value)}"`;
}

/**
 * One custom element: `<tb-tag data-block-id="…" attr="value" …>` with
 * attributes sorted (data-block-id first, then props alphabetically —
 * deterministic output). Data-binding script children (pre-rendered) are
 * indented one tab inside the element.
 */
function renderComponentElement(options: {
	tagName: string;
	blockId: string | null;
	props: Record<string, string>;
	dataChildren: string[];
}): string {
	const attrs: string[] = [];
	if (options.blockId !== null) {
		attrs.push(attr("data-block-id", options.blockId));
	}
	for (const name of Object.keys(options.props).sort(compareStrings)) {
		attrs.push(attr(name, options.props[name]));
	}
	const open = `<${options.tagName}${attrs.map((a) => ` ${a}`).join("")}>`;
	if (options.dataChildren.length === 0) {
		return `${open}</${options.tagName}>`;
	}
	return `${open}\n${options.dataChildren.map((child) => `\t${child}`).join("\n")}\n</${options.tagName}>`;
}

/**
 * Resolves a component block's dataBindings into rendered
 * <script type="application/json"> children (binding props sorted). The
 * dataBindings JSON itself must be a valid object — the caller treats a
 * malformed value as block-fatal.
 */
function resolveDataBindings(
	raw: Record<string, unknown>,
	ctx: ComposeContext,
	label: string,
): string[] {
	const children: string[] = [];
	for (const prop of Object.keys(raw).sort(compareStrings)) {
		const binding = parseDataBinding(raw[prop]);
		if (!binding) {
			ctx.errors.push(`${label}: data binding "${prop}" is malformed; skipped`);
			continue;
		}
		const records = resolveBindingRecords(
			binding,
			ctx,
			`${label} (data binding "${prop}")`,
		);
		if (records === null) continue;
		// `<` is escaped as \u003c (a valid JSON escape that decodes to the
		// same string): a literal `</script>` inside a record body would
		// otherwise close the element and inject the rest as page markup.
		children.push(
			`<script type="application/json" slot="data" data-collection="${escapeHtmlAttr(binding.collection)}">${JSON.stringify({ [prop]: records }).replaceAll("<", "\\u003c")}</script>`,
		);
	}
	return children;
}

/**
 * Loads and validates a pinned version for a block or template slot.
 * Returns null (with the error reported) when the pin is missing or not
 * published, or when the version's apiSchema/defaults JSON is malformed —
 * the caller skips the block/slot.
 */
type PinnedVersion = {
	version: ComposeVersionRow;
	schemaAttrs: Set<string> | null;
	defaults: Record<string, unknown>;
};

function loadPinnedVersion(
	versionId: string,
	label: string,
	ctx: ComposeContext,
): PinnedVersion | null {
	const version = ctx.versions[versionId];
	if (!version) {
		ctx.errors.push(
			`${label}: pinned component version "${versionId}" not found`,
		);
		return null;
	}
	if (version.status !== "published") {
		ctx.errors.push(
			`${label}: component "${version.tagName}" version ${version.version} is "${version.status}", not published; block skipped`,
		);
		return null;
	}
	const schemaAttrs = parseApiSchemaAttributes(version.apiSchema);
	if (!schemaAttrs.ok) {
		ctx.errors.push(
			`${label}: component "${version.tagName}" version ${version.version} has malformed apiSchema JSON; block skipped`,
		);
		return null;
	}
	const defaults = parseJsonObject(version.defaults);
	if (!defaults.ok) {
		ctx.errors.push(
			`${label}: component "${version.tagName}" version ${version.version} has malformed defaults JSON; block skipped`,
		);
		return null;
	}
	return {
		version,
		schemaAttrs: schemaAttrs.value,
		defaults: defaults.value,
	};
}

/** Renders one page block; null = skip (an error was already reported). */
function renderBlock(
	block: ComposeBlockRow,
	ctx: ComposeContext,
): string | null {
	// Exactly one source per block is the handler-enforced contract; be
	// tolerant here — report the conflict and use the priority below.
	const sources = [
		block.componentVersionId ? "componentVersionId" : null,
		block.templateId ? "templateId" : null,
		block.sourceHtml !== null && block.sourceHtml !== undefined
			? "sourceHtml"
			: null,
	].filter((source): source is string => source !== null);
	if (sources.length === 0) {
		ctx.errors.push(
			`block "${block.id}": no source set (exactly one of componentVersionId/templateId/sourceHtml is required); block skipped`,
		);
		return null;
	}
	if (sources.length > 1) {
		ctx.errors.push(
			`block "${block.id}": multiple sources set (${sources.join(", ")}); using ${sources[0]}`,
		);
	}

	const source = sources[0];
	if (source === "sourceHtml") {
		// One-off HTML escape hatch: emitted verbatim inside a stamped DIV
		// (wrapping needs no parser and supports multi-root snippets).
		return `<div data-block-id="${escapeHtmlAttr(block.id)}">\n${(block.sourceHtml ?? "").trim()}\n</div>`;
	}
	if (source === "templateId") {
		return renderTemplateBlock(block, block.templateId ?? "", ctx);
	}
	return renderComponentBlock(block, block.componentVersionId ?? "", ctx);
}

function renderComponentBlock(
	block: ComposeBlockRow,
	versionId: string,
	ctx: ComposeContext,
): string | null {
	const label = `block "${block.id}"`;
	const pinned = loadPinnedVersion(versionId, label, ctx);
	if (!pinned) return null;
	const overrides = parseJsonObject(block.propsOverrides);
	if (!overrides.ok) {
		ctx.errors.push(`${label}: malformed propsOverrides JSON; block skipped`);
		return null;
	}
	const bindings = parseJsonObject(block.dataBindings);
	if (!bindings.ok) {
		ctx.errors.push(`${label}: malformed dataBindings JSON; block skipped`);
		return null;
	}
	// Overrides win over the version defaults (merged before validation, so a
	// non-string override also drops the default it replaces).
	const props = validateProps(
		{ ...pinned.defaults, ...overrides.value },
		pinned.schemaAttrs,
		label,
		pinned.version.tagName,
		ctx.errors,
	);
	const dataChildren = resolveDataBindings(bindings.value, ctx, label);
	ctx.bundles.add(
		componentBundlePath(
			ctx.projectId,
			pinned.version.componentId,
			pinned.version.version,
		),
	);
	return renderComponentElement({
		tagName: pinned.version.tagName,
		blockId: block.id,
		props,
		dataChildren,
	});
}

function renderTemplateBlock(
	block: ComposeBlockRow,
	templateId: string,
	ctx: ComposeContext,
): string | null {
	const slots = ctx.templateSlots[templateId];
	if (!Array.isArray(slots)) {
		ctx.errors.push(
			`block "${block.id}": template "${templateId}" not found; block skipped`,
		);
		return null;
	}
	const blockOverrides = parseJsonObject(block.propsOverrides);
	if (!blockOverrides.ok) {
		ctx.errors.push(
			`block "${block.id}": malformed propsOverrides JSON; block skipped`,
		);
		return null;
	}
	// v1: data bindings target a single element, a template expands to many —
	// report and ignore (never fatal).
	if (
		block.dataBindings !== null &&
		block.dataBindings !== undefined &&
		block.dataBindings.trim() !== ""
	) {
		ctx.errors.push(
			`block "${block.id}": data bindings on template blocks are not supported; ignored`,
		);
	}
	const sorted = [...slots].sort((a, b) => a.ordinal - b.ordinal);
	if (sorted.length === 0) {
		ctx.errors.push(
			`block "${block.id}": template "${templateId}" has no slots; nothing rendered`,
		);
		return null;
	}
	const parts: string[] = [];
	for (const slot of sorted) {
		const label = `block "${block.id}" (template "${templateId}" slot ${slot.ordinal})`;
		if (!slot.componentVersionId) {
			ctx.errors.push(`${label}: no pinned component version; slot skipped`);
			continue;
		}
		const pinned = loadPinnedVersion(slot.componentVersionId, label, ctx);
		if (!pinned) continue;
		const slotOverrides = parseJsonObject(slot.propsOverrides);
		if (!slotOverrides.ok) {
			ctx.errors.push(`${label}: malformed propsOverrides JSON; slot skipped`);
			continue;
		}
		// Block-level overrides win over the slot's own overrides.
		const props = validateProps(
			{ ...pinned.defaults, ...slotOverrides.value, ...blockOverrides.value },
			pinned.schemaAttrs,
			label,
			pinned.version.tagName,
			ctx.errors,
		);
		ctx.bundles.add(
			componentBundlePath(
				ctx.projectId,
				pinned.version.componentId,
				pinned.version.version,
			),
		);
		parts.push(
			renderComponentElement({
				tagName: pinned.version.tagName,
				blockId: null,
				props,
				dataChildren: [],
			}),
		);
	}
	if (parts.length === 0) return null;
	return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Pure resolver
// ---------------------------------------------------------------------------

/**
 * The pure Page → HTML resolver. Deterministic: blocks in ordinal order,
 * tokens sorted by category/role, font links sorted and deduped, bundle
 * imports sorted by path, props/binding props sorted — two calls with the
 * same input return byte-identical output. Never throws; every validation
 * problem is collected into `errors` (block-fatal ones skip the block).
 */
export function composePage(input: ComposeInput): ComposeResult {
	const errors: string[] = [];
	const tokens = input.tokens ?? {};

	const fontLinks = renderFontLinks(tokens[FONT_CATEGORY] ?? [], errors);
	const tokenCss = renderTokenCss(tokens);

	const ctx: ComposeContext = {
		projectId: input.projectId,
		versions: input.componentVersions ?? {},
		templateSlots: input.templateSlots ?? {},
		collectionRecords: input.collectionRecords ?? {},
		errors,
		bundles: new Set<string>(),
	};

	const body: string[] = [];
	const blocks = [...(input.page.blocks ?? [])].sort(
		(a, b) => a.ordinal - b.ordinal,
	);
	for (const block of blocks) {
		const html = renderBlock(block, ctx);
		if (html !== null) body.push(html);
	}

	const head: string[] = [`<title>${escapeHtmlText(input.page.title)}</title>`];
	// Preconnects only when a Google Fonts link is actually present, before
	// every stylesheet link.
	if (
		fontLinks.some((href) => href.startsWith("https://fonts.googleapis.com/"))
	) {
		head.push('<link rel="preconnect" href="https://fonts.googleapis.com">');
		head.push(
			'<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
		);
	}
	// Font hrefs are NOT attribute-escaped: google-constructed hrefs are
	// byte-stable for KUK-923 matching and reverse parsing (only
	// [A-Za-z0-9+.;,@=&] after encodeURIComponent); url-source hrefs are
	// percent-encoded for `"`, `<` at the source (see fontHref above) — a raw
	// `&` in an attribute value is valid HTML.
	head.push(
		...fontLinks.map((href) => `<link rel="stylesheet" href="${href}">`),
	);
	if (tokenCss !== "") {
		head.push(`<style>\n${tokenCss}\n</style>`);
	}
	const imports = [...ctx.bundles].sort(compareStrings);
	if (imports.length > 0) {
		head.push(
			`<script type="module">\n${imports.map((path) => `import "${path}";`).join("\n")}\n</script>`,
		);
	}

	const html = [
		"<!doctype html>",
		"<html>",
		"<head>",
		...head,
		"</head>",
		"<body>",
		...body,
		"</body>",
		"</html>",
	].join("\n");
	return { html, errors };
}

// ---------------------------------------------------------------------------
// Prisma loaders (thin: fetch rows, delegate to the pure resolver)
// ---------------------------------------------------------------------------

type PrismaDb = ReturnType<typeof import("@/lib/db")["getPrisma"]>;

/** The page row shape the loaders pass on (Prisma rows satisfy this). */
type PageWithBlocks = {
	id: string;
	projectId: string;
	path: string;
	title: string;
	blocks: ComposeBlockRow[];
};

/** Fetches everything composePage needs for an already-loaded page row. */
async function composeFromPageRow(
	prisma: PrismaDb,
	page: PageWithBlocks,
): Promise<ComposeResult> {
	const templateIds = [
		...new Set(
			page.blocks
				.map((block) => block.templateId)
				.filter((id): id is string => id !== null && id !== undefined),
		),
	];
	const slots =
		templateIds.length > 0
			? await prisma.templateSlot.findMany({
					where: { templateId: { in: templateIds } },
					orderBy: { ordinal: "asc" },
				})
			: [];
	const versionIds = [
		...new Set(
			[
				...page.blocks.map((block) => block.componentVersionId),
				...slots.map((slot) => slot.componentVersionId),
			].filter((id): id is string => id !== null && id !== undefined),
		),
	];
	const versionRows =
		versionIds.length > 0
			? await prisma.componentVersion.findMany({
					where: { id: { in: versionIds } },
					select: {
						id: true,
						componentId: true,
						version: true,
						status: true,
						apiSchema: true,
						defaults: true,
						component: { select: { tagName: true } },
					},
				})
			: [];
	const componentVersions: Record<string, ComposeVersionRow> = {};
	for (const row of versionRows) {
		componentVersions[row.id] = {
			id: row.id,
			componentId: row.componentId,
			version: row.version,
			status: row.status,
			tagName: row.component.tagName,
			apiSchema: row.apiSchema,
			defaults: row.defaults,
		};
	}
	const templateSlots: Record<string, ComposeSlotRow[]> = {};
	for (const slot of slots) {
		const bucket = templateSlots[slot.templateId];
		const entry: ComposeSlotRow = {
			templateId: slot.templateId,
			ordinal: slot.ordinal,
			componentVersionId: slot.componentVersionId,
			propsOverrides: slot.propsOverrides,
		};
		if (bucket) {
			bucket.push(entry);
		} else {
			templateSlots[slot.templateId] = [entry];
		}
	}
	// Only collections referenced by the page's data bindings are loaded —
	// per-page publish cost must not scale with the project's total dummy
	// data. Bindings whose JSON is unparsable contribute no names (their
	// blocks are reported as malformed by the resolver, which never reads
	// their records).
	const referencedNames = new Set<string>();
	for (const block of page.blocks) {
		if (!block.dataBindings) continue;
		try {
			const raw = JSON.parse(block.dataBindings) as Record<string, unknown>;
			for (const value of Object.values(raw)) {
				if (
					value &&
					typeof value === "object" &&
					typeof (value as { collection?: unknown }).collection === "string"
				) {
					referencedNames.add((value as { collection: string }).collection);
				}
			}
		} catch {
			// Resolver reports the malformed block; nothing to reference.
		}
	}
	const collections =
		referencedNames.size === 0
			? []
			: await prisma.dataCollection.findMany({
					where: {
						projectId: page.projectId,
						name: { in: [...referencedNames] },
					},
					orderBy: { name: "asc" },
					include: { records: { orderBy: { ordinal: "asc" } } },
				});
	const collectionRecords: Record<string, ComposeRecordRow[]> = {};
	for (const collection of collections) {
		collectionRecords[collection.name] = collection.records.map((record) => ({
			ordinal: record.ordinal,
			data: record.data,
		}));
	}
	const tokens = await getProjectTokens(prisma, page.projectId);
	return composePage({
		projectId: page.projectId,
		page: { path: page.path, title: page.title, blocks: page.blocks },
		componentVersions,
		templateSlots,
		collectionRecords,
		tokens,
	});
}

/**
 * Loads the page, its blocks, every pinned component version (+ tagName),
 * template slots, the project's data collections with their records, and the
 * project's design tokens — then composes. Throws only when the page row is
 * missing.
 */
export async function loadComposeInputs(
	prisma: PrismaDb,
	pageId: string,
): Promise<ComposeResult> {
	const page = await prisma.page.findUnique({
		where: { id: pageId },
		include: { blocks: { orderBy: { ordinal: "asc" } } },
	});
	if (!page) throw new Error(`compose: page "${pageId}" not found`);
	return composeFromPageRow(prisma, page);
}

/** Same as loadComposeInputs, addressing the page by (projectId, path). */
export async function loadComposePageByPath(
	prisma: PrismaDb,
	projectId: string,
	path: string,
): Promise<ComposeResult> {
	const page = await prisma.page.findUnique({
		where: { projectId_path: { projectId, path } },
		include: { blocks: { orderBy: { ordinal: "asc" } } },
	});
	if (!page)
		throw new Error(
			`compose: page "${path}" not found in project "${projectId}"`,
		);
	return composeFromPageRow(prisma, page);
}
