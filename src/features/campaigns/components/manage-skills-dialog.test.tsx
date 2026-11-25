import { type ReactNode, StrictMode } from "react";
import {
	act,
	create,
	type ReactTestInstance,
	type ReactTestRenderer,
} from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import type { Skill } from "@/client/api-types";
import { ManageSkillsDialog } from "./manage-skills-dialog";

// ---------------------------------------------------------------------------
// Mocks: queries + the Radix Dialog primitive (needs a DOM).
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
	useSkills: vi.fn(),
	useCreateSkill: vi.fn(),
	useUpdateSkill: vi.fn(),
	useDeleteSkill: vi.fn(),
}));

vi.mock("@/client/queries", () => mocks);

vi.mock("@/components/ui/dialog", () => ({
	Dialog: (props: { children?: ReactNode }) => <div>{props.children}</div>,
	DialogContent: (props: { children?: ReactNode }) => (
		<div>{props.children}</div>
	),
	DialogDescription: (props: { children?: ReactNode }) => (
		<p>{props.children}</p>
	),
	DialogHeader: (props: { children?: ReactNode }) => (
		<div>{props.children}</div>
	),
	DialogTitle: (props: { children?: ReactNode }) => <h2>{props.children}</h2>,
}));

vi.mock("@/components/ui/switch", () => ({
	Switch: (props: {
		"aria-label"?: string;
		checked?: boolean;
		onCheckedChange?: (checked: boolean) => void;
	}) => (
		<button
			aria-checked={props.checked}
			aria-label={props["aria-label"]}
			onClick={() => props.onCheckedChange?.(!props.checked)}
			role="switch"
			type="button"
		/>
	),
}));

const SKILLS: Skill[] = [
	{
		id: "skill-campaign-basics",
		slug: "campaign-basics",
		name: "Campaign basics",
		description: "A guided tour of the studio.",
		content: "# Campaign basics\n…",
		category: "campaign",
		builtin: true,
		enabled: true,
		createdAt: "",
		updatedAt: "",
	},
	{
		id: "custom-1",
		slug: "holiday-push",
		name: "Holiday push",
		description: "December promo playbook.",
		content: "# Holiday push\n…",
		category: "campaign",
		builtin: false,
		enabled: false,
		createdAt: "",
		updatedAt: "",
	},
];

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

function nativeButtons(renderer: ReactTestRenderer): ReactTestInstance[] {
	return renderer.root.findAll(
		(node) => typeof node.type === "string" && node.type === "button",
	);
}

function byId(instance: ReactTestInstance, id: string): ReactTestInstance {
	return instance.find((node) => node.props.id === id);
}

async function renderDialog(): Promise<ReactTestRenderer> {
	let captured: ReactTestRenderer | undefined;
	await act(async () => {
		captured = await create(
			<StrictMode>
				<ManageSkillsDialog open onOpenChange={() => {}} />
			</StrictMode>,
		);
	});
	if (!captured) throw new Error("test renderer did not mount");
	return captured;
}

