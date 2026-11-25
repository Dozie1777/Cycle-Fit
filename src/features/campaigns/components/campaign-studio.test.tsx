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
import { CampaignStudioPage } from "../pages/campaign-studio-page";
import { CampaignBriefPanel } from "./brief-panel";
import { CampaignCalendarPanel, groupEventsByWeek } from "./calendar-panel";
import {
	__resetCampaignHistoryCacheForTests,
	CampaignStudioChat,
} from "./campaign-studio-chat";
import { CampaignStudioLayout } from "./campaign-studio-layout";
import { CampaignPlanPanel } from "./plan-panel";
import { CampaignReportsPanel } from "./reports-panel";

// ---------------------------------------------------------------------------
// Shared mocks: queries + router, following campaigns.test.tsx conventions.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
	useCampaign: vi.fn(),
	useCampaignReport: vi.fn(),
	useInvalidateCampaign: vi.fn(() => vi.fn()),
	// The command palette mounted by CampaignStudioPage (KUK-916) reads these.
	useProjects: vi.fn(() => ({ data: [] })),
	useDesigns: vi.fn(() => ({ data: [] })),
	useCampaigns: vi.fn(() => ({ data: [] })),
	useSaveCampaignBrief: vi.fn(),
	useCreateCampaignPlan: vi.fn(),
	useUpdateCampaignPlan: vi.fn(),
	useAddCampaignPhase: vi.fn(),
	useUpdateCampaignPhase: vi.fn(),
	useCreateCampaignEvent: vi.fn(),
	useUpdateCampaignEvent: vi.fn(),
	useCreateCampaignReport: vi.fn(),
	useDeleteCampaignDocument: vi.fn(),
	// Dashboard hooks (KUK-875) — the page now lands on the control tower.
	useProject: vi.fn(),
	useUpdateCampaign: vi.fn(),
	useGenerateCampaignShare: vi.fn(),
	useRotateCampaignShare: vi.fn(),
	useRevokeCampaignShare: vi.fn(),
	useCampaignAssets: vi.fn(),
	useCampaignMessages: vi.fn(),
	useAttachCampaignEventAsset: vi.fn(),
	// Channel enumeration (KUK-890) — calendar/brief channel selects.
	useChannels: vi.fn(),
	useCreateChannel: vi.fn(),
	useUpdateChannel: vi.fn(),
	// Studio skills (KUK-891) — the "/" menu in the studio chat. Default
	// stubs keep every suite rendering; the chat suite overrides per test.
	useSkills: vi.fn(() => ({ data: [], isPending: false })),
	useCreateSkill: vi.fn(() => ({
		mutate: vi.fn(),
		mutateAsync: vi.fn(() => Promise.resolve({})),
		isPending: false,
		isError: false,
		error: null,
	})),
	useUpdateSkill: vi.fn(() => ({
		mutate: vi.fn(),
		mutateAsync: vi.fn(() => Promise.resolve({})),
		isPending: false,
		isError: false,
		error: null,
	})),
	useDeleteSkill: vi.fn(() => ({
		mutate: vi.fn(),
		mutateAsync: vi.fn(() => Promise.resolve({})),
		isPending: false,
		isError: false,
		error: null,
	})),
	// Campaign KPIs (KUK-896) — the brief panel now embeds the KPI editor.
	useCampaignKpis: vi.fn(() => ({ data: [], isPending: false })),
	useCreateCampaignKpi: vi.fn(() => ({
		mutate: vi.fn(),
		mutateAsync: vi.fn(() => Promise.resolve({})),
		isPending: false,
		isError: false,
		error: null,
	})),
	useUpdateCampaignKpi: vi.fn(() => ({
		mutate: vi.fn(),
		mutateAsync: vi.fn(() => Promise.resolve({})),
		isPending: false,
		isError: false,
		error: null,
	})),
	useDeleteCampaignKpi: vi.fn(() => ({
		mutate: vi.fn(),
		mutateAsync: vi.fn(() => Promise.resolve({})),
		isPending: false,
		isError: false,
		error: null,
	})),
	useCampaignKpiResults: vi.fn(() => ({ data: [], isPending: false })),
	useCreateCampaignKpiResult: vi.fn(() => ({
		mutate: vi.fn(),
		mutateAsync: vi.fn(() => Promise.resolve({})),
		isPending: false,
		isError: false,
		error: null,
	})),
	useUpdateCampaignKpiResult: vi.fn(() => ({
		mutate: vi.fn(),
		mutateAsync: vi.fn(() => Promise.resolve({})),
		isPending: false,
		isError: false,
		error: null,
	})),
	useDeleteCampaignKpiResult: vi.fn(() => ({
		mutate: vi.fn(),
		mutateAsync: vi.fn(() => Promise.resolve({})),
		isPending: false,
		isError: false,
		error: null,
	})),
	// Target audiences — the brief panel now embeds the audience editor.
	useCreateCampaignAudience: vi.fn(() => ({
		mutate: vi.fn(),
		mutateAsync: vi.fn(() => Promise.resolve({})),
		isPending: false,
		isError: false,
		error: null,
	})),
	useUpdateCampaignAudience: vi.fn(() => ({
		mutate: vi.fn(),
		mutateAsync: vi.fn(() => Promise.resolve({})),
		isPending: false,
		isError: false,
		error: null,
	})),
	useDeleteCampaignAudience: vi.fn(() => ({
		mutate: vi.fn(),
		mutateAsync: vi.fn(() => Promise.resolve({})),
		isPending: false,
		isError: false,
		error: null,
	})),
	getCampaignMessages: vi.fn(),
	releaseCampaignTurn: vi.fn(),
	navigate: vi.fn(() => Promise.resolve()),
	// Thinking-effort selector (KUK-892): the mocked Select hands its props
	// here so tests can read the value and drive onValueChange.
	selectProps: {} as Record<string, unknown>,
}));

vi.mock("@/client/queries", () => mocks);

