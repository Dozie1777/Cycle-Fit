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
	CampaignBrief,
	CampaignDetail,
	CampaignPlanDetail,
} from "@/client/api-types";
import {
	CampaignCalendarStrip,
	upcomingStrip,
} from "./campaign-calendar-strip";
import { CampaignDashboard } from "./campaign-dashboard";
import { CampaignOverviewStrip } from "./campaign-overview-strip";
import { CampaignPlanTimeline } from "./campaign-plan-timeline";

// ---------------------------------------------------------------------------
// Shared mocks: queries + router, following campaign-studio.test.tsx.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
	useProject: vi.fn(),
	useUpdateCampaign: vi.fn(),
	useGenerateCampaignShare: vi.fn(),
	useRotateCampaignShare: vi.fn(),
	useRevokeCampaignShare: vi.fn(),
	useCampaignAssets: vi.fn(),
	useCampaignMessages: vi.fn(),
	useUpdateCampaignEvent: vi.fn(),
	useUpdateCampaignPhase: vi.fn(),
	useAttachCampaignEventAsset: vi.fn(),
	// Channel enumeration (KUK-890) — calendar/brief selects pick from it.
	useChannels: vi.fn(),
	useCreateChannel: vi.fn(),
	useUpdateChannel: vi.fn(),
	// Campaign KPIs (KUK-896).
	useCampaignKpis: vi.fn(),
	useCreateCampaignKpi: vi.fn(),
	useUpdateCampaignKpi: vi.fn(),
	useDeleteCampaignKpi: vi.fn(),
	useCampaignKpiResults: vi.fn(),
	useCreateCampaignKpiResult: vi.fn(),
	useUpdateCampaignKpiResult: vi.fn(),
	useDeleteCampaignKpiResult: vi.fn(),
}));

vi.mock("@/client/queries", () => mocks);

vi.mock("@tanstack/react-router", () => ({
	// Router links become inert anchors that keep their target visible to
	// findAllByProps in these component tests.
	Link: (props: { children?: ReactNode; to?: string }) => (
		<a href={props.to}>{props.children}</a>
	),
}));

// Base UI Select needs a DOM; the strip's channel picker asserts wiring via
// native inputs instead.
vi.mock("@/components/ui/select", () => ({
	Select: (props: { children?: ReactNode }) => <div>{props.children}</div>,
	SelectTrigger: (props: { children?: ReactNode }) => (
		<div>{props.children}</div>
	),
	SelectValue: () => null,
	SelectContent: (props: { children?: ReactNode }) => (
		<div>{props.children}</div>
	),
	SelectItem: (props: { value: string; children?: ReactNode }) => (
		<div data-select-item={props.value}>{props.children}</div>
	),
}));

