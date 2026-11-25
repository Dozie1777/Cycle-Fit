// Component tests for the KUK-929 selection bridge: the message protocol
// (preview → parent dispatch, parent → preview highlight posts), the
// injected bridge script's contract, and the shared selection state wiring
// between the preview and the inspector's block list. Follows
// component-library.test.tsx: mocked @/queries + inert dialogs
// (react-test-renderer has no DOM).

import { readFileSync } from "node:fs";
import { type ReactElement, type ReactNode, StrictMode } from "react";
import {
	act,
	create,
	type ReactTestInstance,
	type ReactTestRenderer,
} from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentLibrary as ComponentLibraryPayload } from "@/client/api-types";
import { ComponentLibrary } from "./component-library";
import {
	applyPreviewMessage,
	BlockSelectionProvider,
	blockHighlightMessage,
	blockSelectMessage,
	isBlockHighlightMessage,
	isBlockSelectMessage,
	postBlockHighlight,
	SELECTION_BRIDGE,
	useBlockSelection,
} from "./selection-bridge";

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

async function render(node: ReactElement) {
	let captured: ReactTestRenderer | undefined;
	await act(async () => {
		captured = await create(<StrictMode>{node}</StrictMode>);
	});
	if (!captured) throw new Error("test renderer did not mount");
	return captured;
}

// ---------------------------------------------------------------------------
// Fixtures (from component-library.test.tsx — stale pin shows in the list)
// ---------------------------------------------------------------------------

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
					pinCount: 0,
				},
			],
		},
	],
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
			],
		},
	],
};

/** Records every selection state seen, for assertions. */
function makeSelectionProbe(seen: (string | null)[]) {
	return function SelectionProbe() {
		const { selectedBlockId } = useBlockSelection();
		seen.push(selectedBlockId);
		return null;
	};
}

// ---------------------------------------------------------------------------
// Message protocol
// ---------------------------------------------------------------------------

describe("block selection message protocol", () => {
	it("round-trips the select and highlight payloads", () => {
		expect(blockSelectMessage("b1")).toEqual({ __designBlockSelect: "b1" });
		expect(blockSelectMessage(null)).toEqual({ __designBlockSelect: null });
		expect(blockHighlightMessage("b2")).toEqual({
			__designBlockHighlight: "b2",
		});
		expect(isBlockSelectMessage({ __designBlockSelect: "b1" })).toBe(true);
		expect(isBlockSelectMessage({ __designBlockSelect: null })).toBe(true);
		expect(isBlockHighlightMessage({ __designBlockHighlight: "b2" })).toBe(
			true,
		);
	});

	it("rejects malformed and unrelated payloads", () => {
		expect(isBlockSelectMessage(null)).toBe(false);
		expect(isBlockSelectMessage("b1")).toBe(false);
		expect(isBlockSelectMessage({ __designBlockSelect: 7 })).toBe(false);
		expect(isBlockSelectMessage({ __designSelect: "hero" })).toBe(false);
		expect(isBlockHighlightMessage({ __designBlockSelect: "b1" })).toBe(false);
		expect(isBlockHighlightMessage({ __designBlockHighlight: 7 })).toBe(false);
	});

	it("posts highlights into the frame with a wildcard target origin", () => {
		const post = vi.fn();
		postBlockHighlight({ postMessage: post }, "b1");
		expect(post).toHaveBeenCalledWith({ __designBlockHighlight: "b1" }, "*");
		postBlockHighlight({ postMessage: post }, null);
		expect(post).toHaveBeenLastCalledWith(
			{ __designBlockHighlight: null },
			"*",
		);
	});

	it("no-ops when the frame is not mounted", () => {
		expect(() => postBlockHighlight(null, "b1")).not.toThrow();
		expect(() => postBlockHighlight(undefined, null)).not.toThrow();
	});
});

