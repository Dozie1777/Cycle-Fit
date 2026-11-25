/**
 * Per-element context builders (KUK-943): the seeding text stored in
 * `ElementChat.contextPrompt` at session creation. Each element chat's
 * system prompt carries ONLY the element's own definition, its immediate
 * neighbors, and the project's design tokens / brand kit — never the full
 * design history or other elements' internals. That isolation is the point.
 *
 * The output is consumed by the element chat pipeline (lib/element-chat.ts)
 * and wired at session creation by KUK-942/KUK-944. This module is lib +
 * tests only: it takes the prisma client as a parameter (no runtime db
 * import) so unit tests can stub it like campaign-asset-context.test.ts.
 */

import {
	type DesignTokenRow,
	designTokenRowsToDesignTokens,
	getProjectTokens,
} from "@/features/design-studio/tokens/design-tokens";
import {
	type BrandKitLike,
	brandKitPromptSection,
} from "@/features/projects/brand-kit/brand-kit";
import { loadBrandKit } from "@/features/projects/brand-kit/brand-kit-load";

type PrismaDb = ReturnType<typeof import("@/lib/db")["getPrisma"]>;

export type ElementType = "component" | "page" | "template" | "data" | "flow";

/**
 * Typed not-found: the element row does not exist, or it belongs to a
 * different project than the one the chat session lives in.
 */
export class ElementContextNotFoundError extends Error {
	constructor(elementType: ElementType, elementId: string) {
		super(`${elementType} ${elementId} not found in this project`);
		this.name = "ElementContextNotFoundError";
	}
}

/**
 * Explicit size caps — the whole point is a small focused prompt.
 * - Big source fields (js/html/css): 4 KB each.
 * - JSON contract fields (apiSchema/defaults/overrides/bindings): 2 KB each.
 * - Sample records: at most 5, each capped.
 * - Total output target: under 12 KB (hard clamp on the element body; the
 *   token/brand-kit footer is appended after the clamp so styling context
 *   always survives).
 */
const SOURCE_FIELD_CAP = 4_096;
const JSON_FIELD_CAP = 2_048;
const MAX_SAMPLE_RECORDS = 5;
export const ELEMENT_CONTEXT_TOTAL_CAP = 12_000;

