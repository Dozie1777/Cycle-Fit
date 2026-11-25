import { type ReactNode, StrictMode } from "react";
import {
	act,
	create,
	type ReactTestInstance,
	type ReactTestRenderer,
} from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import type { Channel } from "@/client/api-types";
import { ChannelPicker, ChannelSelect } from "./channel-select";

// ---------------------------------------------------------------------------
// Mocks: queries + the Base UI Select primitive (needs a DOM). The Select
// mock records props so tests can drive onValueChange directly.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
	useChannels: vi.fn(),
	selectProps: vi.fn(),
	manageDialogProps: vi.fn(),
}));

vi.mock("@/client/queries", () => mocks);

vi.mock("./manage-channels-dialog", () => ({
	ManageChannelsDialog: (props: { open: boolean }) => {
		mocks.manageDialogProps(props);
		return props.open ? <div data-manage-dialog="open" /> : null;
	},
}));

vi.mock("@/components/ui/select", () => ({
	Select: (props: Record<string, unknown> & { children?: ReactNode }) => {
		mocks.selectProps(props);
		return <div>{props.children}</div>;
	},
	SelectTrigger: (props: { children?: ReactNode }) => (
		<div>{props.children}</div>
	),
	SelectValue: ({ children }: { children?: ReactNode }) => <>{children}</>,
	SelectContent: (props: { children?: ReactNode }) => (
		<div>{props.children}</div>
	),
	SelectItem: (props: { value: string; children?: ReactNode }) => (
		<div data-select-item={props.value}>{props.children}</div>
	),
}));

const CHANNELS: Channel[] = [
	{ id: "chan-email", name: "Email", color: "#3b82f6", createdAt: "" },
	{ id: "chan-x", name: "X", color: null, createdAt: "" },
];

function byItem(instance: ReactTestInstance, value: string) {
	return instance.findAll((node) => node.props["data-select-item"] === value);
}

async function render(node: ReactNode): Promise<ReactTestRenderer> {
	let captured: ReactTestRenderer | undefined;
	await act(async () => {
		captured = await create(<StrictMode>{node}</StrictMode>);
	});
	if (!captured) throw new Error("test renderer did not mount");
	return captured;
}

describe("ChannelSelect", () => {
	it("renders an option per channel plus the no-channel and manage entries", async () => {
		mocks.useChannels.mockReturnValue({ data: CHANNELS });
		mocks.selectProps.mockClear();
		const renderer = await render(
			<ChannelSelect
				id="test-select"
				value=""
				onChange={() => {}}
				channels={CHANNELS}
			/>,
		);
		const items = renderer.root.findAll(
			(node) => node.props["data-select-item"] !== undefined,
		);
		const values = items.map((node) => node.props["data-select-item"]);
		expect(values).toContain("");
		expect(values).toContain("chan-email");
		expect(values).toContain("chan-x");
		expect(values).toContain("__manage__");
		// Channel names + no-channel label are visible.
		expect(JSON.stringify(renderer.toJSON())).toContain("Email");
	});

	it("shows the legacy free-text name as a grayed legacy hint for unmigrated rows", async () => {
		const renderer = await render(
			<ChannelSelect
				id="test-select"
				value=""
				onChange={() => {}}
				channels={CHANNELS}
				legacyName="email newsletter"
			/>,
		);
		// No duplicate "" item anymore — the legacy value is a hint line.
		expect(byItem(renderer.root, "").length).toBe(1);
		const text = JSON.stringify(renderer.toJSON());
		expect(text).toContain("email newsletter");
		expect(text).toContain("(legacy — pick a channel to link it)");
	});

	it("opens the manage-channels dialog from the ＋ New channel item", async () => {
		mocks.manageDialogProps.mockClear();
		const renderer = await render(
			<ChannelSelect
				id="test-select"
				value=""
				onChange={() => {}}
				channels={CHANNELS}
			/>,
		);
		// Closed initially.
		expect(mocks.manageDialogProps).toHaveBeenCalledWith(
			expect.objectContaining({ open: false }),
		);
		const selectProps = mocks.selectProps.mock.calls.at(-1)?.[0] as {
			onValueChange: (value: string) => void;
		};
		await act(async () => {
			selectProps.onValueChange("__manage__");
		});
		expect(mocks.manageDialogProps).toHaveBeenLastCalledWith(
			expect.objectContaining({ open: true }),
		);
		expect(
			renderer.root.findAll(
				(node) => node.props["data-manage-dialog"] === "open",
			).length,
		).toBe(1);
	});

	it("routes channel picks through onChange", async () => {
		const onChange = vi.fn();
		await render(
			<ChannelSelect
				id="test-select"
				value=""
				onChange={onChange}
				channels={CHANNELS}
			/>,
		);
		const selectProps = mocks.selectProps.mock.calls.at(-1)?.[0] as {
			onValueChange: (value: string) => void;
		};
		await act(async () => {
			selectProps.onValueChange("chan-x");
		});
		expect(onChange).toHaveBeenCalledWith("chan-x");
	});
});

describe("ChannelPicker", () => {
	it("wires the shared channels query into the select with a label", async () => {
		mocks.useChannels.mockReturnValue({ data: CHANNELS });
		const renderer = await render(
			<ChannelPicker
				id="picker"
				label="Channel"
				value="chan-email"
				onChange={() => {}}
			/>,
		);
		expect(
			renderer.root.findAll((node) => node.props["data-select-item"]).length,
		).toBeGreaterThan(0);
		// The label targets the trigger id.
		expect(
			renderer.root.findAll((node) => node.props.htmlFor === "picker").length,
		).toBeGreaterThan(0);
	});
});
