import { type ReactElement, type ReactNode, StrictMode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { onUiEvent } from "@/client/ui-bus";
import { CommandPalette } from "./command-palette";

const mocks = vi.hoisted(() => ({
	useProjects: vi.fn(),
	useDesigns: vi.fn(),
	useCampaigns: vi.fn(),
	navigate: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/client/queries", () => mocks);

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => mocks.navigate,
}));

// Radix Dialog + cmdk need a DOM; the tests assert wiring, not the
// primitives, so render their children directly instead.
vi.mock("@/components/ui/command", () => ({
	CommandDialog: (props: { children?: ReactNode; open?: boolean }) =>
		props.open ? <div>{props.children}</div> : null,
	CommandInput: (props: { placeholder?: string }) => (
		<input data-placeholder={props.placeholder} />
	),
	CommandList: (props: { children?: ReactNode }) => <div>{props.children}</div>,
	CommandEmpty: (props: { children?: ReactNode }) => <p>{props.children}</p>,
	CommandGroup: (props: { children?: ReactNode; heading?: string }) => (
		<section data-heading={props.heading}>{props.children}</section>
	),
	CommandItem: (props: {
		children?: ReactNode;
		onSelect?: () => void;
		value?: string;
	}) => (
		<button onClick={props.onSelect} type="button">
			{props.children}
		</button>
	),
}));

const projects = [
	{
		id: "p1",
		name: "Aurora site",
		description: null,
		createdAt: "2026-10-31T00:00:00.000Z",
		updatedAt: "2026-10-31T00:00:00.000Z",
		designCount: 2,
		campaignCount: 1,
		hasBrandKit: false,
	},
];

const designs = [
	{
		id: "d1",
		prompt: "A pricing page",
		status: "ready",
		projectId: "p1",
		createdAt: "2026-10-31T00:00:00.000Z",
		updatedAt: "2026-10-31T00:00:00.000Z",
	},
];

const campaigns = [
	{
		id: "c1",
		name: "January push",
		status: "ready",
		projectId: "p1",
		briefPrompt: null,
		eventCount: 0,
		createdAt: "2026-10-31T00:00:00.000Z",
		updatedAt: "2026-10-31T00:00:00.000Z",
	},
];

// Node test env: stub the window surface the palette touches (keydown
// listener + location for ?from= origins).
const keydownListeners: ((event: unknown) => void)[] = [];

beforeEach(() => {
	keydownListeners.length = 0;
	vi.stubGlobal("window", {
		addEventListener: (_type: string, handler: (event: unknown) => void) => {
			keydownListeners.push(handler);
		},
		removeEventListener: (_type: string, handler: (event: unknown) => void) => {
			const index = keydownListeners.indexOf(handler);
			if (index >= 0) keydownListeners.splice(index, 1);
		},
		location: { pathname: "/projects" },
	});
	for (const value of Object.values(mocks)) {
		if (vi.isMockFunction(value)) value.mockReset();
	}
	mocks.navigate.mockImplementation(() => Promise.resolve());
	mocks.useProjects.mockReturnValue({
		data: projects,
		isPending: false,
		error: null,
	});
	mocks.useDesigns.mockReturnValue({
		data: designs,
		isPending: false,
		error: null,
	});
	mocks.useCampaigns.mockReturnValue({
		data: campaigns,
		isPending: false,
		error: null,
	});
});

function textOf(node: unknown): string {
	if (node === undefined || node === null) return "";
	if (typeof node !== "object") return String(node);
	if (Array.isArray(node)) return node.map(textOf).join("");
	const inner = node as { children?: unknown };
	return inner.children ? textOf(inner.children) : "";
}

async function render(node: ReactElement) {
	let captured: ReactTestRenderer | undefined;
	await act(async () => {
		captured = await create(<StrictMode>{node}</StrictMode>);
	});
	if (!captured) throw new Error("test renderer did not mount");
	return captured;
}

/** Flush pending React work after an out-of-band event. */
async function flush() {
	await act(async () => {
		await Promise.resolve();
	});
}

async function openWithK(renderer: ReactTestRenderer) {
	for (const handler of [...keydownListeners]) {
		handler({
			key: "k",
			metaKey: true,
			ctrlKey: false,
			preventDefault: () => {},
		});
	}
	await flush();
	return renderer;
}

/** Extract text from a tree of raw React *elements* (children live in props). */
function elementText(node: unknown): string {
	if (node === undefined || node === null || typeof node === "boolean") {
		return "";
	}
	if (typeof node === "string" || typeof node === "number") {
		return String(node);
	}
	if (Array.isArray(node)) return node.map(elementText).join("");
	const el = node as { props?: { children?: unknown } };
	return el.props ? elementText(el.props.children) : "";
}

function buttonsByLabel(
	renderer: ReactTestRenderer,
	text: string,
): { props: { onClick?: () => void } }[] {
	return renderer.root
		.findAll(
			(node) =>
				node.type === "button" &&
				elementText(node.props?.children).includes(text),
		)
		.map((node) => node as { props: { onClick?: () => void } });
}

describe("CommandPalette", () => {
	it("renders nothing until ⌘K opens it", async () => {
		const renderer = await render(<CommandPalette />);
		expect(textOf(renderer.toJSON())).not.toContain("Aurora site");
		await openWithK(renderer);
		const text = textOf(renderer.toJSON());
		expect(text).toContain("Aurora site");
		expect(text).toContain("A pricing page");
		expect(text).toContain("January push");
		expect(text).toContain("New project");
	});

	it("navigates to a project row and closes", async () => {
		const renderer = await render(<CommandPalette />);
		await openWithK(renderer);
		const all = renderer.root.findAll((n) => n.type === "button");
		for (const b of all) {
			const kids = (b.props as { children?: unknown[] })?.children;
			const isArr = Array.isArray(kids);
			const second = isArr ? kids?.[1] : undefined;
			console.log(
				"PROBE2: isArray:",
				isArr,
				"len:",
				Array.isArray(kids) ? kids?.length : "n/a",
				"secondText:",
				JSON.stringify(second ? textOf(second) : "n/a"),
				"wholeText:",
				JSON.stringify(textOf(kids)).slice(0, 40),
			);
		}
		const row = buttonsByLabel(renderer, "Aurora site")[0];
		expect(row).toBeDefined();
		await act(async () => {
			row?.props.onClick?.();
			await flush();
		});
		expect(mocks.navigate).toHaveBeenCalledWith({
			href: "/projects/p1",
		});
	});

	it("navigates to a design with the ?from= origin (KUK-903)", async () => {
		const renderer = await render(<CommandPalette />);
		await openWithK(renderer);
		const row = buttonsByLabel(renderer, "A pricing page")[0];
		expect(row).toBeDefined();
		await act(async () => {
			row?.props.onClick?.();
			await flush();
		});
		expect(mocks.navigate).toHaveBeenCalledWith({
			href: `/studio/d1?from=${encodeURIComponent("/projects")}`,
		});
	});

	it("New project action navigates to the list and fires the UI event", async () => {
		const renderer = await render(<CommandPalette />);
		const events: string[] = [];
		onUiEvent("new-project", () => events.push("new-project"));
		await openWithK(renderer);
		const row = buttonsByLabel(renderer, "New project")[0];
		expect(row).toBeDefined();
		await act(async () => {
			row?.props.onClick?.();
			await flush();
		});
		expect(mocks.navigate).toHaveBeenCalledWith({
			href: "/projects",
		});
		expect(events).toEqual(["new-project"]);
	});
});
