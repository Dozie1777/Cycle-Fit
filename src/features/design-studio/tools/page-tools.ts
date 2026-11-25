// Server-side operations behind the KUK-925 design-chat agent tools:
// composePageTool (compose_page), bindDataTool (bind_data),
// defineTemplateTool (define_template), defineFlowTool (define_flow) and
// listPagesTool (list_pages). Same split as component-tools.ts (KUK-924):
// the DB work lives here, the tool executes in design-chat.ts are thin
// wrappers, and unit tests stub prisma while workers tests hit real D1.
//
// Validation philosophy (mirrors compose.ts's tolerance rules, tightened to
// the tool boundary): every problem the composition engine would only report
// at render time (unknown component/collection/template, draft pin, unknown
// attribute, malformed binding) is rejected HERE with a model-correctable
// error, so a saved page composes cleanly and a publication never fails on
// a block the agent could have fixed. Writes happen only after all
// validation passes (validate-first, then replace-all).

// The KUK-928 composer reads share the library's version-status narrowing.
import {
	type ComponentVersionStatus,
	versionStatus,
} from "./component-library";
import type { ComponentToolFailure } from "./component-tools";

type PrismaDb = ReturnType<typeof import("@/lib/db")["getPrisma"]>;

/** Model-correctable failure returned as a value (never thrown). */
export type PageToolFailure = ComponentToolFailure;

function failure(status: number, errors: string[]): PageToolFailure {
	return { ok: false, errors, status };
}

const MAX_NAME_LENGTH = 80;
const MAX_PATH_LENGTH = 200;
const MAX_TITLE_LENGTH = 200;
const MAX_ACTION_LENGTH = 300;
const MAX_BLOCKS = 100;
const MAX_SLOTS = 50;
const MAX_STEPS = 50;

// ---------------------------------------------------------------------------
// Input shapes (the agent tool inputs in design-chat.ts validate with zod;
// these types describe what reaches the operations)
// ---------------------------------------------------------------------------

/** `{ name, version? }` — version omitted pins the published version. */
export type ComponentRefInput = {
	name: string;
	version?: number | null;
};

export type PropsOverridesInput = Record<string, unknown>;

/**
 * `{ "items": { "collection": "courses", "limit"?: 6, "filter"?: {…} } }` —
 * the prop key maps to the collection binding (compose.ts renders each as a
 * `<script type="application/json" slot="data">` child).
 */
export type DataBindingsInput = Record<string, unknown>;

/** One compose_page block: EXACTLY one of component/template/sourceHtml. */
export type PageBlockInput = {
	component?: ComponentRefInput | null;
	template?: string | null;
	sourceHtml?: string | null;
	propsOverrides?: PropsOverridesInput | null;
	dataBindings?: DataBindingsInput | null;
};

/** One define_template slot: a component pin + optional prop overrides. */
export type TemplateSlotInput = {
	component: ComponentRefInput;
	propsOverrides?: PropsOverridesInput | null;
};

/** One define_flow step: an existing page path + transition annotations. */
export type FlowStepInput = {
	path: string;
	entryAction?: string | null;
	exitTarget?: string | null;
};

// ---------------------------------------------------------------------------
// Shared validation helpers
// ---------------------------------------------------------------------------

/** A plain JSON object guard (arrays/null/primitives are rejected). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parameter types the raw D1 batch accepts (D1/SQLite column values). */
type BatchValue = string | number | null;

/**
 * Replace-all as ONE atomic D1 batch: the DELETE and every INSERT commit or
 * roll back together (D1 batches execute in a single transaction), so an
 * interrupted write can never leave the old rows gone and the new rows
 * half-inserted (same pattern as seedDataCollection's atomic replace). Ids
 * are generated per row and ordinals are deterministic from the input, so
 * the statement list needs no recompute on retry — a failure just rethrows.
 * `insertColumns`/rows must match in order and arity.
 */
async function atomicReplaceAll(
	db: D1Database,
	options: {
		table: string;
		/** WHERE column (and its value) of the delete, e.g. "pageId". */
		deleteColumn: string;
		deleteValue: string;
		/** Insert column list, quoted, e.g. '"id", "pageId", "ordinal"'. */
		insertColumns: string;
		/** Parameter arrays, one per INSERT row, matching insertColumns. */
		rows: BatchValue[][];
	},
): Promise<void> {
	const statements = [
		db
			.prepare(
				`DELETE FROM "${options.table}" WHERE "${options.deleteColumn}" = ?`,
			)
			.bind(options.deleteValue),
		...options.rows.map((row) =>
			db
				.prepare(
					`INSERT INTO "${options.table}" (${options.insertColumns}) VALUES (${row.map(() => "?").join(", ")})`,
				)
				.bind(...row),
		),
	];
	await db.batch(statements);
}

type ResolvedPin = {
	componentId: string;
	versionId: string;
	version: number;
	tagName: string;
	apiSchema: string | null;
};

/**
 * Resolves a component reference to an exact ComponentVersion pin (the
 * KUK-917 manual-re-pin model): an explicit version number pins that row
 * (published or retired — drafts are rejected with a clear error); an
 * omitted version pins the component's `publishedVersionId` (409-style
 * error when nothing is published yet). Soft-deleted components are not
 * addressable. Errors are pushed onto `errors` and null returned.
 */
async function resolveComponentPin(
	prisma: PrismaDb,
	projectId: string,
	ref: ComponentRefInput,
	label: string,
	errors: string[],
): Promise<ResolvedPin | null> {
	const name = typeof ref?.name === "string" ? ref.name.trim() : "";
	if (!name || name.length > MAX_NAME_LENGTH) {
		errors.push(
			`${label}: component name is required (${MAX_NAME_LENGTH} characters or fewer, e.g. "Hero").`,
		);
		return null;
	}
	const component = await prisma.component.findUnique({
		where: { projectId_name: { projectId, name } },
	});
	if (!component || component.deletedAt) {
		errors.push(
			`${label}: unknown component "${name}" — call list_components to see the project's library.`,
		);
		return null;
	}
	let versionRow: {
		id: string;
		version: number;
		status: string;
		apiSchema: string | null;
	} | null;
	if (ref.version != null) {
		if (!Number.isInteger(ref.version) || ref.version < 1) {
			errors.push(
				`${label}: version must be a positive integer (got ${JSON.stringify(ref.version)}).`,
			);
			return null;
		}
		versionRow = await prisma.componentVersion.findFirst({
			where: { componentId: component.id, version: ref.version },
		});
		if (!versionRow) {
			errors.push(
				`${label}: component "${name}" has no version ${ref.version}.`,
			);
			return null;
		}
		if (versionRow.status === "draft") {
			errors.push(
				`${label}: component "${name}" version ${ref.version} is a draft — pin a published version (publish_design publishes the drafts you authored this turn).`,
			);
			return null;
		}
		if (versionRow.status !== "published") {
			// Retired (or any non-renderable status): the composer renders only
			// "published" rows, so saving a pin to anything else would silently
			// omit the block's content from every publication. Point the model
			// at the currently published version instead.
			const published = component.publishedVersionId
				? await prisma.componentVersion.findUnique({
						where: { id: component.publishedVersionId },
						select: { version: true },
					})
				: null;
			errors.push(
				`${label}: component "${name}" version ${ref.version} is retired and cannot render${published ? ` — pin version ${published.version} (the currently published one) or omit version to use it` : " — publish the component first"}.`,
			);
			return null;
		}
	} else {
		if (!component.publishedVersionId) {
			errors.push(
				`${label}: component "${name}" has no published version — publish the component first.`,
			);
			return null;
		}
		versionRow = await prisma.componentVersion.findUnique({
			where: { id: component.publishedVersionId },
		});
		if (!versionRow) {
			errors.push(
				`${label}: component "${name}" published-version pointer is missing — publish the component again.`,
			);
			return null;
		}
	}
	return {
		componentId: component.id,
		versionId: versionRow.id,
		version: versionRow.version,
		tagName: component.tagName,
		apiSchema: versionRow.apiSchema,
	};
}

/**
 * Resolves an EXISTING PageBlock pin by its ComponentVersion id (the studio
 * block replacement's pass-through): the row must exist and its component
 * must belong to the project and still be live. Any status is accepted —
 * the pin was validated when it was written and the manual re-pin model
 * (KUK-917) says it stays put until explicitly re-pinned. Also returns the
 * component name so the composer can keep labeling the block.
 */