vi.mock("@tanstack/react-router", () => ({
	// Router links become inert wrappers in these component tests.
	Link: (props: { children?: ReactNode }) => <span>{props.children}</span>,
	useNavigate: () => mocks.navigate,
}));

// Base UI Tabs/Select primitives need a DOM; assert wiring instead.
vi.mock("@/components/ui/tabs", () => ({
	Tabs: (props: { children?: ReactNode }) => <div>{props.children}</div>,
	TabsList: (props: { children?: ReactNode }) => <div>{props.children}</div>,
	TabsTrigger: (props: { children?: ReactNode }) => <div>{props.children}</div>,
	TabsContent: (props: { children?: ReactNode }) => <div>{props.children}</div>,
}));

vi.mock("./manage-channels-dialog", () => ({
	ManageChannelsDialog: (props: { open: boolean }) =>
		props.open ? <div data-manage-dialog="open" /> : null,
}));

vi.mock("./manage-skills-dialog", () => ({
	ManageSkillsDialog: (props: { open: boolean }) =>
		props.open ? <div data-manage-skills-dialog="open" /> : null,
}));

vi.mock("@/components/ui/select", () => ({
	Select: (props: { children?: ReactNode }) => {
		// Capture props so tests can drive the thinking-effort selector
		// (KUK-892) without a real Select implementation.
		mocks.selectProps = props;
		return <div>{props.children}</div>;
	},
	SelectTrigger: (props: { children?: ReactNode }) => (
		<div>{props.children}</div>
	),
	SelectValue: () => null,
	SelectContent: (props: { children?: ReactNode }) => (
		<div>{props.children}</div>
	),
	SelectItem: (props: { children?: ReactNode }) => <div>{props.children}</div>,
}));

vi.mock("@/components/ui/tooltip", () => ({
	Tooltip: (props: { children?: ReactNode }) => props.children,
	TooltipTrigger: (props: { children?: ReactNode }) => props.children,
	TooltipContent: (props: { children?: ReactNode }) => (
		<div>{props.children}</div>
	),
}));

vi.mock("streamdown", () => ({
	Streamdown: ({ children }: { children: string }) => children,
}));

// The resizable shell renders children directly in these tests.
vi.mock("react-resizable-panels", () => ({
	Group: (props: { children?: ReactNode }) => <div>{props.children}</div>,
	Panel: (props: { children?: ReactNode }) => <div>{props.children}</div>,
	Separator: () => null,
}));

