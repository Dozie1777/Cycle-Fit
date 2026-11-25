import { type ReactNode, StrictMode } from "react";
import {
	act,
	create,
	type ReactTestInstance,
	type ReactTestRenderer,
} from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import type { Channel } from "@/client/api-types";
import { ManageChannelsDialog } from "./manage-channels-dialog";

// ---------------------------------------------------------------------------
// Mocks: queries + the Radix Dialog primitive (needs a DOM).
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
	useChannels: vi.fn(),
	useCreateChannel: vi.fn(),
	useUpdateChannel: vi.fn(),
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

const CHANNELS: Channel[] = [
	{ id: "chan-email", name: "Email", color: "#3b82f6", createdAt: "" },
	{ id: "chan-x", name: "X", color: null, createdAt: "" },
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
				<ManageChannelsDialog open onOpenChange={() => {}} />
			</StrictMode>,
		);
	});
	if (!captured) throw new Error("test renderer did not mount");
	return captured;
}

describe("ManageChannelsDialog", () => {
	it("creates a channel with trimmed name and optional color", async () => {
		const createChannel = mutationStub();
		mocks.useChannels.mockReturnValue({ data: CHANNELS, isPending: false });
		mocks.useCreateChannel.mockReturnValue(createChannel);
		mocks.useUpdateChannel.mockReturnValue(mutationStub());
		const renderer = await renderDialog();

		await act(async () => {
			byId(renderer.root, "new-channel-name").props.onChange({
				target: { value: "  Newsletter  " },
			});
			byId(renderer.root, "new-channel-color").props.onChange({
				target: { value: "#10b981" },
			});
		});

		const form = renderer.root.find((node) => node.type === "form");
		await act(async () => {
			form.props.onSubmit({ preventDefault: () => {} });
		});

		expect(createChannel.mutateAsync).toHaveBeenCalledWith({
			name: "Newsletter",
			color: "#10b981",
		});
	});

	it("saves a row's rename/recolor and keeps unchanged rows disabled", async () => {
		const updateChannel = mutationStub();
		mocks.useChannels.mockReturnValue({ data: CHANNELS, isPending: false });
		mocks.useCreateChannel.mockReturnValue(mutationStub());
		mocks.useUpdateChannel.mockReturnValue(updateChannel);
		const renderer = await renderDialog();

		// Every row starts unchanged → its Save button is disabled.
		const saveButtons = nativeButtons(renderer).filter(
			(node) => node.children[0] === "Save",
		);
		expect(saveButtons.length).toBe(2);
		expect(saveButtons.every((node) => node.props.disabled)).toBe(true);

		// Edit the Email row's name and clear-safe color.
		const emailNameInput = byId(renderer.root, "channel-name-chan-email");
		await act(async () => {
			emailNameInput.props.onChange({ target: { value: "Newsletter" } });
			byId(renderer.root, "channel-color-chan-email").props.onChange({
				target: { value: "#10b981" },
			});
		});

		// Exactly one Save is now enabled — the edited row's.
		const saveAfterEdit = nativeButtons(renderer).filter(
			(node) => node.children[0] === "Save",
		);
		const enabled = saveAfterEdit.filter((node) => !node.props.disabled);
		expect(enabled.length).toBe(1);
		await act(async () => {
			enabled[0].props.onClick();
		});

		expect(updateChannel.mutateAsync).toHaveBeenCalledWith({
			channelId: "chan-email",
			name: "Newsletter",
			color: "#10b981",
		});
	});

	it("shows the empty state before any channel exists", async () => {
		mocks.useChannels.mockReturnValue({ data: [], isPending: false });
		mocks.useCreateChannel.mockReturnValue(mutationStub());
		mocks.useUpdateChannel.mockReturnValue(mutationStub());
		const renderer = await renderDialog();
		expect(JSON.stringify(renderer.toJSON())).toContain(
			"No channels yet — add the first one above.",
		);
	});
});
