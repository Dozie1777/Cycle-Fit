/**
 * Pure validation gate for component drafts (KUK-919). Takes plain data — no
 * Prisma/R2/env — so the later `save_component` tool (KUK-921+) can run every
 * agent-authored draft through it before persisting a ComponentVersion.
 *
 * Errors are written to be self-correcting: each message tells the model what
 * broke and what the convention expects instead.
 */

/** tag names reserved by the platform; agent components must not use them. */
export const RESERVED_TB_TAG_NAMES: readonly string[] = ["tb-font", "tb-data"];

export type ComponentDraftInput = {
	/** Custom-element tag name, must be a valid "tb-…" name. */
	tagName: string;
	/** Custom-element class source: one class extends HTMLElement + one customElements.define. */
	js: string;
	/** Template markup (optional; the skeleton renders its own default content). */
	html?: string | null;
	/** "light" (default) | "open". "closed" is rejected — it breaks the editor inspector. */
	shadowMode?: string | null;
	/** JSON contract string (or pre-parsed object): { attributes, slots, events }. */
	apiSchema?: string | Record<string, unknown> | null;
	/** JSON string (or pre-parsed object) of default attribute values. */
	defaults?: string | Record<string, unknown> | null;
};

export type ComponentValidationResult =
	| {
			ok: true;
	  }
	| {
			ok: false;
			errors: string[];
	  };

/**
 * Validates a component draft before it becomes a ComponentVersion row.
 * Pure: no DB/env access — tag/name collision checks belong to the
 * `save_component` tool (KUK-924), which calls this first and surfaces
 * `errors` verbatim to the model so it can self-correct. The canonical
 * reference for every convention enforced here is `TB_COMPONENT_SKELETON`.
 */
export function validateComponentDraft(
	input: ComponentDraftInput,
): ComponentValidationResult {
	const errors: string[] = [];

	validateTagName(input.tagName, errors);
	validateJs(input.tagName, input.js, errors);
	if (typeof input.html === "string" && input.html.trim().length > 0) {
		validateHtml(input.html, errors);
	}
	validateShadowMode(input.shadowMode, errors);

	let attributes: Record<string, unknown> | null = null;
	const apiSchema = input.apiSchema;
	if (
		apiSchema != null &&
		(typeof apiSchema !== "string" || apiSchema.trim().length > 0)
	) {
		const parsed = parseJsonField("apiSchema", apiSchema);
		if (parsed.ok) {
			validateApiSchema(parsed.value, errors);
			attributes = extractAttributes(parsed.value);
		} else {
			errors.push(parsed.error);
		}
	}

	const defaults = input.defaults;
	if (
		defaults != null &&
		(typeof defaults !== "string" || defaults.trim().length > 0)
	) {
		const parsed = parseJsonField("defaults", defaults);
		if (parsed.ok) {
			validateDefaults(parsed.value, attributes, errors);
		} else {
			errors.push(parsed.error);
		}
	}

	if (errors.length === 0) {
		return { ok: true };
	}
	return { ok: false, errors };
}

function parseJsonField(
	fieldName: string,
	value: string | Record<string, unknown>,
): { ok: true; value: unknown } | { ok: false; error: string } {
	if (typeof value !== "string") {
		return { ok: true, value };
	}
	try {
		return { ok: true, value: JSON.parse(value) };
	} catch (error) {
		const detail = error instanceof Error ? error.message : "parse error";
		return {
			ok: false,
			error: `${fieldName} must be valid JSON (${detail}).`,
		};
	}
}

function validateTagName(tagName: string, errors: string[]): void {
	if (typeof tagName !== "string" || tagName.trim().length === 0) {
		errors.push(
			'tagName is required — a "tb-…" custom element name (e.g. "tb-pricing-card").',
		);
		return;
	}
	if (tagName !== tagName.toLowerCase()) {
		errors.push(
			`tagName "${tagName}" must be all lowercase (e.g. "tb-pricing-card").`,
		);
	}
	if (!tagName.startsWith("tb-")) {
		errors.push(
			`tagName "${tagName}" must start with the "tb-" prefix (e.g. "tb-pricing-card").`,
		);
	} else if (tagName === "tb-") {
		errors.push(
			'tagName must include a name after the "tb-" prefix (e.g. "tb-pricing-card").',
		);
	}
	if (tagName.length > 64) {
		errors.push(
			`tagName "${tagName}" is too long (${tagName.length} characters) — keep it at 64 or fewer.`,
		);
	}
	if (!/^[a-z][a-z0-9._-]*$/.test(tagName)) {
		errors.push(
			`tagName "${tagName}" contains invalid characters — use lowercase letters, digits, "-", ".", "_" (e.g. "tb-pricing-card").`,
		);
	}
	if (RESERVED_TB_TAG_NAMES.includes(tagName)) {
		errors.push(
			`tagName "${tagName}" is reserved by the platform — choose another "tb-…" name.`,
		);
	}
}

