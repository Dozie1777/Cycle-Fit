// Component tests for the KUK-927 studio component library panel:
// loading/empty/error states, the version timeline with lifecycle action
// wiring (publish/restore/retire) and the re-pin affordance over the
// design's pinned blocks. Follows campaign-dashboard.test.tsx: mocked
// @/queries + inert dialogs (react-test-renderer has no DOM).
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
	LibraryComponent,
} from "@/client/api-types";
import { ComponentLibrary } from "./component-library";

const mocks = vi.hoisted(() => ({
	useCreateElementChat: vi.fn(() => ({ mutateAsync: vi.fn() })),
	useProjectComponents: vi.fn(),
	usePublishComponentVersion: vi.fn(),
	useRestoreComponentVersion: vi.fn(),
	useRetireComponent: vi.fn(),
	useRepinBlock: vi.fn(),
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
// Render helpers (from campaign-dashboard.test.tsx)
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
	// Whitespace-insensitive: text children arrive as separate string and
	// number fragments ("Re-pin all (", 2, ")").
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
): ReactTestInstance | undefined {
	return renderer.root
		.findAll(
			(node) =>
				typeof node.type === "string" &&
				node.type === "button" &&
				node.props["aria-label"] === label,
		)
		.at(0);
}

function anchorByHref(
	renderer: ReactTestRenderer,
	href: string,
): ReactTestInstance | undefined {
	return renderer.root
		.findAll(
			(node) =>
				typeof node.type === "string" &&
				node.type === "a" &&
				node.props.href === href,
		)
		.at(0);
}

async function render(node: ReactElement) {
	let captured: ReactTestRenderer | undefined;
	await act(async () => {
		captured = await create(<StrictMode>{node}</StrictMode>);
	});
	if (!captured) throw new Error("test renderer did not mount");
	return captured;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const heroComponent: LibraryComponent = {
	id: "comp-hero",
	name: "Hero",
	kind: "section",
	tagName: "tb-hero",
	publishedVersionId: "ver-2",
	publishedVersion: 2,
	draftVersion: 3,
	versions: [
		{
			id: "ver-3",
			version: 3,
			status: "draft",
			changeNote: "tighten hero",
			createdAt: "2026-11-01T00:00:00.000Z",
			createdTurnId: "deadbeef-1234-5678",
			hasPngPreview: false,
			demoDocUrl: "/designs/d1/file/drafts/hero-v3.html",
			pinCount: 0,
		},
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
		{
			id: "ver-1",
			version: 1,
			status: "retired",
			changeNote: "first cut",
			createdAt: "2026-10-30T00:00:00.000Z",
			createdTurnId: "cafe0000-1234-5678",
			hasPngPreview: false,
			demoDocUrl: null,
			pinCount: 0,
		},
	],
};

const footerComponent: LibraryComponent = {
	id: "comp-footer",
	name: "Footer",
	kind: "layout",
	tagName: "tb-footer",
	publishedVersionId: null,
	publishedVersion: null,
	draftVersion: null,
	versions: [
		{
			id: "fver-1",
			version: 1,
			status: "retired",
			changeNote: null,
			createdAt: "2026-10-29T00:00:00.000Z",
			createdTurnId: null,
			hasPngPreview: false,
			demoDocUrl: null,
			pinCount: 0,
		},
	],
};

const library: ComponentLibraryPayload = {
	components: [footerComponent, heroComponent],
	pages: [
		{
			id: "page-1",
			path: "/",
			title: "Home",
			status: "published",
			blocks: [
				{
					id: "block-stale",
					ordinal: 0,
					kind: "component",
					componentVersionId: "ver-1",
					componentId: "comp-hero",
					componentName: "Hero",
					tagName: "tb-hero",
					version: 1,
					versionStatus: "retired",
				},
				{
					id: "block-current",
					ordinal: 1,
					kind: "component",
					componentVersionId: "ver-2",
					componentId: "comp-hero",
					componentName: "Hero",
					tagName: "tb-hero",
					version: 2,
					versionStatus: "published",
				},
			],
		},
	],
};

beforeEach(() => {
	mocks.useProjectComponents.mockReturnValue(
		queryStub({ data: library, isPending: false }),
	);
	mocks.usePublishComponentVersion.mockReturnValue(mutationStub());
	mocks.useRestoreComponentVersion.mockReturnValue(mutationStub());
	mocks.useRetireComponent.mockReturnValue(mutationStub());
	mocks.useRepinBlock.mockReturnValue(mutationStub());
});

const PROPS = { projectId: "proj-1", designId: "d1" };

describe("ComponentLibrary", () => {
	it("shows a loading state while the library query is pending", async () => {
		mocks.useProjectComponents.mockReturnValue(queryStub());
		const renderer = await render(<ComponentLibrary {...PROPS} />);
		expect(textOf(renderer)).toContain("Loading…");
	});

	it("shows the query error", async () => {
		mocks.useProjectComponents.mockReturnValue(
			queryStub({ isPending: false, error: new Error("library read failed") }),
		);
		const renderer = await render(<ComponentLibrary {...PROPS} />);
		expect(textOf(renderer)).toContain("library read failed");
	});

	it("shows the empty state when the project has no components", async () => {
		mocks.useProjectComponents.mockReturnValue(
			queryStub({
				isPending: false,
				data: { components: [], pages: null },
			}),
		);
		const renderer = await render(<ComponentLibrary {...PROPS} />);
		expect(textOf(renderer)).toContain("No components yet");
	});

	it("lists components with their state and tag/kind line", async () => {
		const renderer = await render(<ComponentLibrary {...PROPS} />);
		const text = textOf(renderer);
		expect(text).toContain("Hero");
		expect(text).toContain("published v2");
		expect(text).toContain("tb-hero · section");
		// Footer: no published version, its latest is retired.
		expect(text).toContain("Footer");
		expect(text).toContain("retired");
	});

	it("reveals the version timeline (notes, turn id, pins, demo doc) on select", async () => {
		const renderer = await render(<ComponentLibrary {...PROPS} />);
		expect(textOf(renderer)).not.toContain("tighten hero");

		await act(async () => {
			buttonByText(renderer, "Hero")?.props.onClick?.();
		});

		const text = textOf(renderer);
		expect(text).toContain("tighten hero");
		expect(text).toContain("turn deadbeef"); // shortened opaque turn id
		expect(text).toContain("1 pin"); // the published version's pin count
		expect(
			anchorByHref(renderer, "/designs/d1/file/drafts/hero-v3.html"),
		).toBeDefined();
	});

	it("publishes the draft through the publish mutation", async () => {
		const publish = mutationStub();
		mocks.usePublishComponentVersion.mockReturnValue(publish);
		const renderer = await render(<ComponentLibrary {...PROPS} />);

		await act(async () => {
			buttonByText(renderer, "Hero")?.props.onClick?.();
		});
		await act(async () => {
			buttonByText(renderer, "Publish")?.props.onClick?.();
		});

		expect(publish.mutateAsync).toHaveBeenCalledWith({
			componentId: "comp-hero",
			versionId: "ver-3",
		});
	});

	it("surfaces a publish failure", async () => {
		mocks.usePublishComponentVersion.mockReturnValue(
			mutationStub({
				mutateAsync: vi.fn(() =>
					Promise.reject(
						new Error("component version v3 is no longer a draft"),
					),
				),
			}),
		);
		const renderer = await render(<ComponentLibrary {...PROPS} />);

		await act(async () => {
			buttonByText(renderer, "Hero")?.props.onClick?.();
		});
		await act(async () => {
			buttonByText(renderer, "Publish")?.props.onClick?.();
		});

		expect(textOf(renderer)).toContain("no longer a draft");
	});

	it("restores a retired version after confirming", async () => {
		const restore = mutationStub();
		mocks.useRestoreComponentVersion.mockReturnValue(restore);
		const renderer = await render(<ComponentLibrary {...PROPS} />);

		await act(async () => {
			buttonByText(renderer, "Hero")?.props.onClick?.();
		});
		await act(async () => {
			buttonByLabel(renderer, "Restore version 1")?.props.onClick?.();
		});
		// Confirm dialog explains the republish semantics.
		expect(textOf(renderer)).toContain(
			"creates a new version with this content",
		);
		await act(async () => {
			buttonByText(renderer, "Restore")?.props.onClick?.();
		});

		expect(restore.mutateAsync).toHaveBeenCalledWith({
			componentId: "comp-hero",
			versionId: "ver-1",
		});
	});

	it("retires the published version after confirming", async () => {
		const retire = mutationStub();
		mocks.useRetireComponent.mockReturnValue(retire);
		const renderer = await render(<ComponentLibrary {...PROPS} />);

		await act(async () => {
			buttonByText(renderer, "Hero")?.props.onClick?.();
		});
		await act(async () => {
			buttonByText(renderer, "Retire")?.props.onClick?.();
		});
		expect(textOf(renderer)).toContain("nothing is live");
		await act(async () => {
			// The dialog's destructive confirm (the second "Retire" button).
			renderer.root
				.findAll(
					(node) =>
						typeof node.type === "string" &&
						node.type === "button" &&
						flattenChildren(node.props.children).includes("Retire"),
				)
				.at(-1)
				?.props.onClick?.();
		});

		expect(retire.mutateAsync).toHaveBeenCalledWith("comp-hero");
	});
});

describe("ComponentLibrary re-pin affordance", () => {
	it("surfaces stale pins with a one-click re-pin", async () => {
		const repin = mutationStub();
		mocks.useRepinBlock.mockReturnValue(repin);
		const renderer = await render(<ComponentLibrary {...PROPS} />);

		const text = textOf(renderer);
		expect(text).toContain("Hero v1 — v2 published");
		expect(text).not.toContain("Re-pin all"); // one stale block → no bulk affordance

		await act(async () => {
			buttonByText(renderer, "Re-pin to v2")?.props.onClick?.();
		});

		expect(repin.mutateAsync).toHaveBeenCalledWith({
			designId: "d1",
			pageId: "page-1",
			blockId: "block-stale",
			componentId: "comp-hero",
		});
	});

	it("offers a bulk re-pin per page when several pins are stale", async () => {
		const repin = mutationStub();
		mocks.useRepinBlock.mockReturnValue(repin);
		const bulkPages: ComponentLibraryPayload = {
			components: library.components,
			pages: [
				{
					id: "page-1",
					path: "/",
					title: "Home",
					status: "published",
					blocks: [
						{
							id: "block-a",
							ordinal: 0,
							kind: "component",
							componentVersionId: "ver-1",
							componentId: "comp-hero",
							componentName: "Hero",
							tagName: "tb-hero",
							version: 1,
							versionStatus: "retired",
						},
						{
							id: "block-b",
							ordinal: 1,
							kind: "component",
							componentVersionId: "ver-1",
							componentId: "comp-hero",
							componentName: "Hero",
							tagName: "tb-hero",
							version: 1,
							versionStatus: "retired",
						},
					],
				},
			],
		};
		mocks.useProjectComponents.mockReturnValue(
			queryStub({ data: bulkPages, isPending: false }),
		);
		const renderer = await render(<ComponentLibrary {...PROPS} />);

		await act(async () => {
			buttonByText(renderer, "Re-pin all (2)")?.props.onClick?.();
		});

		expect(repin.mutateAsync).toHaveBeenCalledTimes(2);
		expect(repin.mutateAsync).toHaveBeenCalledWith({
			designId: "d1",
			pageId: "page-1",
			blockId: "block-a",
			componentId: "comp-hero",
		});
	});

	it("reports an up-to-date state when every pin is current", async () => {
		mocks.useProjectComponents.mockReturnValue(
			queryStub({
				isPending: false,
				data: {
					components: library.components,
					pages: [
						{
							id: "page-1",
							path: "/",
							title: "Home",
							status: "published",
							blocks: [
								{
									id: "block-current",
									ordinal: 0,
									kind: "component",
									componentVersionId: "ver-2",
									componentId: "comp-hero",
									componentName: "Hero",
									tagName: "tb-hero",
									version: 2,
									versionStatus: "published",
								},
							],
						},
					],
				},
			}),
		);
		const renderer = await render(<ComponentLibrary {...PROPS} />);
		expect(textOf(renderer)).toContain(
			"All pinned blocks use the currently published versions.",
		);
	});

	it("mentions in-progress drafts alongside the published target", async () => {
		mocks.useProjectComponents.mockReturnValue(
			queryStub({
				isPending: false,
				data: {
					...library,
					components: [
						{
							...heroComponent,
							draftVersion: 4,
							versions: [
								{
									id: "ver-4",
									version: 4,
									status: "draft",
									changeNote: null,
									createdAt: "2026-11-01T09:00:00.000Z",
									createdTurnId: null,
									hasPngPreview: false,
									demoDocUrl: null,
									pinCount: 0,
								},
								...heroComponent.versions,
							],
						},
						footerComponent,
					],
				},
			}),
		);
		const renderer = await render(<ComponentLibrary {...PROPS} />);
		expect(textOf(renderer)).toContain("v2 published · draft v4 in progress");
	});

	it("renders nothing when the payload is not design-scoped", async () => {
		mocks.useProjectComponents.mockReturnValue(
			queryStub({
				isPending: false,
				data: { components: library.components, pages: null },
			}),
		);
		const renderer = await render(<ComponentLibrary {...PROPS} />);
		expect(textOf(renderer)).not.toContain("Blocks");
		expect(textOf(renderer)).toContain("Hero");
	});
});