// The manage-channels dialog is inert in these tests (Radix needs a DOM);
// its inputs would otherwise shift the strip form's input indexes.
vi.mock("./manage-channels-dialog", () => ({
	ManageChannelsDialog: (props: { open: boolean }) =>
		props.open ? <div data-manage-dialog="open" /> : null,
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
// Render helpers (from campaign-studio.test.tsx)
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

function inputEvent(value: string) {
	return { target: { value }, currentTarget: { value }, nativeEvent: {} };
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
// Fixtures — calendar dates are relative to "now" so the upcoming strip
// window is stable no matter when the suite runs.
// ---------------------------------------------------------------------------

const CAMPAIGN_ID = "11111111-1111-1111-1111-111111111111";

function futureIso(daysAhead: number, hour = 9): string {
	const date = new Date();
	date.setUTCHours(hour, 0, 0, 0);
	date.setUTCDate(date.getUTCDate() + daysAhead);
	return date.toISOString();
}

const briefFixture: CampaignBrief = {
	id: "brief-1",
	campaignId: CAMPAIGN_ID,
	objective: "Win January",
	audience: "Design engineers",
	keyMessage: "Ship faster",
	tone: "plain-spoken",
	channels: "email, X",
	budget: "$15k",
	kpis: "- 100 signups\n- 40 demo requests",
	body: null,
	createdAt: "2026-10-30T00:00:00.000Z",
	updatedAt: "2026-10-30T03:00:00.000Z",
};

const plansFixture: CampaignPlanDetail[] = [
	{
		id: "plan-1",
		campaignId: CAMPAIGN_ID,
		name: "Q1 launch plan",
		status: "draft",
		createdAt: "2026-10-30T00:00:00.000Z",
		updatedAt: "2026-10-30T02:00:00.000Z",
		phases: [
			{
				id: "phase-0",
				planId: "plan-1",
				name: "Teaser week",
				objective: "Warm the list",
				startsAt: "2026-03-01T00:00:00.000Z",
				endsAt: null,
				position: 0,
				body: null,
			},
			{
				id: "phase-1",
				planId: "plan-1",
				name: "Launch week",
				objective: "Convert",
				startsAt: "2026-03-08T00:00:00.000Z",
				endsAt: null,
				position: 1,
				body: null,
			},
		],
	},
];

const eventsFixture: CalendarEventEntry[] = [
	{
		id: "event-email",
		campaignId: CAMPAIGN_ID,
		title: "Launch email",
		channel: null,
		channelId: "chan-email",
		linkedChannel: { id: "chan-email", name: "email", color: "#3b82f6" },
		scheduledAt: futureIso(2),
		status: "scheduled",
		assetId: null,
		notes: null,
		createdAt: "2026-10-30T00:00:00.000Z",
		updatedAt: "2026-10-30T04:00:00.000Z",
	},
	{
		id: "event-x",
		campaignId: CAMPAIGN_ID,
		title: "X thread",
		channel: null,
		channelId: "chan-x",
		linkedChannel: { id: "chan-x", name: "X", color: null },
		scheduledAt: futureIso(4),
		status: "planned",
		assetId: null,
		notes: null,
		createdAt: "2026-10-30T00:00:00.000Z",
		updatedAt: "2026-10-30T04:00:00.000Z",
	},
	{
		id: "event-old",
		campaignId: CAMPAIGN_ID,
		title: "Teaser post",
		// Legacy free-text row: no link, gray fallback in the UI.
		channel: "X",
		channelId: null,
		linkedChannel: null,
		scheduledAt: futureIso(-5),
		status: "published",
		assetId: null,
		notes: null,
		createdAt: "2026-10-30T00:00:00.000Z",
		updatedAt: "2026-10-30T01:00:00.000Z",
	},
];

const detailFixture: CampaignDetail = {
	id: CAMPAIGN_ID,
	name: "Back-to-school push",
	briefPrompt: "Drive January enrollments",
	status: "ready",
	error: null,
	projectId: "p1",
	shareSlug: null,
	shareRevokedAt: null,
	shareIncludeReports: false,
	targetEndDate: null,
	createdAt: "2026-10-30T00:00:00.000Z",
	updatedAt: "2026-10-30T05:00:00.000Z",
	brief: briefFixture,
	plans: plansFixture,
	events: eventsFixture,
	channelIds: ["chan-email", "chan-x"],
	kpis: [],
	audiences: [],
	reports: [
		{
			id: "report-1",
			title: "Week 1 performance",
			periodStart: "2026-03-02T00:00:00.000Z",
			periodEnd: "2026-03-08T00:00:00.000Z",
			createdAt: "2026-03-09T00:00:00.000Z",
		},
	],
};

const kpiFixture: CampaignDetail["kpis"][number] = {
	id: "kpi-1",
	campaignId: CAMPAIGN_ID,
	name: "Newsletter signups",
	kind: "number",
	targetNumber: 100,
	targetBoolean: null,
	targetText: null,
	unit: "signups",
	color: "#3b82f6",
	sortOrder: 0,
	createdAt: "2026-10-30T00:00:00.000Z",
	updatedAt: "2026-10-30T00:00:00.000Z",
	results: [
		{
			id: "result-1",
			kpiId: "kpi-1",
			actualNumber: 120,
			actualBoolean: null,
			actualText: null,
			status: "exceeded",
			reportId: null,
			recordedAt: "2026-03-09T00:00:00.000Z",
			createdAt: "2026-03-09T00:00:00.000Z",
			updatedAt: "2026-03-09T00:00:00.000Z",
			report: null,
		},
	],
};

const emptyDetail: CampaignDetail = {
	...detailFixture,
	brief: null,
	plans: [],
	events: [],
	channelIds: [],
	audiences: [],
	reports: [],
};

beforeEach(() => {
	for (const value of Object.values(mocks)) {
		if (vi.isMockFunction(value)) value.mockReset();
	}
	mocks.useProject.mockReturnValue(
		queryStub({
			isPending: false,
			data: { id: "p1", name: "Growth 2026" },
		}),
	);
	mocks.useUpdateCampaign.mockReturnValue(mutationStub());
	mocks.useGenerateCampaignShare.mockReturnValue(mutationStub());
	mocks.useRotateCampaignShare.mockReturnValue(mutationStub());
	mocks.useRevokeCampaignShare.mockReturnValue(mutationStub());
	mocks.useUpdateCampaignEvent.mockReturnValue(mutationStub());
	mocks.useUpdateCampaignPhase.mockReturnValue(mutationStub());
	mocks.useAttachCampaignEventAsset.mockReturnValue(mutationStub());
	// Channel enumeration: a fixed small list for the strip's picker.
	mocks.useChannels.mockReturnValue({
		data: [
			{ id: "chan-email", name: "email", color: "#3b82f6", createdAt: "" },
			{ id: "chan-x", name: "X", color: null, createdAt: "" },
		],
		isPending: false,
	});
	mocks.useCreateChannel.mockReturnValue(mutationStub());
	mocks.useUpdateChannel.mockReturnValue(mutationStub());
	mocks.useCampaignKpis.mockReturnValue(
		queryStub({ isPending: false, data: [] }),
	);
	mocks.useCreateCampaignKpi.mockReturnValue(mutationStub());
	mocks.useUpdateCampaignKpi.mockReturnValue(mutationStub());
	mocks.useDeleteCampaignKpi.mockReturnValue(mutationStub());
	mocks.useCampaignKpiResults.mockReturnValue(
		queryStub({ isPending: false, data: [] }),
	);
	mocks.useCreateCampaignKpiResult.mockReturnValue(mutationStub());
	mocks.useUpdateCampaignKpiResult.mockReturnValue(mutationStub());
	mocks.useDeleteCampaignKpiResult.mockReturnValue(mutationStub());
	mocks.useCampaignAssets.mockReturnValue(
		queryStub({ isPending: false, data: [] }),
	);
	mocks.useCampaignMessages.mockReturnValue(
		queryStub({
			isPending: false,
			data: [
				{
					id: "m1",
					role: "assistant",
					content: "Drafted the brief and planned two phases.",
					createdAt: "2026-10-30T03:30:00.000Z",
				},
			],
		}),
	);
});

// ---------------------------------------------------------------------------
// Overview strip
// ---------------------------------------------------------------------------

describe("CampaignOverviewStrip", () => {
	it("renders the KPI scorecard plus the latest report", async () => {
		const renderer = await render(
			<CampaignOverviewStrip
				detail={{ ...detailFixture, kpis: [kpiFixture] }}
				onOpenStudio={() => {}}
			/>,
		);
		const text = textOf(renderer.toJSON());
		expect(text).toContain("Newsletter signups");
		expect(text).toContain("Target: 100 signups");
		expect(text).toContain("120 signups");
		expect(text).toContain("Exceeded");
		expect(text).toContain("Week 1 performance");
		expect(text).toContain("2026-03-02 – 2026-03-08");
	});

	it("guides to the studio when nothing has been written yet", async () => {
		const renderer = await render(
			<CampaignOverviewStrip detail={emptyDetail} onOpenStudio={() => {}} />,
		);
		expect(textOf(renderer.toJSON())).toContain(
			"No KPIs or reports yet — define KPI targets in the brief",
		);
	});
});

// ---------------------------------------------------------------------------
// Plan timeline
// ---------------------------------------------------------------------------

describe("CampaignPlanTimeline", () => {
	it("renders the phases in position order as an expandable bar", async () => {
		const renderer = await render(
			<CampaignPlanTimeline detail={detailFixture} onOpenStudio={() => {}} />,
		);
		const text = textOf(renderer.toJSON());
		expect(text.indexOf("Teaser week")).toBeLessThan(
			text.indexOf("Launch week"),
		);
		expect(text).toContain("Q1 launch plan");

		const chip = renderer.root.findAllByProps({ "aria-expanded": false })[0];
		await act(async () => {
			chip.props.onClick();
		});
		expect(textOf(renderer.toJSON())).toContain("Warm the list");
	});

	it("reorders a phase by patching its position", async () => {
		const updatePhase = mutationStub();
		mocks.useUpdateCampaignPhase.mockReturnValue(updatePhase);
		const renderer = await render(
			<CampaignPlanTimeline detail={detailFixture} onOpenStudio={() => {}} />,
		);
		const chip = renderer.root.findAllByProps({ "aria-expanded": false })[0];
		await act(async () => {
			chip.props.onClick();
		});
		const moveUp = renderer.root.findAllByProps({
			"aria-label": "Move Teaser week up",
		})[0];
		expect(moveUp.props.disabled).toBe(true); // already first
		const moveDown = renderer.root.findAllByProps({
			"aria-label": "Move Teaser week down",
		})[0];
		await act(async () => {
			await moveDown.props.onClick();
		});
		expect(updatePhase.mutateAsync).toHaveBeenCalledWith({
			phaseId: "phase-0",
			position: 1,
		});
	});

	it("guides to the studio when there is no plan", async () => {
		const renderer = await render(
			<CampaignPlanTimeline detail={emptyDetail} onOpenStudio={() => {}} />,
		);
		expect(textOf(renderer.toJSON())).toContain(
			"No plan yet — ask the agent in the studio to break the campaign into",
		);
	});
});

// ---------------------------------------------------------------------------
// Calendar strip
// ---------------------------------------------------------------------------

describe("upcomingStrip", () => {
	it("buckets upcoming events into channel lanes and counts the rest", () => {
		const strip = upcomingStrip(eventsFixture);
		expect(strip.lanes.map((lane) => lane.channel)).toEqual(["email", "X"]);
		expect(strip.lanes[0]?.events.map((event) => event.id)).toEqual([
			"event-email",
		]);
		expect(strip.lanes[1]?.events.map((event) => event.id)).toEqual([
			"event-x",
		]);
		expect(strip.earlierCount).toBe(1);
		expect(strip.laterCount).toBe(0);
	});
});

describe("CampaignCalendarStrip", () => {
	it("renders channel swimlanes for the upcoming window only", async () => {
		const renderer = await render(
			<CampaignCalendarStrip
				campaignId={CAMPAIGN_ID}
				events={eventsFixture}
				onOpenStudio={() => {}}
			/>,
		);
		const text = textOf(renderer.toJSON());
		expect(text).toContain("email");
		expect(text).toContain("Launch email");
		expect(text).toContain("X thread");
		// Past events stay out of the strip but are summarised.
		expect(text).toContain("1 earlier");
		expect(text).not.toContain("Teaser post");
	});

	it("quick-edits title, date and status in place", async () => {
		const updateEvent = mutationStub();
		mocks.useUpdateCampaignEvent.mockReturnValue(updateEvent);
		const renderer = await render(
			<CampaignCalendarStrip
				campaignId={CAMPAIGN_ID}
				events={[eventsFixture[0] as CalendarEventEntry]}
				onOpenStudio={() => {}}
			/>,
		);
		const slot = renderer.root.findAllByProps({
			title: "Click to quick-edit",
		})[0];
		await act(async () => {
			slot.props.onClick();
		});
		const inputs = byStringType(renderer.root, "input");
		await act(async () => {
			inputs[0].props.onChange(inputEvent("Launch email v2"));
			// The channel picker is a select now — the native inputs are
			// title and date only; the channel link stays untouched.
			inputs[1].props.onChange(inputEvent("2026-03-05"));
		});
		const status = renderer.root.findAllByProps({
			id: `strip-status-event-email`,
		})[0];
		await act(async () => {
			status.props.onChange(inputEvent("published"));
		});
		const form = byStringType(renderer.root, "form")[0];
		await act(async () => {
			form.props.onSubmit({ preventDefault: () => {} });
		});
		expect(updateEvent.mutateAsync).toHaveBeenCalledWith({
			eventId: "event-email",
			title: "Launch email v2",
			// The link is untouched by the title/date/status edits — the
			// picker is a select now, so its value re-saves as-is.
			channelId: "chan-email",
			scheduledAt: "2026-03-05",
			status: "published",
		});
	});

	it("guides to the studio calendar when nothing is scheduled ahead", async () => {
		const renderer = await render(
			<CampaignCalendarStrip
				campaignId={CAMPAIGN_ID}
				events={[eventsFixture[2] as CalendarEventEntry]}
				onOpenStudio={() => {}}
			/>,
		);
		expect(textOf(renderer.toJSON())).toContain(
			"Nothing scheduled in the next three weeks",
		);
	});
});

// ---------------------------------------------------------------------------
// Activity feed (rendered inside the dashboard)
// ---------------------------------------------------------------------------

describe("CampaignDashboard", () => {
	it("renders every zone from live data", async () => {
		const renderer = await render(
			<CampaignDashboard
				detail={detailFixture}
				onOpenStudio={() => {}}
				onClose={() => {}}
			/>,
		);
		const text = textOf(renderer.toJSON());
		expect(text).toContain("Overview");
		expect(text).toContain("Plan");
		expect(text).toContain("Next 3 weeks");
		expect(text).toContain("Assets");
		expect(text).toContain("Activity");
		// Breadcrumb to the parent project.
		expect(text).toContain("Growth 2026");
		// Activity feed merges the chat transcript with document writes.
		expect(text).toContain("Drafted the brief and planned two phases.");
		expect(text).toContain("Brief");
	});

	it("renames the campaign inline through PATCH", async () => {
		const updateCampaign = mutationStub();
		mocks.useUpdateCampaign.mockReturnValue(updateCampaign);
		const renderer = await render(
			<CampaignDashboard
				detail={detailFixture}
				onOpenStudio={() => {}}
				onClose={() => {}}
			/>,
		);
		await act(async () => {
			await buttonByText(renderer, "Rename")?.props.onClick();
		});
		const input = renderer.root.findAllByProps({
			"aria-label": "Campaign name",
		})[0];
		await act(async () => {
			input.props.onChange(inputEvent("January launch"));
		});
		const form = byStringType(renderer.root, "form")[0];
		await act(async () => {
			form.props.onSubmit({ preventDefault: () => {} });
		});
		expect(updateCampaign.mutateAsync).toHaveBeenCalledWith({
			campaignId: CAMPAIGN_ID,
			name: "January launch",
		});
	});

	it("generates a share link from the share menu when unshared", async () => {
		const generate = mutationStub();
		mocks.useGenerateCampaignShare.mockReturnValue(generate);
		const renderer = await render(
			<CampaignDashboard
				detail={detailFixture}
				onOpenStudio={() => {}}
				onClose={() => {}}
			/>,
		);
		await act(async () => {
			await buttonByText(renderer, "Share")?.props.onClick();
		});
		expect(textOf(renderer.toJSON())).toContain(
			"Not shared — generate a link to let people follow along.",
		);
		await act(async () => {
			await buttonByText(renderer, "Generate share link")?.props.onClick();
		});
		expect(generate.mutateAsync).toHaveBeenCalledTimes(1);
	});

	it("drives rotate and revoke from the share menu when shared", async () => {
		const rotate = mutationStub();
		const revoke = mutationStub();
		mocks.useRotateCampaignShare.mockReturnValue(rotate);
		mocks.useRevokeCampaignShare.mockReturnValue(revoke);
		const renderer = await render(
			<CampaignDashboard
				detail={{ ...detailFixture, shareSlug: "abc12345" }}
				onOpenStudio={() => {}}
				onClose={() => {}}
			/>,
		);
		await act(async () => {
			await buttonByText(renderer, "Share")?.props.onClick();
		});
		expect(textOf(renderer.toJSON())).toContain(
			"Shared — anyone with the link can view this campaign.",
		);
		await act(async () => {
			await buttonByText(renderer, "Rotate link")?.props.onClick();
		});
		expect(rotate.mutateAsync).toHaveBeenCalledTimes(1);
		await act(async () => {
			await buttonByText(renderer, "Share")?.props.onClick();
		});
		await act(async () => {
			await buttonByText(renderer, "Revoke sharing")?.props.onClick();
		});
		expect(revoke.mutateAsync).toHaveBeenCalledTimes(1);
	});

	it("shows the revoked state and links Present to the runner route", async () => {
		const renderer = await render(
			<CampaignDashboard
				detail={{
					...detailFixture,
					shareSlug: null,
					shareRevokedAt: "2026-10-29T10:00:00.000Z",
				}}
				onOpenStudio={() => {}}
				onClose={() => {}}
			/>,
		);
		await act(async () => {
			await buttonByText(renderer, "Share")?.props.onClick();
		});
		const text = textOf(renderer.toJSON());
		expect(text).toContain("Sharing revoked 2026-10-29");
		expect(text).toContain("Generate share link");
		// Present (KUK-877) links into the full-screen runner for this campaign.
		const presentLink = renderer.root.findAllByProps({
			href: "/campaigns/$id/present",
		})[0];
		expect(presentLink).toBeDefined();
		expect(textOf(presentLink)).toContain("Present");
	});

	it("switches into the studio from the header button", async () => {
		const onOpenStudio = vi.fn();
		const renderer = await render(
			<CampaignDashboard
				detail={detailFixture}
				onOpenStudio={onOpenStudio}
				onClose={() => {}}
			/>,
		);
		await act(async () => {
			await buttonByText(renderer, "Open studio")?.props.onClick();
		});
		expect(onOpenStudio).toHaveBeenCalledWith("brief");
	});

	it("shows one guided first-step while the campaign is empty (KUK-912)", async () => {
		mocks.useCampaignMessages.mockReturnValue(queryStub({ data: [] }));
		const onOpenStudio = vi.fn();
		const renderer = await render(
			<CampaignDashboard
				detail={emptyDetail}
				onOpenStudio={onOpenStudio}
				onClose={() => {}}
			/>,
		);
		const text = textOf(renderer.toJSON());
		// One guided hero replaces the six empty panels.
		expect(text).toContain("Start by briefing the agent");
		expect(text).toContain("Open studio and brief the agent");
		expect(text).not.toContain("No plan yet");
		await act(async () => {
			await buttonByText(
				renderer,
				"Open studio and brief the agent",
			)?.props.onClick();
		});
		expect(onOpenStudio).toHaveBeenCalledWith("brief");
	});

	it("returns to the zone panels once the campaign has content", async () => {
		mocks.useCampaignMessages.mockReturnValue(queryStub({ data: [] }));
		const renderer = await render(
			<CampaignDashboard
				detail={detailFixture}
				onOpenStudio={() => {}}
				onClose={() => {}}
			/>,
		);
		const text = textOf(renderer.toJSON());
		expect(text).not.toContain("Start by briefing the agent");
	});
});