function validateJs(tagName: string, js: string, errors: string[]): void {
	if (typeof js !== "string" || js.trim().length === 0) {
		errors.push(
			"js is required — the custom element class source (see TB_COMPONENT_SKELETON in src/lib/component-skeleton.ts).",
		);
		return;
	}
	if (!/\bclass\s+[A-Za-z_$][\w$]*\s+extends\s+HTMLElement\b/.test(js)) {
		errors.push(
			'js must define a custom element class: "class … extends HTMLElement { … }".',
		);
	}
	const defineCount = js.match(/\bcustomElements\.define\s*\(/g)?.length ?? 0;
	if (defineCount === 0) {
		errors.push(
			`js must register the element exactly once: customElements.define("${tagName}", ClassName).`,
		);
	} else if (defineCount > 1) {
		errors.push(
			`js must call customElements.define exactly once (found ${defineCount} calls).`,
		);
	} else {
		const registered = extractDefinedTagName(js);
		if (registered === null) {
			errors.push(
				`js must pass the tag name as a literal string to customElements.define, exactly equal to the component's tagName "${tagName}".`,
			);
		} else if (registered !== tagName) {
			errors.push(
				`js registers "${registered}" but the component's tagName is "${tagName}" — they must match exactly.`,
			);
		}
	}
	if (/\bdocument\.write\s*\(/.test(js)) {
		errors.push(
			"js must not use document.write — it breaks hydration; render into `this` instead.",
		);
	}
	if (/\beval\s*\(/.test(js)) {
		errors.push(
			"js must not use eval — it is blocked by CSP; parse structured data with JSON.parse.",
		);
	}
	if (/\bnew\s+Function\s*\(/.test(js)) {
		errors.push(
			"js must not use new Function — it is blocked by CSP; compute values with plain code.",
		);
	}

	// data-ssr hydration convention: connectedCallback must check for the
	// server-rendered marker before any re-render. Heuristic: within the
	// connectedCallback body window, a data-ssr guard must appear before any
	// innerHTML assignment (or there must be no unconditional assignment).
	const callbackIndex = js.search(/\bconnectedCallback\s*\(/);
	if (callbackIndex !== -1) {
		const body = js.slice(callbackIndex, callbackIndex + 2000);
		const guardIndex = body.indexOf("data-ssr");
		const renderIndex = body.search(/\binnerHTML\s*\+?=/);
		if (renderIndex !== -1 && (guardIndex === -1 || guardIndex > renderIndex)) {
			errors.push(
				'js must respect the data-ssr hydration convention: connectedCallback must check this.hasAttribute("data-ssr") and return early before any re-render, so server-rendered markup is not overwritten (see TB_COMPONENT_SKELETON in src/lib/component-skeleton.ts).',
			);
		}
	}
}

function extractDefinedTagName(js: string): string | null {
	const match = js.match(
		/\bcustomElements\.define\s*\(\s*(['"`])([^'"`\n]+)\1/,
	);
	return match?.[2] ?? null;
}

function validateHtml(html: string, errors: string[]): void {
	if (/\s+on[a-z]+\s*=\s*(['"])/i.test(html)) {
		errors.push(
			'html must not contain inline event handler attributes (onclick="…" and other on* attributes) — attach listeners in js with addEventListener.',
		);
	}
	// Executable scripts are blocked by CSP. The JSON data-child convention is
	// the one sanctioned exception: <script type="application/json" slot="data">.
	if (/<script(?![^>]*type=["']application\/json["'])[^>]*>/i.test(html)) {
		errors.push(
			'html must not contain <script> tags (blocked by CSP) — pass structured data through the JSON child convention: <script type="application/json" slot="data">…</script>.',
		);
	}
	const ids = new Map<string, number>();
	const idPattern = /\bid\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"'`]+))/g;
	for (const match of html.matchAll(idPattern)) {
		const id = match[1] ?? match[2] ?? match[3] ?? "";
		ids.set(id, (ids.get(id) ?? 0) + 1);
	}
	const duplicates = [...ids.entries()]
		.filter(([, count]) => count > 1)
		.map(([id]) => `"${id}"`);
	if (duplicates.length > 0) {
		errors.push(
			`html has duplicate id attributes: ${duplicates.join(", ")} — ids must be unique within the snippet.`,
		);
	}
}

function validateShadowMode(shadowMode: unknown, errors: string[]): void {
	if (shadowMode == null) {
		return; // defaults to "light"
	}
	if (shadowMode !== "light" && shadowMode !== "open") {
		errors.push(
			`shadowMode must be "light" or "open" (got "${String(shadowMode)}"). "closed" is rejected — it breaks the editor inspector.`,
		);
	}
}

function validateApiSchema(schema: unknown, errors: string[]): void {
	if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
		errors.push(
			"apiSchema must be a JSON object with optional keys: attributes, slots, events.",
		);
		return;
	}
	const keys = Object.keys(schema);
	const unknownKeys = keys.filter(
		(key) => key !== "attributes" && key !== "slots" && key !== "events",
	);
	if (unknownKeys.length > 0) {
		errors.push(
			`apiSchema has unknown top-level keys: ${unknownKeys.join(", ")} — allowed keys are: attributes, slots, events.`,
		);
	}
	if ("attributes" in schema) {
		const attributes = (schema as Record<string, unknown>).attributes;
		if (
			typeof attributes !== "object" ||
			attributes === null ||
			Array.isArray(attributes)
		) {
			errors.push(
				"apiSchema.attributes must be an object mapping attribute names to { type, description? }.",
			);
		} else {
			for (const [name, definition] of Object.entries(attributes)) {
				if (
					typeof definition !== "object" ||
					definition === null ||
					Array.isArray(definition)
				) {
					errors.push(
						`apiSchema.attributes.${name} must be an object with at least a string "type" (e.g. { "type": "string", "description": "…" }).`,
					);
					continue;
				}
				const def = definition as Record<string, unknown>;
				if (typeof def.type !== "string") {
					errors.push(
						`apiSchema.attributes.${name}.type must be a string (e.g. "string", "number", "boolean", "enum").`,
					);
				}
			}
		}
	}
	if ("slots" in schema) {
		const slots = (schema as Record<string, unknown>).slots;
		if (
			!Array.isArray(slots) ||
			slots.some((slot) => typeof slot !== "string")
		) {
			errors.push(
				'apiSchema.slots must be an array of slot name strings (e.g. ["icon", "actions"]).',
			);
		}
	}
	if ("events" in schema) {
		const events = (schema as Record<string, unknown>).events;
		if (
			!Array.isArray(events) ||
			events.some((event) => typeof event !== "string")
		) {
			errors.push(
				'apiSchema.events must be an array of event name strings (e.g. ["item-selected"]).',
			);
		}
	}
}

function extractAttributes(schema: unknown): Record<string, unknown> | null {
	if (typeof schema !== "object" || schema === null) {
		return null;
	}
	const attributes = (schema as Record<string, unknown>).attributes;
	if (
		typeof attributes !== "object" ||
		attributes === null ||
		Array.isArray(attributes)
	) {
		return null;
	}
	return attributes as Record<string, unknown>;
}

function validateDefaults(
	defaults: unknown,
	attributes: Record<string, unknown> | null,
	errors: string[],
): void {
	if (
		typeof defaults !== "object" ||
		defaults === null ||
		Array.isArray(defaults)
	) {
		errors.push(
			"defaults must be a JSON object mapping attribute names to string values.",
		);
		return;
	}
	if (attributes !== null) {
		for (const key of Object.keys(defaults)) {
			if (!(key in attributes)) {
				errors.push(
					`defaults key "${key}" is not declared in apiSchema.attributes — declare it there or remove the default.`,
				);
			}
		}
	}
	for (const [key, value] of Object.entries(defaults)) {
		if (typeof value !== "string") {
			errors.push(
				`defaults.${key} must be a string — attributes are strings per the contract; pass complex values through the JSON data child instead.`,
			);
		}
	}
}
