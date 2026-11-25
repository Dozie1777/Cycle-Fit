import { type ReactElement, StrictMode } from "react";
import {
	act,
	create,
	type ReactTestInstance,
	type ReactTestRenderer,
} from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	CalendarEventEntry,
	CampaignAssetSummary,
} from "@/client/api-types";
import {
	CampaignPresentRunner,
	keyStep,
	orderPresentAssets,
} from "./campaign-present-runner";

// ---------------------------------------------------------------------------
// Helpers (react-test-renderer, following campaign-dashboard.test.tsx)
// ---------------------------------------------------------------------------

function byStringType(
	instance: ReactTestInstance,
	type: string,
): ReactTestInstance[] {
	return (
		instance.findAllByType as unknown as (
			queryType: string,
		) => ReactTestInstance[]
	)(type);
}

function flattenChildren(children: unknown): string {
	if (typeof children !== "object" || children === null) {
		return children === undefined || children === null ? "" : String(children);
	}
	if (Array.isArray(children)) {
		return children.map(flattenChildren).join(" ");
	}
	// React elements carry text under props.children; react-test-renderer
	// toJSON() nodes carry it under a sibling children key instead.
	const node = children as {
		props?: { children?: unknown };
		children?: unknown;
	};
	if (node.props && node.props.children !== undefined) {
		return flattenChildren(node.props.children);
	}
	if (node.children !== undefined) return flattenChildren(node.children);
	return "";
}

