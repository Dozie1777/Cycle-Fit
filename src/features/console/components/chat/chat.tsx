"use client";

import { SendIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useActor } from "@/client/rivet-actor-context";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import {
	Message,
	MessageAvatar,
	MessageContent,
} from "@/components/ui/message";
import {
	MessageScroller,
	MessageScrollerButton,
	MessageScrollerContent,
	MessageScrollerItem,
	MessageScrollerProvider,
	MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

type ChatRole = "user" | "assistant" | "system";

type ChatMessage = {
	id: string;
	conversationId: string;
	role: ChatRole;
	content: string;
	createdAt: number;
	metadata: string | null;
};

type Conversation = {
	id: string;
	title: string | null;
	createdAt: number;
	updatedAt: number;
};

type ChatProps = {
	actorName: "chat" | "projectChat";
	actorKey: [string, string];
	title?: string;
};

// RivetKit's client types infer the return type of async actions as
// `Promise<Promise<T>>` (the inner Promise comes from the action function
// itself, then `ActorActionFunction` wraps it again). At runtime the actor
// returns `Promise<T>`, so we unwrap the extra Promise layer for the
// connection's action methods.
type ActorConnection = NonNullable<
	ReturnType<typeof useActor<"chat">>["connection"]
>;
type UnwrapActorActions<T> = {
	[K in keyof T]: T[K] extends (
		...args: infer Args
	) => Promise<Promise<infer R>>
		? (...args: Args) => Promise<R>
		: T[K];
};
type ChatConnection = UnwrapActorActions<ActorConnection>;

export function Chat({ actorName, actorKey, title }: ChatProps) {
	const { connection: rawConnection, isConnected } = useActor({
		name: actorName,
		key: actorKey,
	});
	const connection = rawConnection as ChatConnection | null;
	const [conversations, setConversations] = useState<Conversation[]>([]);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const selectedIdRef = useRef(selectedId);
	const [messages, setMessages] = useState<Map<string, ChatMessage>>(new Map());
	const [streaming, setStreaming] = useState<Map<string, string>>(new Map());
	const [loadingConversations, setLoadingConversations] = useState(false);
	const [loadingMessages, setLoadingMessages] = useState(false);
	const [sending, setSending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [draft, setDraft] = useState("");
	const bootstrapped = useRef(false);

	useEffect(() => {
		selectedIdRef.current = selectedId;
	}, [selectedId]);

	useEffect(() => {
		if (!connection || bootstrapped.current) return;
		bootstrapped.current = true;
		setLoadingConversations(true);
		setError(null);
		connection
			.listConversations()
			.then(({ conversations: rows }) => {
				setConversations(rows);
				if (rows[0]) setSelectedId(rows[0].id);
			})
			.catch((cause) => {
				setError(cause instanceof Error ? cause.message : String(cause));
			})
			.finally(() => setLoadingConversations(false));
	}, [connection]);

	useEffect(() => {
		if (!connection || !selectedId) return;
		setLoadingMessages(true);
		setError(null);
		setStreaming(new Map());
		connection
			.getMessages(selectedId, { limit: 50 })
			.then(({ messages: rows }) => {
				setMessages(new Map(rows.map((m) => [m.id, m])));
			})
			.catch((cause) => {
				setError(cause instanceof Error ? cause.message : String(cause));
			})
			.finally(() => setLoadingMessages(false));
	}, [connection, selectedId]);

	useEffect(() => {
		if (!connection) return;

		const unsubscribeDelta = connection.on("messageDelta", (payload) => {
			if (payload.conversationId !== selectedIdRef.current) return;
			setStreaming((prev) => {
				const next = new Map(prev);
				next.set(
					payload.messageId,
					(prev.get(payload.messageId) ?? "") + payload.content,
				);
				return next;
			});
		});

		const unsubscribeComplete = connection.on("messageComplete", (payload) => {
			if (payload.conversationId !== selectedIdRef.current) return;
			setMessages((prev) =>
				new Map(prev).set(payload.message.id, payload.message),
			);
			setStreaming((prev) => {
				const next = new Map(prev);
				next.delete(payload.message.id);
				return next;
			});
			setConversations((prev) =>
				prev
					.map((conversation) =>
						conversation.id === payload.conversationId
							? { ...conversation, updatedAt: Date.now() }
							: conversation,
					)
					.sort((a, b) => b.updatedAt - a.updatedAt),
			);
		});

		return () => {
			unsubscribeDelta();
			unsubscribeComplete();
		};
	}, [connection]);

	async function handleNewConversation() {
		if (!connection) return;
		setError(null);
		try {
			const { conversation } = await connection.createConversation(
				`Chat ${conversations.length + 1}`,
			);
			setConversations((prev) => [conversation, ...prev]);
			setSelectedId(conversation.id);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		}
	}

	async function handleSend(event: React.FormEvent) {
		event.preventDefault();
		const text = draft.trim();
		if (!connection || !selectedId || !text || sending) return;

		setDraft("");
		setSending(true);
		setError(null);

		const tempId = `temp-${Date.now()}`;
		setMessages((prev) =>
			new Map(prev).set(tempId, {
				id: tempId,
				conversationId: selectedId,
				role: "user",
				content: text,
				createdAt: Date.now(),
				metadata: null,
			}),
		);

		try {
			await connection.sendMessage(selectedId, text);
			const { messages: rows } = await connection.getMessages(selectedId, {
				limit: 50,
			});
			const persisted = new Map(rows.map((m) => [m.id, m]));
			setMessages(persisted);
			setStreaming((prev) => {
				const next = new Map(prev);
				for (const id of persisted.keys()) next.delete(id);
				return next;
			});
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setSending(false);
		}
	}

	const messageList = Array.from(messages.values()).sort(
		(a, b) => a.createdAt - b.createdAt,
	);
	const streamingMessages = Array.from(streaming.entries()).filter(
		([id]) => !messages.has(id),
	);
	const busy = sending || streamingMessages.length > 0;

	if (!isConnected || loadingConversations) {
		return (
			<div className="flex h-96 items-center justify-center">
				<Spinner />
				<span className="ml-2 text-sm text-muted-foreground">Connecting…</span>
			</div>
		);
	}

	return (
		<div className="flex h-[min(800px,calc(100vh-16rem))] min-h-96 flex-col gap-4">
			<div className="flex items-center justify-between">
				<h3 className="font-semibold">{title ?? "Chat"}</h3>
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={handleNewConversation}
					disabled={!connection}
				>
					New chat
				</Button>
			</div>

			<div className="flex min-h-0 flex-1 gap-4">
				<div className="flex w-56 min-w-0 flex-col gap-1 overflow-y-auto rounded-lg border p-2">
					{conversations.length === 0 && (
						<p className="px-2 py-4 text-center text-xs text-muted-foreground">
							No conversations yet.
						</p>
					)}
					{conversations.map((conversation) => (
						<Button
							key={conversation.id}
							type="button"
							variant={selectedId === conversation.id ? "secondary" : "ghost"}
							size="sm"
							className="justify-start"
							onClick={() => setSelectedId(conversation.id)}
						>
							<span className="truncate">
								{conversation.title ?? "Untitled chat"}
							</span>
						</Button>
					))}
				</div>

				<div className="flex min-w-0 flex-1 flex-col gap-3">
					<MessageScrollerProvider autoScroll>
						<MessageScroller className="flex-1 rounded-lg border">
							<MessageScrollerViewport className="p-4">
								<MessageScrollerContent className="gap-4">
									{loadingMessages && messageList.length === 0 && (
										<div className="flex items-center justify-center py-8">
											<Spinner />
										</div>
									)}
									{messageList.map((message) => (
										<MessageScrollerItem
											key={message.id}
											messageId={message.id}
											scrollAnchor={message.role === "user"}
										>
											<Message
												align={message.role === "user" ? "end" : "start"}
											>
												<MessageAvatar>
													<span className="text-xs font-medium">
														{message.role === "user" ? "You" : "AI"}
													</span>
												</MessageAvatar>
												<MessageContent>
													<Bubble
														variant={
															message.role === "user" ? "default" : "muted"
														}
														align={message.role === "user" ? "end" : "start"}
													>
														<BubbleContent>{message.content}</BubbleContent>
													</Bubble>
												</MessageContent>
											</Message>
										</MessageScrollerItem>
									))}
									{streamingMessages.map(([messageId, content]) => (
										<MessageScrollerItem key={messageId} messageId={messageId}>
											<Message align="start">
												<MessageAvatar>
													<span className="text-xs font-medium">AI</span>
												</MessageAvatar>
												<MessageContent>
													<Bubble variant="muted" align="start">
														<BubbleContent>{content}</BubbleContent>
													</Bubble>
												</MessageContent>
											</Message>
										</MessageScrollerItem>
									))}
									{sending && streamingMessages.length === 0 && (
										<div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
											<Spinner />
											Thinking…
										</div>
									)}
								</MessageScrollerContent>
							</MessageScrollerViewport>
							<MessageScrollerButton />
						</MessageScroller>
					</MessageScrollerProvider>

					{error && <p className="text-sm text-destructive">{error}</p>}

					<form onSubmit={handleSend} className="flex gap-2">
						<Textarea
							value={draft}
							onChange={(event) => setDraft(event.currentTarget.value)}
							placeholder="Type a message…"
							rows={1}
							disabled={busy || !selectedId}
							className="min-h-10 resize-none"
						/>
						<Button
							type="submit"
							disabled={busy || !draft.trim() || !selectedId}
						>
							{sending ? (
								<Spinner />
							) : (
								<>
									<SendIcon data-icon="inline-start" />
									Send
								</>
							)}
						</Button>
					</form>
				</div>
			</div>
		</div>
	);
}