async function resolveExistingPin(
	prisma: PrismaDb,
	projectId: string,
	versionId: string,
	label: string,
	errors: string[],
): Promise<(ResolvedPin & { componentName: string }) | null> {
	const version = await prisma.componentVersion.findUnique({
		where: { id: versionId },
		select: {
			id: true,
			version: true,
			apiSchema: true,
			component: {
				select: {
					id: true,
					name: true,
					tagName: true,
					projectId: true,
					deletedAt: true,
				},
			},
		},
	});
	if (!version || version.component.projectId !== projectId) {
		errors.push(`${label}: unknown component version "${versionId}".`);
		return null;
	}
	if (version.component.deletedAt) {
		errors.push(
			`${label}: component "${version.component.name}" is deleted — remove the block instead.`,
		);
		return null;
	}
	return {
		componentId: version.component.id,
		versionId: version.id,
		version: version.version,
		tagName: version.component.tagName,
		apiSchema: version.apiSchema,
		componentName: version.component.name,
	};
}

/**
 * Parses a ComponentVersion's apiSchema JSON into its declared attribute
 * names. `attributes` is {name: {type, description}, …}; a schema without an
 * `attributes` key (slots/events only, or no contract) returns null attrs —
 * "the schema does not constrain attributes" (unknown KEYS are then
 * accepted, matching compose's tolerance). Malformed JSON is `ok: false`.
 */
type ApiSchemaAttrs = { ok: true; attrs: Set<string> | null } | { ok: false };

function parseApiSchemaAttrs(
	apiSchema: string | null | undefined,
): ApiSchemaAttrs {
	if (
		apiSchema === null ||
		apiSchema === undefined ||
		apiSchema.trim() === ""
	) {
		return { ok: true, attrs: null };
	}
	try {
		const parsed: unknown = JSON.parse(apiSchema);
		const attributes = isPlainObject(parsed)
			? (parsed as { attributes?: unknown }).attributes
			: undefined;
		if (attributes === undefined) return { ok: true, attrs: null };
		if (!isPlainObject(attributes)) return { ok: false };
		return { ok: true, attrs: new Set(Object.keys(attributes)) };
	} catch {
		return { ok: false };
	}
}

/**
 * Validates one (possibly merged) propsOverrides set against an apiSchema's
 * attribute names: unknown keys (only when the schema constrains) and
 * non-string values are errors — the same problems compose reports at
 * render time, rejected here instead so the block can never save into a
 * state the composer would only flag later.
 */
function checkOverridesAgainstAttrs(
	attrs: Set<string> | null,
	overrides: Record<string, unknown>,
	tagName: string,
	label: string,
	errors: string[],
): void {
	for (const key of Object.keys(overrides).sort()) {
		if (attrs !== null && !attrs.has(key)) {
			const known =
				attrs.size > 0 ? ` (known: ${[...attrs].sort().join(", ")})` : "";
			errors.push(
				`${label}: unknown attribute "${key}" for component "${tagName}"${known}.`,
			);
		} else if (typeof overrides[key] !== "string") {
			errors.push(
				`${label}: attribute "${key}" must be a string (apiSchema attributes are strings).`,
			);
		}
	}
}

/**
 * Validates propsOverrides against a pinned version's apiSchema attribute
 * names and serializes them for the JSON column. Unknown attributes and
 * non-string values are REJECTED (not silently dropped like the composer's
 * render-time tolerance — at the tool boundary the model should fix them).
 * A schema without an `attributes` key does not constrain attribute names.
 * Returns the JSON string, or null after pushing the errors.
 */
function validatePropsOverrides(
	pin: Pick<ResolvedPin, "tagName" | "apiSchema">,
	overrides: PropsOverridesInput | null | undefined,
	label: string,
	errors: string[],
): string | null {
	if (overrides === null || overrides === undefined) return null;
	if (!isPlainObject(overrides)) {
		errors.push(`${label}: propsOverrides must be an object.`);
		return null;
	}
	const schema = parseApiSchemaAttrs(pin.apiSchema);
	if (!schema.ok) {
		errors.push(
			`${label}: component "${pin.tagName}" has malformed apiSchema JSON — fix it with save_component.`,
		);
		return null;
	}
	const before = errors.length;
	checkOverridesAgainstAttrs(
		schema.attrs,
		overrides,
		pin.tagName,
		label,
		errors,
	);
	if (errors.length > before) return null;
	return Object.keys(overrides).length > 0 ? JSON.stringify(overrides) : null;
}

/**
 * Validates template-BLOCK-level propsOverrides against every affected slot
 * at the tool boundary (compose merges block-level overrides into EVERY
 * slot and validates each merged set against that slot's pinned apiSchema —
 * a bad value would otherwise surface only at composition, where
 * createPublication rejects the whole publication). For each slot with a
 * constraining apiSchema the MERGED set is validated (slot overrides, then
 * block-level keys win — exactly compose's merge); a slot whose pinned
 * version lacks apiSchema/attributes keeps the plain-object tolerance for
 * key names (non-string values are still rejected, as compose rejects
 * them at render). Returns the block overrides' JSON string, or null after
 * pushing the errors (each error names the offending slot).
 */
async function validateTemplateBlockOverrides(
	prisma: PrismaDb,
	options: {
		templateId: string;
		templateName: string;
		overrides: PropsOverridesInput | null | undefined;
		label: string;
		errors: string[];
	},
): Promise<string | null> {
	const { overrides, label, errors } = options;
	if (
		overrides !== null &&
		overrides !== undefined &&
		!isPlainObject(overrides)
	) {
		errors.push(`${label}: propsOverrides must be an object.`);
		return null;
	}
	const slots = await prisma.templateSlot.findMany({
		where: { templateId: options.templateId },
		orderBy: { ordinal: "asc" },
		select: {
			ordinal: true,
			componentVersionId: true,
			propsOverrides: true,
		},
	});
	const versionIds = [
		...new Set(
			slots
				.map((slot) => slot.componentVersionId)
				.filter((id): id is string => id !== null),
		),
	];
	const versionRows =
		versionIds.length > 0
			? await prisma.componentVersion.findMany({
					where: { id: { in: versionIds } },
					select: {
						id: true,
						apiSchema: true,
						component: { select: { tagName: true } },
					},
				})
			: [];
	const versionById = new Map(versionRows.map((row) => [row.id, row]));
	const before = errors.length;
	for (const slot of slots) {
		const slotLabel = `${label} (template "${options.templateName}" slot ${slot.ordinal})`;
		let slotOverrides: Record<string, unknown> = {};
		if (
			typeof slot.propsOverrides === "string" &&
			slot.propsOverrides.trim() !== ""
		) {
			try {
				const parsed: unknown = JSON.parse(slot.propsOverrides);
				if (!isPlainObject(parsed)) {
					errors.push(
						`${slotLabel}: template slot has malformed propsOverrides — redefine the template.`,
					);
					continue;
				}
				slotOverrides = parsed;
			} catch {
				errors.push(
					`${slotLabel}: template slot has malformed propsOverrides JSON — redefine the template.`,
				);
				continue;
			}
		}
		const version = slot.componentVersionId
			? versionById.get(slot.componentVersionId)
			: undefined;
		if (!version) continue; // compose reports the missing pin itself
		const schema = parseApiSchemaAttrs(version.apiSchema);
		if (!schema.ok) {
			errors.push(
				`${slotLabel}: component "${version.component.tagName}" has malformed apiSchema JSON — fix it with save_component.`,
			);
			continue;
		}
		// Merged exactly as compose merges: slot overrides, then block-level
		// keys win.
		checkOverridesAgainstAttrs(
			schema.attrs,
			{ ...slotOverrides, ...(overrides ?? {}) },
			version.component.tagName,
			slotLabel,
			errors,
		);
	}
	if (errors.length > before) return null;
	return overrides != null && Object.keys(overrides).length > 0
		? JSON.stringify(overrides)
		: null;
}

/** One validated dataBindings entry: { collection, limit?, filter? }. */
type ValidatedBinding = {
	collection: string;
	limit?: number;
	filter?: Record<string, string | number | boolean>;
};

/**
 * Validates one raw bindings entry against the same shape rules the
 * composer's parseDataBinding enforces; null after pushing errors.
 */
