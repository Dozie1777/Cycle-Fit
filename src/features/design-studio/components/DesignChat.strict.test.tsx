import { act, StrictMode, useEffect } from "react";
import {
	create,
	type ReactTestInstance,
	type ReactTestRenderer,
} from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignChat } from "./DesignChat";

const { getDesignMessages, sendMessage, chatState } = vi.hoisted(() => ({
	getDesignMessages: vi.fn(),
	sendMessage: vi.fn(),
	chatState: { status: "ready", messages: [] } as {
		status: string;
		messages: Array<{
			id: string;
			role: string;
			parts: Array<{
				type: string;
				text?: string;
				toolCallId?: string;
				state?: string;
				input?: unknown;
				output?: unknown;
			}>;
		}>;
	},
}));

vi.mock("@/client/trpc", () => ({
	asJson: (call: Promise<unknown>) => call,
	trpc: {
		designs: {
			listMessages: { query: getDesignMessages },
			assets: { list: { query: vi.fn().mockResolvedValue([]) } },
		},
	},
}));

vi.mock("@ai-sdk/react", () => ({
	useChat: () => ({
		messages: chatState.messages,
		sendMessage,
		status: chatState.status,
		error: undefined,
		stop: vi.fn(),
	}),
}));

vi.mock("@/client/rivet-actor-context", () => ({
	useActor: () => ({
		connection: {
			sendMessage: vi.fn(),
			on: vi.fn(() => vi.fn()),
		},
		isConnected: true,
	}),
}));

vi.mock("streamdown", () => ({
	Streamdown: ({ children }: { children: string }) => children,
}));

// DesignChat reads the skill library for the "/" menu (0020) and can open
// the manage-skills dialog — no rows and no-op mutations in these StrictMode
// effect tests.
vi.mock("@/client/queries", () => ({
	useSkills: () => ({ data: [], isPending: false }),
	useCreateSkill: () => ({ mutateAsync: vi.fn() }),
	useUpdateSkill: () => ({ mutateAsync: vi.fn() }),
	useDeleteSkill: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/components/ai-elements/conversation", () => ({
	Conversation: ({ children }: { children: React.ReactNode }) => children,
	ConversationContent: ({ children }: { children: React.ReactNode }) =>
		children,
	ConversationEmptyState: () => null,
	ConversationScrollButton: () => null,
}));

vi.mock("@/components/ai-elements/message", () => ({
	Message: ({ children }: { children: React.ReactNode }) => children,
	MessageContent: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/components/ai-elements/prompt-input", () => ({
	PromptInput: ({ children }: { children: React.ReactNode }) => children,
	PromptInputBody: ({ children }: { children: React.ReactNode }) => children,
	PromptInputFooter: ({ children }: { children: React.ReactNode }) => children,
	PromptInputButton: ({ children }: { children: React.ReactNode }) => (
		<button type="button">{children}</button>
	),
	PromptInputSubmit: () => <button type="button">Submit</button>,
	PromptInputTextarea: ({ disabled }: { disabled?: boolean }) => (
		<textarea name="message" disabled={disabled} />
	),
	PromptInputTools: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/components/ui/sheet", () => ({
	Sheet: ({ children }: { children: React.ReactNode }) => children,
	SheetContent: ({ children }: { children: React.ReactNode }) => children,
	SheetTrigger: ({ children }: { children: React.ReactNode }) => children,
	SheetTitle: () => null,
	SheetDescription: () => null,
}));

vi.mock("@/components/ai-elements/suggestion", () => ({
	Suggestion: () => null,
	Suggestions: () => null,
}));

vi.mock("@/components/ui/message-scroller", () => ({
	MessageScrollerItem: ({ children }: { children: React.ReactNode }) =>
		children,
	useMessageScroller: () => ({
		scrollToEnd: () => true,
		scrollToMessage: () => true,
		scrollToStart: () => true,
	}),
	useMessageScrollerScrollable: () => ({ start: false, end: false }),
}));

