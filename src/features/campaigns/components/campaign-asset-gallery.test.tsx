import { type ReactElement, type ReactNode, StrictMode } from "react";
import {
	act,
	create,
	type ReactTestInstance,
	type ReactTestRenderer,
} from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	CalendarEventEntry,
	CampaignAssetSummary,
} from "@/client/api-types";
import { CampaignAssetGallery } from "./campaign-asset-gallery";

// ---------------------------------------------------------------------------
// Shared mocks, following campaign-dashboard.test.tsx conventions.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
	useCampaignAssets: vi.fn(),
	useAttachCampaignEventAsset: vi.fn(),
}));

vi.mock("@/client/queries", () => mocks);

vi.mock("@tanstack/react-router", () => ({
	// Router links become inert wrappers in these component tests.
	Link: (props: { children?: ReactNode }) => <span>{props.children}</span>,
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
	const child = children as { props?: { children?: unknown } };
	if ("props" in child) return flattenChildren(child.props?.children);
	return "";
}

function textOf(node: unknown): string {
	if (typeof node !== "object" || node === null) {
		return node === undefined || node === null ? "" : String(node);
	}
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CAMPAIGN_ID = "11111111-1111-1111-1111-111111111111";

const publishedAsset: CampaignAssetSummary = {
	id: "22222222-2222-2222-2222-222222222222",
	prompt: "Launch email hero",
	campaignId: CAMPAIGN_ID,
	projectId: "p1",
	status: "complete",
	createdAt: "2026-10-30T00:00:00.000Z",
	published: true,
};

const draftAsset: CampaignAssetSummary = {
	id: "33333333-3333-3333-3333-333333333333",
	prompt: "X thread draft",
	campaignId: CAMPAIGN_ID,
	projectId: "p1",
	status: "running",
	createdAt: "2026-10-30T01:00:00.000Z",
	published: false,
};

const eventsFixture: CalendarEventEntry[] = [
	{
		id: "event-open",
		campaignId: CAMPAIGN_ID,
		title: "Launch email",
		channel: null,
		channelId: "chan-email",
		linkedChannel: { id: "chan-email", name: "email", color: "#3b82f6" },
		scheduledAt: "2026-11-04T09:00:00.000Z",
		status: "planned",
		assetId: null,
		notes: null,
		createdAt: "2026-10-30T00:00:00.000Z",
		updatedAt: "2026-10-30T00:00:00.000Z",
	},
	{
		id: "event-taken",
		campaignId: CAMPAIGN_ID,
		title: "Teaser",
		// Legacy free-text row: no link yet.
		channel: "X",
		channelId: null,
		linkedChannel: null,
		scheduledAt: "2026-11-02T09:00:00.000Z",
		status: "scheduled",
		assetId: "44444444-4444-4444-4444-444444444444",
		notes: null,
		createdAt: "2026-10-30T00:00:00.000Z",
		updatedAt: "2026-10-30T00:00:00.000Z",
	},
];

beforeEach(() => {
	for (const value of Object.values(mocks)) {
		if (vi.isMockFunction(value)) value.mockReset();
	}
	mocks.useCampaignAssets.mockReturnValue(
		queryStub({
			isPending: false,
			data: [publishedAsset, draftAsset],
		}),
	);
	mocks.useAttachCampaignEventAsset.mockReturnValue(mutationStub());
});

describe("CampaignAssetGallery", () => {
	it("renders a preview card per asset with version/publish state", async () => {
		const renderer = await render(
			<CampaignAssetGallery
				campaignId={CAMPAIGN_ID}
				events={eventsFixture}
				onOpenStudio={() => {}}
			/>,
		);
		const text = textOf(renderer.toJSON());
		expect(text).toContain("Launch email hero");
		expect(text).toContain("X thread draft");
		expect(text).toContain("Published");
		expect(text).toContain("Draft");
		// Preview thumbnail points at the design preview route.
		const images = renderer.root.findAllByType("img");
		expect(images[0]?.props.src).toBe(
			"/designs/22222222-2222-2222-2222-222222222222/preview",
		);
	});

	it("links every asset card into the design studio", async () => {
		const renderer = await render(
			<CampaignAssetGallery
				campaignId={CAMPAIGN_ID}
				events={eventsFixture}
				onOpenStudio={() => {}}
			/>,
		);
		expect(mocks.useCampaignAssets).toHaveBeenCalledWith(CAMPAIGN_ID);
		const studioLinks = renderer.root.findAllByProps({
			"aria-label": "Open Launch email hero in studio",
		});
		expect(studioLinks.length).toBe(1);
	});

	it("attaches an asset to an open calendar slot via the events route", async () => {
		const attach = mutationStub();
		mocks.useAttachCampaignEventAsset.mockReturnValue(attach);
		// Render the published asset alone so exactly one attach row shows.
		mocks.useCampaignAssets.mockReturnValue(
			queryStub({ isPending: false, data: [publishedAsset] }),
		);
		const renderer = await render(
			<CampaignAssetGallery
				campaignId={CAMPAIGN_ID}
				events={eventsFixture}
				onOpenStudio={() => {}}
			/>,
		);
		const select = renderer.root.findAllByProps({
			"aria-label": "Attach Launch email hero to a calendar date",
		})[0];
		await act(async () => {
			select.props.onChange({ target: { value: "event-open" } });
		});
		const attachButtons = byStringType(renderer.root, "button").filter(
			(node) => flattenChildren(node.props.children).trim() === "Attach",
		);
		expect(attachButtons.length).toBe(1);
		await act(async () => {
			await attachButtons[0]?.props.onClick();
		});
		expect(attach.mutateAsync).toHaveBeenCalledWith({
			eventId: "event-open",
			assetId: "22222222-2222-2222-2222-222222222222",
		});
	});

	it("detaches an asset that already owns a slot", async () => {
		const attach = mutationStub();
		mocks.useAttachCampaignEventAsset.mockReturnValue(attach);
		mocks.useCampaignAssets.mockReturnValue(
			queryStub({ isPending: false, data: [publishedAsset] }),
		);
		const attachedEvent: CalendarEventEntry = {
			id: "event-open",
			campaignId: CAMPAIGN_ID,
			title: "Launch email",
			channel: null,
			channelId: "chan-email",
			linkedChannel: { id: "chan-email", name: "email", color: "#3b82f6" },
			scheduledAt: "2026-11-04T09:00:00.000Z",
			status: "planned",
			assetId: publishedAsset.id,
			notes: null,
			createdAt: "2026-10-30T00:00:00.000Z",
			updatedAt: "2026-10-30T00:00:00.000Z",
		};
		const renderer = await render(
			<CampaignAssetGallery
				campaignId={CAMPAIGN_ID}
				events={[attachedEvent]}
				onOpenStudio={() => {}}
			/>,
		);
		const text = textOf(renderer.toJSON());
		expect(text).toContain("Scheduled Nov 4");
		const detach = byStringType(renderer.root, "button").find((node) =>
			flattenChildren(node.props.children).includes("Detach from"),
		);
		await act(async () => {
			await detach?.props.onClick();
		});
		expect(attach.mutateAsync).toHaveBeenCalledWith({
			eventId: "event-open",
			assetId: null,
		});
	});

	it("copies the public site link only for published assets", async () => {
		// The unit environment has no DOM: stub clipboard and location, then
		// restore whatever was there before.
		const originalNavigator = globalThis.navigator;
		const originalLocation = globalThis.location;
		const clipboard = vi.fn(() => Promise.resolve());
		Object.defineProperty(globalThis, "navigator", {
			value: { clipboard: { writeText: clipboard } },
			configurable: true,
		});
		Object.defineProperty(globalThis, "location", {
			value: { origin: "https://bot.test" },
			configurable: true,
		});
		try {
			const renderer = await render(
				<CampaignAssetGallery
					campaignId={CAMPAIGN_ID}
					events={[]}
					onOpenStudio={() => {}}
				/>,
			);
			const draftCopy = byStringType(renderer.root, "button").find(
				(node) =>
					flattenChildren(node.props.children).includes("Copy public link") &&
					node.props.title?.includes("Publish the asset"),
			);
			expect(draftCopy?.props.disabled).toBe(true);

			const copy = byStringType(renderer.root, "button").find(
				(node) =>
					flattenChildren(node.props.children).includes("Copy public link") &&
					node.props.disabled === false,
			);
			await act(async () => {
				await copy?.props.onClick();
			});
			expect(clipboard).toHaveBeenCalledWith(
				"https://bot.test/designs/22222222-2222-2222-2222-222222222222/site",
			);
		} finally {
			Object.defineProperty(globalThis, "navigator", {
				value: originalNavigator,
				configurable: true,
			});
			if (originalLocation === undefined) {
				// @ts-expect-error — restore the node environment (no location).
				delete globalThis.location;
			} else {
				Object.defineProperty(globalThis, "location", {
					value: originalLocation,
					configurable: true,
				});
			}
		}
	});

	it("renders an empty state guiding to the agent", async () => {
		mocks.useCampaignAssets.mockReturnValue(
			queryStub({ isPending: false, data: [] }),
		);
		const renderer = await render(
			<CampaignAssetGallery
				campaignId={CAMPAIGN_ID}
				events={[]}
				onOpenStudio={() => {}}
			/>,
		);
		expect(textOf(renderer.toJSON())).toContain(
			"No assets yet — ask the agent in the studio to create the first",
		);
	});
});