function validateDataBindingEntry(
	value: unknown,
	label: string,
	prop: string,
	errors: string[],
): ValidatedBinding | null {
	if (!isPlainObject(value)) {
		errors.push(
			`${label}: data binding "${prop}" must be an object like { collection, limit?, filter? }.`,
		);
		return null;
	}
	const v = value as Record<string, unknown>;
	if (typeof v.collection !== "string" || v.collection.trim() === "") {
		errors.push(`${label}: data binding "${prop}" needs a collection name.`);
		return null;
	}
	const binding: ValidatedBinding = { collection: v.collection };
	if (v.limit !== undefined) {
		if (
			typeof v.limit !== "number" ||
			!Number.isInteger(v.limit) ||
			v.limit < 0
		) {
			errors.push(
				`${label}: data binding "${prop}" limit must be a non-negative integer.`,
			);
			return null;
		}
		binding.limit = v.limit;
	}
	if (v.filter !== undefined) {
		if (!isPlainObject(v.filter)) {
			errors.push(
				`${label}: data binding "${prop}" filter must be an object of primitive values.`,
			);
			return null;
		}
		const filter: Record<string, string | number | boolean> = {};
		for (const [key, filterValue] of Object.entries(v.filter)) {
			if (
				typeof filterValue !== "string" &&
				typeof filterValue !== "number" &&
				typeof filterValue !== "boolean"
			) {
				errors.push(
					`${label}: data binding "${prop}" filter value "${key}" must be a string, number or boolean.`,
				);
				return null;
			}
			filter[key] = filterValue;
		}
		binding.filter = filter;
	}
	return binding;
}

/**
 * Validates a full dataBindings object: every entry shape-checked, and every
 * referenced collection must exist (by name) in the project. Returns the
 * JSON string for the column ("" when empty — compose treats blank as no
 * bindings), or null after pushing errors.
 */
async function validateDataBindings(
	prisma: PrismaDb,
	projectId: string,
	bindings: DataBindingsInput | null | undefined,
	label: string,
	errors: string[],
): Promise<string | null> {
	if (bindings === null || bindings === undefined) return null;
	if (!isPlainObject(bindings)) {
		errors.push(`${label}: dataBindings must be an object keyed by prop name.`);
		return null;
	}
	const before = errors.length;
	const entries: Array<{ prop: string; binding: ValidatedBinding }> = [];
	for (const prop of Object.keys(bindings)) {
		const binding = validateDataBindingEntry(
			bindings[prop],
			label,
			prop,
			errors,
		);
		if (binding) entries.push({ prop, binding });
	}
	if (errors.length > before) return null;
	const names = [...new Set(entries.map((e) => e.binding.collection))];
	const collections =
		names.length > 0
			? await prisma.dataCollection.findMany({
					where: { projectId, name: { in: names } },
					select: { name: true },
				})
			: [];
	const existing = new Set(collections.map((row) => row.name));
	for (const name of names) {
		if (!existing.has(name)) {
			errors.push(
				`${label}: unknown data collection "${name}" — seed it with seed_data first.`,
			);
		}
	}
	if (errors.length > before) return null;
	return entries.length > 0 ? JSON.stringify(bindings) : null;
}

// ---------------------------------------------------------------------------
// compose_page
// ---------------------------------------------------------------------------

/** Per-block pin summary returned on success. */
export type ComposedBlockPin =
	| {
			ordinal: number;
			kind: "component";
			component: string;
			tagName: string;
			version: number;
	  }
	| { ordinal: number; kind: "template"; template: string }
	| { ordinal: number; kind: "html" };

export type ComposePageToolResult =
	| {
			ok: true;
			page: {
				id: string;
				path: string;
				title: string;
				status: string;
				created: boolean;
			};
			blocks: ComposedBlockPin[];
	  }
	| PageToolFailure;

/** A validated+prepared block, ready for the PageBlock insert. */
type PreparedBlock = {
	componentVersionId?: string;
	templateId?: string;
	sourceHtml?: string;
	propsOverrides?: string;
	dataBindings?: string;
	pin: ComposedBlockPin;
};

/**
 * Validates a full block list and resolves every pin/override/binding — the
 * complete error list, nothing written. Shared by composePageTool and the
 * KUK-928 studio block replacement, so the admin surface enforces exactly
 * the same rules as the agent tool (unknown/draft/retired pins, unknown
 * attributes, unknown collections, template-block restrictions). Entries may
 * be plain untyped objects — every field is shape-checked below.
 *
 * `preserveExistingPins` (studio block replacement only) lets a block pass
 * through an existing pin by `componentVersionId` instead of naming
 * component+version: reorders and deletes must be able to keep a stale
 * (retired) pin exactly where it is — pins never move unless the editor
 * explicitly re-pins them (the KUK-917 manual re-pin model). The pin row is
 * verified to exist and belong to the project; its overrides/bindings are
 * re-validated so a pass-through can never smuggle in new junk.
 */
async function preparePageBlocks(
	prisma: PrismaDb,
	projectId: string,
	blocks: readonly unknown[],
	options: { preserveExistingPins?: boolean } = {},
): Promise<
	{ ok: true; prepared: PreparedBlock[] } | { ok: false; errors: string[] }
> {
	const errors: string[] = [];
	const prepared: PreparedBlock[] = [];
	for (const [ordinal, entry] of blocks.entries()) {
		const label = `blocks[${ordinal}]`;
		if (!isPlainObject(entry)) {
			errors.push(`${label}: must be an object.`);
			continue;
		}
		if (options.preserveExistingPins) {
			const preservedId = entry.componentVersionId;
			if (preservedId !== undefined && preservedId !== null) {
				if (
					typeof preservedId !== "string" ||
					(entry.component !== undefined && entry.component !== null) ||
					(entry.template !== undefined && entry.template !== null) ||
					(entry.sourceHtml !== undefined && entry.sourceHtml !== null)
				) {
					errors.push(
						`${label}: set either componentVersionId (keep the existing pin) or exactly one of component, template, sourceHtml.`,
					);
					continue;
				}
				const pin = await resolveExistingPin(
					prisma,
					projectId,
					preservedId,
					label,
					errors,
				);
				if (!pin) continue;
				const before = errors.length;
				const propsOverrides = await validatePropsOverrides(
					pin,
					entry.propsOverrides as PropsOverridesInput | null | undefined,
					label,
					errors,
				);
				const dataBindings = await validateDataBindings(
					prisma,
					projectId,
					entry.dataBindings as DataBindingsInput | null | undefined,
					label,
					errors,
				);
				if (errors.length > before) continue;
				prepared.push({
					componentVersionId: pin.versionId,
					...(propsOverrides !== null ? { propsOverrides } : {}),
					...(dataBindings !== null ? { dataBindings } : {}),
					pin: {
						ordinal,
						kind: "component",
						component: pin.componentName,
						tagName: pin.tagName,
						version: pin.version,
					},
				});
				continue;
			}
		}
		const block = entry as PageBlockInput;
		const sources = [
			block.component !== null && block.component !== undefined
				? "component"
				: null,
			block.template !== null && block.template !== undefined
				? "template"
				: null,
			block.sourceHtml !== null && block.sourceHtml !== undefined
				? "sourceHtml"
				: null,
		].filter((source): source is string => source !== null);
		if (sources.length === 0) {
			errors.push(
				`${label}: no source — set exactly one of component, template or sourceHtml.`,
			);
			continue;
		}
		if (sources.length > 1) {
			errors.push(
				`${label}: multiple sources (${sources.join(", ")}) — set exactly one.`,
			);
			continue;
		}

		if (sources[0] === "component") {
			const ref = block.component as ComponentRefInput;
			const pin = await resolveComponentPin(
				prisma,
				projectId,
				ref,
				label,
				errors,
			);
			if (!pin) continue;
			const propsOverrides = await validatePropsOverrides(
				pin,
				block.propsOverrides as PropsOverridesInput | null | undefined,
				label,
				errors,
			);
			const dataBindings = await validateDataBindings(
				prisma,
				projectId,
				block.dataBindings as DataBindingsInput | null | undefined,
				label,
				errors,
			);
			prepared.push({
				componentVersionId: pin.versionId,
				...(propsOverrides !== null ? { propsOverrides } : {}),
				...(dataBindings !== null ? { dataBindings } : {}),
				pin: {
					ordinal,
					kind: "component",
					component: ref.name,
					tagName: pin.tagName,
					version: pin.version,
				},
			});
			continue;
		}

		if (sources[0] === "template") {
			const name =
				typeof block.template === "string" ? block.template.trim() : "";
			const template =
				name && name.length <= MAX_NAME_LENGTH
					? await prisma.template.findUnique({
							where: { projectId_name: { projectId, name } },
						})
					: null;
			if (!template) {
				errors.push(
					`${label}: unknown template "${block.template}" — define it with define_template first.`,
				);
				continue;
			}
			// prop overrides apply at compose (block-level overrides win over
			// slot-level) — validated here against every slot's pinned
			// apiSchema so a bad value can't save into a page the composer
			// would later fail the publication on. Data bindings on template
			// blocks are rejected outright (the composer reports them as
			// errors, which would fail publications).
			const propsOverrides = await validateTemplateBlockOverrides(prisma, {
				templateId: template.id,
				templateName: template.name,
				overrides: block.propsOverrides as
					| PropsOverridesInput
					| null
					| undefined,
				label,
				errors,
			});
			if (block.dataBindings !== null && block.dataBindings !== undefined) {
				errors.push(
					`${label}: data bindings on template blocks are not supported (a template expands to several elements) — bind data on component blocks.`,
				);
			}
			prepared.push({
				templateId: template.id,
				...(propsOverrides !== null ? { propsOverrides } : {}),
				pin: { ordinal, kind: "template", template: template.name },
			});
			continue;
		}

		// sourceHtml: the one-off escape hatch — non-empty verbatim markup,
		// no overrides/bindings (nothing to validate them against).
		const sourceHtml =
			typeof block.sourceHtml === "string" ? block.sourceHtml : "";
		if (sourceHtml.trim() === "") {
			errors.push(`${label}: sourceHtml must be a non-empty HTML string.`);
			continue;
		}
		if (block.propsOverrides !== null && block.propsOverrides !== undefined) {
			errors.push(
				`${label}: propsOverrides only apply to component blocks — inline HTML carries its own markup.`,
			);
		}
		if (block.dataBindings !== null && block.dataBindings !== undefined) {
			errors.push(
				`${label}: data bindings only apply to component blocks — use a component for bound data.`,
			);
		}
		prepared.push({
			sourceHtml,
			pin: { ordinal, kind: "html" },
		});
	}
	if (errors.length > 0) return { ok: false, errors };
	return { ok: true, prepared };
}