describe("applyPreviewMessage", () => {
	const handlers = { onSection: vi.fn(), onBlock: vi.fn() };

	beforeEach(() => {
		handlers.onSection.mockClear();
		handlers.onBlock.mockClear();
	});

	it("dispatches section selections (legacy data-section bridge)", () => {
		applyPreviewMessage({ __designSelect: "hero" }, handlers);
		applyPreviewMessage({ __designSelect: null }, handlers);
		expect(handlers.onSection).toHaveBeenNthCalledWith(1, "hero");
		expect(handlers.onSection).toHaveBeenNthCalledWith(2, null);
	});

	it("dispatches block selections and deselects", () => {
		applyPreviewMessage({ __designBlockSelect: "b1" }, handlers);
		applyPreviewMessage({ __designBlockSelect: null }, handlers);
		expect(handlers.onBlock).toHaveBeenNthCalledWith(1, "b1");
		expect(handlers.onBlock).toHaveBeenNthCalledWith(2, null);
	});

	it("drops malformed values instead of propagating them", () => {
		applyPreviewMessage({ __designSelect: 7 }, handlers);
		applyPreviewMessage({ __designBlockSelect: 7 }, handlers);
		expect(handlers.onSection).not.toHaveBeenCalled();
		expect(handlers.onBlock).not.toHaveBeenCalled();
	});

	it("ignores unrelated payloads and non-objects", () => {
		expect(() =>
			applyPreviewMessage({ something: "else" }, handlers),
		).not.toThrow();
		expect(() => applyPreviewMessage(null, handlers)).not.toThrow();
		expect(() => applyPreviewMessage("click", handlers)).not.toThrow();
		expect(handlers.onSection).not.toHaveBeenCalled();
		expect(handlers.onBlock).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// Injected bridge script contract
// ---------------------------------------------------------------------------

describe("SELECTION_BRIDGE script", () => {
	it("targets the block marker and both message keys", () => {
		expect(SELECTION_BRIDGE).toContain('closest("[data-block-id]")');
		expect(SELECTION_BRIDGE).toContain("__designBlockSelect");
		expect(SELECTION_BRIDGE).toContain("__designBlockHighlight");
	});

	it("keeps the legacy section contract intact", () => {
		expect(SELECTION_BRIDGE).toContain('closest("[data-section]")');
		// The served-body injection test counts these exactly (workers
		// suite): the section branch's set + clear, and the block branch's
		// deselect of a lingering section selection.
		expect(SELECTION_BRIDGE.match(/__designSelect/g)).toHaveLength(3);
	});

	it("clears the other selection kind's parent state on every selection", () => {
		// Section → block and block → section: each branch must deselect
		// the other kind, or the parent keeps a stale selection that
		// resurfaces on the next frame load. Two occurrences each: the
		// background deselect plus the cross-kind deselect.
		expect(SELECTION_BRIDGE.match(/\{ __designSelect: null \}/g)).toHaveLength(
			2,
		);
		expect(
			SELECTION_BRIDGE.match(/\{ __designBlockSelect: null \}/g),
		).toHaveLength(2);
	});

	it("is a single injectable script with no literal close tag in source", () => {
		expect(SELECTION_BRIDGE.match(/<script>/g)).toHaveLength(1);
		// The closing tag is split in the source (`</scr` + `ipt>`), the
		// convention the previous inline bridge used; the runtime string still
		// ends with a real closing tag so the served HTML stays balanced.
		const source = readFileSync(
			new URL("./selection-bridge.tsx", import.meta.url),
			"utf8",
		);
		expect(source).not.toContain("</scr" + "ipt>");
		expect(SELECTION_BRIDGE.trim().endsWith("</scr" + "ipt>")).toBe(true);
	});

	it("ignores stale ids and its own click echoes", () => {
		// Stale id: element gone → nothing scrolled, nothing thrown.
		expect(SELECTION_BRIDGE).toContain("if (!el) return;");
		// Echo: the click already outlined the block — no re-scroll to center.
		expect(SELECTION_BRIDGE).toContain(
			'blockCurrent.getAttribute("data-block-id") === id) return;',
		);
		// Outline styling is runtime-only inline styling, never persisted.
		expect(SELECTION_BRIDGE).toContain("scrollIntoView(");
	});
});

// ---------------------------------------------------------------------------
// Shared selection state + inspector wiring
// ---------------------------------------------------------------------------

describe("BlockSelectionProvider", () => {
	it("selects, toggles off, and shares the state across consumers", async () => {
		const seen: (string | null)[] = [];
		const Probe = makeSelectionProbe(seen);

		function Host() {
			const { selectedBlockId, selectBlock } = useBlockSelection();
			return (
				<button
					type="button"
					onClick={() => selectBlock(selectedBlockId === "b1" ? null : "b1")}
				>
					toggle
				</button>
			);
		}

		const renderer = await render(
			<BlockSelectionProvider>
				<Host />
				<Probe />
			</BlockSelectionProvider>,
		);
		expect(seen.at(-1)).toBe(null);

		const toggle = buttonByText(renderer, "toggle");
		expect(toggle).toBeDefined();
		await act(async () => {
			toggle?.props.onClick();
		});
		expect(seen.at(-1)).toBe("b1");
		await act(async () => {
			toggle?.props.onClick();
		});
		expect(seen.at(-1)).toBe(null);
	});

	it("falls back to an inert selection outside a provider", async () => {
		const seen: (string | null)[] = [];
		const Probe = makeSelectionProbe(seen);

		function Host() {
			const { selectedBlockId, selectBlock } = useBlockSelection();
			return (
				<button type="button" onClick={() => selectBlock("b1")}>
					{selectedBlockId === null ? "none" : selectedBlockId}
				</button>
			);
		}

		const renderer = await render(
			<>
				<Host />
				<Probe />
			</>,
		);
		expect(seen.at(-1)).toBe(null);
		const toggle = buttonByText(renderer, "none");
		await act(async () => {
			toggle?.props.onClick();
		});
		// The fallback never stores a selection: stale clicks are absorbed.
		expect(seen.at(-1)).toBe(null);
	});
});

describe("ComponentLibrary block rows (selection bridge wiring)", () => {
	beforeEach(() => {
		mocks.useProjectComponents.mockReturnValue(
			queryStub({ data: library, isPending: false }),
		);
		mocks.usePublishComponentVersion.mockReturnValue(queryStub());
		mocks.useRestoreComponentVersion.mockReturnValue(queryStub());
		mocks.useRetireComponent.mockReturnValue(queryStub());
		mocks.useRepinBlock.mockReturnValue(queryStub());
	});

	it("selects a block row and highlights it while selected", async () => {
		const seen: (string | null)[] = [];
		const Probe = makeSelectionProbe(seen);
		const renderer = await render(
			<BlockSelectionProvider>
				<ComponentLibrary projectId="p1" designId="d1" />
				<Probe />
			</BlockSelectionProvider>,
		);
		const row = buttonByText(renderer, "Hero v1");
		expect(row).toBeDefined();

		await act(async () => {
			row?.props.onClick();
		});
		expect(seen.at(-1)).toBe("block-stale");
		const pressed = renderer.root.findAll(
			(node) =>
				typeof node.type === "string" &&
				node.type === "button" &&
				node.props["aria-pressed"] === true,
		);
		expect(pressed).toHaveLength(1);

		await act(async () => {
			row?.props.onClick();
		});
		expect(seen.at(-1)).toBe(null);
		expect(
			renderer.root.findAll(
				(node) =>
					typeof node.type === "string" &&
					node.type === "button" &&
					node.props["aria-pressed"] === true,
			),
		).toHaveLength(0);
	});

	it("absorbs stale selections (block deleted while the preview was open)", async () => {
		const seen: (string | null)[] = [];
		const Probe = makeSelectionProbe(seen);

		function PreviewClick() {
			const { selectBlock } = useBlockSelection();
			return (
				<button type="button" onClick={() => selectBlock("block-gone")}>
					preview click
				</button>
			);
		}

		const renderer = await render(
			<BlockSelectionProvider>
				<ComponentLibrary projectId="p1" designId="d1" />
				<PreviewClick />
				<Probe />
			</BlockSelectionProvider>,
		);
		const click = buttonByText(renderer, "preview click");
		expect(click).toBeDefined();
		await act(async () => {
			click?.props.onClick();
		});
		// The state carries the unknown id without crashing; no row claims it.
		expect(seen.at(-1)).toBe("block-gone");
		expect(
			renderer.root.findAll(
				(node) =>
					typeof node.type === "string" &&
					node.type === "button" &&
					node.props["aria-pressed"] === true,
			),
		).toHaveLength(0);
	});
});