vi.mock("@/client/use-media-query", () => ({
	useMediaQuery: vi.fn(() => true),
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
// Fixtures
// ---------------------------------------------------------------------------

const CAMPAIGN_ID = "11111111-1111-1111-1111-111111111111";

const briefFixture: CampaignBrief = {
	id: "brief-1",
	campaignId: CAMPAIGN_ID,
	objective: "Win January",
	audience: "Design engineers",
	keyMessage: "Ship faster",
	tone: "plain-spoken",
	channels: "email, X",
	budget: "$15k",
	kpis: "- 100 signups",
	body: "## Context\nWritten by the agent.",
	createdAt: "2026-10-30T00:00:00.000Z",
	updatedAt: "2026-10-30T01:00:00.000Z",
};

function phase(
	id: string,
	position: number,
	name: string,
): CampaignPlanDetail["phases"][number] {
	return {
		id,
		planId: "plan-1",
		name,
		objective: `Objective ${position}`,
		startsAt: `2026-03-0${position + 2}T00:00:00.000Z`,
		endsAt: null,
		position,
		body: null,
	};
}

const plansFixture: CampaignPlanDetail[] = [
	{
		id: "plan-1",
		campaignId: CAMPAIGN_ID,
		name: "Q1 launch plan",
		status: "draft",
		createdAt: "2026-10-30T00:00:00.000Z",
		updatedAt: "2026-10-30T00:00:00.000Z",
		phases: [
			phase("phase-0", 0, "Teaser week"),
			phase("phase-1", 1, "Launch week"),
		],
	},
];

const eventsFixture: CalendarEventEntry[] = [
	{
		id: "event-mon",
		campaignId: CAMPAIGN_ID,
		title: "Launch email",
		channel: null,
		channelId: "chan-email",
		linkedChannel: { id: "chan-email", name: "email", color: "#3b82f6" },
		scheduledAt: "2026-03-02T09:00:00.000Z",
		status: "scheduled",
		assetId: "asset-12345678",
		notes: null,
		createdAt: "2026-10-30T00:00:00.000Z",
		updatedAt: "2026-10-30T00:00:00.000Z",
	},
	{
		id: "event-wed",
		campaignId: CAMPAIGN_ID,
		title: "X thread",
		// Legacy free-text row: no link yet, gray fallback in the UI.
		channel: "X",
		channelId: null,
		linkedChannel: null,
		scheduledAt: "2026-03-04T10:00:00.000Z",
		status: "planned",
		assetId: null,
		notes: null,
		createdAt: "2026-10-30T00:00:00.000Z",
		updatedAt: "2026-10-30T00:00:00.000Z",
	},
	{
		id: "event-later",
		campaignId: CAMPAIGN_ID,
		title: "Next month slot",
		channel: null,
		channelId: null,
		linkedChannel: null,
		scheduledAt: "2026-04-06T09:00:00.000Z",
		status: "draft",
		assetId: null,
		notes: null,
		createdAt: "2026-10-30T00:00:00.000Z",
		updatedAt: "2026-10-30T00:00:00.000Z",
	},
	{
		id: "event-loose",
		campaignId: CAMPAIGN_ID,
		title: "Unscheduled slot",
		channel: null,
		channelId: null,
		linkedChannel: null,
		scheduledAt: null,
		status: "planned",
		assetId: null,
		notes: null,
		createdAt: "2026-10-30T00:00:00.000Z",
		updatedAt: "2026-10-30T00:00:00.000Z",
	},
];

const reportsFixture: CampaignDetail["reports"] = [
	{
		id: "report-1",
		title: "Week 1 performance",
		periodStart: "2026-03-02T00:00:00.000Z",
		periodEnd: "2026-03-08T00:00:00.000Z",
		createdAt: "2026-03-09T00:00:00.000Z",
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
	updatedAt: "2026-10-30T00:00:00.000Z",
	brief: briefFixture,
	plans: plansFixture,
	events: eventsFixture,
	channelIds: ["chan-email"],
	kpis: [],
	audiences: [],
	reports: reportsFixture,
};

// ---------------------------------------------------------------------------
// Render helpers (from campaigns.test.tsx)
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

/** Exact-match variant — "Delete" must not match "Delete plan". */

async function render(node: ReactElement) {
	let captured: ReactTestRenderer | undefined;
	await act(async () => {
		captured = await create(<StrictMode>{node}</StrictMode>);
	});
	if (!captured) throw new Error("test renderer did not mount");
	return captured;
}

beforeEach(() => {
	chat.config = null;
	chat.state.messages = [];
	chat.state.status = "ready";
	// The chat's remount cache is module state shared across tests that all
	// reuse CAMPAIGN_ID — clear it so every test fetches history fresh.
	__resetCampaignHistoryCacheForTests();
	for (const value of Object.values(mocks)) {
		if (vi.isMockFunction(value)) value.mockReset();
	}
	mocks.navigate.mockImplementation(() => Promise.resolve());
	mocks.useInvalidateCampaign.mockImplementation(() => vi.fn());
	mocks.useSaveCampaignBrief.mockReturnValue(mutationStub());
	mocks.useCreateCampaignPlan.mockReturnValue(mutationStub());
	mocks.useUpdateCampaignPlan.mockReturnValue(mutationStub());
	mocks.useAddCampaignPhase.mockReturnValue(mutationStub());
	mocks.useUpdateCampaignPhase.mockReturnValue(mutationStub());
	mocks.useCreateCampaignEvent.mockReturnValue(mutationStub());
	mocks.useUpdateCampaignEvent.mockReturnValue(mutationStub());
	mocks.useCreateCampaignReport.mockReturnValue(mutationStub());
	mocks.useDeleteCampaignDocument.mockReturnValue(mutationStub());
	mocks.useCampaignReport.mockReturnValue(queryStub());
	// Dashboard mocks: assets/messages queries plus the header mutations.
	mocks.useProject.mockReturnValue(
		queryStub({
			isPending: false,
			data: { id: "p1", name: "Project" },
		}),
	);
	mocks.useUpdateCampaign.mockReturnValue(mutationStub());
	mocks.useGenerateCampaignShare.mockReturnValue(mutationStub());
	mocks.useRotateCampaignShare.mockReturnValue(mutationStub());
	mocks.useRevokeCampaignShare.mockReturnValue(mutationStub());
	mocks.useAttachCampaignEventAsset.mockReturnValue(mutationStub());
	// Channel enumeration: the seeded standard list, shortened.
	mocks.useChannels.mockReturnValue({
		data: [
			{ id: "chan-email", name: "Email", color: "#3b82f6", createdAt: "" },
			{ id: "chan-x", name: "X", color: null, createdAt: "" },
		],
		isPending: false,
	});
	mocks.useCreateChannel.mockReturnValue(mutationStub());
	mocks.useUpdateChannel.mockReturnValue(mutationStub());
	mocks.useCampaignAssets.mockReturnValue(
		queryStub({ isPending: false, data: [] }),
	);
	mocks.useCampaignMessages.mockReturnValue(
		queryStub({ isPending: false, data: [] }),
	);
});

// ---------------------------------------------------------------------------
// Brief panel
// ---------------------------------------------------------------------------

describe("CampaignBriefPanel", () => {
	it("renders the structured fields and marks a missing brief", async () => {
		const renderer = await render(
			<CampaignBriefPanel
				campaignId={CAMPAIGN_ID}
				brief={briefFixture}
				channelIds={["chan-email"]}
				audiences={[]}
			/>,
		);
		const text = textOf(renderer.toJSON());
		// Input values live on props, not in children text.
		const objective = renderer.root.findAllByProps({
			id: "brief-objective",
		})[0];
		expect(objective.props.value).toBe("Win January");
		// The audience textarea is gone: structured rows render through the
		// audience editor, and the deprecated brief markdown only shows as a
		// legacy fallback (audiences empty + non-empty brief.audience).
		const textAgain = textOf(renderer.toJSON());
		expect(textAgain).toContain("Target audiences");
		expect(textAgain).toContain("Legacy audience markdown (deprecated)");
		expect(textAgain).toContain("Design engineers");
		expect(text).toContain("Edits here patch the brief rows");

		const empty = await render(
			<CampaignBriefPanel
				campaignId={CAMPAIGN_ID}
				brief={null}
				channelIds={[]}
				audiences={[]}
			/>,
		);
		expect(textOf(empty.toJSON())).toContain(
			"No brief yet — ask the agent in chat to draft one",
		);
	});

	it("saves a merged patch; empty inputs clear their field", async () => {
		const save = mutationStub();
		mocks.useSaveCampaignBrief.mockReturnValue(save);
		const renderer = await render(
			<CampaignBriefPanel
				campaignId={CAMPAIGN_ID}
				brief={briefFixture}
				channelIds={["chan-email"]}
				audiences={[]}
			/>,
		);
		const inputs = byStringType(renderer.root, "input");
		// First input is the objective; blank it out to clear the field.
		await act(async () => {
			inputs[0].props.onChange(inputEvent(""));
		});
		const form = byStringType(renderer.root, "form")[0];
		await act(async () => {
			form.props.onSubmit({ preventDefault: () => {} });
		});
		expect(save.mutateAsync).toHaveBeenCalledWith(
			// The audience field is no longer part of the brief patch — it
			// lives in the structured audience rows now.
			expect.not.objectContaining({ audience: expect.anything() }),
		);
		expect(save.mutateAsync).toHaveBeenCalledWith(
			expect.objectContaining({
				objective: null,
				keyMessage: "Ship faster",
			}),
		);
	});
});

// ---------------------------------------------------------------------------
// Plan panel
// ---------------------------------------------------------------------------

describe("CampaignPlanPanel", () => {
	it("lists plans with phases in position order", async () => {
		const renderer = await render(
			<CampaignPlanPanel campaignId={CAMPAIGN_ID} plans={plansFixture} />,
		);
		const text = textOf(renderer.toJSON());
		expect(text.indexOf("Teaser week")).toBeLessThan(
			text.indexOf("Launch week"),
		);
		expect(text).toContain("Q1 launch plan");
		expect(text).toContain("draft");
	});

	it("renders an empty state guiding to the agent or manual creation", async () => {
		const renderer = await render(
			<CampaignPlanPanel campaignId={CAMPAIGN_ID} plans={[]} />,
		);
		expect(textOf(renderer.toJSON())).toContain(
			"No plans yet — ask the agent in chat to plan the campaign",
		);
	});

	it("moves a phase by patching its position", async () => {
		const updatePhase = mutationStub();
		mocks.useUpdateCampaignPhase.mockReturnValue(updatePhase);
		const renderer = await render(
			<CampaignPlanPanel campaignId={CAMPAIGN_ID} plans={plansFixture} />,
		);
		const moveUp = renderer.root.findAllByProps({
			"aria-label": "Move Launch week up",
		})[0];
		await act(async () => {
			await moveUp.props.onClick();
		});
		expect(updatePhase.mutateAsync).toHaveBeenCalledWith({
			phaseId: "phase-1",
			position: 0,
		});
	});

	it("creates a plan through the inline form", async () => {
		const createPlan = mutationStub();
		mocks.useCreateCampaignPlan.mockReturnValue(createPlan);
		const renderer = await render(
			<CampaignPlanPanel campaignId={CAMPAIGN_ID} plans={[]} />,
		);
		await act(async () => {
			await buttonByText(renderer, "New plan")?.props.onClick();
		});
		const inputs = byStringType(renderer.root, "input");
		await act(async () => {
			inputs[0].props.onChange(inputEvent("Retention plan"));
		});
		const form = byStringType(renderer.root, "form")[0];
		await act(async () => {
			form.props.onSubmit({ preventDefault: () => {} });
		});
		expect(createPlan.mutateAsync).toHaveBeenCalledWith({
			name: "Retention plan",
		});
	});

	it("adds and deletes phases through the document API", async () => {
		const addPhase = mutationStub();
		mocks.useAddCampaignPhase.mockReturnValue(addPhase);
		const remove = mutationStub();
		mocks.useDeleteCampaignDocument.mockReturnValue(remove);
		const renderer = await render(
			<CampaignPlanPanel campaignId={CAMPAIGN_ID} plans={plansFixture} />,
		);
		await act(async () => {
			await buttonByText(renderer, "Add phase")?.props.onClick();
		});
		const inputs = byStringType(renderer.root, "input");
		await act(async () => {
			inputs[0].props.onChange(inputEvent("Sustain week"));
		});
		const addForm = byStringType(renderer.root, "form")[0];
		await act(async () => {
			addForm.props.onSubmit({ preventDefault: () => {} });
		});
		expect(addPhase.mutateAsync).toHaveBeenCalledWith({
			planId: "plan-1",
			name: "Sustain week",
			objective: null,
		});

		// Exact-match "Delete": the plan card's "Delete plan" must not win.
		const deleteButtons = byStringType(renderer.root, "button").filter(
			(node) => flattenChildren(node.props.children).trim() === "Delete",
		);
		expect(deleteButtons.length).toBe(2); // one per phase
		await act(async () => {
			await deleteButtons[0]?.props.onClick();
		});
		expect(remove.mutateAsync).toHaveBeenCalledWith({
			kind: "phase",
			id: "phase-0",
		});
	});
});

// ---------------------------------------------------------------------------
// Calendar panel
// ---------------------------------------------------------------------------

describe("CampaignCalendarPanel", () => {
	it("groups events by week with unscheduled slots last", () => {
		const groups = groupEventsByWeek(eventsFixture);
		expect(groups.map((group) => group.label)).toEqual([
			"Week of Mar 2",
			"Week of Apr 6",
			"Unscheduled",
		]);
		expect(groups[0]?.events.map((event) => event.id)).toEqual([
			"event-mon",
			"event-wed",
		]);
	});

	it("renders week groups, status pills and the asset chip", async () => {
		const renderer = await render(
			<CampaignCalendarPanel campaignId={CAMPAIGN_ID} events={eventsFixture} />,
		);
		const text = textOf(renderer.toJSON());
		expect(text).toContain("Week of Mar 2");
		expect(text).toContain("Launch email");
		expect(text).toContain("scheduled");
		expect(text).toContain("Asset asset-12");
		expect(text).toContain("Unscheduled");
	});

	it("creates an event through the inline form", async () => {
		const createEvent = mutationStub();
		mocks.useCreateCampaignEvent.mockReturnValue(createEvent);
		const renderer = await render(
			<CampaignCalendarPanel campaignId={CAMPAIGN_ID} events={[]} />,
		);
		await act(async () => {
			await buttonByText(renderer, "New event")?.props.onClick();
		});
		const inputs = byStringType(renderer.root, "input");
		await act(async () => {
			inputs[0].props.onChange(inputEvent("Waitlist email"));
		});
		const form = byStringType(renderer.root, "form")[0];
		await act(async () => {
			form.props.onSubmit({ preventDefault: () => {} });
		});
		expect(createEvent.mutateAsync).toHaveBeenCalledWith({
			title: "Waitlist email",
			channelId: null,
			scheduledAt: null,
			status: "planned",
			notes: null,
		});
	});

	it("quick-edits an event's title and status", async () => {
		const updateEvent = mutationStub();
		mocks.useUpdateCampaignEvent.mockReturnValue(updateEvent);
		const renderer = await render(
			<CampaignCalendarPanel
				campaignId={CAMPAIGN_ID}
				events={[eventsFixture[0] as CalendarEventEntry]}
			/>,
		);
		await act(async () => {
			await buttonByText(renderer, "Edit")?.props.onClick();
		});
		const inputs = byStringType(renderer.root, "input");
		await act(async () => {
			inputs[0].props.onChange(inputEvent("Launch email v2"));
		});
		const form = byStringType(renderer.root, "form")[0];
		await act(async () => {
			form.props.onSubmit({ preventDefault: () => {} });
		});
		expect(updateEvent.mutateAsync).toHaveBeenCalledWith(
			expect.objectContaining({
				eventId: "event-mon",
				title: "Launch email v2",
				status: "scheduled",
			}),
		);
	});
});

// ---------------------------------------------------------------------------
// Reports panel
// ---------------------------------------------------------------------------

describe("CampaignReportsPanel", () => {
	it("renders a tab per report with period labels", async () => {
		const renderer = await render(
			<CampaignReportsPanel
				campaignId={CAMPAIGN_ID}
				reports={reportsFixture}
			/>,
		);
		const text = textOf(renderer.toJSON());
		expect(text).toContain("Week 1 performance");
		expect(text).toContain("2026-03-02 – 2026-03-08");
	});

	it("renders an empty state guiding to the agent or manual creation", async () => {
		const renderer = await render(
			<CampaignReportsPanel campaignId={CAMPAIGN_ID} reports={[]} />,
		);
		expect(textOf(renderer.toJSON())).toContain(
			"No reports yet — reports land here as the campaign runs",
		);
	});

	it("creates a report manually with title, period and body", async () => {
		const createReport = mutationStub();
		mocks.useCreateCampaignReport.mockReturnValue(createReport);
		const renderer = await render(
			<CampaignReportsPanel campaignId={CAMPAIGN_ID} reports={[]} />,
		);
		await act(async () => {
			await buttonByText(renderer, "New report")?.props.onClick();
		});
		const inputs = byStringType(renderer.root, "input");
		await act(async () => {
			inputs[0].props.onChange(inputEvent("Week 2 recap"));
		});
		const textareas = byStringType(renderer.root, "textarea");
		await act(async () => {
			textareas[0].props.onChange(inputEvent("## Week 2"));
		});
		const form = byStringType(renderer.root, "form")[0];
		await act(async () => {
			form.props.onSubmit({ preventDefault: () => {} });
		});
		expect(createReport.mutateAsync).toHaveBeenCalledWith({
			title: "Week 2 recap",
			body: "## Week 2",
			periodStart: null,
			periodEnd: null,
		});
	});

	it("fetches the selected report and renders its markdown", async () => {
		mocks.useCampaignReport.mockReturnValue(
			queryStub({
				isPending: false,
				data: {
					id: "report-1",
					campaignId: CAMPAIGN_ID,
					title: "Week 1 performance",
					periodStart: "2026-03-02T00:00:00.000Z",
					periodEnd: "2026-03-08T00:00:00.000Z",
					summary: "Strong open.",
					metrics: null,
					body: "## Week 1 body",
					createdAt: "2026-03-09T00:00:00.000Z",
					updatedAt: "2026-03-09T00:00:00.000Z",
				},
			}),
		);
		const renderer = await render(
			<CampaignReportsPanel
				campaignId={CAMPAIGN_ID}
				reports={reportsFixture}
			/>,
		);
		expect(mocks.useCampaignReport).toHaveBeenCalledWith(
			CAMPAIGN_ID,
			"report-1",
		);
		const text = textOf(renderer.toJSON());
		expect(text).toContain("## Week 1 body");
		expect(text).toContain("Strong open.");
	});
});

// ---------------------------------------------------------------------------
// Studio chat
// ---------------------------------------------------------------------------

const chat = vi.hoisted(() => ({
	config: null as {
		onFinish?: () => void;
		id?: string;
	} | null,
	state: {
		messages: [] as Array<{
			id: string;
			role: string;
			parts: Array<Record<string, unknown>>;
		}>,
		status: "ready" as string,
	},
	sendMessage: vi.fn(() => Promise.resolve()),
}));

vi.mock("@ai-sdk/react", () => ({
	// `messages` seeds the hook like the real implementation; chat.state
	// simulates the live-stream transcript once populated.
	useChat: (config: {
		id?: string;
		messages?: Array<Record<string, unknown>>;
		onFinish?: () => void;
	}) => {
		chat.config = config;
		return {
			messages:
				chat.state.messages.length > 0
					? chat.state.messages
					: (config.messages ?? []),
			sendMessage: chat.sendMessage,
			status: chat.state.status,
			error: undefined,
			stop: vi.fn(),
			regenerate: vi.fn(),
			clearError: vi.fn(),
		};
	},
}));

vi.mock("ai", () => ({
	getToolName: (part: { type: string; toolName?: string }) =>
		part.type === "dynamic-tool" ? (part.toolName ?? "") : part.type.slice(5),
}));

// The chat panel now drives the RivetKit `campaignChat` actor instead of an
// SSE endpoint — hand the component a connected actor stub whose sendMessage
// the transport tests can inspect.
const actor = vi.hoisted(() => ({
	connection: {
		sendMessage: vi.fn(() => new Promise(() => {})),
		on: vi.fn(() => vi.fn()),
	},
}));
vi.mock("@/client/rivet-actor-context", () => ({
	useActor: () => ({
		connection: actor.connection,
		isConnected: true,
	}),
}));

vi.mock("@/client/trpc", () => ({
	asJson: (call: Promise<unknown>) => call,
	trpc: {
		campaigns: {
			listMessages: { query: mocks.getCampaignMessages },
			releaseTurn: { mutate: mocks.releaseCampaignTurn },
		},
	},
}));

vi.mock("@/components/ai-elements/conversation", () => ({
	Conversation: (props: { children?: ReactNode }) => props.children,
	ConversationContent: (props: { children?: ReactNode }) => props.children,
	ConversationEmptyState: (props: { title?: string }) => <p>{props.title}</p>,
	ConversationScrollButton: () => null,
}));

vi.mock("@/components/ai-elements/message", () => ({
	Message: (props: { children?: ReactNode }) => props.children,
	MessageContent: (props: { children?: ReactNode }) => props.children,
}));

vi.mock("@/components/ai-elements/prompt-input", () => ({
	PromptInput: (props: {
		children?: ReactNode;
		onSubmit?: (message: { text?: string }) => void;
	}) => <form onSubmit={props.onSubmit as never}>{props.children}</form>,
	PromptInputBody: (props: { children?: ReactNode }) => props.children,
	PromptInputFooter: (props: { children?: ReactNode }) => props.children,
	PromptInputTools: (props: { children?: ReactNode }) => props.children,
	PromptInputSubmit: () => <button type="button">Send</button>,
	PromptInputTextarea: (props: {
		onChange?: (event: { currentTarget: { value: string } }) => void;
		onKeyDown?: (event: { key: string; preventDefault: () => void }) => void;
		placeholder?: string;
		ref?: { current: HTMLTextAreaElement | null };
	}) => (
		<textarea
			name="message"
			onChange={props.onChange}
			onKeyDown={props.onKeyDown}
			placeholder={props.placeholder}
			ref={props.ref ?? undefined}
		/>
	),
}));

vi.mock("@/components/ai-elements/suggestion", () => ({
	Suggestion: (props: { suggestion: string; onClick?: () => void }) => (
		<button type="button" onClick={props.onClick}>
			{props.suggestion}
		</button>
	),
	Suggestions: (props: { children?: ReactNode }) => props.children,
}));

vi.mock("@/components/ai-elements/reasoning", () => ({
	Reasoning: (props: { children?: ReactNode }) => props.children,
	ReasoningContent: () => null,
	ReasoningTrigger: () => null,
}));

vi.mock("@/components/ai-elements/confirmation", () => ({
	Confirmation: (props: {
		title: string;
		actions: Array<{ label: string; value: string }>;
		onAction: (value: string) => void;
	}) => (
		<div>
			<p>{props.title}</p>
			{props.actions.map((action) => (
				<button
					key={action.value}
					type="button"
					onClick={() => props.onAction(action.value)}
				>
					{action.label}
				</button>
			))}
		</div>
	),
}));

vi.mock("@/components/ai-elements/tool", () => ({
	Tool: (props: { children?: ReactNode }) => props.children,
	ToolContent: (props: { children?: ReactNode }) => props.children,
	ToolHeader: (props: { type?: string; toolName?: string }) => (
		<span>{props.toolName ?? props.type}</span>
	),
	ToolInput: () => null,
	ToolOutput: () => null,
}));

vi.mock("@/components/ui/message-scroller", () => ({
	MessageScrollerItem: (props: { children?: ReactNode }) => props.children,
	useMessageScroller: () => ({
		scrollToEnd: () => true,
		scrollToMessage: () => true,
		scrollToStart: () => true,
	}),
	useMessageScrollerScrollable: () => ({ start: false, end: false }),
}));

vi.mock("@/components/ui/spinner", () => ({ Spinner: () => null }));

describe("CampaignStudioChat", () => {
	beforeEach(() => {
		chat.config = null;
		chat.state.messages = [];
		chat.state.status = "ready";
		mocks.getCampaignMessages.mockResolvedValue([]);
		mocks.releaseCampaignTurn.mockReset();
		mocks.releaseCampaignTurn.mockResolvedValue({ released: true });
		// Studio skills (KUK-891): one enabled, one disabled.
		mocks.useSkills.mockReturnValue({
			data: [
				{
					id: "skill-1",
					slug: "campaign-basics",
					name: "Campaign basics",
					description: "A guided tour of the studio.",
					content: "# Campaign basics",
					builtin: true,
					enabled: true,
					createdAt: "",
					updatedAt: "",
				},
				{
					id: "skill-2",
					slug: "retired",
					name: "Retired skill",
					description: "Disabled — hidden from the menu.",
					content: "# Retired",
					builtin: false,
					enabled: false,
					createdAt: "",
					updatedAt: "",
				},
			],
			isPending: false,
		} as never);
		mocks.useCreateSkill.mockReturnValue(mutationStub());
		mocks.useUpdateSkill.mockReturnValue(mutationStub());
		mocks.useDeleteSkill.mockReturnValue(mutationStub());
	});

	it("loads history from D1 and auto-sends the brief prompt once", async () => {
		mocks.getCampaignMessages.mockResolvedValue([
			{
				id: "m1",
				role: "user",
				content: "Plan a launch",
				createdAt: "2026-10-30T00:00:00.000Z",
			},
		]);
		await act(async () => {
			await render(
				<CampaignStudioChat
					campaignId={CAMPAIGN_ID}
					briefPrompt="Drive January enrollments"
					onTurnSettled={() => {}}
				/>,
			);
		});
		expect(mocks.getCampaignMessages).toHaveBeenCalledWith({
			campaignId: CAMPAIGN_ID,
		});
		expect(chat.config?.id).toBe(`campaign-${CAMPAIGN_ID}`);
		// History exists — no auto-send.
		expect(chat.sendMessage).not.toHaveBeenCalled();
	});

	it("auto-sends the brief prompt when the conversation is empty", async () => {
		await act(async () => {
			await render(
				<CampaignStudioChat
					campaignId={CAMPAIGN_ID}
					briefPrompt="Drive January enrollments"
					onTurnSettled={() => {}}
				/>,
			);
		});
		expect(chat.sendMessage).toHaveBeenCalledWith({
			text: "Drive January enrollments",
		});
	});

	it("sends trimmed text through the composer and reports settled turns", async () => {
		const onTurnSettled = vi.fn();
		const renderer = await render(
			<CampaignStudioChat
				campaignId={CAMPAIGN_ID}
				briefPrompt={null}
				onTurnSettled={onTurnSettled}
			/>,
		);
		const chatForm = byStringType(renderer.root, "form")[0];
		await act(async () => {
			chatForm.props.onSubmit({ text: "  draft the plan  " });
		});
		expect(chat.sendMessage).toHaveBeenCalledWith({ text: "draft the plan" });

		await act(async () => {
			chat.config?.onFinish?.();
		});
		expect(onTurnSettled).toHaveBeenCalled();
	});

	it("hides the stuck-turn banner while no turn is running server-side", async () => {
		const renderer = await render(
			<CampaignStudioChat
				campaignId={CAMPAIGN_ID}
				briefPrompt={null}
				onTurnSettled={() => {}}
			/>,
		);
		expect(textOf(renderer.toJSON())).not.toContain("still running");
	});

	it("offers a force-release when the server reports a stuck turn", async () => {
		const onTurnSettled = vi.fn();
		// The banner is grace-gated (a remount mid-turn is locally idle while
		// the server legitimately streams) — it only appears after the
		// 30-second timer fires. Fake timers must wrap the mount so the
		// grace timeout is scheduled on the fake clock.
		vi.useFakeTimers();
		let renderer: ReactTestRenderer;
		try {
			renderer = await render(
				<CampaignStudioChat
					campaignId={CAMPAIGN_ID}
					briefPrompt={null}
					onTurnSettled={onTurnSettled}
					turnInProgress
				/>,
			);
			expect(textOf(renderer.toJSON())).not.toContain("still running");
			await act(async () => {
				vi.advanceTimersByTime(30_000);
			});
		} finally {
			vi.useRealTimers();
		}
		expect(textOf(renderer.toJSON())).toContain("still running");
		const release = buttonByText(renderer, "Release stuck turn");
		expect(release).toBeDefined();
		await act(async () => {
			release?.props.onClick();
		});
		expect(mocks.releaseCampaignTurn).toHaveBeenCalledWith({
			campaignId: CAMPAIGN_ID,
		});
		expect(onTurnSettled).toHaveBeenCalled();
		// The transcript reloads after the release.
		await vi.waitFor(() => {
			expect(mocks.getCampaignMessages.mock.calls.length).toBeGreaterThan(1);
		});
	});

	it("renders the thinking-effort selector with Low/Balanced/Deep and a tooltip", async () => {
		const renderer = await render(
			<CampaignStudioChat
				campaignId={CAMPAIGN_ID}
				briefPrompt={null}
				onTurnSettled={() => {}}
			/>,
		);
		const text = textOf(renderer.toJSON());
		for (const label of ["Low", "Balanced", "Deep"]) {
			expect(text).toContain(label);
		}
		expect(text).toContain(
			"Low = fastest; Deep = maximum reasoning — GLM cannot fully disable reasoning",
		);
	});

	it("defaults the thinking effort to Low and sends the chosen effort with each turn", async () => {
		await render(
			<CampaignStudioChat
				campaignId={CAMPAIGN_ID}
				briefPrompt={null}
				onTurnSettled={() => {}}
			/>,
		);
		// Default is Low.
		expect(mocks.selectProps.value as string | undefined).toBe("low");
		const transport = (
			chat.config as unknown as {
				transport?: {
					sendMessages: (args: {
						messages: Array<{
							role: string;
							parts: Array<{ type: string; text?: string }>;
						}>;
						abortSignal?: undefined;
					}) => Promise<unknown>;
				};
			}
		)?.transport;
		expect(transport?.sendMessages).toBeDefined();
		actor.connection.sendMessage.mockClear();
		const outgoing = [
			{ role: "user", parts: [{ type: "text", text: "plan the launch" }] },
		];
		await transport?.sendMessages({ messages: outgoing });
		expect(actor.connection.sendMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				message: "plan the launch",
				thinkingEffort: "low",
			}),
		);

		// Switch to Deep — the next turn ships the new choice.
		await act(async () => {
			(mocks.selectProps.onValueChange as (value: string) => void)?.("max");
		});
		expect(mocks.selectProps.value as string | undefined).toBe("max");
		actor.connection.sendMessage.mockClear();
		await transport?.sendMessages({ messages: outgoing });
		expect(actor.connection.sendMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				message: "plan the launch",
				thinkingEffort: "max",
			}),
		);
	});

	it("renders tool cards and ask_user confirmations from the stream", async () => {
		chat.state.messages = [
			{
				id: "a1",
				role: "assistant",
				parts: [
					{ type: "tool-save_brief", state: "output-available" },
					{
						type: "tool-ask_user",
						state: "output-available",
						toolCallId: "t1",
						output: {
							question: "Which audience first?",
							options: [
								{ label: "Students", value: "students" },
								{ label: "Teachers", value: "teachers" },
							],
						},
					},
				],
			},
		];
		const renderer = await render(
			<CampaignStudioChat
				campaignId={CAMPAIGN_ID}
				briefPrompt={null}
				onTurnSettled={() => {}}
			/>,
		);
		const text = textOf(renderer.toJSON());
		expect(text).toContain("save_brief");
		expect(text).toContain("Which audience first?");

		const answer = byStringType(renderer.root, "button").find((node) =>
			flattenChildren(node.props.children).includes("Students"),
		);
		await act(async () => {
			answer?.props.onClick();
		});
		expect(chat.sendMessage).toHaveBeenCalledWith({ text: "students" });
	});

	it("opens the slash skill menu while the draft is a slash invocation", async () => {
		const renderer = await render(
			<CampaignStudioChat
				campaignId={CAMPAIGN_ID}
				briefPrompt={null}
				onTurnSettled={() => {}}
			/>,
		);
		const textarea = byStringType(renderer.root, "textarea")[0];

		// Normal typing shows no menu.
		await act(async () => {
			textarea.props.onChange({ currentTarget: { value: "draft the plan" } });
		});
		expect(renderer.root.findAllByProps({ role: "option" })).toHaveLength(0);

		// Typing "/" opens the menu with the enabled skills only.
		await act(async () => {
			textarea.props.onChange({ currentTarget: { value: "/" } });
		});
		const options = renderer.root.findAllByProps({ role: "option" });
		expect(options).toHaveLength(1);
		const optionText = textOf(options[0]);
		expect(optionText).toContain("/campaign-basics");
		expect(optionText).not.toContain("retired");

		// The query filters the menu.
		await act(async () => {
			textarea.props.onChange({ currentTarget: { value: "/retired" } });
		});
		expect(renderer.root.findAllByProps({ role: "option" })).toHaveLength(0);
	});

	it("inserts the /slug and closes the menu on skill pick", async () => {
		const renderer = await render(
			<CampaignStudioChat
				campaignId={CAMPAIGN_ID}
				briefPrompt={null}
				onTurnSettled={() => {}}
			/>,
		);
		const textarea = byStringType(renderer.root, "textarea")[0];
		await act(async () => {
			textarea.props.onChange({ currentTarget: { value: "/" } });
		});
		const option = renderer.root.findAllByProps({ role: "option" })[0];
		let prevented = false;
		await act(async () => {
			option.props.onMouseDown({
				preventDefault: () => {
					prevented = true;
				},
			});
		});
		expect(prevented).toBe(true);
		// The inserted "/campaign-basics " draft (with trailing space) is no
		// longer a bare slash invocation, so the menu closes; sending it
		// flows as a normal message.
		expect(renderer.root.findAllByProps({ role: "option" })).toHaveLength(0);
	});

	it("closes the slash menu and clears the draft after sending", async () => {
		const renderer = await render(
			<CampaignStudioChat
				campaignId={CAMPAIGN_ID}
				briefPrompt={null}
				onTurnSettled={() => {}}
			/>,
		);
		const textarea = byStringType(renderer.root, "textarea")[0];
		const chatForm = byStringType(renderer.root, "form")[0];

		// Type a bare slash invocation: the menu is open over the draft.
		await act(async () => {
			textarea.props.onChange({ currentTarget: { value: "/campaign-basics" } });
		});
		expect(renderer.root.findAllByProps({ role: "option" })).toHaveLength(1);

		// Submitting clears the synced draft (the form reset fires no
		// onChange) so the menu cannot linger over an empty input.
		await act(async () => {
			chatForm.props.onSubmit({ text: "/campaign-basics" });
		});
		expect(chat.sendMessage).toHaveBeenCalledWith({
			text: "/campaign-basics",
		});
		expect(renderer.root.findAllByProps({ role: "option" })).toHaveLength(0);
	});

	it("opens the manage-skills dialog from the chat footer", async () => {
		const renderer = await render(
			<CampaignStudioChat
				campaignId={CAMPAIGN_ID}
				briefPrompt={null}
				onTurnSettled={() => {}}
			/>,
		);
		expect(
			renderer.root.findAllByProps({ "data-manage-skills-dialog": "open" }),
		).toHaveLength(0);
		const skillsButton = byStringType(renderer.root, "button").find((node) =>
			flattenChildren(node.props.children).includes("Skills"),
		);
		await act(async () => {
			skillsButton?.props.onClick();
		});
		expect(
			renderer.root.findAllByProps({ "data-manage-skills-dialog": "open" }),
		).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// Studio shell + page
// ---------------------------------------------------------------------------

describe("CampaignStudioLayout", () => {
	it("renders the chat panel beside all four document tabs", async () => {
		const renderer = await render(
			<CampaignStudioLayout
				detail={detailFixture}
				onClose={() => {}}
				onTurnSettled={() => {}}
			/>,
		);
		const text = textOf(renderer.toJSON());
		expect(text).toContain("Back-to-school push");
		expect(text).toContain("Brief");
		expect(text).toContain("Plan");
		expect(text).toContain("Calendar");
		expect(text).toContain("Reports");
		// Brief tab is the default document panel (input value via props).
		const objective = renderer.root.findAllByProps({
			id: "brief-objective",
		})[0];
		expect(objective.props.value).toBe("Win January");
	});
});

describe("CampaignStudioPage", () => {
	it("renders loading and error states from the campaign query", async () => {
		mocks.useCampaign.mockReturnValue(queryStub());
		const loading = await render(
			<CampaignStudioPage id={CAMPAIGN_ID} onClose={() => {}} />,
		);
		expect(textOf(loading.toJSON())).toContain("Loading campaign…");

		mocks.useCampaign.mockReturnValue(
			queryStub({ isPending: false, error: new Error("boom") }),
		);
		const failed = await render(
			<CampaignStudioPage id={CAMPAIGN_ID} onClose={() => {}} />,
		);
		expect(textOf(failed.toJSON())).toContain("Failed to load campaign.");
	});

	it("lands on the dashboard and switches into the studio", async () => {
		mocks.useCampaign.mockReturnValue(
			queryStub({ isPending: false, data: detailFixture }),
		);
		const renderer = await render(
			<CampaignStudioPage id={CAMPAIGN_ID} onClose={() => {}} />,
		);
		const text = textOf(renderer.toJSON());
		// Landing view is the control tower, not the studio shell.
		expect(text).toContain("Overview");
		expect(text).toContain("Next 3 weeks");
		expect(text).not.toContain("Loading studio…");

		// "Open studio" switches into the studio workspace in place.
		const openStudio = byStringType(renderer.root, "button").find((node) =>
			flattenChildren(node.props.children).includes("Open studio"),
		);
		await act(async () => {
			await openStudio?.props.onClick();
		});
		const studioText = textOf(renderer.toJSON());
		expect(studioText).toContain("Brief");
		expect(studioText).toContain("Reports");
	});
});