/**
 * Upserts a Page by (projectId, path): created when absent (status draft,
 * unless `publish` flips it immediately); on update the title changes only
 * when different, `publish: true` moves a draft page to published (never the
 * reverse — unpublishing is not a compose concern), and the authoring design
 * is attached. Blocks are validated FIRST (all of them — the error list is
 * complete) and only then written with replace-all semantics: the DELETE of
 * the existing PageBlocks and every INSERT run as ONE atomic D1 batch, so a
 * failed write leaves the previous blocks fully intact (a page row created
 * just for this compose is cleaned up best effort).
 */
export async function composePageTool(
	prisma: PrismaDb,
	db: D1Database,
	options: {
		projectId: string;
		/** The authoring design workspace (attached to the page row). */
		designId?: string;
		path: string;
		title: string;
		blocks: PageBlockInput[];
		/** Flips the page to "published" (part of the next publication). */
		publish?: boolean;
	},
): Promise<ComposePageToolResult> {
	const path = typeof options.path === "string" ? options.path.trim() : "";
	if (
		!path.startsWith("/") ||
		path.length > MAX_PATH_LENGTH ||
		path.includes("?") ||
		path.includes("#")
	) {
		return failure(400, [
			`path must be a site path starting with "/" (e.g. "/" or "/pricing"), at most ${MAX_PATH_LENGTH} characters.`,
		]);
	}
	const title = typeof options.title === "string" ? options.title.trim() : "";
	if (!title || title.length > MAX_TITLE_LENGTH) {
		return failure(400, [
			`title is required (${MAX_TITLE_LENGTH} characters or fewer).`,
		]);
	}
	if (!Array.isArray(options.blocks)) {
		return failure(400, ["blocks must be an array."]);
	}
	if (options.blocks.length > MAX_BLOCKS) {
		return failure(400, [
			`too many blocks (${options.blocks.length}) — compose at most ${MAX_BLOCKS} per page.`,
		]);
	}

	// ---- validation pass (complete error list, nothing written) ----
	const prepared = await preparePageBlocks(
		prisma,
		options.projectId,
		options.blocks,
	);
	if (!prepared.ok) {
		return failure(400, prepared.errors);
	}

	// ---- writes (validation passed) ----
	const existing = await prisma.page.findUnique({
		where: { projectId_path: { projectId: options.projectId, path } },
	});
	let pageId: string;
	let status: string;
	let created: boolean;
	if (!existing) {
		const page = await prisma.page.create({
			data: {
				projectId: options.projectId,
				...(options.designId ? { designId: options.designId } : {}),
				path,
				title,
				status: options.publish ? "published" : "draft",
			},
		});
		pageId = page.id;
		status = page.status;
		created = true;
	} else {
		const data: {
			title?: string;
			status?: string;
			designId?: string;
		} = {};
		if (existing.title !== title) data.title = title;
		if (options.publish && existing.status !== "published") {
			data.status = "published";
		}
		if (options.designId && existing.designId !== options.designId) {
			data.designId = options.designId;
		}
		pageId = existing.id;
		status = data.status ?? existing.status;
		created = false;
		if (Object.keys(data).length > 0) {
			await prisma.page.update({ where: { id: existing.id }, data });
		}
	}
	await atomicReplaceAll(db, {
		table: "PageBlock",
		deleteColumn: "pageId",
		deleteValue: pageId,
		insertColumns:
			'"id", "pageId", "ordinal", "componentVersionId", "templateId", "sourceHtml", "propsOverrides", "dataBindings"',
		rows: prepared.prepared.map((block, ordinal) => [
			crypto.randomUUID(),
			pageId,
			ordinal,
			block.componentVersionId ?? null,
			block.templateId ?? null,
			block.sourceHtml ?? null,
			block.propsOverrides ?? null,
			block.dataBindings ?? null,
		]),
	}).catch(async (error: unknown) => {
		// The batch rolled back atomically — the previous blocks survive.
		// A page row created just for this compose is removed best effort so
		// an interrupted compose never leaves a blockless page behind (the
		// title/status update of an existing page is harmless metadata).
		if (created) {
			await prisma.page.delete({ where: { id: pageId } }).catch(() => {});
		}
		throw error;
	});
	return {
		ok: true,
		page: { id: pageId, path, title, status, created },
		blocks: prepared.prepared.map((block) => block.pin),
	};
}

// ---------------------------------------------------------------------------
// bind_data
// ---------------------------------------------------------------------------

export type BindDataToolResult =
	| {
			ok: true;
			path: string;
			ordinal: number;
			bindings: Record<string, unknown>;
	  }
	| PageToolFailure;

/**
 * Sets or replaces ONE block's dataBindings (validated: shape + collections
 * exist). Bindings only render on component-pinned blocks — the composer
 * ignores them elsewhere (and errors on template blocks), so binding
 * anything else is rejected here with a clear error. An empty object clears
 * the bindings.
 */
export async function bindDataTool(
	prisma: PrismaDb,
	options: {
		projectId: string;
		path: string;
		ordinal: number;
		bindings: DataBindingsInput;
	},
): Promise<BindDataToolResult> {
	const path = typeof options.path === "string" ? options.path.trim() : "";
	if (!path.startsWith("/") || path.length > MAX_PATH_LENGTH) {
		return failure(400, [
			`path must be a site path starting with "/", e.g. "/pricing".`,
		]);
	}
	if (!Number.isInteger(options.ordinal) || options.ordinal < 0) {
		return failure(400, [
			`ordinal must be a non-negative integer — the block's position from the compose_page call (0-based).`,
		]);
	}
	if (!isPlainObject(options.bindings)) {
		return failure(400, [
			"bindings must be an object keyed by prop name, e.g. { items: { collection: 'courses', limit: 6 } }.",
		]);
	}
	const errors: string[] = [];
	const label = `bind_data (block ${options.ordinal})`;
	const serialized = await validateDataBindings(
		prisma,
		options.projectId,
		options.bindings,
		label,
		errors,
	);
	if (errors.length > 0) return failure(400, errors);

	const page = await prisma.page.findUnique({
		where: { projectId_path: { projectId: options.projectId, path } },
		select: { id: true, path: true },
	});
	if (!page) {
		return failure(404, [
			`no page at path "${path}" — compose it with compose_page first.`,
		]);
	}
	const block = await prisma.pageBlock.findUnique({
		where: { pageId_ordinal: { pageId: page.id, ordinal: options.ordinal } },
		select: { id: true, componentVersionId: true, templateId: true },
	});
	if (!block) {
		return failure(404, [
			`page "${path}" has no block at ordinal ${options.ordinal} — check list_pages / your compose_page call.`,
		]);
	}
	if (!block.componentVersionId) {
		return failure(400, [
			`block ${options.ordinal} on "${path}" is not a component block — data bindings render only on component-pinned blocks.`,
		]);
	}
	await prisma.pageBlock.update({
		where: { id: block.id },
		data: { dataBindings: serialized },
	});
	return {
		ok: true,
		path,
		ordinal: options.ordinal,
		bindings: options.bindings,
	};
}