vi.mock("@/components/ai-elements/style-options", () => ({
	StyleOptions: () => null,
}));

vi.mock("@/components/ui/select", () => ({
	Select: ({ children }: { children: React.ReactNode }) => children,
	SelectContent: ({ children }: { children: React.ReactNode }) => children,
	SelectItem: ({ children }: { children: React.ReactNode }) => children,
	SelectTrigger: ({ children }: { children: React.ReactNode }) => children,
	SelectValue: () => null,
}));

vi.mock("@/components/ui/spinner", () => ({
	Spinner: () => null,
}));

describe("DesignChat StrictMode effects", () => {
	afterEach(() => {
		chatState.status = "ready";
		chatState.messages = [];
		vi.clearAllMocks();
		vi.unstubAllGlobals();
	});

	it("auto-sends an empty conversation exactly once during effect replay", async () => {
		getDesignMessages.mockResolvedValue([]);
		sendMessage.mockResolvedValue(undefined);
		vi.stubGlobal("localStorage", {
			clear: vi.fn(),
			getItem: vi.fn(() => null),
			setItem: vi.fn(),
			removeItem: vi.fn(),
		});
		let renderer: ReactTestRenderer | undefined;
		let replayedEffects = 0;

		function EffectReplayProbe() {
			useEffect(() => {
				replayedEffects += 1;
			}, []);
			return null;
		}

		await act(async () => {
			renderer = create(
				<StrictMode>
					<EffectReplayProbe />
					<DesignChat
						projectId="design-strict-mode"
						prompt="Build a landing page"
						status="ready"
						onTurnSettled={() => {}}
					/>
				</StrictMode>,
			);
			await Promise.resolve();
		});

		expect(replayedEffects).toBe(2);
		expect(getDesignMessages).toHaveBeenCalledTimes(1);
		expect(sendMessage).toHaveBeenCalledTimes(1);
		expect(sendMessage).toHaveBeenCalledWith({ text: "Build a landing page" });
		renderer?.unmount();
	});

	it("skips the auto-brief when autoBrief is false (remix forks)", async () => {
		getDesignMessages.mockResolvedValue([]);
		sendMessage.mockResolvedValue(undefined);
		vi.stubGlobal("localStorage", {
			clear: vi.fn(),
			getItem: vi.fn(() => null),
			setItem: vi.fn(),
			removeItem: vi.fn(),
		});
		let renderer: ReactTestRenderer | undefined;
		await act(async () => {
			renderer = create(
				<StrictMode>
					<DesignChat
						projectId="design-remix-fork"
						prompt="Remix of: Build a landing page"
						status="ready"
						onTurnSettled={() => {}}
						autoBrief={false}
					/>
				</StrictMode>,
			);
			await Promise.resolve();
		});
		// The fork already carries published files; the brief must not be
		// auto-sent (it would regenerate over the fork).
		expect(sendMessage).not.toHaveBeenCalled();
		renderer?.unmount();
	});

	it("enables the composer when the client stream reaches its terminal state", async () => {
		getDesignMessages.mockResolvedValue([]);
		vi.stubGlobal("localStorage", {
			getItem: vi.fn(() => null),
			setItem: vi.fn(),
		});
		chatState.status = "streaming";
		chatState.messages = [
			{
				id: "history",
				role: "assistant",
				parts: [{ type: "text", text: "done" }],
			},
		];
		let renderer: ReactTestRenderer | undefined;
		await act(async () => {
			renderer = create(
				<DesignChat
					projectId="design-terminal-state"
					prompt="Build a landing page"
					status="ready"
					onTurnSettled={() => {}}
				/>,
			);
			await Promise.resolve();
		});
		expect(renderer?.root.findByType("textarea").props.disabled).toBe(true);

		chatState.status = "ready";
		await act(async () => {
			renderer?.update(
				<DesignChat
					projectId="design-terminal-state"
					prompt="Build a landing page"
					status="ready"
					onTurnSettled={() => {}}
				/>,
			);
		});
		expect(renderer?.root.findByType("textarea").props.disabled).toBe(false);
		renderer?.unmount();
	});

	it("recovers a finished turn after a mid-turn remount without background re-requests", async () => {
		// Mid-turn remount: the original useChat (and its stream) is torn
		// down, so the remounted chat can never see the turn's onFinish.
		// The remount must (a) serve the cached transcript WITHOUT re-
		// requesting listMessages, and (b) once the live status poll sees
		// the server-side turn settle (chatting → ready), force-reload the
		// transcript from D1 so the completed turn's messages appear.
		getDesignMessages.mockResolvedValue([
			{
				id: "partial",
				role: "assistant",
				parts: [{ type: "text", text: "partial stream" }],
			},
		]);
		vi.stubGlobal("localStorage", {
			getItem: vi.fn(() => null),
			setItem: vi.fn(),
		});
		chatState.status = "ready";
		chatState.messages = [];

		let renderer: ReactTestRenderer | undefined;
		const mount = async (status: string) => {
			await act(async () => {
				renderer = create(
					<DesignChat
						projectId="design-midturn-remount"
						prompt="Build a landing page"
						status={status}
						onTurnSettled={() => {}}
					/>,
				);
				await Promise.resolve();
			});
		};

		// First mount while the server streams: history fetch + cache seed.
		await mount("chatting");
		expect(getDesignMessages).toHaveBeenCalledTimes(1);

		// Remount mid-turn (panel reconfiguration): the cached transcript
		// is served synchronously — no new history request.
		renderer?.unmount();
		await mount("chatting");
		expect(getDesignMessages).toHaveBeenCalledTimes(1);

		// The status poll observes the turn settle: force-reload from D1.
		await act(async () => {
			renderer?.update(
				<DesignChat
					projectId="design-midturn-remount"
					prompt="Build a landing page"
					status="ready"
					onTurnSettled={() => {}}
				/>,
			);
		});
		expect(getDesignMessages).toHaveBeenCalledTimes(2);
		renderer?.unmount();
	});

	it("renders the open_element_chat handoff and opens the element chat on click", async () => {
		// KUK-944: a successful open_element_chat tool result renders an
		// affordance; clicking it hands the session to the studio, which
		// mounts the focused element-chat panel.
		getDesignMessages.mockResolvedValue([]);
		vi.stubGlobal("localStorage", {
			getItem: vi.fn(() => null),
			setItem: vi.fn(),
		});
		chatState.status = "ready";
		chatState.messages = [
			{
				id: "handoff",
				role: "assistant",
				parts: [
					{
						type: "tool-open_element_chat",
						toolCallId: "tc-handoff",
						state: "output",
						input: {},
						output: {
							ok: true,
							elementChatId: "ec-1",
							elementType: "component",
							elementName: "Calendar",
							note: "compact month grid",
						},
					},
				],
			},
		];
		const onOpenElementChat = vi.fn();
		let renderer: ReactTestRenderer | undefined;
		await act(async () => {
			renderer = create(
				<DesignChat
					projectId="design-element-handoff"
					prompt="Build a landing page"
					status="ready"
					onTurnSettled={() => {}}
					onOpenElementChat={onOpenElementChat}
				/>,
			);
			await Promise.resolve();
		});

		const openButton = renderer?.root
			.findAllByType("button")
			.find((node) =>
				JSON.stringify(node.props.children ?? "").includes("Open chat"),
			);
		expect(openButton).toBeDefined();
		await act(async () => {
			openButton?.props.onClick();
		});
		expect(onOpenElementChat).toHaveBeenCalledWith({
			elementChatId: "ec-1",
			elementType: "component",
			elementName: "Calendar",
			note: "compact month grid",
		});
		renderer?.unmount();
	});
});