/** Truncates `text` to `limit` characters, marking the cut with an ellipsis. */
function cap(text: string | null | undefined, limit: number): string {
	if (!text) return "";
	return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

/** One-line summary of a JSON field (propsOverrides, dataBindings, …). */
function jsonSummary(text: string | null, limit = JSON_FIELD_CAP): string {
	const capped = cap(text, limit);
	return capped ? ` — ${capped}` : "";
}

/** Renders an optional nullable field as a fenced block, or skips it. */
function fenced(lang: string, label: string, body: string): string {
	return body ? `\n${label}:\n\n\`\`\`${lang}\n${body}\n\`\`\`` : "";
}

/** The shared project styling footer: design tokens + brand kit, once. */
async function buildStyleFooter(
	prisma: PrismaDb,
	projectId: string,
): Promise<string> {
	const sections: string[] = [];
	const kit: BrandKitLike | null = await loadBrandKit(prisma, projectId);
	if (kit) {
		const section = brandKitPromptSection(kit);
		if (section) sections.push(section);
	}
	const grouped = await getProjectTokens(prisma, projectId);
	const rows: DesignTokenRow[] = [];
	for (const list of Object.values(grouped)) rows.push(...list);
	if (rows.length > 0) {
		const tokens = designTokenRowsToDesignTokens(rows);
		const lines = [...tokens.colors, ...tokens.other].map(
			(token) => `${token.name}: ${token.value};`,
		);
		sections.push(
			`# Design tokens\n\nThe project's token store — apply these CSS custom properties instead of hardcoding values:\n\n\`\`\`css\n:root {\n${lines.join("\n")}\n}\n\`\`\``,
		);
	}
	return sections.length > 0 ? `\n\n${sections.join("\n\n")}` : "";
}

/** Clamps the element body so body + footer stays under the total cap. */
function clampTotal(body: string, footer: string): string {
	const budget = ELEMENT_CONTEXT_TOTAL_CAP - footer.length;
	if (body.length <= budget) return `${body}${footer}`;
	return `${body.slice(0, Math.max(0, budget - 1))}…${footer}`;
}

/**
 * The component builder: identity (name, tagName, kind), latest + published
 * version content (truncated per field), status/version numbers, and the
 * pages currently pinning it (paths only — never block internals).
 */
async function buildComponentContext(
	prisma: PrismaDb,
	projectId: string,
	elementId: string,
): Promise<string> {
	const component = await prisma.component.findFirst({
		where: { id: elementId, projectId },
		include: {
			versions: { orderBy: { version: "desc" }, take: 1 },
			publishedVersion: true,
		},
	});
	if (!component) throw new ElementContextNotFoundError("component", elementId);
	const latest = component.versions[0] ?? null;
	const published = component.publishedVersion;

	const parts: string[] = [];
	parts.push(
		`# Element: component ${component.name}\n\n- Tag: \`${component.tagName}\`\n- Kind: ${component.kind}`,
	);

	const statusLine = published
		? `published v${published.version}`
		: "no published version (pages pin nothing)";
	parts.push(
		`\n## Versions\n\n- ${latest ? `Latest: v${latest.version} (${latest.status})` : "No versions yet"}\n- Currently ${statusLine}`,
	);

	for (const [label, version] of [
		["Latest version", latest],
		["Published version", published],
	] as const) {
		if (!version) continue;
		parts.push(
			`\n## ${label}: v${version.version} (${version.status})${
				version.changeNote ? ` — ${cap(version.changeNote, 200)}` : ""
			}`,
		);
		parts.push(
			fenced("js", "js", cap(version.js, SOURCE_FIELD_CAP)) || "\n(js empty)",
		);
		parts.push(fenced("html", "html", cap(version.html, SOURCE_FIELD_CAP)));
		parts.push(
			fenced(
				"css",
				"css (token-driven: var(--tb-…))",
				cap(version.css, SOURCE_FIELD_CAP),
			),
		);
		parts.push(
			fenced("json", "apiSchema", cap(version.apiSchema, JSON_FIELD_CAP)),
		);
		parts.push(
			fenced("json", "defaults", cap(version.defaults, JSON_FIELD_CAP)),
		);
	}

	// Neighbors: pages pinning ANY version of this component — paths only.
	const pinning = await prisma.pageBlock.findMany({
		where: { componentVersion: { componentId: elementId } },
		include: { page: { select: { path: true, title: true } } },
	});
	const paths = [
		...new Map(pinning.map((block) => [block.page.path, block.page])).values(),
	];
	parts.push(
		`\n## Pages using this component\n${
			paths.length > 0
				? paths
						.map(
							(page) => `- ${page.path}${page.title ? ` (${page.title})` : ""}`,
						)
						.join("\n")
				: "None yet."
		}`,
	);
	return parts.join("\n");
}

/**
 * The page builder: path/title/status, blocks in ordinal order (pinned
 * component tagName+version, template name, or "raw HTML" marker, plus
 * propsOverrides/dataBindings summaries), and the flows the page joins.
 */
async function buildPageContext(
	prisma: PrismaDb,
	projectId: string,
	elementId: string,
): Promise<string> {
	const page = await prisma.page.findFirst({
		where: { id: elementId, projectId },
		include: {
			blocks: {
				orderBy: { ordinal: "asc" },
				include: {
					componentVersion: { include: { component: true } },
					template: { select: { name: true } },
				},
			},
			flowSteps: { include: { flow: { select: { name: true } } } },
		},
	});
	if (!page) throw new ElementContextNotFoundError("page", elementId);

	const blockLines = page.blocks.map((block) => {
		const what = block.componentVersion
			? `${block.componentVersion.component.tagName} v${block.componentVersion.version}`
			: block.template
				? `template "${block.template.name}"`
				: "raw HTML";
		const extras: string[] = [];
		if (block.propsOverrides)
			extras.push(`props: ${cap(block.propsOverrides, JSON_FIELD_CAP)}`);
		if (block.dataBindings)
			extras.push(`data: ${cap(block.dataBindings, JSON_FIELD_CAP)}`);
		return `- #${block.ordinal}: ${what}${extras.length ? ` — ${extras.join(" — ")}` : ""}`;
	});

	const flowNames = [...new Set(page.flowSteps.map((step) => step.flow.name))];

	return [
		`# Element: page ${page.path}\n\n- Title: ${page.title}\n- Status: ${page.status}`,
		`\n## Blocks (ordinal order)\n${blockLines.length ? blockLines.join("\n") : "No blocks yet."}`,
		`\n## Flows through this page\n${flowNames.length ? flowNames.map((name) => `- ${name}`).join("\n") : "None."}`,
	].join("\n");
}

/**
 * The template builder: name + slots in ordinal order (component tagName,
 * pinned version, overrides summary) + the pages using it (paths).
 */
async function buildTemplateContext(
	prisma: PrismaDb,
	projectId: string,
	elementId: string,
): Promise<string> {
	const template = await prisma.template.findFirst({
		where: { id: elementId, projectId },
		include: {
			slots: {
				orderBy: { ordinal: "asc" },
				include: {
					componentVersion: { include: { component: true } },
				},
			},
		},
	});
	if (!template) throw new ElementContextNotFoundError("template", elementId);

	const slotLines = template.slots.map((slot) => {
		const pinned = slot.componentVersion
			? `${slot.componentVersion.component.tagName} v${slot.componentVersion.version}`
			: "unpinned";
		const overrides = slot.propsOverrides
			? jsonSummary(slot.propsOverrides)
			: "";
		return `- Slot #${slot.ordinal}: ${pinned}${overrides}`;
	});

	const usages = await prisma.pageBlock.findMany({
		where: { templateId: elementId },
		include: { page: { select: { path: true, title: true } } },
	});
	const pages = [
		...new Map(usages.map((block) => [block.page.path, block.page])).values(),
	];

	return [
		`# Element: template ${template.name}`,
		`\n## Slots (ordinal order)\n${slotLines.length ? slotLines.join("\n") : "No slots yet."}`,
		`\n## Pages using this template\n${pages.length ? pages.map((page) => `- ${page.path}${page.title ? ` (${page.title})` : ""}`).join("\n") : "None yet."}`,
	].join("\n");
}

/**
 * The data-collection builder: name, shape inferred from sample records, up
 * to 5 sample records (JSON, capped), and the pages binding it (cheap: one
 * scan of the project's page blocks parsing dataBindings).
 */
async function buildDataContext(
	prisma: PrismaDb,
	projectId: string,
	elementId: string,
): Promise<string> {
	const collection = await prisma.dataCollection.findFirst({
		where: { id: elementId, projectId },
		include: {
			records: { orderBy: { ordinal: "asc" }, take: MAX_SAMPLE_RECORDS },
		},
	});
	if (!collection) throw new ElementContextNotFoundError("data", elementId);

	const total = await prisma.dataRecord.count({
		where: { collectionId: elementId },
	});

	// Defensive double cap: `take` limits the query; the slice keeps the
	// builder honest even against a client that ignores `take`.
	const samples = collection.records.slice(0, MAX_SAMPLE_RECORDS);
	// Infer the shape from the sample records' key union.
	const keys: string[] = [];
	for (const record of samples) {
		try {
			for (const key of Object.keys(
				JSON.parse(record.data) as Record<string, unknown>,
			)) {
				if (!keys.includes(key)) keys.push(key);
			}
		} catch {
			// A malformed row contributes no shape.
		}
	}

	const sampleLines = samples.map(
		(record) =>
			`- #${record.ordinal}: ${cap(
				record.data.replace(/\s+/g, " ").trim(),
				JSON_FIELD_CAP,
			)}`,
	);

	// Pages binding this collection: scan the project's blocks' dataBindings.
	const blocks = await prisma.pageBlock.findMany({
		where: { page: { projectId } },
		include: { page: { select: { path: true } } },
	});
	const bindingPages = new Set<string>();
	for (const block of blocks) {
		if (!block.dataBindings) continue;
		try {
			const bindings = JSON.parse(block.dataBindings) as Record<
				string,
				unknown
			>;
			// dataBindings shape: { "<prop>": { "collection": "<name>", … } } —
			// the collection name is nested one level under the prop key.
			const bound = Object.values(bindings).some(
				(value) =>
					typeof value === "object" &&
					value !== null &&
					(value as Record<string, unknown>).collection === collection.name,
			);
			if (bound) bindingPages.add(block.page.path);
		} catch {
			// Skip malformed bindings.
		}
	}

	return [
		`# Element: data collection "${collection.name}"\n\n- Records: ${total} (showing up to ${MAX_SAMPLE_RECORDS} samples)`,
		`\n## Shape (inferred from samples)\n${keys.length ? keys.map((key) => `- ${key}`).join("\n") : "Unknown (no sample records)."}`,
		`\n## Sample records\n${sampleLines.length ? sampleLines.join("\n") : "Empty collection."}`,
		`\n## Pages binding this collection\n${bindingPages.size ? [...bindingPages].map((path) => `- ${path}`).join("\n") : "None discovered."}`,
	].join("\n");
}

/**
 * The flow builder: name + ordered steps (page path + entry/exit action
 * summaries).
 */
async function buildFlowContext(
	prisma: PrismaDb,
	projectId: string,
	elementId: string,
): Promise<string> {
	const flow = await prisma.flow.findFirst({
		where: { id: elementId, projectId },
		include: {
			steps: {
				orderBy: { ordinal: "asc" },
				include: { page: { select: { path: true, title: true } } },
			},
		},
	});
	if (!flow) throw new ElementContextNotFoundError("flow", elementId);

	const stepLines = flow.steps.map((step) => {
		const entry = step.entryAction
			? `enter: ${cap(step.entryAction, 200)}`
			: "";
		const exit = step.exitTarget ? `exit: ${cap(step.exitTarget, 200)}` : "";
		const actions = [entry, exit].filter(Boolean).join(" — ");
		return `- Step #${step.ordinal}: ${step.page.path}${step.page.title ? ` (${step.page.title})` : ""}${actions ? ` — ${actions}` : ""}`;
	});

	return [
		`# Element: flow ${flow.name}`,
		`\n## Steps (journey order)\n${stepLines.length ? stepLines.join("\n") : "No steps yet."}`,
	].join("\n");
}

/**
 * Builds the per-element context prompt: the element's own definition, its
 * immediate neighbors, then the project's design tokens and brand kit (once).
 * Throws ElementContextNotFoundError when the element does not exist or
 * belongs to another project.
 */
export async function buildElementContext(
	prisma: PrismaDb,
	projectId: string,
	elementType: ElementType,
	elementId: string,
): Promise<string> {
	let body: string;
	switch (elementType) {
		case "component":
			body = await buildComponentContext(prisma, projectId, elementId);
			break;
		case "page":
			body = await buildPageContext(prisma, projectId, elementId);
			break;
		case "template":
			body = await buildTemplateContext(prisma, projectId, elementId);
			break;
		case "data":
			body = await buildDataContext(prisma, projectId, elementId);
			break;
		case "flow":
			body = await buildFlowContext(prisma, projectId, elementId);
			break;
	}
	const footer = await buildStyleFooter(prisma, projectId);
	return clampTotal(body, footer);
}