// ---------------------------------------------------------------------------
// define_template
// ---------------------------------------------------------------------------

export type DefineTemplateToolResult =
	| { ok: true; template: { id: string; name: string; slotCount: number } }
	| PageToolFailure;

/**
 * Upserts a Template by (projectId, name) and writes its slots with
 * replace-all semantics (redefine = DELETE + INSERTs in ONE atomic D1
 * batch). Slots use the same pin validation as page blocks (no
 * template/dataBindings nesting — a slot is one component pin + optional
 * prop overrides).
 */
export async function defineTemplateTool(
	prisma: PrismaDb,
	db: D1Database,
	options: {
		projectId: string;
		name: string;
		slots: TemplateSlotInput[];
	},
): Promise<DefineTemplateToolResult> {
	const name = typeof options.name === "string" ? options.name.trim() : "";
	if (!name || name.length > MAX_NAME_LENGTH) {
		return failure(400, [
			`template name is required (${MAX_NAME_LENGTH} characters or fewer, e.g. "LandingHero").`,
		]);
	}
	if (!Array.isArray(options.slots) || options.slots.length === 0) {
		return failure(400, [
			"slots must be a non-empty array of { component: { name, version? }, propsOverrides? }.",
		]);
	}
	if (options.slots.length > MAX_SLOTS) {
		return failure(400, [
			`too many slots (${options.slots.length}) — define at most ${MAX_SLOTS}.`,
		]);
	}
	const errors: string[] = [];
	const prepared: Array<{
		componentVersionId: string;
		propsOverrides?: string;
	}> = [];
	for (const [ordinal, slot] of options.slots.entries()) {
		const label = `slots[${ordinal}]`;
		if (!isPlainObject(slot) || !isPlainObject(slot.component)) {
			errors.push(
				`${label}: must be an object with a component: { name, version? } pin.`,
			);
			continue;
		}
		const pin = await resolveComponentPin(
			prisma,
			options.projectId,
			slot.component as ComponentRefInput,
			label,
			errors,
		);
		if (!pin) continue;
		const propsOverrides = await validatePropsOverrides(
			pin,
			slot.propsOverrides,
			label,
			errors,
		);
		prepared.push({
			componentVersionId: pin.versionId,
			...(propsOverrides !== null ? { propsOverrides } : {}),
		});
	}
	if (errors.length > 0) return failure(400, errors);

	let template = await prisma.template.findUnique({
		where: { projectId_name: { projectId: options.projectId, name } },
		select: { id: true },
	});
	let created = false;
	if (!template) {
		template = await prisma.template.create({
			data: { projectId: options.projectId, name },
			select: { id: true },
		});
		created = true;
	}
	const templateId = template.id;
	await atomicReplaceAll(db, {
		table: "TemplateSlot",
		deleteColumn: "templateId",
		deleteValue: templateId,
		insertColumns:
			'"id", "templateId", "ordinal", "componentVersionId", "propsOverrides"',
		rows: prepared.map((slot, ordinal) => [
			crypto.randomUUID(),
			templateId,
			ordinal,
			slot.componentVersionId,
			slot.propsOverrides ?? null,
		]),
	}).catch(async (error: unknown) => {
		// Batch rolled back atomically — the previous slots survive; a
		// template row created just for this define is cleaned up.
		if (created) {
			await prisma.template
				.delete({ where: { id: templateId } })
				.catch(() => {});
		}
		throw error;
	});
	return {
		ok: true,
		template: { id: templateId, name, slotCount: prepared.length },
	};
}

// ---------------------------------------------------------------------------
// define_flow
// ---------------------------------------------------------------------------

export type DefineFlowToolResult =
	| { ok: true; flow: { id: string; name: string; stepCount: number } }
	| PageToolFailure;

/**
 * Upserts a Flow by (projectId, name) and writes its steps with replace-all
 * semantics (DELETE + INSERTs in ONE atomic D1 batch). Every step's path
 * must reference an existing page of the project (draft or published —
 * flows are journeys over pages, not publications).
 */
export async function defineFlowTool(
	prisma: PrismaDb,
	db: D1Database,
	options: {
		projectId: string;
		name: string;
		steps: FlowStepInput[];
	},
): Promise<DefineFlowToolResult> {
	const name = typeof options.name === "string" ? options.name.trim() : "";
	if (!name || name.length > MAX_NAME_LENGTH) {
		return failure(400, [
			`flow name is required (${MAX_NAME_LENGTH} characters or fewer, e.g. "Onboarding").`,
		]);
	}
	if (!Array.isArray(options.steps) || options.steps.length === 0) {
		return failure(400, [
			"steps must be a non-empty array of { path, entryAction?, exitTarget? }.",
		]);
	}
	if (options.steps.length > MAX_STEPS) {
		return failure(400, [
			`too many steps (${options.steps.length}) — define at most ${MAX_STEPS}.`,
		]);
	}
	const errors: string[] = [];
	const paths: string[] = [];
	const cleaned: Array<{
		path: string;
		entryAction?: string;
		exitTarget?: string;
	}> = [];
	for (const [ordinal, step] of options.steps.entries()) {
		const label = `steps[${ordinal}]`;
		if (!isPlainObject(step)) {
			errors.push(`${label}: must be an object with a page path.`);
			continue;
		}
		const path = typeof step.path === "string" ? step.path.trim() : "";
		if (!path.startsWith("/") || path.length > MAX_PATH_LENGTH) {
			errors.push(
				`${label}: path must be a site path starting with "/", e.g. "/pricing".`,
			);
			continue;
		}
		const entryAction =
			typeof step.entryAction === "string" ? step.entryAction.trim() : "";
		const exitTarget =
			typeof step.exitTarget === "string" ? step.exitTarget.trim() : "";
		if (entryAction.length > MAX_ACTION_LENGTH) {
			errors.push(
				`${label}: entryAction is at most ${MAX_ACTION_LENGTH} characters.`,
			);
			continue;
		}
		if (exitTarget.length > MAX_ACTION_LENGTH) {
			errors.push(
				`${label}: exitTarget is at most ${MAX_ACTION_LENGTH} characters.`,
			);
			continue;
		}
		paths.push(path);
		cleaned.push({
			path,
			...(entryAction ? { entryAction } : {}),
			...(exitTarget ? { exitTarget } : {}),
		});
	}
	if (errors.length > 0) return failure(400, errors);
	const pages = await prisma.page.findMany({
		where: { projectId: options.projectId, path: { in: paths } },
		select: { id: true, path: true },
	});
	const pageIdByPath = new Map(pages.map((page) => [page.path, page.id]));
	const prepared: Array<{
		pageId: string;
		entryAction?: string;
		exitTarget?: string;
	}> = [];
	for (const [ordinal, step] of cleaned.entries()) {
		const pageId = pageIdByPath.get(step.path);
		if (!pageId) {
			errors.push(
				`steps[${ordinal}]: no page at path "${step.path}" — compose it with compose_page first.`,
			);
			continue;
		}
		prepared.push({
			pageId,
			...(step.entryAction ? { entryAction: step.entryAction } : {}),
			...(step.exitTarget ? { exitTarget: step.exitTarget } : {}),
		});
	}
	if (errors.length > 0) return failure(400, errors);

	let flow = await prisma.flow.findUnique({
		where: { projectId_name: { projectId: options.projectId, name } },
		select: { id: true },
	});
	let created = false;
	if (!flow) {
		flow = await prisma.flow.create({
			data: { projectId: options.projectId, name },
			select: { id: true },
		});
		created = true;
	}
	const flowId = flow.id;
	await atomicReplaceAll(db, {
		table: "FlowStep",
		deleteColumn: "flowId",
		deleteValue: flowId,
		insertColumns:
			'"id", "flowId", "ordinal", "pageId", "entryAction", "exitTarget"',
		rows: prepared.map((step, ordinal) => [
			crypto.randomUUID(),
			flowId,
			ordinal,
			step.pageId,
			step.entryAction ?? null,
			step.exitTarget ?? null,
		]),
	}).catch(async (error: unknown) => {
		// Batch rolled back atomically — the previous steps survive; a flow
		// row created just for this define is cleaned up.
		if (created) {
			await prisma.flow.delete({ where: { id: flowId } }).catch(() => {});
		}
		throw error;
	});
	return {
		ok: true,
		flow: { id: flowId, name, stepCount: prepared.length },
	};
}

