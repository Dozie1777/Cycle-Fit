// Component tests for the KUK-928 studio building-block panels (tabs,
// page composer, data collections, templates, flows): loading/empty/error
// states and the action wiring over the full-list replace mutations.
// Follows component-library.test.tsx: mocked @/queries + inert dialogs
// (react-test-renderer has no DOM).
import { type ReactElement, type ReactNode, StrictMode } from "react";
import {
	act,
	create,
	type ReactTestInstance,
	type ReactTestRenderer,
} from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	ComponentLibrary as ComponentLibraryPayload,
	DataCollections,
	DesignPages,
	Flows,
	Templates,
} from "@/client/api-types";
import { BuildingBlocks } from "./building-blocks";

const mocks = vi.hoisted(() => ({
	useCreateElementChat: vi.fn(() => ({ mutateAsync: vi.fn() })),
	useProjectComponents: vi.fn(),
	useDesignPages: vi.fn(),
	useProjectData: vi.fn(),
	useProjectTemplates: vi.fn(),
	useProjectFlows: vi.fn(),
	useCreatePage: vi.fn(),
	useUpdatePage: vi.fn(),
	useDeletePage: vi.fn(),
	useReplacePageBlocks: vi.fn(),
	useCreateDataCollection: vi.fn(),
	useRenameDataCollection: vi.fn(),
	useDeleteDataCollection: vi.fn(),
	useReplaceDataRecords: vi.fn(),
	useDefineTemplate: vi.fn(),
	useDeleteTemplate: vi.fn(),
	useDefineFlow: vi.fn(),
	useDeleteFlow: vi.fn(),
}));

vi.mock("@/client/queries", () => mocks);

// Base UI Dialog needs a DOM; render its children inline when open so the
// confirm flows stay assertable.
vi.mock("@/components/ui/dialog", () => ({
	Dialog: (props: { open: boolean; children?: ReactNode }) =>
		props.open ? <div>{props.children}</div> : null,
	DialogContent: (props: { children?: ReactNode }) => (
		<div>{props.children}</div>
	),
	DialogTitle: (props: { children?: ReactNode }) => <div>{props.children}</div>,
	DialogDescription: (props: { children?: ReactNode }) => (
		<div>{props.children}</div>
	),
	DialogFooter: (props: { children?: ReactNode }) => (
		<div>{props.children}</div>
	),
}));

function queryStub(overrides: Record<string, unknown> = {}) {
	return {
		data: undefined,
		isPending: true,
		error: null,
		refetch: vi.fn(() => Promise.resolve()),
		...overrides,
	};
}

