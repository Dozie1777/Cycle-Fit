// Client tests for the element-chat panel's settle-recovery (the Code
// Review warning on KUK-944): when the live session poll sees the server
// finish a turn, both a remounted panel (never streamed) and a panel whose
// stream died mid-turn (stuck busy useChat) must recover the completed
// transcript from D1. Follows component-library.test.tsx: mocked queries +
// react-test-renderer (no DOM).
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	__resetElementHistoryCacheForTests,
	ElementChatPanel,
} from "./element-chat-panel";

const mocks = vi.hoisted(() => ({
	listMessages: vi.fn(),
	chatState: {
		status: "ready",
		messages: [] as Array<Record<string, unknown>>,
	},
	sendMessage: vi.fn(),
	sessionStatus: { status: "chatting" },
}));

vi.mock("@/client/trpc", () => ({
	asJson: (call: Promise<unknown>) => call,
	trpc: {
		elementChats: {
			listMessages: { query: mocks.listMessages },
			get: { query: vi.fn() },
		},
	},
}));

// The live session poll (useElementChat) reads from the mutable holder so
// a test can flip the server-side status between renders.
vi.mock("@/client/queries", () => ({
	useElementChat: () => ({ data: { status: mocks.sessionStatus.status } }),
}));

vi.mock("@ai-sdk/react", () => ({
	useChat: () => ({
		messages: mocks.chatState.messages,
		sendMessage: mocks.sendMessage,
		status: mocks.chatState.status,
		error: undefined,
		stop: vi.fn(),
		regenerate: vi.fn(),
		clearError: vi.fn(),
	}),
}));

vi.mock("@/client/rivet-actor-context", () => ({
	useActor: () => ({
		connection: { sendMessage: vi.fn(), on: vi.fn(() => vi.fn()) },
		isConnected: true,
	}),
}));

vi.mock("streamdown", () => ({
	Streamdown: ({ children }: { children: string }) => children,
}));

const session = {
	elementChatId: "ec-recovery",
	elementType: "component",
	elementName: "PricingCard",
	note: null,
} as const;

function mount(rendererBox: { renderer?: ReactTestRenderer }) {
	return act(async () => {
		rendererBox.renderer = create(
			<ElementChatPanel
				projectId="project-1"
				session={session}
				onClose={() => {}}
			/>,
		);
	});
}

function settle(rendererBox: { renderer?: ReactTestRenderer }) {
	return act(async () => {
		rendererBox.renderer?.update(
			<ElementChatPanel
				projectId="project-1"
				session={session}
				onClose={() => {}}
			/>,
		);
	});
}

describe("ElementChatPanel settle-recovery", () => {
	beforeEach(() => {
		// All tests share the session id; the module-level remount cache
		// would otherwise serve the previous test's transcript.
		__resetElementHistoryCacheForTests();
	});

	afterEach(() => {
		mocks.chatState.status = "ready";
		mocks.chatState.messages = [];
		mocks.sessionStatus.status = "chatting";
		vi.clearAllMocks();
		vi.useRealTimers();
	});

	it("force-remounts a stuck stream when the server settles mid-turn (connection drop)", async () => {
		vi.useFakeTimers();
		mocks.listMessages.mockResolvedValue([]);
		// This mount streamed the turn (busy) — and stays busy because the
		// WebSocket died before turnFinished arrived.
		mocks.chatState.status = "streaming";
		const rendererBox: { renderer?: ReactTestRenderer } = {};
		await mount(rendererBox);
		expect(mocks.listMessages).toHaveBeenCalledTimes(1);

		// The live poll observes the server settle while the local stream
		// is still busy → 5s grace → forced remount → fresh history load.
		mocks.sessionStatus.status = "ready";
		await settle(rendererBox);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(5000);
		});
		expect(mocks.listMessages).toHaveBeenCalledTimes(2);
		rendererBox.renderer?.unmount();
	});

	it("does not remount a stream that drains normally after the settle", async () => {
		vi.useFakeTimers();
		mocks.listMessages.mockResolvedValue([]);
		mocks.chatState.status = "streaming";
		const rendererBox: { renderer?: ReactTestRenderer } = {};
		await mount(rendererBox);

		mocks.sessionStatus.status = "ready";
		await settle(rendererBox);
		// The healthy tail drains: turnFinished arrives and useChat goes
		// idle before the grace period ends → no forced remount.
		mocks.chatState.status = "ready";
		await settle(rendererBox);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(6000);
		});
		expect(mocks.listMessages).toHaveBeenCalledTimes(1);
		rendererBox.renderer?.unmount();
	});

	it("reloads history for a remounted panel that never streamed the turn", async () => {
		mocks.listMessages.mockResolvedValue([]);
		// This mount never went busy (a panel remount tore down the
		// original stream); the server is finishing the turn.
		mocks.chatState.status = "ready";
		const rendererBox: { renderer?: ReactTestRenderer } = {};
		await mount(rendererBox);
		expect(mocks.listMessages).toHaveBeenCalledTimes(1);

		mocks.sessionStatus.status = "ready";
		await settle(rendererBox);
		expect(mocks.listMessages).toHaveBeenCalledTimes(2);
		rendererBox.renderer?.unmount();
	});
});
