import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { useCallback, useEffect, useRef, useState } from "react";
import { Streamdown } from "streamdown";
import { useElementChat } from "@/client/queries";
import { useActor } from "@/client/rivet-actor-context";
import { parseStoredParts } from "@/client/stored-parts";
import { asJson, trpc } from "@/client/trpc";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ElementChatTransport } from "@/features/design-studio/element-chat/transport";

/** The orchestrator handoff payload (open_element_chat tool result). */
export type OpenElementChat = {
	elementChatId: string;
	elementType: string;
	elementName: string;
	note: string | null;
};

type ElementChatMessage = {
	id: string;
	role: string;
	content: string;
	/** Raw JSON array of the assistant turn's UI parts; null on user rows and pre-feature rows. */
	parts: string | null;
	createdAt: string;
};

function toUIMessage(row: ElementChatMessage): UIMessage {
	// Rebuild the full live-turn parts (reasoning + tool calls) from the
	// persisted JSON; fall back to the flat text for rows without parts.
	const stored = parseStoredParts(row.parts);
	return {
		id: row.id,
		role: row.role === "user" ? "user" : "assistant",
		parts:
			stored.length > 0
				? (stored as UIMessage["parts"])
				: [{ type: "text", text: row.content }],
	};
}

// Remount cache (same contract as the design and campaign chats): keeps the
// latest transcript in memory so a panel remount (mobile tab switch, panel
// reconfiguration) renders instantly and never re-requests listMessages.
// The Inner syncs live chat state back into it as turns stream.
const historyCache = new Map<string, UIMessage[]>();

/** Test-only: clears the remount cache (tests share session ids). */
export function __resetElementHistoryCacheForTests(): void {
	historyCache.clear();
}

/**
 * The focused element-chat surface (KUK-945): one scoped chat for one
 * design element, mounted as the studio's element panel (4th resizable
 * panel on desktop, third mobile tab). The connection binds to the session
 * at connect time (actor params — the server derives the conversation,
 * never the client), history loads once through the elementChats router,
 * and turns stream through the project-wide elementChat actor. Remount
 * resilience mirrors the main chats: cached transcript + settle-recovery
 * when the live session poll sees a mid-turn remount's turn finish, and a
 * forced remount when the connection drops mid-turn (see the recovery
 * effect in the body below).
 */
export function ElementChatPanel({
	projectId,
	session,
	onClose,
}: {
	projectId: string;
	session: OpenElementChat;
	onClose: () => void;
}) {
	// Bumped by the body's connection-drop recovery: a fresh mount is the
	// only way to unstick a useChat whose stream died mid-turn (a busy
	// useChat ignores fresh `messages`, so reloading history in place can
	// never replace the hung stream).
	const [reloadKey, setReloadKey] = useState(0);
	// Stable identity: the body's settle-recovery effect depends on this
	// callback, so an unstable inline arrow would replace the effect on
	// every parent render — re-initializing prevStatusRef from the NEW
	// status before the chatting → settled transition is ever observed.
	const handleForcedReload = useCallback(() => {
		// Drop the cached transcript first: it holds the partial
		// stream state of the hung mount, and a fresh mount would
		// serve it and never re-request the completed turn.
		historyCache.delete(session.elementChatId);
		setReloadKey((k) => k + 1);
	}, [session.elementChatId]);
	return (
		<ElementChatBody
			key={reloadKey}
			projectId={projectId}
			session={session}
			onClose={onClose}
			onForcedReload={handleForcedReload}
		/>
	);
}