function mutationStub(overrides: Record<string, unknown> = {}) {
	return {
		mutate: vi.fn(),
		mutateAsync: vi.fn(() => Promise.resolve({})),
		isPending: false,
		isError: false,
		error: null,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Render helpers (from component-library.test.tsx)
// ---------------------------------------------------------------------------

function flattenChildren(children: unknown): string {
	if (typeof children !== "object" || children === null) {
		return children === undefined || children === null ? "" : String(children);
	}
	if (Array.isArray(children)) {
		return children.map(flattenChildren).join(" ");
	}
	const child = children as { props?: { children?: unknown } };
	if ("props" in child) return flattenChildren(child.props?.children);
	return "";
}

/** The panel's full rendered text (string children of every node). */
function textOf(renderer: ReactTestRenderer): string {
	const parts: string[] = [];
	renderer.root.findAll((node) => {
		const children = node.props?.children;
		if (typeof children === "string" || typeof children === "number") {
			parts.push(String(children));
		} else if (Array.isArray(children)) {
			for (const child of children) {
				if (typeof child === "string" || typeof child === "number") {
					parts.push(String(child));
				}
			}
		}
		return false;
	});
	return parts.join("");
}

function buttonByText(
	renderer: ReactTestRenderer,
	text: string,
): ReactTestInstance | undefined {
	const needle = text.replace(/\s+/g, "");
	return renderer.root
		.findAll(
			(node) =>
				typeof node.type === "string" &&
				node.type === "button" &&
				flattenChildren(node.props.children)
					.replace(/\s+/g, "")
					.includes(needle),
		)
		.at(0);
}

function buttonByLabel(
	renderer: ReactTestRenderer,
	label: string,
	index = 0,
): ReactTestInstance | undefined {
	return renderer.root
		.findAll(
			(node) =>
				typeof node.type === "string" &&
				node.type === "button" &&
				node.props["aria-label"] === label,
		)
		.at(index);
}

/** Inputs / textareas / selects, addressable by their aria-label. */
function labeled(
	renderer: ReactTestRenderer,
	label: string,
	tag: "input" | "textarea" | "select",
	index = 0,
): ReactTestInstance | undefined {
	return renderer.root
		.findAll(
			(node) =>
				typeof node.type === "string" &&
				node.type === tag &&
				node.props["aria-label"] === label,
		)
		.at(index);
}

function setValue(element: ReactTestInstance | undefined, value: string): void {
	// Controlled inputs re-render from state, so the change must run under
	// act like the click handlers do.
	act(() => {
		element?.props.onChange({ target: { value } });
	});
}

async function render(node: ReactElement) {
	let captured: ReactTestRenderer | undefined;
	await act(async () => {
		captured = await create(<StrictMode>{node}</StrictMode>);
	});
	if (!captured) throw new Error("test renderer did not mount");
	return captured;
}

/** Switches the inspector's building-block tab. */
async function openTab(renderer: ReactTestRenderer, tab: string) {
	await act(async () => {
		buttonByText(renderer, tab)?.props.onClick?.();
	});
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROPS = { projectId: "proj-1", designId: "d1" };

const library: ComponentLibraryPayload = {
	components: [
		{
			id: "comp-hero",
			name: "Hero",
			kind: "section",
			tagName: "tb-hero",
			publishedVersionId: "ver-2",
			publishedVersion: 2,
			draftVersion: null,
			versions: [
				{
					id: "ver-2",
					version: 2,
					status: "published",
					changeNote: null,
					createdAt: "2026-10-31T00:00:00.000Z",
					createdTurnId: null,
					hasPngPreview: false,
					demoDocUrl: null,
					pinCount: 1,
				},
			],
		},
	],
	pages: null,
};

const pages: DesignPages = {
	pages: [
		{
			id: "page-1",
			path: "/pricing",
			title: "Pricing",
			status: "draft",
			blocks: [
				{
					id: "block-0",
					ordinal: 0,
					kind: "component",
					componentVersionId: "ver-2",
					componentId: "comp-hero",
					componentName: "Hero",
					tagName: "tb-hero",
					version: 2,
					versionStatus: "published",
					templateId: null,
					templateName: null,
					sourceHtml: null,
					propsOverrides: { heading: "Hi" },
					dataBindings: null,
				},
				{
					id: "block-1",
					ordinal: 1,
					kind: "template",
					componentVersionId: null,
					componentId: null,
					componentName: null,
					tagName: null,
					version: null,
					versionStatus: null,
					templateId: "tpl-1",
					templateName: "LandingHero",
					sourceHtml: null,
					propsOverrides: null,
					dataBindings: null,
				},
				{
					id: "block-2",
					ordinal: 2,
					kind: "html",
					componentVersionId: null,
					componentId: null,
					componentName: null,
					tagName: null,
					version: null,
					versionStatus: null,
					templateId: null,
					templateName: null,
					sourceHtml: "<p>x</p>",
					propsOverrides: null,
					dataBindings: null,
				},
			],
		},
	],
};

const data: DataCollections = {
	collections: [
		{
			id: "col-1",
			name: "courses",
			records: [
				{ id: "rec-1", ordinal: 0, data: '{"title":"First"}' },
				{ id: "rec-2", ordinal: 1, data: '{"title":"Second"}' },
			],
		},
	],
};

const templates: Templates = {
	templates: [
		{
			id: "tpl-1",
			name: "LandingHero",
			slots: [
				{
					id: "slot-1",
					ordinal: 0,
					componentVersionId: "ver-2",
					componentName: "Hero",
					tagName: "tb-hero",
					version: 2,
					versionStatus: "published",
					propsOverrides: { heading: "Hi" },
				},
			],
		},
	],
};

const flows: Flows = {
	flows: [
		{
			id: "flow-1",
			name: "Checkout",
			steps: [
				{
					id: "step-1",
					ordinal: 0,
					pageId: "page-1",
					pagePath: "/pricing",
					pageTitle: "Pricing",
					entryAction: null,
					exitTarget: "click .cta",
				},
			],
		},
	],
	pages: [{ id: "page-1", path: "/pricing", title: "Pricing" }],
};

const mutations = {
	createPage: mutationStub(),
	updatePage: mutationStub(),
	deletePage: mutationStub(),
	replacePageBlocks: mutationStub(),
	createDataCollection: mutationStub(),
	renameDataCollection: mutationStub(),
	deleteDataCollection: mutationStub(),
	replaceDataRecords: mutationStub(),
	defineTemplate: mutationStub(),
	deleteTemplate: mutationStub(),
	defineFlow: mutationStub(),
	deleteFlow: mutationStub(),
};

beforeEach(() => {
	mocks.useProjectComponents.mockReturnValue(
		queryStub({ data: library, isPending: false }),
	);
	mocks.useDesignPages.mockReturnValue(
		queryStub({ data: pages, isPending: false }),
	);
	mocks.useProjectData.mockReturnValue(queryStub({ data, isPending: false }));
	mocks.useProjectTemplates.mockReturnValue(
		queryStub({ data: templates, isPending: false }),
	);
	mocks.useProjectFlows.mockReturnValue(
		queryStub({ data: flows, isPending: false }),
	);
	for (const [name, stub] of Object.entries(mutations)) {
		stub.mutateAsync.mockClear();
		stub.mutateAsync.mockImplementation(() => Promise.resolve({}));
		stub.isPending = false;
		const hook =
			`use${name[0].toUpperCase()}${name.slice(1)}` as keyof typeof mocks;
		mocks[hook].mockReturnValue(stub);
	}
});

describe("BuildingBlocks tabs", () => {
	it("defaults to the KUK-927 component library and exposes the new tabs", async () => {
		const renderer = await render(<BuildingBlocks {...PROPS} />);
		const text = textOf(renderer);
		expect(text).toContain("Hero"); // library panel content
		for (const tab of ["Pages", "Data", "Templates", "Flows"]) {
			expect(buttonByText(renderer, tab)).toBeDefined();
		}
	});

	it("shows the Pages panel after switching tabs", async () => {
		const renderer = await render(<BuildingBlocks {...PROPS} />);
		await openTab(renderer, "Pages");
		expect(textOf(renderer)).toContain("/pricing");
	});
});

describe("Pages panel", () => {
	it("shows loading, error and empty states", async () => {
		mocks.useDesignPages.mockReturnValue(queryStub());
		const loading = await render(<BuildingBlocks {...PROPS} />);
		await openTab(loading, "Pages");
		expect(textOf(loading)).toContain("Loading…");

		mocks.useDesignPages.mockReturnValue(
			queryStub({ isPending: false, error: new Error("pages read failed") }),
		);
		const errored = await render(<BuildingBlocks {...PROPS} />);
		await openTab(errored, "Pages");
		expect(textOf(errored)).toContain("pages read failed");

		mocks.useDesignPages.mockReturnValue(
			queryStub({ isPending: false, data: { pages: [] } }),
		);
		const empty = await render(<BuildingBlocks {...PROPS} />);
		await openTab(empty, "Pages");
		expect(textOf(empty)).toContain("No pages yet");
	});

	it("lists pages with status and block counts", async () => {
		const renderer = await render(<BuildingBlocks {...PROPS} />);
		await openTab(renderer, "Pages");
		const text = textOf(renderer);
		expect(text).toContain("/pricing");
		expect(text).toContain("draft · 3 blocks");
		expect(text).toContain("Pricing");
	});

	it("creates a page through the new-page form", async () => {
		const renderer = await render(<BuildingBlocks {...PROPS} />);
		await openTab(renderer, "Pages");
		await act(async () => {
			buttonByText(renderer, "New page")?.props.onClick?.();
		});
		setValue(labeled(renderer, "Page path", "input"), "/about");
		setValue(labeled(renderer, "Page title", "input"), "About");
		await act(async () => {
			buttonByText(renderer, "Create page")?.props.onClick?.();
		});
		expect(mutations.createPage.mutateAsync).toHaveBeenCalledWith({
			path: "/about",
			title: "About",
		});
	});

	it("shows a create failure", async () => {
		mutations.createPage.mutateAsync.mockImplementation(() =>
			Promise.reject(new Error('a page at path "/about" already exists.')),
		);
		const renderer = await render(<BuildingBlocks {...PROPS} />);
		await openTab(renderer, "Pages");
		await act(async () => {
			buttonByText(renderer, "New page")?.props.onClick?.();
		});
		await act(async () => {
			buttonByText(renderer, "Create page")?.props.onClick?.();
		});
		expect(textOf(renderer)).toContain("already exists");
	});

	it("opens the composer with block labels and renames the page", async () => {
		const renderer = await render(<BuildingBlocks {...PROPS} />);
		await openTab(renderer, "Pages");
		await act(async () => {
			buttonByText(renderer, "/pricing")?.props.onClick?.();
		});
		const text = textOf(renderer);
		expect(text).toContain("Hero v2 (published)");
		expect(text).toContain("template LandingHero");
		expect(text).toContain("inline html");

		setValue(labeled(renderer, "Page title", "input"), "Pricing v2");
		await act(async () => {
			buttonByText(renderer, "Rename")?.props.onClick?.();
		});
		expect(mutations.updatePage.mutateAsync).toHaveBeenCalledWith({
			pageId: "page-1",
			path: "/pricing",
			title: "Pricing v2",
		});
	});

	it("resets the composer when switching to another page", async () => {
		mocks.useDesignPages.mockReturnValue(
			queryStub({
				isPending: false,
				data: {
					pages: [
						...pages.pages,
						{
							id: "page-2",
							path: "/checkout",
							title: "Checkout",
							status: "draft",
							blocks: [],
						},
					],
				} satisfies DesignPages,
			}),
		);
		const renderer = await render(<BuildingBlocks {...PROPS} />);
		await openTab(renderer, "Pages");
		await act(async () => {
			buttonByText(renderer, "/pricing")?.props.onClick?.();
		});
		setValue(labeled(renderer, "Page title", "input"), "Stale title");
		await act(async () => {
			buttonByText(renderer, "/checkout")?.props.onClick?.();
		});
		// The composer is keyed by page id: a stale path/title from the
		// previously selected page must not leak into the new page's form.
		expect(labeled(renderer, "Page title", "input")?.props.value).toBe(
			"Checkout",
		);
		expect(labeled(renderer, "Page path", "input")?.props.value).toBe(
			"/checkout",
		);
	});

	it("removes a block with a full-list replace (pins pass through)", async () => {
		const renderer = await render(<BuildingBlocks {...PROPS} />);
		await openTab(renderer, "Pages");
		await act(async () => {
			buttonByText(renderer, "/pricing")?.props.onClick?.();
		});
		await act(async () => {
			buttonByLabel(renderer, "Remove block 1")?.props.onClick?.();
		});
		expect(mutations.replacePageBlocks.mutateAsync).toHaveBeenCalledWith({
			pageId: "page-1",
			blocks: [
				{ componentVersionId: "ver-2", propsOverrides: { heading: "Hi" } },
				{ sourceHtml: "<p>x</p>" },
			],
		});
	});

	it("reorders blocks", async () => {
		const renderer = await render(<BuildingBlocks {...PROPS} />);
		await openTab(renderer, "Pages");
		await act(async () => {
			buttonByText(renderer, "/pricing")?.props.onClick?.();
		});
		await act(async () => {
			buttonByLabel(renderer, "Move block 0 down")?.props.onClick?.();
		});
		expect(mutations.replacePageBlocks.mutateAsync).toHaveBeenCalledWith({
			pageId: "page-1",
			blocks: [
				{ template: "LandingHero" },
				{ componentVersionId: "ver-2", propsOverrides: { heading: "Hi" } },
				{ sourceHtml: "<p>x</p>" },
			],
		});
	});

	it("adds a component block pinning the picked published version", async () => {
		const renderer = await render(<BuildingBlocks {...PROPS} />);
		await openTab(renderer, "Pages");
		await act(async () => {
			buttonByText(renderer, "/pricing")?.props.onClick?.();
		});
		setValue(labeled(renderer, "Component", "select"), "comp-hero");
		setValue(labeled(renderer, "Version", "select"), "ver-2");
		await act(async () => {
			buttonByText(renderer, "Add to end (3)")?.props.onClick?.();
		});
		expect(mutations.replacePageBlocks.mutateAsync).toHaveBeenCalledWith({
			pageId: "page-1",
			blocks: [
				{ componentVersionId: "ver-2", propsOverrides: { heading: "Hi" } },
				{ template: "LandingHero" },
				{ sourceHtml: "<p>x</p>" },
				{ component: { name: "Hero", version: 2 } },
			],
		});
	});

	it("adds a template block", async () => {
		const renderer = await render(<BuildingBlocks {...PROPS} />);
		await openTab(renderer, "Pages");
		await act(async () => {
			buttonByText(renderer, "/pricing")?.props.onClick?.();
		});
		await act(async () => {
			// The kind chooser buttons render their option name as text.
			renderer.root
				.findAll(
					(node) =>
						typeof node.type === "string" &&
						node.type === "button" &&
						node.props["aria-pressed"] !== undefined &&
						flattenChildren(node.props.children) === "template",
				)
				.at(0)
				?.props.onClick?.();
		});
		setValue(labeled(renderer, "Template", "select"), "tpl-1");
		await act(async () => {
			buttonByText(renderer, "Add to end (3)")?.props.onClick?.();
		});
		expect(mutations.replacePageBlocks.mutateAsync).toHaveBeenCalledWith({
			pageId: "page-1",
			blocks: [
				{ componentVersionId: "ver-2", propsOverrides: { heading: "Hi" } },
				{ template: "LandingHero" },
				{ sourceHtml: "<p>x</p>" },
				{ template: "LandingHero" },
			],
		});
	});

	it("surfaces a save failure from the composer", async () => {
		mutations.replacePageBlocks.mutateAsync.mockImplementation(() =>
			Promise.reject(new Error("blocks[0]: unknown component.")),
		);
		const renderer = await render(<BuildingBlocks {...PROPS} />);
		await openTab(renderer, "Pages");
		await act(async () => {
			buttonByText(renderer, "/pricing")?.props.onClick?.();
		});
		await act(async () => {
			buttonByLabel(renderer, "Remove block 1")?.props.onClick?.();
		});
		expect(textOf(renderer)).toContain("unknown component");
	});

	it("deletes the page after confirming", async () => {
		const renderer = await render(<BuildingBlocks {...PROPS} />);
		await openTab(renderer, "Pages");
		await act(async () => {
			buttonByText(renderer, "/pricing")?.props.onClick?.();
		});
		await act(async () => {
			buttonByLabel(renderer, "Delete page /pricing")?.props.onClick?.();
		});
		expect(textOf(renderer)).toContain("The page, its blocks");
		await act(async () => {
			buttonByText(renderer, "Delete")?.props.onClick?.();
		});
		expect(mutations.deletePage.mutateAsync).toHaveBeenCalledWith("page-1");
	});
});

describe("Data panel", () => {
	it("shows loading and empty states", async () => {
		mocks.useProjectData.mockReturnValue(queryStub());
		const loading = await render(<BuildingBlocks {...PROPS} />);
		await openTab(loading, "Data");
		expect(textOf(loading)).toContain("Loading…");

		mocks.useProjectData.mockReturnValue(
			queryStub({ isPending: false, data: { collections: [] } }),
		);
		const empty = await render(<BuildingBlocks {...PROPS} />);
		await openTab(empty, "Data");
		expect(textOf(empty)).toContain("No collections yet");
	});

	it("lists collections and reveals their records", async () => {
		const renderer = await render(<BuildingBlocks {...PROPS} />);
		await openTab(renderer, "Data");
		expect(textOf(renderer)).toContain("courses");
		expect(textOf(renderer)).toContain("2 records");
		await act(async () => {
			buttonByText(renderer, "courses")?.props.onClick?.();
		});
		// Textarea bodies are value props, not text children.
		const first = labeled(renderer, "Record 0 JSON", "textarea");
		expect(first).toBeDefined();
		expect(first?.props.value).toBe('{"title":"First"}');
	});

	it("creates a collection", async () => {
		const renderer = await render(<BuildingBlocks {...PROPS} />);
		await openTab(renderer, "Data");
		await act(async () => {
			buttonByText(renderer, "New collection")?.props.onClick?.();
		});
		setValue(labeled(renderer, "Collection name", "input"), "lessons");
		await act(async () => {
			buttonByText(renderer, "Create collection")?.props.onClick?.();
		});
		expect(mutations.createDataCollection.mutateAsync).toHaveBeenCalledWith(
			"lessons",
		);
	});

	it("adds, edits and deletes records through full-list replaces", async () => {
		const renderer = await render(<BuildingBlocks {...PROPS} />);
		await openTab(renderer, "Data");
		await act(async () => {
			buttonByText(renderer, "courses")?.props.onClick?.();
		});

		// Add.
		setValue(
			labeled(renderer, "New record JSON", "textarea"),
			'{"title":"Third"}',
		);
		await act(async () => {
			buttonByText(renderer, "Add record")?.props.onClick?.();
		});
		expect(mutations.replaceDataRecords.mutateAsync).toHaveBeenCalledWith({
			collectionId: "col-1",
			records: [{ title: "First" }, { title: "Second" }, { title: "Third" }],
		});

		// Edit record 0.
		setValue(
			labeled(renderer, "Record 0 JSON", "textarea"),
			'{"title":"Edit"}',
		);
		await act(async () => {
			buttonByText(renderer, "Save")?.props.onClick?.();
		});
		expect(mutations.replaceDataRecords.mutateAsync).toHaveBeenCalledWith({
			collectionId: "col-1",
			records: [{ title: "Edit" }, { title: "Second" }],
		});

		// Delete record 1.
		await act(async () => {
			buttonByLabel(renderer, "Delete record 1")?.props.onClick?.();
		});
		expect(mutations.replaceDataRecords.mutateAsync).toHaveBeenCalledWith({
			collectionId: "col-1",
			records: [{ title: "First" }],
		});
	});

	it("rejects invalid record JSON locally without calling the API", async () => {
		const renderer = await render(<BuildingBlocks {...PROPS} />);
		await openTab(renderer, "Data");
		await act(async () => {
			buttonByText(renderer, "courses")?.props.onClick?.();
		});
		setValue(labeled(renderer, "New record JSON", "textarea"), "{nope");
		await act(async () => {
			buttonByText(renderer, "Add record")?.props.onClick?.();
		});
		expect(textOf(renderer)).toContain("not valid JSON");
		expect(mutations.replaceDataRecords.mutateAsync).not.toHaveBeenCalled();
	});

	it("renames a collection", async () => {
		const renderer = await render(<BuildingBlocks {...PROPS} />);
		await openTab(renderer, "Data");
		await act(async () => {
			buttonByText(renderer, "Rename")?.props.onClick?.();
		});
		setValue(labeled(renderer, "Collection name", "input"), "lessons");
		await act(async () => {
			buttonByText(renderer, "Save")?.props.onClick?.();
		});
		expect(mutations.renameDataCollection.mutateAsync).toHaveBeenCalledWith({
			collectionId: "col-1",
			name: "lessons",
		});
	});

	it("deletes a collection after confirming and shows the bound-collection error", async () => {
		mutations.deleteDataCollection.mutateAsync.mockImplementation(() =>
			Promise.reject(
				new Error(
					'1 page block(s) bind "courses" — unbind them before deleting.',
				),
			),
		);
		const renderer = await render(<BuildingBlocks {...PROPS} />);
		await openTab(renderer, "Data");
		await act(async () => {
			buttonByLabel(renderer, "Delete collection courses")?.props.onClick?.();
		});
		await act(async () => {
			buttonByText(renderer, "Delete")?.props.onClick?.();
		});
		expect(mutations.deleteDataCollection.mutateAsync).toHaveBeenCalledWith(
			"col-1",
		);
		expect(textOf(renderer)).toContain("unbind them before deleting");
	});
});

describe("Templates panel", () => {
	it("shows loading and empty states", async () => {
		mocks.useProjectTemplates.mockReturnValue(queryStub());
		const loading = await render(<BuildingBlocks {...PROPS} />);
		await openTab(loading, "Templates");
		expect(textOf(loading)).toContain("Loading…");

		mocks.useProjectTemplates.mockReturnValue(
			queryStub({ isPending: false, data: { templates: [] } }),
		);
		const empty = await render(<BuildingBlocks {...PROPS} />);
		await openTab(empty, "Templates");
		expect(textOf(empty)).toContain("No templates yet");
	});

	it("lists templates and reveals their slots", async () => {
		const renderer = await render(<BuildingBlocks {...PROPS} />);
		await openTab(renderer, "Templates");
		expect(textOf(renderer)).toContain("LandingHero");
		expect(textOf(renderer)).toContain("1 slot");
		await act(async () => {
			buttonByText(renderer, "LandingHero")?.props.onClick?.();
		});
		expect(textOf(renderer)).toContain("Hero v2 (published)");
	});

	it("creates a template with a component slot", async () => {
		const renderer = await render(<BuildingBlocks {...PROPS} />);
		await openTab(renderer, "Templates");
		await act(async () => {
			buttonByText(renderer, "New template")?.props.onClick?.();
		});
		setValue(labeled(renderer, "Template name", "input"), "PricingHero");
		setValue(labeled(renderer, "Slot 0 component", "select"), "comp-hero");
		setValue(labeled(renderer, "Slot 0 version", "select"), "ver-2");
		setValue(
			labeled(renderer, "Slot 0 overrides JSON", "input"),
			'{"heading":"Hi"}',
		);
		await act(async () => {
			buttonByText(renderer, "Create template")?.props.onClick?.();
		});
		expect(mutations.defineTemplate.mutateAsync).toHaveBeenCalledWith({
			name: "PricingHero",
			slots: [
				{
					component: { name: "Hero", version: 2 },
					propsOverrides: { heading: "Hi" },
				},
			],
		});
	});

	it("rejects a create-mode name collision before any write", async () => {
		const renderer = await render(<BuildingBlocks {...PROPS} />);
		await openTab(renderer, "Templates");
		await act(async () => {
			buttonByText(renderer, "New template")?.props.onClick?.();
		});
		// defineTemplate upserts by (project, name) — creating with an
		// existing template's name would restomp it and its slots.
		setValue(labeled(renderer, "Template name", "input"), "LandingHero");
		setValue(labeled(renderer, "Slot 0 component", "select"), "comp-hero");
		setValue(labeled(renderer, "Slot 0 version", "select"), "ver-2");
		await act(async () => {
			buttonByText(renderer, "Create template")?.props.onClick?.();
		});
		expect(textOf(renderer)).toContain("already exists");
		expect(mutations.defineTemplate.mutateAsync).not.toHaveBeenCalled();
	});

	it("blocks submit when a slot has no pinnable component", async () => {
		const renderer = await render(<BuildingBlocks {...PROPS} />);
		await openTab(renderer, "Templates");
		await act(async () => {
			buttonByText(renderer, "New template")?.props.onClick?.();
		});
		setValue(labeled(renderer, "Template name", "input"), "Drafty");
		await act(async () => {
			buttonByText(renderer, "Create template")?.props.onClick?.();
		});
		expect(textOf(renderer)).toContain(
			"pick a component with a published version",
		);
		expect(mutations.defineTemplate.mutateAsync).not.toHaveBeenCalled();
	});

	it("deletes a template after confirming and surfaces the referenced error", async () => {
		mutations.deleteTemplate.mutateAsync.mockImplementation(() =>
			Promise.reject(
				new Error(
					'2 page block(s) instantiate "LandingHero" — remove them before deleting the template.',
				),
			),
		);
		const renderer = await render(<BuildingBlocks {...PROPS} />);
		await openTab(renderer, "Templates");
		await act(async () => {
			buttonByLabel(renderer, "Delete template LandingHero")?.props.onClick?.();
		});
		await act(async () => {
			buttonByText(renderer, "Delete")?.props.onClick?.();
		});
		expect(mutations.deleteTemplate.mutateAsync).toHaveBeenCalledWith("tpl-1");
		expect(textOf(renderer)).toContain("remove them before deleting");
	});
});

describe("Flows panel", () => {
	it("shows loading and empty states", async () => {
		mocks.useProjectFlows.mockReturnValue(queryStub());
		const loading = await render(<BuildingBlocks {...PROPS} />);
		await openTab(loading, "Flows");
		expect(textOf(loading)).toContain("Loading…");

		mocks.useProjectFlows.mockReturnValue(
			queryStub({ isPending: false, data: { flows: [], pages: [] } }),
		);
		const empty = await render(<BuildingBlocks {...PROPS} />);
		await openTab(empty, "Flows");
		expect(textOf(empty)).toContain("No flows yet");
	});

	it("lists flows and reveals their steps", async () => {
		const renderer = await render(<BuildingBlocks {...PROPS} />);
		await openTab(renderer, "Flows");
		expect(textOf(renderer)).toContain("Checkout");
		expect(textOf(renderer)).toContain("1 step");
		await act(async () => {
			buttonByText(renderer, "Checkout")?.props.onClick?.();
		});
		const text = textOf(renderer);
		expect(text).toContain("/pricing");
		expect(text).toContain("exits via “click .cta”");
	});

	it("creates a flow with an ordered step", async () => {
		const renderer = await render(<BuildingBlocks {...PROPS} />);
		await openTab(renderer, "Flows");
		setValue(labeled(renderer, "Flow name", "input"), "Onboarding");
		setValue(labeled(renderer, "Step 0 page", "select"), "page-1");
		setValue(labeled(renderer, "Step 0 exit target", "input"), "click .cta");
		await act(async () => {
			buttonByText(renderer, "Create flow")?.props.onClick?.();
		});
		expect(mutations.defineFlow.mutateAsync).toHaveBeenCalledWith({
			name: "Onboarding",
			steps: [{ path: "/pricing", exitTarget: "click .cta" }],
		});
	});

	it("refuses to submit a step without a page", async () => {
		const renderer = await render(<BuildingBlocks {...PROPS} />);
		await openTab(renderer, "Flows");
		setValue(labeled(renderer, "Flow name", "input"), "Broken");
		await act(async () => {
			buttonByText(renderer, "Create flow")?.props.onClick?.();
		});
		expect(textOf(renderer)).toContain("Step 0: pick a page.");
		expect(mutations.defineFlow.mutateAsync).not.toHaveBeenCalled();
	});

	it("rejects a create-mode name collision before any write", async () => {
		const renderer = await render(<BuildingBlocks {...PROPS} />);
		await openTab(renderer, "Flows");
		setValue(labeled(renderer, "Flow name", "input"), "Checkout");
		setValue(labeled(renderer, "Step 0 page", "select"), "page-1");
		await act(async () => {
			buttonByText(renderer, "Create flow")?.props.onClick?.();
		});
		expect(textOf(renderer)).toContain("already exists");
		expect(mutations.defineFlow.mutateAsync).not.toHaveBeenCalled();
	});

	it("freezes the name when editing — the redefine targets the same flow", async () => {
		const renderer = await render(<BuildingBlocks {...PROPS} />);
		await openTab(renderer, "Flows");
		await act(async () => {
			buttonByText(renderer, "Edit")?.props.onClick?.();
		});
		// The edit form renders inside the flow's list item — before the
		// always-visible new-flow form.
		expect(labeled(renderer, "Flow name", "input", 0)?.props.disabled).toBe(
			true,
		);
		setValue(
			labeled(renderer, "Step 0 exit target", "input", 0),
			"click .save",
		);
		await act(async () => {
			buttonByText(renderer, "Save flow")?.props.onClick?.();
		});
		expect(mutations.defineFlow.mutateAsync).toHaveBeenCalledWith({
			name: "Checkout",
			steps: [{ path: "/pricing", exitTarget: "click .save" }],
		});
	});

	it("deletes a flow after confirming", async () => {
		const renderer = await render(<BuildingBlocks {...PROPS} />);
		await openTab(renderer, "Flows");
		await act(async () => {
			buttonByLabel(renderer, "Delete flow Checkout")?.props.onClick?.();
		});
		await act(async () => {
			buttonByText(renderer, "Delete")?.props.onClick?.();
		});
		expect(mutations.deleteFlow.mutateAsync).toHaveBeenCalledWith("flow-1");
	});
});