// ---------------------------------------------------------------------------
// list_pages
// ---------------------------------------------------------------------------

export type PagesSummary = {
	pages: Array<{
		path: string;
		title: string;
		status: string;
		blockCount: number;
	}>;
	templates: Array<{ name: string; slotCount: number }>;
	flows: Array<{ name: string; stepCount: number }>;
};

/** Prompt discovery helper: the project's pages, templates and flows. */
export async function listPagesTool(
	prisma: PrismaDb,
	options: { projectId: string },
): Promise<PagesSummary> {
	const [pages, templates, flows] = await Promise.all([
		prisma.page.findMany({
			where: { projectId: options.projectId },
			orderBy: { path: "asc" },
			select: {
				path: true,
				title: true,
				status: true,
				_count: { select: { blocks: true } },
			},
		}),
		prisma.template.findMany({
			where: { projectId: options.projectId },
			orderBy: { name: "asc" },
			select: { name: true, _count: { select: { slots: true } } },
		}),
		prisma.flow.findMany({
			where: { projectId: options.projectId },
			orderBy: { name: "asc" },
			select: { name: true, _count: { select: { steps: true } } },
		}),
	]);
	return {
		pages: pages.map((page) => ({
			path: page.path,
			title: page.title,
			status: page.status,
			blockCount: page._count.blocks,
		})),
		templates: templates.map((template) => ({
			name: template.name,
			slotCount: template._count.slots,
		})),
		flows: flows.map((flow) => ({
			name: flow.name,
			stepCount: flow._count.steps,
		})),
	};
}

// ---------------------------------------------------------------------------
// KUK-928 studio building-block admin ops — the DB work behind the studio's
// page composer, data collections, templates and flows views. Same contract
// as the KUK-925 tools above: validate first (model-correctable failures as
// values), then write; list replacements go through atomicReplaceAll. Every
// design-scoped op fences the page through its authoring design and the
// design through its project (the KUK-927 review lesson — never trust a
// path id without checking parentage).
// ---------------------------------------------------------------------------

/** A page path/title validation failure message, or null when valid. */
function validatePagePath(path: string): string | null {
	if (
		!path.startsWith("/") ||
		path.length > MAX_PATH_LENGTH ||
		path.includes("?") ||
		path.includes("#")
	) {
		return `path must be a site path starting with "/" (e.g. "/" or "/pricing"), at most ${MAX_PATH_LENGTH} characters.`;
	}
	return null;
}

function validatePageTitle(title: string): string | null {
	if (!title || title.length > MAX_TITLE_LENGTH) {
		return `title is required (${MAX_TITLE_LENGTH} characters or fewer).`;
	}
	return null;
}

/**
 * Loads a page fenced through its authoring design: the page must belong to
 * the given design and the design to the given project. Null on any break
 * (missing row, cross-project design, page of another design).
 */
async function loadDesignPage(
	prisma: PrismaDb,
	options: { projectId: string; designId: string; pageId: string },
): Promise<{
	id: string;
	path: string;
	title: string;
	status: string;
} | null> {
	const design = await prisma.design.findUnique({
		where: { id: options.designId },
		select: { projectId: true },
	});
	if (!design || design.projectId !== options.projectId) return null;
	const page = await prisma.page.findUnique({
		where: { id: options.pageId },
		select: {
			id: true,
			path: true,
			title: true,
			status: true,
			designId: true,
		},
	});
	if (!page || page.designId !== options.designId) return null;
	return page;
}

// ---------------------------------------------------------------------------
// Page composer reads + page mutations
// ---------------------------------------------------------------------------

/** One composer block with its full source detail (editable round-trip). */
export type ComposerBlock = {
	id: string;
	ordinal: number;
	kind: "component" | "template" | "html";
	/** Component blocks: the exact pinned version. */
	componentVersionId: string | null;
	componentId: string | null;
	componentName: string | null;
	tagName: string | null;
	version: number | null;
	versionStatus: ComponentVersionStatus | null;
	/** Template blocks. */
	templateId: string | null;
	templateName: string | null;
	/** HTML blocks. */
	sourceHtml: string | null;
	/** Parsed JSON (null when absent or malformed — malformed normalizes away). */
	propsOverrides: PropsOverridesInput | null;
	dataBindings: DataBindingsInput | null;
};

export type ComposerPage = {
	id: string;
	path: string;
	title: string;
	status: string;
	blocks: ComposerBlock[];
};

export type DesignComposerView = {
	pages: ComposerPage[];
};

/**
 * The design's pages with their blocks' full source detail for the studio
 * composer. Null when the design is missing or not part of the requested
 * project (no cross-project leak, same contract as listDesignPagePins).
 */
export async function listDesignComposerPages(
	prisma: PrismaDb,
	options: { projectId: string; designId: string },
): Promise<DesignComposerView | null> {
	const design = await prisma.design.findUnique({
		where: { id: options.designId },
		select: { projectId: true },
	});
	if (!design || design.projectId !== options.projectId) return null;
	const pages = await prisma.page.findMany({
		where: { designId: options.designId },
		orderBy: { path: "asc" },
		select: {
			id: true,
			path: true,
			title: true,
			status: true,
			blocks: {
				orderBy: { ordinal: "asc" },
				select: {
					id: true,
					ordinal: true,
					componentVersionId: true,
					templateId: true,
					sourceHtml: true,
					propsOverrides: true,
					dataBindings: true,
					componentVersion: {
						select: {
							id: true,
							version: true,
							status: true,
							component: {
								select: { id: true, name: true, tagName: true },
							},
						},
					},
					template: { select: { id: true, name: true } },
				},
			},
		},
	});
	return {
		pages: pages.map((page) => ({
			id: page.id,
			path: page.path,
			title: page.title,
			status: page.status,
			blocks: page.blocks.map((block) => {
				const pinned = block.componentVersion;
				const template = block.template;
				return {
					id: block.id,
					ordinal: block.ordinal,
					kind: pinned
						? ("component" as const)
						: template
							? ("template" as const)
							: ("html" as const),
					componentVersionId: block.componentVersionId,
					componentId: pinned?.component.id ?? null,
					componentName: pinned?.component.name ?? null,
					tagName: pinned?.component.tagName ?? null,
					version: pinned?.version ?? null,
					versionStatus: pinned ? versionStatus(pinned.status) : null,
					templateId: block.templateId,
					templateName: template?.name ?? null,
					sourceHtml: block.sourceHtml,
					propsOverrides: parseJsonObject(block.propsOverrides),
					dataBindings: parseJsonObject(block.dataBindings),
				};
			}),
		})),
	};
}