function ElementChatBody({
	projectId,
	session,
	onClose,
	onForcedReload,
}: {
	projectId: string;
	session: OpenElementChat;
	onClose: () => void;
	onForcedReload: () => void;
}) {
	// Seed from the remount cache so a remount renders immediately.
	const [initialMessages, setInitialMessages] = useState<UIMessage[] | null>(
		() => historyCache.get(session.elementChatId) ?? null,
	);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [draft, setDraft] = useState("");
	const bootstrapped = useRef(false);

	const { connection, isConnected } = useActor({
		name: "elementChat",
		key: ["elementChat", projectId],
		params: { elementChatId: session.elementChatId },
	});

	// Live session status: drives settle-recovery and the stuck/error line.
	const sessionQuery = useElementChat(session.elementChatId, { live: true });
	const status = sessionQuery.data?.status ?? null;

	const load = useCallback(
		(force = false) => {
			const cached = historyCache.get(session.elementChatId);
			if (cached && !force) {
				setInitialMessages(cached);
				setLoadError(null);
				return;
			}
			setLoadError(null);
			setInitialMessages(null);
			void (async () => {
				try {
					const history = await asJson(
						trpc.elementChats.listMessages.query({
							elementChatId: session.elementChatId,
						}),
					);
					const messages = history.map(toUIMessage);
					historyCache.set(session.elementChatId, messages);
					setInitialMessages(messages);
				} catch (e) {
					setLoadError(e instanceof Error ? e.message : String(e));
					setInitialMessages([]);
				}
			})();
		},
		[session.elementChatId],
	);

	useEffect(() => {
		if (bootstrapped.current) return;
		bootstrapped.current = true;
		load();
	}, [load]);

	const transportRef = useRef<ElementChatTransport | null>(null);
	if (connection && !transportRef.current) {
		transportRef.current = new ElementChatTransport(
			// RivetKit's ActorConn is structurally richer than the minimal
			// shape the transport needs — same cast the campaign chat uses.
			connection as unknown as ConstructorParameters<
				typeof ElementChatTransport
			>[0],
		);
	}

	const {
		messages,
		sendMessage,
		status: chatStatus,
		error,
		stop,
		regenerate,
		clearError,
	} = useChat({
		id: `element-${session.elementChatId}`,
		messages: initialMessages ?? undefined,
		transport: connection ? (transportRef.current ?? undefined) : undefined,
	});

	// Keep the remount cache in sync with the live chat state.
	useEffect(() => {
		historyCache.set(session.elementChatId, messages);
	}, [session.elementChatId, messages]);

	// Mid-turn remount + connection-drop recovery (mirrors the main chats).
	const streamedHereRef = useRef(false);
	const busy = chatStatus === "submitted" || chatStatus === "streaming";
	if (busy) streamedHereRef.current = true;
	// Latest chat status for the recovery timer below, without the effect
	// depending on it (the effect must only run on status changes).
	const chatStatusRef = useRef(chatStatus);
	chatStatusRef.current = chatStatus;
	const prevStatusRef = useRef(status);
	useEffect(() => {
		const wasChatting = prevStatusRef.current;
		prevStatusRef.current = status;
		if (wasChatting !== "chatting" || status == null || status === "chatting")
			return;
		if (!streamedHereRef.current) {
			// Mid-turn remount: this instance never streamed the in-flight
			// turn (a panel remount tore down the original useChat), so its
			// onFinish can never fire. The live session poll observed the
			// server finish it — force-reload the transcript from D1 (an
			// idle useChat syncs fresh `messages`).
			load(true);
			return;
		}
		// Connection-drop recovery: this instance streamed the turn, but
		// the WebSocket died mid-turn (the turn itself kept running and
		// persisted server-side), so turnFinished never arrived on the
		// dead connection and useChat stays busy forever. A busy useChat
		// ignores fresh messages, so only a forced remount can show the
		// completed turn. Give the healthy tail a few seconds to drain
		// (the settle may race the last chunks), then remount if still
		// busy.
		const stillBusy =
			chatStatusRef.current === "submitted" ||
			chatStatusRef.current === "streaming";
		if (!stillBusy) return;
		const timer = setTimeout(() => {
			if (
				chatStatusRef.current === "submitted" ||
				chatStatusRef.current === "streaming"
			) {
				onForcedReload();
			}
		}, 5000);
		return () => clearTimeout(timer);
	}, [status, load, onForcedReload]);

	if (initialMessages === null || !isConnected || !connection) {
		return (
			<PanelFrame session={session} onClose={onClose}>
				<div className="flex flex-1 items-center justify-center p-4 text-sm text-muted-foreground">
					{loadError ? (
						`Failed to load history: ${loadError}`
					) : (
						<>
							<Spinner /> loading conversation…
						</>
					)}
				</div>
			</PanelFrame>
		);
	}

	async function handleSend(event: React.FormEvent) {
		event.preventDefault();
		const text = draft.trim();
		if (!text || busy) return;
		setDraft("");
		clearError();
		await sendMessage({ text });
	}

	return (
		<PanelFrame session={session} onClose={onClose}>
			<div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
				{session.note && (
					<p className="rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground">
						{session.note}
					</p>
				)}
				{messages.map((message) => (
					<div
						key={message.id}
						className={
							message.role === "user"
								? "ml-8 rounded-lg bg-primary/10 p-2.5 text-sm"
								: "mr-8 rounded-lg border p-2.5 text-sm"
						}
					>
						{message.parts.map((part, index) =>
							part.type === "text" ? (
								<Streamdown
									// biome-ignore lint/suspicious/noArrayIndexKey: parts are append-only
									key={index}
								>
									{part.text}
								</Streamdown>
							) : null,
						)}
					</div>
				))}
				{busy && (
					<div className="mr-8 flex items-center gap-2 rounded-lg border p-2.5 text-xs text-muted-foreground">
						<Spinner /> thinking…
					</div>
				)}
				{error && (
					<div className="flex items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive">
						<span>{error.message || "turn failed"}</span>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="h-6 px-2"
							onClick={() => void regenerate()}
						>
							Retry
						</Button>
					</div>
				)}
			</div>
			<form onSubmit={handleSend} className="flex items-end gap-2 border-t p-3">
				<Textarea
					value={draft}
					onChange={(e) => setDraft(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && !e.shiftKey) {
							e.preventDefault();
							void handleSend(e);
						}
					}}
					rows={2}
					maxLength={8000}
					placeholder={`Ask about the ${session.elementName} ${session.elementType}…`}
					className="min-h-0 flex-1 resize-none"
				/>
				{busy ? (
					<Button type="button" variant="outline" onClick={() => void stop()}>
						Stop
					</Button>
				) : (
					<Button type="submit" disabled={!draft.trim()}>
						Send
					</Button>
				)}
			</form>
		</PanelFrame>
	);
}

/** Panel chrome: header + close, sized by the parent (panel or overlay). */
function PanelFrame({
	session,
	onClose,
	children,
}: {
	session: OpenElementChat;
	onClose: () => void;
	children: React.ReactNode;
}) {
	return (
		<div className="flex h-full w-full min-w-0 flex-col">
			<div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
				<div className="min-w-0">
					<p className="truncate text-sm font-semibold">
						{session.elementName}{" "}
						<span className="font-normal text-muted-foreground">
							({session.elementType})
						</span>
					</p>
					<p className="text-xs text-muted-foreground">Element chat</p>
				</div>
				<Button type="button" variant="outline" size="sm" onClick={onClose}>
					Close
				</Button>
			</div>
			{children}
		</div>
	);
}