describe("DesignChat element-chat handoff (open_element_chat)", () => {
	afterEach(() => {
		chatState.status = "ready";
		chatState.messages = [];
		vi.clearAllMocks();
		vi.unstubAllGlobals();
	});

	/** Finds a rendered <button> whose text content includes `text`. */
	function findButtonByText(
		renderer: ReactTestRenderer,
		text: string,
	): ReactTestInstance | undefined {
		const flatten = (node: { children?: unknown[] }): string[] => {
			const out: string[] = [];
			for (const child of node.children ?? []) {
				if (typeof child === "string") out.push(child);
				else if (child != null && typeof child === "object")
					out.push(...flatten(child as { children?: unknown[] }));
			}
			return out;
		};
		return renderer.root
			.findAll((node) => node.type === "button")
			.find((button) => flatten(button).join("").includes(text));
	}

	it("renders the handoff card and opens the element chat on click", async () => {
		getDesignMessages.mockResolvedValue([]);
		vi.stubGlobal("localStorage", {
			clear: vi.fn(),
			getItem: vi.fn(() => null),
			setItem: vi.fn(),
			removeItem: vi.fn(),
		});
		chatState.status = "ready";
		// A completed open_element_chat tool call in the transcript.
		chatState.messages = [
			{
				id: "handoff-turn",
				role: "assistant",
				parts: [
					{
						type: "tool-open_element_chat",
						toolCallId: "call-1",
						state: "output-available",
						input: { elementType: "component", elementId: "comp-1" },
						output: {
							ok: true,
							elementChatId: "ec-1",
							elementType: "component",
							elementName: "PricingCard",
							created: true,
							note: "tighten the pricing card",
						},
					},
				],
			},
		] as unknown as typeof chatState.messages;

		const onOpenElementChat = vi.fn();
		let renderer: ReactTestRenderer | undefined;
		await act(async () => {
			renderer = create(
				<DesignChat
					projectId="design-handoff"
					prompt="Build a landing page"
					status="ready"
					onTurnSettled={() => {}}
					autoBrief={false}
					onOpenElementChat={onOpenElementChat}
				/>,
			);
			await Promise.resolve();
		});

		const openButton = renderer
			? findButtonByText(renderer, "Open chat")
			: undefined;
		expect(openButton).toBeDefined();
		await act(async () => {
			openButton?.props.onClick();
			await Promise.resolve();
		});
		expect(onOpenElementChat).toHaveBeenCalledWith({
			elementChatId: "ec-1",
			elementType: "component",
			elementName: "PricingCard",
			note: "tighten the pricing card",
		});
		renderer?.unmount();
	});

	it("does not render a handoff card for a failed open_element_chat call", async () => {
		getDesignMessages.mockResolvedValue([]);
		vi.stubGlobal("localStorage", {
			clear: vi.fn(),
			getItem: vi.fn(() => null),
			setItem: vi.fn(),
			removeItem: vi.fn(),
		});
		chatState.status = "ready";
		chatState.messages = [
			{
				id: "failed-turn",
				role: "assistant",
				parts: [
					{
						type: "tool-open_element_chat",
						toolCallId: "call-2",
						state: "output-available",
						input: { elementType: "component", elementId: "comp-1" },
						output: {
							ok: false,
							error: "component comp-1 not found",
						},
					},
				],
			},
		] as unknown as typeof chatState.messages;

		const onOpenElementChat = vi.fn();
		let renderer: ReactTestRenderer | undefined;
		await act(async () => {
			renderer = create(
				<DesignChat
					projectId="design-handoff-failed"
					prompt="Build a landing page"
					status="ready"
					onTurnSettled={() => {}}
					autoBrief={false}
					onOpenElementChat={onOpenElementChat}
				/>,
			);
			await Promise.resolve();
		});

		expect(
			renderer ? findButtonByText(renderer, "Open chat") : undefined,
		).toBeUndefined();
		expect(onOpenElementChat).not.toHaveBeenCalled();
		renderer?.unmount();
	});
});