function buttonByText(
	renderer: ReactTestRenderer,
	text: string,
): ReactTestInstance | undefined {
	return byStringType(renderer.root, "button").find((node) =>
		flattenChildren(node.props.children).includes(text),
	);
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

function asset(id: string, prompt: string, published = true) {
	return {
		id,
		prompt,
		campaignId: "c-1",
		projectId: "p-1",
		status: "completed",
		createdAt: "2026-10-30T00:00:00.000Z",
		published,
	} satisfies CampaignAssetSummary;
}

function event(id: string, assetId: string | null, scheduledAt: string | null) {
	return {
		id,
		campaignId: "c-1",
		title: `Event ${id}`,
		channel: null,
		channelId: null,
		linkedChannel: null,
		scheduledAt,
		status: "scheduled",
		assetId,
		notes: null,
		createdAt: "2026-10-30T00:00:00.000Z",
		updatedAt: "2026-10-30T00:00:00.000Z",
	} satisfies CalendarEventEntry;
}

const deck = asset("deck-1", "Create the campaign asset: launch deck.");
const landing = asset("landing-1", "Create the campaign asset: landing page.");
const draft = asset("draft-1", "Create the campaign asset: one-pager.", false);

// ---------------------------------------------------------------------------
// orderPresentAssets — the chain order
// ---------------------------------------------------------------------------

describe("orderPresentAssets", () => {
	it("keeps only published assets in list order without attachments", () => {
		const chain = orderPresentAssets([landing, deck, draft], []);
		expect(chain.map((a) => a.id)).toEqual(["landing-1", "deck-1"]);
	});

	it("leads with event-attached assets in scheduledAt order", () => {
		const events = [
			event("e2", "deck-1", "2026-11-05T09:00:00.000Z"),
			event("e1", "landing-1", "2026-11-01T09:00:00.000Z"),
		];
		const chain = orderPresentAssets([deck, landing], events);
		expect(chain.map((a) => a.id)).toEqual(["landing-1", "deck-1"]);
	});

	it("puts unscheduled attachments after scheduled ones", () => {
		const events = [
			event("e1", "deck-1", null),
			event("e2", "landing-1", "2026-11-01T09:00:00.000Z"),
		];
		const chain = orderPresentAssets([deck, landing], events);
		expect(chain.map((a) => a.id)).toEqual(["landing-1", "deck-1"]);
	});

	it("appends unattached published assets after attached ones", () => {
		const extra = asset("extra-1", "Create the campaign asset: post.");
		const events = [event("e1", "deck-1", "2026-11-05T09:00:00.000Z")];
		const chain = orderPresentAssets([extra, deck, landing], events);
		expect(chain.map((a) => a.id)).toEqual(["deck-1", "extra-1", "landing-1"]);
	});

	it("ignores events whose asset is not published", () => {
		const events = [event("e1", "draft-1", "2026-11-05T09:00:00.000Z")];
		const chain = orderPresentAssets([deck, draft], events);
		expect(chain.map((a) => a.id)).toEqual(["deck-1"]);
	});
});

// ---------------------------------------------------------------------------
// keyStep — the keyboard map
// ---------------------------------------------------------------------------

describe("keyStep", () => {
	it("maps forward keys", () => {
		for (const key of ["ArrowRight", "ArrowDown", "PageDown", " "]) {
			expect(keyStep(key)).toBe("next");
		}
	});

	it("maps backward keys", () => {
		for (const key of ["ArrowLeft", "ArrowUp", "PageUp"]) {
			expect(keyStep(key)).toBe("prev");
		}
	});

	it("maps jump and exit keys", () => {
		expect(keyStep("Home")).toBe("first");
		expect(keyStep("End")).toBe("last");
		expect(keyStep("Escape")).toBe("exit");
	});

	it("ignores other keys", () => {
		expect(keyStep("a")).toBeNull();
		expect(keyStep("Shift")).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// CampaignPresentRunner — rendering + navigation
// ---------------------------------------------------------------------------

// The runner attaches its keydown listener to window; node-env tests get a
// stub so keyboard navigation is exercised without a DOM. Re-stubbed per
// test because afterEach unstubbing must not leak between cases.
const keydownListeners = new Map<string, (e: unknown) => void>();

beforeEach(() => {
	keydownListeners.clear();
	vi.stubGlobal("window", {
		addEventListener: (type: string, fn: (e: unknown) => void) => {
			keydownListeners.set(type, fn);
		},
		removeEventListener: (type: string) => {
			keydownListeners.delete(type);
		},
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
});

function keydown(key: string): void {
	const listener = keydownListeners.get("keydown");
	expect(listener).toBeDefined();
	listener?.({ key, preventDefault: () => {} });
}

function iframeSrc(renderer: ReactTestRenderer): string | undefined {
	return byStringType(renderer.root, "iframe")[0]?.props.src as
		| string
		| undefined;
}

describe("CampaignPresentRunner", () => {
	it("renders the first published asset full-screen in a sandboxed iframe", async () => {
		const onExit = vi.fn();
		const renderer = await render(
			<CampaignPresentRunner
				assets={[deck, landing, draft]}
				events={[]}
				onExit={onExit}
			/>,
		);
		const iframe = byStringType(renderer.root, "iframe")[0];
		expect(iframe.props.src).toBe("/designs/deck-1/site");
		expect(iframe.props.sandbox).toBe("allow-scripts allow-forms allow-popups");
		expect(flattenChildren(iframe.props.title)).toContain("launch deck");
		// Drafts are excluded from the chain.
		expect(iframeSrc(renderer)).not.toContain("draft-1");
	});

	it("shows the chain position and asset names in the bottom bar", async () => {
		const renderer = await render(
			<CampaignPresentRunner
				assets={[deck, landing]}
				events={[]}
				onExit={() => {}}
			/>,
		);
		const text = flattenChildren(
			byStringType(renderer.root, "nav")[0].props.children,
		).replace(/\s+/g, " ");
		expect(text).toContain("1 / 2");
		expect(text).toContain("launch deck");
		expect(text).toContain("landing page");
	});

	it("advances and goes back via the bar buttons, clamping at the ends", async () => {
		const renderer = await render(
			<CampaignPresentRunner
				assets={[deck, landing]}
				events={[]}
				onExit={() => {}}
			/>,
		);
		expect(buttonByText(renderer, "Prev")?.props.disabled).toBe(true);
		await act(async () => {
			await buttonByText(renderer, "Next")?.props.onClick();
		});
		expect(iframeSrc(renderer)).toBe("/designs/landing-1/site");
		expect(buttonByText(renderer, "Next")?.props.disabled).toBe(true);
		await act(async () => {
			await buttonByText(renderer, "Prev")?.props.onClick();
		});
		expect(iframeSrc(renderer)).toBe("/designs/deck-1/site");
	});

	it("switches assets via the bar switcher", async () => {
		const renderer = await render(
			<CampaignPresentRunner
				assets={[deck, landing]}
				events={[]}
				onExit={() => {}}
			/>,
		);
		const switcher = byStringType(renderer.root, "button").find((node) =>
			flattenChildren(node.props.children).includes("landing page"),
		);
		await act(async () => {
			await switcher?.props.onClick();
		});
		expect(iframeSrc(renderer)).toBe("/designs/landing-1/site");
	});

	it("navigates assets with the keyboard and exits on Escape", async () => {
		const onExit = vi.fn();
		const renderer = await render(
			<CampaignPresentRunner
				assets={[deck, landing]}
				events={[]}
				onExit={onExit}
			/>,
		);
		await act(async () => {
			keydown("ArrowRight");
		});
		expect(iframeSrc(renderer)).toBe("/designs/landing-1/site");
		await act(async () => {
			keydown(" "); // space at the last asset clamps — stays put
		});
		expect(iframeSrc(renderer)).toBe("/designs/landing-1/site");
		await act(async () => {
			keydown("ArrowLeft");
		});
		expect(iframeSrc(renderer)).toBe("/designs/deck-1/site");
		await act(async () => {
			keydown("Escape");
		});
		expect(onExit).toHaveBeenCalledTimes(1);
	});

	it("jumps to first/last with Home/End", async () => {
		const renderer = await render(
			<CampaignPresentRunner
				assets={[deck, landing, asset("extra-1", "post")]}
				events={[]}
				onExit={() => {}}
			/>,
		);
		await act(async () => {
			keydown("End");
		});
		expect(iframeSrc(renderer)).toBe("/designs/extra-1/site");
		await act(async () => {
			keydown("Home");
		});
		expect(iframeSrc(renderer)).toBe("/designs/deck-1/site");
	});

	it("shows an empty state with an exit path when nothing is published", async () => {
		const onExit = vi.fn();
		const renderer = await render(
			<CampaignPresentRunner assets={[draft]} events={[]} onExit={onExit} />,
		);
		const text = flattenChildren(renderer.toJSON());
		expect(text).toContain("Nothing to present yet");
		await act(async () => {
			await buttonByText(renderer, "Back to dashboard")?.props.onClick();
		});
		expect(onExit).toHaveBeenCalledTimes(1);
	});
});