/** Parses a stored JSON column into a plain object (null otherwise). */
function parseJsonObject(value: string | null): Record<string, unknown> | null {
	if (!value || value.trim() === "") return null;
	try {
		const parsed: unknown = JSON.parse(value);
		return isPlainObject(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

export type PageMutationResult =
	| {
			ok: true;
			page: { id: string; path: string; title: string; status: string };
			/** Block pins on the block-replacement path. */
			blocks?: ComposedBlockPin[];
	  }
	| PageToolFailure;

/**
 * Creates a draft page owned by the (fenced) design. Unlike composePageTool
 * this never upserts: an existing path is a 409, so the studio's create form
 * can never wipe another page's blocks by accident.
 */
export async function createPageTool(
	prisma: PrismaDb,
	options: {
		projectId: string;
		designId: string;
		path: string;
		title: string;
	},
): Promise<PageMutationResult> {
	const design = await prisma.design.findUnique({
		where: { id: options.designId },
		select: { projectId: true },
	});
	if (!design || design.projectId !== options.projectId) {
		return failure(404, ["design not found in this project."]);
	}
	const path = typeof options.path === "string" ? options.path.trim() : "";
	const pathError = validatePagePath(path);
	if (pathError) return failure(400, [pathError]);
	const title = typeof options.title === "string" ? options.title.trim() : "";
	const titleError = validatePageTitle(title);
	if (titleError) return failure(400, [titleError]);
	const existing = await prisma.page.findUnique({
		where: { projectId_path: { projectId: options.projectId, path } },
		select: { id: true },
	});
	if (existing) {
		return failure(409, [
			`a page at path "${path}" already exists in this project.`,
		]);
	}
	const page = await prisma.page.create({
		data: {
			projectId: options.projectId,
			designId: options.designId,
			path,
			title,
			status: "draft",
		},
	});
	return {
		ok: true,
		page: {
			id: page.id,
			path: page.path,
			title: page.title,
			status: page.status,
		},
	};
}

/**
 * Renames a page's title and/or path (path renames are uniqueness-checked
 * within the project). Blocks and flow steps cascade through the page row,
 * so a rename moves them along.
 */
export async function updatePageTool(
	prisma: PrismaDb,
	options: {
		projectId: string;
		designId: string;
		pageId: string;
		path?: string | null;
		title?: string | null;
	},
): Promise<PageMutationResult> {
	const page = await loadDesignPage(prisma, options);
	if (!page) {
		return failure(404, ["page not found in this design."]);
	}
	const data: { path?: string; title?: string } = {};
	if (options.path !== null && options.path !== undefined) {
		const path = options.path.trim();
		const pathError = validatePagePath(path);
		if (pathError) return failure(400, [pathError]);
		if (path !== page.path) {
			const taken = await prisma.page.findUnique({
				where: { projectId_path: { projectId: options.projectId, path } },
				select: { id: true },
			});
			if (taken) {
				return failure(409, [
					`a page at path "${path}" already exists in this project.`,
				]);
			}
			data.path = path;
		}
	}
	if (options.title !== null && options.title !== undefined) {
		const title = options.title.trim();
		const titleError = validatePageTitle(title);
		if (titleError) return failure(400, [titleError]);
		if (title !== page.title) data.title = title;
	}
	if (Object.keys(data).length === 0) {
		return {
			ok: true,
			page: {
				id: page.id,
				path: page.path,
				title: page.title,
				status: page.status,
			},
		};
	}
	const updated = await prisma.page.update({
		where: { id: page.id },
		data,
	});
	return {
		ok: true,
		page: {
			id: updated.id,
			path: updated.path,
			title: updated.title,
			status: updated.status,
		},
	};
}

/**
 * Deletes a page (blocks and flow steps cascade through the FKs). Only the
 * design's own page can be deleted — the fence doubles as the 404 guard.
 */
export async function deletePageTool(
	prisma: PrismaDb,
	options: { projectId: string; designId: string; pageId: string },
): Promise<PageMutationResult> {
	const page = await loadDesignPage(prisma, options);
	if (!page) {
		return failure(404, ["page not found in this design."]);
	}
	await prisma.page.delete({ where: { id: page.id } });
	return { ok: true, page };
}

/**
 * Replaces ALL of a page's blocks with the given list (add / delete /
 * reorder are full-list writes, mirroring composePageTool): validated first
 * (complete error list), then DELETE + INSERTs in ONE atomic D1 batch, so a
 * failed write leaves the previous blocks fully intact. Block ids are
 * regenerated on every write — the composer re-reads after each mutation.
 */
export async function replacePageBlocksTool(
	prisma: PrismaDb,
	db: D1Database,
	options: {
		projectId: string;
		designId: string;
		pageId: string;
		blocks: readonly unknown[];
	},
): Promise<PageMutationResult> {
	const page = await loadDesignPage(prisma, options);
	if (!page) {
		return failure(404, ["page not found in this design."]);
	}
	if (options.blocks.length > MAX_BLOCKS) {
		return failure(400, [
			`too many blocks (${options.blocks.length}) — a page carries at most ${MAX_BLOCKS}.`,
		]);
	}
	const prepared = await preparePageBlocks(
		prisma,
		options.projectId,
		options.blocks,
		{ preserveExistingPins: true },
	);
	if (!prepared.ok) {
		return failure(400, prepared.errors);
	}
	await atomicReplaceAll(db, {
		table: "PageBlock",
		deleteColumn: "pageId",
		deleteValue: page.id,
		insertColumns:
			'"id", "pageId", "ordinal", "componentVersionId", "templateId", "sourceHtml", "propsOverrides", "dataBindings"',
		rows: prepared.prepared.map((block, ordinal) => [
			crypto.randomUUID(),
			page.id,
			ordinal,
			block.componentVersionId ?? null,
			block.templateId ?? null,
			block.sourceHtml ?? null,
			block.propsOverrides ?? null,
			block.dataBindings ?? null,
		]),
	});
	return {
		ok: true,
		page,
		blocks: prepared.prepared.map((block) => block.pin),
	};
}

// ---------------------------------------------------------------------------
// Data collections + records
// ---------------------------------------------------------------------------

export type DataCollectionDetail = {
	id: string;
	name: string;
	records: Array<{ id: string; ordinal: number; data: string }>;
};

/**
 * The project's data collections with their records (ordinal order, raw
 * JSON-as-TEXT bodies — the UI round-trips the string).
 */
export async function listProjectDataCollections(
	prisma: PrismaDb,
	options: { projectId: string },
): Promise<DataCollectionDetail[]> {
	const collections = await prisma.dataCollection.findMany({
		where: { projectId: options.projectId },
		orderBy: { name: "asc" },
		select: {
			id: true,
			name: true,
			records: {
				orderBy: { ordinal: "asc" },
				select: { id: true, ordinal: true, data: true },
			},
		},
	});
	return collections.map((collection) => ({
		id: collection.id,
		name: collection.name,
		records: collection.records,
	}));
}

/**
 * PageBlocks of the project whose dataBindings reference the collection
 * name (exact match after JSON.parse — not a LIKE scan, so "course" never
 * matches "courses"). Rename/delete of a bound collection would leave
 * every referencing block rendering an unknown collection at composition
 * time, so the mutations below refuse it first.
 */
async function bindingsReferencingCollection(
	prisma: PrismaDb,
	projectId: string,
	name: string,
): Promise<number> {
	const blocks = await prisma.pageBlock.findMany({
		where: { page: { projectId }, dataBindings: { not: null } },
		select: { dataBindings: true },
	});
	let count = 0;
	for (const block of blocks) {
		const bindings = parseJsonObject(block.dataBindings);
		if (!bindings) continue;
		for (const value of Object.values(bindings)) {
			if (
				isPlainObject(value) &&
				typeof value.collection === "string" &&
				value.collection === name
			) {
				count += 1;
				break;
			}
		}
	}
	return count;
}

export type DataCollectionMutationResult =
	| { ok: true; collection: { id: string; name: string } }
	| PageToolFailure;

/** Creates an empty collection; duplicate names (within the project) are a 409. */
export async function createDataCollectionTool(
	prisma: PrismaDb,
	options: { projectId: string; name: string },
): Promise<DataCollectionMutationResult> {
	const name = typeof options.name === "string" ? options.name.trim() : "";
	if (!name || name.length > MAX_NAME_LENGTH) {
		return failure(400, [
			`collection name is required (${MAX_NAME_LENGTH} characters or fewer, e.g. "courses").`,
		]);
	}
	const existing = await prisma.dataCollection.findUnique({
		where: { projectId_name: { projectId: options.projectId, name } },
		select: { id: true },
	});
	if (existing) {
		return failure(409, [`collection "${name}" already exists.`]);
	}
	const collection = await prisma.dataCollection.create({
		data: { projectId: options.projectId, name },
	});
	return { ok: true, collection: { id: collection.id, name: collection.name } };
}

/** Renames a collection unless page-block bindings still reference the name. */
export async function renameDataCollectionTool(
	prisma: PrismaDb,
	options: { projectId: string; collectionId: string; name: string },
): Promise<DataCollectionMutationResult> {
	const collection = await loadDataCollection(prisma, options);
	if (!collection) {
		return failure(404, ["data collection not found in this project."]);
	}
	const name = typeof options.name === "string" ? options.name.trim() : "";
	if (!name || name.length > MAX_NAME_LENGTH) {
		return failure(400, [
			`collection name is required (${MAX_NAME_LENGTH} characters or fewer).`,
		]);
	}
	if (name !== collection.name) {
		const referenced = await bindingsReferencingCollection(
			prisma,
			options.projectId,
			collection.name,
		);
		if (referenced > 0) {
			return failure(409, [
				`${referenced} page block(s) bind "${collection.name}" — unbind them before renaming.`,
			]);
		}
		const taken = await prisma.dataCollection.findUnique({
			where: { projectId_name: { projectId: options.projectId, name } },
			select: { id: true },
		});
		if (taken) {
			return failure(409, [`collection "${name}" already exists.`]);
		}
	}
	const updated = await prisma.dataCollection.update({
		where: { id: collection.id },
		data: { name },
	});
	return { ok: true, collection: { id: updated.id, name: updated.name } };
}

/** Deletes a collection (records cascade) unless page blocks still bind it. */
export async function deleteDataCollectionTool(
	prisma: PrismaDb,
	options: { projectId: string; collectionId: string },
): Promise<DataCollectionMutationResult> {
	const collection = await loadDataCollection(prisma, options);
	if (!collection) {
		return failure(404, ["data collection not found in this project."]);
	}
	const referenced = await bindingsReferencingCollection(
		prisma,
		options.projectId,
		collection.name,
	);
	if (referenced > 0) {
		return failure(409, [
			`${referenced} page block(s) bind "${collection.name}" — unbind them before deleting.`,
		]);
	}
	await prisma.dataCollection.delete({ where: { id: collection.id } });
	return { ok: true, collection };
}

/** Loads a collection fenced to its project. Null on any break. */
async function loadDataCollection(
	prisma: PrismaDb,
	options: { projectId: string; collectionId: string },
): Promise<{ id: string; name: string } | null> {
	const collection = await prisma.dataCollection.findUnique({
		where: { id: options.collectionId },
		select: { id: true, name: true, projectId: true },
	});
	if (!collection || collection.projectId !== options.projectId) return null;
	return collection;
}

export type DataRecordsResult =
	| { ok: true; collectionId: string; name: string; count: number }
	| PageToolFailure;

const MAX_RECORDS = 1000;

/**
 * Replaces ALL of a collection's records with the given list (add / edit /
 * delete are full-list writes): each record must be a plain JSON-serializable
 * object; the DELETE + INSERTs run as ONE atomic D1 batch with ordinals
 * 0..n-1, so a failed write leaves the previous records fully intact. Record
 * ids are regenerated — the UI re-reads after each mutation.
 */
export async function replaceDataRecordsTool(
	prisma: PrismaDb,
	db: D1Database,
	options: {
		projectId: string;
		collectionId: string;
		records: readonly unknown[];
	},
): Promise<DataRecordsResult> {
	const collection = await loadDataCollection(prisma, options);
	if (!collection) {
		return failure(404, ["data collection not found in this project."]);
	}
	if (options.records.length > MAX_RECORDS) {
		return failure(400, [
			`too many records (${options.records.length}) — a collection holds at most ${MAX_RECORDS}.`,
		]);
	}
	const rows: string[] = [];
	for (const [index, record] of options.records.entries()) {
		if (
			typeof record !== "object" ||
			record === null ||
			Array.isArray(record)
		) {
			return failure(400, [
				`records[${index}] must be a plain JSON object (got ${record === null ? "null" : Array.isArray(record) ? "array" : typeof record}).`,
			]);
		}
		try {
			rows.push(JSON.stringify(record));
		} catch (error) {
			const detail =
				error instanceof Error ? error.message : "not serializable";
			return failure(400, [
				`records[${index}] is not JSON-serializable (${detail}).`,
			]);
		}
	}
	await atomicReplaceAll(db, {
		table: "DataRecord",
		deleteColumn: "collectionId",
		deleteValue: collection.id,
		insertColumns: '"id", "collectionId", "ordinal", "data"',
		rows: rows.map((data, ordinal) => [
			crypto.randomUUID(),
			collection.id,
			ordinal,
			data,
		]),
	});
	return {
		ok: true,
		collectionId: collection.id,
		name: collection.name,
		count: rows.length,
	};
}

// ---------------------------------------------------------------------------
// Templates + flows: reads and deletes (create/slot+step replacement reuse
// defineTemplateTool / defineFlowTool unchanged)
// ---------------------------------------------------------------------------

export type TemplateDetail = {
	id: string;
	name: string;
	slots: Array<{
		id: string;
		ordinal: number;
		componentVersionId: string | null;
		componentName: string | null;
		tagName: string | null;
		version: number | null;
		versionStatus: ComponentVersionStatus | null;
		propsOverrides: PropsOverridesInput | null;
	}>;
};

/** The project's templates with their ordered slots (composer + flows UI). */
export async function listProjectTemplates(
	prisma: PrismaDb,
	options: { projectId: string },
): Promise<TemplateDetail[]> {
	const templates = await prisma.template.findMany({
		where: { projectId: options.projectId },
		orderBy: { name: "asc" },
		select: {
			id: true,
			name: true,
			slots: {
				orderBy: { ordinal: "asc" },
				select: {
					id: true,
					ordinal: true,
					componentVersionId: true,
					propsOverrides: true,
					componentVersion: {
						select: {
							id: true,
							version: true,
							status: true,
							component: {
								select: { id: true, name: true, tagName: true },
							},
						},
					},
				},
			},
		},
	});
	return templates.map((template) => ({
		id: template.id,
		name: template.name,
		slots: template.slots.map((slot) => {
			const pinned = slot.componentVersion;
			return {
				id: slot.id,
				ordinal: slot.ordinal,
				componentVersionId: slot.componentVersionId,
				componentName: pinned?.component.name ?? null,
				tagName: pinned?.component.tagName ?? null,
				version: pinned?.version ?? null,
				versionStatus: pinned ? versionStatus(pinned.status) : null,
				propsOverrides: parseJsonObject(slot.propsOverrides),
			};
		}),
	}));
}

export type DeleteResult = { ok: true } | PageToolFailure;

/**
 * Deletes a template. PageBlocks referencing it are refused first (409):
 * the FK only nulls templateId, which would leave those blocks with no
 * renderable source and fail every later publication.
 */
export async function deleteTemplateTool(
	prisma: PrismaDb,
	options: { projectId: string; templateId: string },
): Promise<DeleteResult> {
	const template = await prisma.template.findUnique({
		where: { id: options.templateId },
		select: { id: true, name: true, projectId: true },
	});
	if (!template || template.projectId !== options.projectId) {
		return failure(404, ["template not found in this project."]);
	}
	const used = await prisma.pageBlock.count({
		where: { templateId: template.id },
	});
	if (used > 0) {
		return failure(409, [
			`${used} page block(s) instantiate "${template.name}" — remove them before deleting the template.`,
		]);
	}
	await prisma.template.delete({ where: { id: template.id } });
	return { ok: true };
}

export type FlowDetail = {
	id: string;
	name: string;
	steps: Array<{
		id: string;
		ordinal: number;
		pageId: string;
		pagePath: string;
		pageTitle: string;
		entryAction: string | null;
		exitTarget: string | null;
	}>;
};

export type FlowsView = {
	flows: FlowDetail[];
	/** The project's pages — the flow-step page picker's options. */
	pages: Array<{ id: string; path: string; title: string }>;
};

/** The project's flows with their ordered steps, plus its pages by path. */
export async function listProjectFlows(
	prisma: PrismaDb,
	options: { projectId: string },
): Promise<FlowsView> {
	const [flows, pages] = await Promise.all([
		prisma.flow.findMany({
			where: { projectId: options.projectId },
			orderBy: { name: "asc" },
			select: {
				id: true,
				name: true,
				steps: {
					orderBy: { ordinal: "asc" },
					select: {
						id: true,
						ordinal: true,
						pageId: true,
						entryAction: true,
						exitTarget: true,
						page: { select: { path: true, title: true } },
					},
				},
			},
		}),
		prisma.page.findMany({
			where: { projectId: options.projectId },
			orderBy: { path: "asc" },
			select: { id: true, path: true, title: true },
		}),
	]);
	return {
		flows: flows.map((flow) => ({
			id: flow.id,
			name: flow.name,
			steps: flow.steps.map((step) => ({
				id: step.id,
				ordinal: step.ordinal,
				pageId: step.pageId,
				pagePath: step.page.path,
				pageTitle: step.page.title,
				entryAction: step.entryAction,
				exitTarget: step.exitTarget,
			})),
		})),
		pages,
	};
}

/** Deletes a flow (its steps cascade through the FKs). */
export async function deleteFlowTool(
	prisma: PrismaDb,
	options: { projectId: string; flowId: string },
): Promise<DeleteResult> {
	const flow = await prisma.flow.findUnique({
		where: { id: options.flowId },
		select: { id: true, projectId: true },
	});
	if (!flow || flow.projectId !== options.projectId) {
		return failure(404, ["flow not found in this project."]);
	}
	await prisma.flow.delete({ where: { id: flow.id } });
	return { ok: true };
}
