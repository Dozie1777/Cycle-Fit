import { type ReactNode, StrictMode, useState } from "react";
import {
	act,
	create,
	type ReactTestInstance,
	type ReactTestRenderer,
} from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { CreateProjectDialog } from "./create-project-dialog";

// ---------------------------------------------------------------------------
// Mocks: queries + the Radix Dialog primitive (needs a DOM).
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
	useCreateProject: vi.fn(),
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
	// Match the composite Input/Textarea component (whose onChange is the raw
	// handler), not the DOM node (whose onChange is Base UI's merged handler
	// and needs a full synthetic event).
	return instance.find((node) => {
		const name = typeof node.type === "function" ? node.type.name : "";
		return (name === "Input" || name === "Textarea") && node.props.id === id;
	});
}

type OpenChange = (open: boolean) => void;

async function renderDialog(
	onOpenChange: OpenChange = () => {},
): Promise<ReactTestRenderer> {
	let captured: ReactTestRenderer | undefined;
	await act(async () => {
		captured = await create(
			<StrictMode>
				<CreateProjectDialog onOpenChange={onOpenChange} open />
			</StrictMode>,
		);
	});
	if (!captured) throw new Error("test renderer did not mount");
	return captured;
}

function submitButton(renderer: ReactTestRenderer): ReactTestInstance {
	return nativeButtons(renderer).find(
		(node) => node.children[0] === "Create project",
	) as ReactTestInstance;
}

describe("CreateProjectDialog", () => {
	it("creates a project with trimmed name and description, then closes", async () => {
		const createProject = mutationStub();
		mocks.useCreateProject.mockReturnValue(createProject);
		const onOpenChange = vi.fn<OpenChange>();
		const renderer = await renderDialog(onOpenChange);

		await act(async () => {
			byId(renderer.root, "project-name").props.onChange({
				target: { value: " Spring teaser " },
			});
			byId(renderer.root, "project-description").props.onChange({
				target: { value: "Teaser-week designs. " },
			});
		});

		const form = renderer.root.find((node) => node.type === "form");
		await act(async () => {
			form.props.onSubmit({ preventDefault: () => {} });
		});

		expect(createProject.mutateAsync).toHaveBeenCalledWith({
			name: "Spring teaser",
			description: "Teaser-week designs.",
		});
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it("sends no description key when the description is blank", async () => {
		const createProject = mutationStub();
		mocks.useCreateProject.mockReturnValue(createProject);
		const renderer = await renderDialog();

		await act(async () => {
			byId(renderer.root, "project-name").props.onChange({
				target: { value: "Solo name" },
			});
			byId(renderer.root, "project-description").props.onChange({
				target: { value: "   " },
			});
		});

		const form = renderer.root.find((node) => node.type === "form");
		await act(async () => {
			form.props.onSubmit({ preventDefault: () => {} });
		});

		expect(createProject.mutateAsync).toHaveBeenCalledWith({
			name: "Solo name",
			description: undefined,
		});
	});

	it("keeps the submit button disabled until a name is entered", async () => {
		mocks.useCreateProject.mockReturnValue(mutationStub());
		const renderer = await renderDialog();

		expect(submitButton(renderer).props.disabled).toBe(true);

		await act(async () => {
			byId(renderer.root, "project-name").props.onChange({
				target: { value: "Named" },
			});
		});
		expect(submitButton(renderer).props.disabled).toBe(false);
	});

	it("shows a loading label and disables submit while creating", async () => {
		mocks.useCreateProject.mockReturnValue(mutationStub({ isPending: true }));
		const renderer = await renderDialog();

		const creating = nativeButtons(renderer).find(
			(node) => node.children[0] === "Creating…",
		);
		expect(creating).toBeDefined();
		expect(creating?.props.disabled).toBe(true);
	});

	it("displays a mutation error inside the dialog and stays open", async () => {
		const createProject = mutationStub({
			mutateAsync: vi.fn(() => Promise.reject(new Error("name taken"))),
		});
		mocks.useCreateProject.mockReturnValue(createProject);
		const onOpenChange = vi.fn<OpenChange>();
		const renderer = await renderDialog(onOpenChange);

		await act(async () => {
			byId(renderer.root, "project-name").props.onChange({
				target: { value: "Dupe" },
			});
		});
		const form = renderer.root.find((node) => node.type === "form");
		await act(async () => {
			form.props.onSubmit({ preventDefault: () => {} });
		});

		expect(JSON.stringify(renderer.toJSON())).toContain("name taken");
		expect(onOpenChange).not.toHaveBeenCalledWith(false);
	});

	it("the cancel button dismisses without submitting", async () => {
		const createProject = mutationStub();
		mocks.useCreateProject.mockReturnValue(createProject);
		const onOpenChange = vi.fn<OpenChange>();
		const renderer = await renderDialog(onOpenChange);

		const cancel = nativeButtons(renderer).find(
			(node) => node.children[0] === "Cancel",
		);
		await act(async () => {
			cancel?.props.onClick();
		});

		expect(createProject.mutateAsync).not.toHaveBeenCalled();
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it("clears fields and errors after the dialog closes", async () => {
		const createProject = mutationStub({
			mutateAsync: vi.fn(() => Promise.reject(new Error("boom"))),
		});
		mocks.useCreateProject.mockReturnValue(createProject);

		function Harness() {
			const [open, setOpen] = useState(true);
			return <CreateProjectDialog onOpenChange={setOpen} open={open} />;
		}

		let renderer: ReactTestRenderer | undefined;
		await act(async () => {
			renderer = await create(
				<StrictMode>
					<Harness />
				</StrictMode>,
			);
		});
		const root = renderer as unknown as ReactTestRenderer;

		await act(async () => {
			byId(root.root, "project-name").props.onChange({
				target: { value: "Stale" },
			});
			byId(root.root, "project-description").props.onChange({
				target: { value: "Stale description" },
			});
		});
		const form = root.root.find((node) => node.type === "form");
		await act(async () => {
			form.props.onSubmit({ preventDefault: () => {} });
		});
		expect(JSON.stringify(root.toJSON())).toContain("boom");

		// Close through the dialog's own onOpenChange, then reopen.
		const dialog = root.root.find((node) => node.props.onOpenChange);
		await act(async () => {
			dialog.props.onOpenChange(false);
		});
		await act(async () => {
			dialog.props.onOpenChange(true);
		});

		expect(byId(root.root, "project-name").props.value).toBe("");
		expect(byId(root.root, "project-description").props.value).toBe("");
		expect(JSON.stringify(root.toJSON())).not.toContain("boom");
	});
});