describe("ManageSkillsDialog", () => {
	it("creates a skill from slug/name/description/markdown content", async () => {
		const createSkill = mutationStub();
		mocks.useSkills.mockReturnValue({ data: SKILLS, isPending: false });
		mocks.useCreateSkill.mockReturnValue(createSkill);
		mocks.useUpdateSkill.mockReturnValue(mutationStub());
		mocks.useDeleteSkill.mockReturnValue(mutationStub());
		const renderer = await renderDialog();

		await act(async () => {
			byId(renderer.root, "new-skill-slug").props.onChange({
				target: { value: " spring-teaser " },
			});
			byId(renderer.root, "new-skill-name").props.onChange({
				target: { value: " Spring teaser " },
			});
			byId(renderer.root, "new-skill-description").props.onChange({
				target: { value: "Teaser-week playbook." },
			});
			byId(renderer.root, "new-skill-content").props.onChange({
				target: { value: "# Spring teaser" },
			});
		});

		const form = renderer.root.find((node) => node.type === "form");
		await act(async () => {
			form.props.onSubmit({ preventDefault: () => {} });
		});

		expect(createSkill.mutateAsync).toHaveBeenCalledWith({
			slug: "spring-teaser",
			name: "Spring teaser",
			description: "Teaser-week playbook.",
			content: "# Spring teaser",
			category: "campaign",
		});
	});

	it("toggles a skill's enabled state", async () => {
		mocks.useSkills.mockReturnValue({ data: SKILLS, isPending: false });
		mocks.useCreateSkill.mockReturnValue(mutationStub());
		const updateSkill = mutationStub();
		mocks.useUpdateSkill.mockReturnValue(updateSkill);
		mocks.useDeleteSkill.mockReturnValue(mutationStub());
		const renderer = await renderDialog();

		// The disabled "Holiday push" row's switch: enabling it calls PATCH.
		const toggle = renderer.root.find(
			(node) =>
				typeof node.type === "string" &&
				node.props["aria-label"] === "Enable Holiday push",
		);
		expect(toggle.props["aria-checked"]).toBe(false);
		await act(async () => {
			toggle.props.onClick();
		});
		expect(updateSkill.mutateAsync).toHaveBeenCalledWith({
			skillId: "custom-1",
			enabled: true,
		});
	});

	it("edits content in the inline textarea and saves changed rows only", async () => {
		mocks.useSkills.mockReturnValue({ data: SKILLS, isPending: false });
		mocks.useCreateSkill.mockReturnValue(mutationStub());
		const updateSkill = mutationStub();
		mocks.useUpdateSkill.mockReturnValue(updateSkill);
		mocks.useDeleteSkill.mockReturnValue(mutationStub());
		const renderer = await renderDialog();

		const editButtons = nativeButtons(renderer).filter(
			(node) => node.children[0] === "Edit",
		);
		expect(editButtons).toHaveLength(2);
		await act(async () => {
			editButtons[1].props.onClick();
		});

		await act(async () => {
			byId(renderer.root, "skill-content-custom-1").props.onChange({
				target: { value: "# Holiday push\nUpdated steps" },
			});
		});
		const save = nativeButtons(renderer).find(
			(node) => node.children[0] === "Save" && !node.props.disabled,
		);
		expect(save).toBeDefined();
		await act(async () => {
			save?.props.onClick();
		});
		expect(updateSkill.mutateAsync).toHaveBeenCalledWith({
			skillId: "custom-1",
			name: "Holiday push",
			description: "December promo playbook.",
			content: "# Holiday push\nUpdated steps",
		});
	});

	it("arms delete with a confirm click and never offers it for builtin rows", async () => {
		mocks.useSkills.mockReturnValue({ data: SKILLS, isPending: false });
		mocks.useCreateSkill.mockReturnValue(mutationStub());
		mocks.useUpdateSkill.mockReturnValue(mutationStub());
		const deleteSkill = mutationStub();
		mocks.useDeleteSkill.mockReturnValue(deleteSkill);
		const renderer = await renderDialog();

		const deleteButtons = nativeButtons(renderer).filter(
			(node) => node.children[0] === "Delete",
		);
		// Two rows rendered — only the non-builtin one gets a Delete button.
		expect(deleteButtons).toHaveLength(1);

		// First click arms (no delete yet); the button flips to a
		// destructive "Confirm delete".
		await act(async () => {
			deleteButtons[0].props.onClick();
		});
		expect(deleteSkill.mutateAsync).not.toHaveBeenCalled();
		const armed = nativeButtons(renderer).find(
			(node) => node.children[0] === "Confirm delete",
		);
		expect(armed).toBeDefined();
		expect(armed?.props.className).toContain("destructive");

		// Second click deletes.
		await act(async () => {
			armed?.props.onClick();
		});
		expect(deleteSkill.mutateAsync).toHaveBeenCalledWith("custom-1");
	});

	it("shows the empty state before any skill exists", async () => {
		mocks.useSkills.mockReturnValue({ data: [], isPending: false });
		mocks.useCreateSkill.mockReturnValue(mutationStub());
		mocks.useUpdateSkill.mockReturnValue(mutationStub());
		mocks.useDeleteSkill.mockReturnValue(mutationStub());
		const renderer = await renderDialog();
		expect(JSON.stringify(renderer.toJSON())).toContain(
			"No skills yet — add the first one above.",
		);
	});
});
