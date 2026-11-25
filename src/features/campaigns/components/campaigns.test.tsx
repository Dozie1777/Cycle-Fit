import { type ReactElement, type ReactNode, StrictMode } from "react";
import {
	act,
	create,
	type ReactTestInstance,
	type ReactTestRenderer,
} from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CampaignSummary } from "@/client/api-types";
import { CampaignsPage } from "../pages/campaigns-page";
import { CampaignCard } from "./campaign-card";
import { ProjectCampaignsSection } from "./project-campaigns-section";

const mocks = vi.hoisted(() => ({
	useCampaigns: vi.fn(),
	useProjects: vi.fn(),
	useProjectCampaigns: vi.fn(),
	useCreateCampaign: vi.fn(),
	useCreateProjectCampaign: vi.fn(),
	useCreateProject: vi.fn(),
	useUpdateCampaign: vi.fn(),
	useDeleteCampaign: vi.fn(),
	navigate: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/client/queries", () => mocks);

vi.mock("@tanstack/react-router", () => ({
	// Router links become inert wrappers in these component tests.
	Link: (props: { children?: ReactNode }) => <span>{props.children}</span>,
	useNavigate: () => mocks.navigate,
}));

// Radix Dialog/Select need a DOM; the tests assert wiring, not the
// primitives, so render their children directly instead.
vi.mock("@/components/ui/select", () => ({
	Select: (props: { children?: ReactNode }) => <div>{props.children}</div>,
	SelectTrigger: (props: { children?: ReactNode }) => (
		<div>{props.children}</div>
	),
	SelectValue: () => null,
	SelectContent: (props: { children?: ReactNode }) => (
		<div>{props.children}</div>
	),
	SelectItem: (props: { children?: ReactNode }) => <div>{props.children}</div>,
}));

vi.mock("@/components/ui/dialog", () => ({
	Dialog: (props: { children?: ReactNode; open?: boolean }) =>
		props.open ? <div>{props.children}</div> : null,
	DialogContent: (props: { children?: ReactNode }) => (
		<div>{props.children}</div>
	),
	DialogDescription: (props: { children?: ReactNode }) => (
		<p>{props.children}</p>
	),
	DialogFooter: (props: { children?: ReactNode }) => (
		<div>{props.children}</div>
	),
	DialogHeader: (props: { children?: ReactNode }) => (
		<div>{props.children}</div>
	),
	DialogTitle: (props: { children?: ReactNode }) => <h2>{props.children}</h2>,
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
		...overrides,
	};
}

const FIXED_NOW = Date.parse("2026-10-30T12:00:00.000Z");

function campaign(overrides: Partial<CampaignSummary> = {}): CampaignSummary {
	return {
		id: "11111111-1111-1111-1111-111111111111",
		name: "Back-to-school push",
		briefPrompt: "Drive January enrollments",
		status: "draft",
		error: null,
		projectId: "p1",
		shareSlug: null,
		shareRevokedAt: null,
		shareIncludeReports: false,
		targetEndDate: null,
		createdAt: new Date(FIXED_NOW - 60_000).toISOString(),
		updatedAt: new Date(FIXED_NOW - 60_000).toISOString(),
		assetCount: 3,
		eventCount: 7,
		latestReportTitle: "Week 3 recap",
		// Health inputs (KUK-982/983) — no plan/KPI data in this fixture.
		draftEventCount: 0,
		hasFinalPlan: false,
		planCount: 0,
		nextScheduledAt: null,
		kpiCount: 0,
		recordedKpiCount: 0,
		missedKpiCount: 0,
		partialKpiCount: 0,
		primaryKpi: null,
		...overrides,
	};
}

const projects = [
	{ id: "p1", name: "Q4 launch", designCount: 0 },
	{ id: "p2", name: "Evergreen", designCount: 0 },
];

// react-test-renderer types findAllByType with React.ElementType; these
// helpers query by the plain intrinsic string instead.
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

/** Rendered text content of the whole tree (children joined without gaps). */
function textOf(node: unknown): string {
	if (typeof node !== "object" || node === null) {
		return node === undefined || node === null ? "" : String(node);
	}
	if (Array.isArray(node)) return node.map(textOf).join("");
	const inner = node as { children?: unknown };
	return inner.children ? textOf(inner.children) : "";
}

// The Input is Base UI's FieldControl: its internal onChange reads
// event.currentTarget.value, so synthetic events carry both surfaces.
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

function allButtonsByText(
	renderer: ReactTestRenderer,
	text: string,
): ReactTestInstance[] {
	return byStringType(renderer.root, "button").filter((node) =>
		flattenChildren(node.props.children).includes(text),
	);
}

beforeEach(() => {
	vi.stubGlobal("window", {
		location: { origin: "https://bot.test" },
	});
	vi.stubGlobal("navigator", {
		clipboard: { writeText: vi.fn(() => Promise.resolve()) },
	});
	for (const value of Object.values(mocks)) {
		if (vi.isMockFunction(value)) value.mockReset();
	}
	mocks.navigate.mockImplementation(() => Promise.resolve());
	mocks.useProjects.mockReturnValue(
		queryStub({ data: projects, isPending: false }),
	);
	mocks.useCreateCampaign.mockReturnValue(mutationStub());
	mocks.useCreateProject.mockReturnValue(mutationStub());
	mocks.useCreateProjectCampaign.mockReturnValue(mutationStub());
	mocks.useUpdateCampaign.mockReturnValue(mutationStub());
	mocks.useDeleteCampaign.mockReturnValue(mutationStub());
});

async function render(node: ReactElement) {
	let captured: ReactTestRenderer | undefined;
	await act(async () => {
		captured = await create(<StrictMode>{node}</StrictMode>);
	});
	if (!captured) throw new Error("test renderer did not mount");
	return captured;
}

describe("CampaignCard", () => {
	it("renders name, status, counts, project chip and latest report", async () => {
		const renderer = await render(
			<CampaignCardWrapper campaign={campaign()} projectName="Q4 launch" />,
		);
		const text = textOf(renderer.toJSON());
		expect(text).toContain("Back-to-school push");
		// KUK-979: the card shows a derived lifecycle label, never the raw
		// chat-pipeline status string.
		expect(text).toContain("Planning");
		expect(text).not.toContain("draft");
		expect(text).toContain("3 assets");
		expect(text).toContain("7 scheduled posts");
		expect(text).toContain("Latest report: Week 3 recap");
		expect(text).toContain("Q4 launch");
	});

	it("hides the project chip when showProject is false", async () => {
		const renderer = await render(
			<CampaignCardWrapper campaign={campaign()} showProject={false} />,
		);
		expect(textOf(renderer.toJSON())).not.toContain("Q4 launch");
	});

	it("offers copy share link only when a slug exists and copies the public URL", async () => {
		const withoutSlug = await render(
			<CampaignCardWrapper campaign={campaign()} />,
		);
		expect(buttonByText(withoutSlug, "Copy share link")).toBeUndefined();

		const withSlug = await render(
			<CampaignCardWrapper campaign={campaign({ shareSlug: "slug-1" })} />,
		);
		const button = buttonByText(withSlug, "Copy share link");
		expect(button).toBeDefined();
		await act(async () => {
			button?.props.onClick();
		});
		expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
			"https://bot.test/share/campaign/slug-1",
		);
	});

	it("renames via PATCH mutation", async () => {
		const update = mutationStub();
		mocks.useUpdateCampaign.mockReturnValue(update);
		const renderer = await render(
			<CampaignCardWrapper campaign={campaign()} />,
		);
		const rename = buttonByText(renderer, "Rename");
		await act(async () => {
			rename?.props.onClick();
		});
		const input = byStringType(renderer.root, "input")[0];
		await act(async () => {
			input.props.onChange(inputEvent("Renamed campaign"));
		});
		const form = byStringType(renderer.root, "form")[0];
		await act(async () => {
			form.props.onSubmit({ preventDefault: () => {} });
		});
		expect(update.mutateAsync).toHaveBeenCalledWith({
			campaignId: campaign().id,
			name: "Renamed campaign",
		});
	});

	it("deletes after the styled confirm dialog", async () => {
		const remove = mutationStub();
		mocks.useDeleteCampaign.mockReturnValue(remove);
		const renderer = await render(
			<CampaignCardWrapper campaign={campaign()} />,
		);
		// First Delete opens the ConfirmDialog; the second (inside the
		// dialog) is the destructive confirmation.
		const opener = buttonByText(renderer, "Delete");
		await act(async () => {
			await opener?.props.onClick();
		});
		const confirms = allButtonsByText(renderer, "Delete");
		expect(confirms.length).toBe(2);
		expect(remove.mutateAsync).not.toHaveBeenCalled();
		await act(async () => {
			await confirms[1]?.props.onClick();
		});
		expect(remove.mutateAsync).toHaveBeenCalledWith(campaign().id);
	});
});

describe("CampaignsPage", () => {
	it("renders loading skeletons while pending", async () => {
		mocks.useCampaigns.mockReturnValue(queryStub());
		const renderer = await render(<CampaignsPageWrapper />);
		expect(JSON.stringify(renderer.toJSON())).toContain(
			'"data-slot":"skeleton"',
		);
	});

	it("renders the error state when the list fails", async () => {
		mocks.useCampaigns.mockReturnValue(
			queryStub({ isPending: false, error: new Error("boom") }),
		);
		const renderer = await render(<CampaignsPageWrapper />);
		expect(textOf(renderer.toJSON())).toContain("Failed to load campaigns");
	});

	it("renders an empty state that guides to creating the first campaign", async () => {
		mocks.useCampaigns.mockReturnValue(
			queryStub({ isPending: false, data: [] }),
		);
		const renderer = await render(<CampaignsPageWrapper />);
		expect(textOf(renderer.toJSON())).toContain(
			"No campaigns yet — create the first one with New campaign.",
		);
	});

	it("groups campaigns by parent project and filters by projectId", async () => {
		mocks.useCampaigns.mockReturnValue(
			queryStub({
				isPending: false,
				data: [
					campaign(),
					campaign({
						id: "22222222-2222-2222-2222-222222222222",
						name: "Evergreen nurture",
						projectId: "p2",
					}),
				],
			}),
		);
		const all = await render(<CampaignsPageWrapper />);
		const allText = textOf(all.toJSON());
		expect(allText).toContain("Q4 launch");
		expect(allText).toContain("Evergreen nurture");

		const filtered = await render(<CampaignsPageWrapper projectId="p2" />);
		const filteredText = textOf(filtered.toJSON());
		expect(filteredText).toContain("Evergreen nurture");
		expect(filteredText).not.toContain("Back-to-school push");
	});

	it("creates a campaign through the dialog and navigates to its dashboard route", async () => {
		const createCampaign = mutationStub({
			mutateAsync: vi.fn(() => Promise.resolve({ campaignId: "c-new" })),
		});
		mocks.useCreateCampaign.mockReturnValue(createCampaign);
		mocks.useCampaigns.mockReturnValue(
			queryStub({ isPending: false, data: [] }),
		);
		const renderer = await render(<CampaignsPageWrapper projectId="p1" />);

		const open = buttonByText(renderer, "New campaign");
		await act(async () => {
			open?.props.onClick();
		});
		const inputs = byStringType(renderer.root, "input");
		await act(async () => {
			inputs[0].props.onChange(inputEvent("January push"));
		});
		await act(async () => {
			inputs[1].props.onChange(inputEvent("One-line brief"));
		});
		const form = byStringType(renderer.root, "form")[0];
		await act(async () => {
			form.props.onSubmit({ preventDefault: () => {} });
		});
		expect(createCampaign.mutateAsync).toHaveBeenCalledWith({
			projectId: "p1",
			name: "January push",
			briefPrompt: "One-line brief",
		});
		expect(mocks.navigate).toHaveBeenCalledWith({
			href: "/campaigns/c-new",
		});
	});
});

describe("ProjectCampaignsSection", () => {
	it("renders the project's campaigns without the redundant project chip", async () => {
		mocks.useProjectCampaigns.mockReturnValue(
			queryStub({ isPending: false, data: [campaign()] }),
		);
		const renderer = await render(
			<ProjectCampaignsSectionWrapper projectId="p1" />,
		);
		const text = textOf(renderer.toJSON());
		expect(text).toContain("Back-to-school push");
		expect(text).not.toContain("Q4 launch");
	});

	it("creates from the project with the container pre-filled", async () => {
		const createCampaign = mutationStub({
			mutateAsync: vi.fn(() => Promise.resolve({ campaignId: "c-new" })),
		});
		mocks.useCreateProjectCampaign.mockReturnValue(createCampaign);
		mocks.useProjectCampaigns.mockReturnValue(
			queryStub({ isPending: false, data: [] }),
		);
		const renderer = await render(
			<ProjectCampaignsSectionWrapper projectId="p1" />,
		);
		const inputs = byStringType(renderer.root, "input");
		await act(async () => {
			inputs[0].props.onChange(inputEvent("Launch week"));
		});
		const form = byStringType(renderer.root, "form")[0];
		await act(async () => {
			form.props.onSubmit({ preventDefault: () => {} });
		});
		expect(createCampaign.mutateAsync).toHaveBeenCalledWith({
			projectId: "p1",
			name: "Launch week",
			briefPrompt: undefined,
		});
		// KUK-903: the navigation records the project page as the origin so
		// the campaign's Back button returns here.
		expect(mocks.navigate).toHaveBeenCalledWith({
			href: "/campaigns/c-new?from=%2Fprojects%2Fp1",
		});
	});

	it("renders an empty state guiding to the create form", async () => {
		mocks.useProjectCampaigns.mockReturnValue(
			queryStub({ isPending: false, data: [] }),
		);
		const renderer = await render(
			<ProjectCampaignsSectionWrapper projectId="p1" />,
		);
		expect(textOf(renderer.toJSON())).toContain(
			"No campaigns in this project yet — create one above.",
		);
	});
});

function CampaignCardWrapper(props: {
	campaign: CampaignSummary;
	projectName?: string;
	showProject?: boolean;
}) {
	return <CampaignCard {...props} />;
}

function CampaignsPageWrapper({ projectId }: { projectId?: string }) {
	return <CampaignsPage projectId={projectId} />;
}

function ProjectCampaignsSectionWrapper({ projectId }: { projectId: string }) {
	return <ProjectCampaignsSection projectId={projectId} />;
}
