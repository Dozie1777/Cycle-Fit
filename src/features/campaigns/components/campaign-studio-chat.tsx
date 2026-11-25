import { useChat } from "@ai-sdk/react";
import { getToolName, type UIMessage } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Streamdown } from "streamdown";
import type { CampaignMessage, Skill } from "@/client/api-types";
import { useSkills } from "@/client/queries";
import { useActor } from "@/client/rivet-actor-context";
import { parseStoredParts } from "@/client/stored-parts";
import { asJson, trpc } from "@/client/trpc";
import {
	Confirmation,
	type ConfirmationAction,
} from "@/components/ai-elements/confirmation";
import {
	Conversation,
	ConversationContent,
	ConversationEmptyState,
	ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import {
	PromptInput,
	PromptInputBody,
	PromptInputFooter,
	type PromptInputMessage,
	PromptInputSubmit,
	PromptInputTextarea,
	PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import {
	Reasoning,
	ReasoningContent,
	ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import {
	Tool,
	ToolContent,
	ToolHeader,
	ToolInput,
	ToolOutput,
	type ToolPart,
} from "@/components/ai-elements/tool";
import { Button } from "@/components/ui/button";
import {
	MessageScrollerItem,
	useMessageScroller,
	useMessageScrollerScrollable,
} from "@/components/ui/message-scroller";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import {
	type CampaignThinkingEffort,
	DEFAULT_THINKING_EFFORT,
} from "@/features/campaigns/chat/campaign-chat-prompt";
import { CampaignChatTransport } from "@/features/campaigns/chat/transport";
import { ManageSkillsDialog } from "./manage-skills-dialog";
import { isSlashDraft, SkillSlashMenu } from "./skill-slash-menu";

/**
 * Campaign chat panel (KUK-874): the same useChat + rivet actor transport
 * pipeline as the design chat (DesignChat.tsx), driven by the `campaignChat`
 * RivetKit actor instead of an SSE endpoint. History lives in D1 — fetched
 * once on mount — and every settled turn triggers onTurnSettled so the
 * document panels refetch the campaign detail (the agent writes brief/plan/
 * event/report rows through its tools mid-chat).
 */

// Keep the most recently loaded history in memory so a remount of the chat
// panel (e.g. a mobile tab switch or a desktop breakpoint cross while the
// resizable panels reconfigure) renders instantly and does NOT re-request
// listMessages — same contract as the design chat's historyCache. The Inner
// syncs the live chat state back into it as turns stream.
const historyCache = new Map<string, UIMessage[]>();

/** Test-only: clears the remount cache (tests share one campaign id). */
export function __resetCampaignHistoryCacheForTests(): void {
	historyCache.clear();
}

const SUGGESTIONS = [
	"Draft the campaign brief",
	"Plan a four-week launch timeline",
	"Build next week's content calendar",
	"Write a week-one performance report",
] as const;

/**
 * Thinking-effort selector options (KUK-892). Human labels over the wire
 * values: GLM-5.3-flash cannot fully disable reasoning, so "Low" is the
 * fastest end available rather than an "off" switch.
 */
const THINKING_EFFORT_OPTIONS = [
	{ value: "low", label: "Low" },
	{ value: "high", label: "Balanced" },
	{ value: "max", label: "Deep" },
] as const satisfies ReadonlyArray<{
	value: CampaignThinkingEffort;
	label: string;
}>;

const THINKING_EFFORT_TOOLTIP =
	"Low = fastest; Deep = maximum reasoning — GLM cannot fully disable reasoning";

function toUIMessage(row: CampaignMessage): UIMessage {
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

type Props = {
	campaignId: string;
	/** One-line brief from the create dialog — auto-sent as the first turn. */
	briefPrompt: string | null;
	onTurnSettled: () => void;
	/**
	 * The server says a turn is running (campaign status "chatting") — fed
	 * from the polled detail. When the local chat is idle but this is true,
	 * a previous turn wedged server-side and is holding the lease: every
	 * send would 409 ("chat turn already in progress"). The banner offers
	 * the force-release escape hatch (POST /chat/cancel).
	 */
	turnInProgress?: boolean;
};

export function CampaignStudioChat({
	campaignId,
	briefPrompt,
	onTurnSettled,
	turnInProgress,
}: Props) {
	// Seed from the remount cache so a remounted panel renders immediately
	// and skips the network entirely (see historyCache below).
	const [initialMessages, setInitialMessages] = useState<UIMessage[] | null>(
		() => historyCache.get(campaignId) ?? null,
	);
	const [loadError, setLoadError] = useState<string | null>(null);
	const bootstrapped = useRef(false);
	const actorKey = useMemo<[string, string]>(
		() => ["campaign", campaignId],
		[campaignId],
	);
	const { connection: actorConnection, isConnected: actorConnected } = useActor(
		{
			name: "campaignChat",
			key: actorKey,
		},
	);

	// The ref guard keeps StrictMode's double effect invocation from
	// double-fetching. With a cached snapshot we serve it and do NOT re-request
	// history in the background — the sync effect in the Inner keeps the cache
	// current as turns stream. Only the stuck-turn escape hatch force-reloads
	// (bypasses the cache), matching the design chat's contract.
	const load = useCallback(
		(force = false) => {
			const cached = historyCache.get(campaignId);
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
						trpc.campaigns.listMessages.query({ campaignId }),
					);
					const messages = history.map(toUIMessage);
					historyCache.set(campaignId, messages);
					setInitialMessages(messages);
				} catch (e) {
					setLoadError(e instanceof Error ? e.message : String(e));
					setInitialMessages([]);
				}
			})();
		},
		[campaignId],
	);

	useEffect(() => {
		if (bootstrapped.current) return;
		bootstrapped.current = true;
		load();
	}, [load]);

	// Stable force-reload identity: the Inner's settle-recovery effect
	// depends on this callback.
	const reloadHistory = useCallback(() => load(true), [load]);

	if (initialMessages === null || !actorConnected || !actorConnection) {
		return (
			<p className="muted">
				<Spinner /> loading conversation…
			</p>
		);
	}
	return (
		<CampaignStudioChatInner
			campaignId={campaignId}
			briefPrompt={briefPrompt}
			onTurnSettled={onTurnSettled}
			turnInProgress={turnInProgress}
			initialMessages={initialMessages}
			loadError={loadError}
			reloadHistory={reloadHistory}
			actorConnection={actorConnection}
		/>
	);
}

/**
 * Pins the transcript to the bottom while the assistant streams, mirroring
 * the design chat's follow: a new turn re-engages it, scrolling up pauses,
 * returning to the bottom (or sending) resumes.
 */
function StreamFollower({
	busy,
	fingerprint,
	followRef,
}: {
	busy: boolean;
	fingerprint: string;
	followRef: { current: boolean };
}) {
	const { scrollToEnd } = useMessageScroller();
	const { end } = useMessageScrollerScrollable();
	const skipFirstRef = useRef(false);
	const lastFingerprintRef = useRef(fingerprint);
	const followedOnceRef = useRef(false);

	useEffect(() => {
		if (busy) {
			followRef.current = true;
			skipFirstRef.current = true;
			followedOnceRef.current = false;
		}
	}, [busy, followRef]);

	useEffect(() => {
		if (end) {
			if (followedOnceRef.current) followRef.current = false;
			return;
		}
		followRef.current = true;
	}, [end, followRef]);

	useEffect(() => {
		if (lastFingerprintRef.current === fingerprint) return;
		lastFingerprintRef.current = fingerprint;
		if (!busy || !followRef.current) return;
		if (skipFirstRef.current) {
			skipFirstRef.current = false;
			return;
		}
		if (scrollToEnd({ behavior: "auto" })) {
			followedOnceRef.current = true;
		}
	}, [busy, fingerprint, scrollToEnd, followRef]);

	return null;
}

function CampaignStudioChatInner({
	campaignId,
	briefPrompt,
	onTurnSettled,
	turnInProgress = false,
	initialMessages,
	loadError,
	reloadHistory,
	actorConnection,
}: Props & {
	initialMessages: UIMessage[];
	loadError: string | null;
	reloadHistory: () => void;
	actorConnection: NonNullable<
		ReturnType<typeof useActor<"campaignChat">>["connection"]
	>;
}) {
	// Thinking effort (KUK-892): per-session component state, sent with every
	// turn but never persisted server-side. Read at send time through a ref —
	// the transport is created once and must not capture stale state.
	const [thinkingEffort, setThinkingEffort] = useState<CampaignThinkingEffort>(
		DEFAULT_THINKING_EFFORT,
	);
	const thinkingEffortRef = useRef<CampaignThinkingEffort>(thinkingEffort);
	thinkingEffortRef.current = thinkingEffort;

	const transport = useMemo(
		() =>
			new CampaignChatTransport(
				actorConnection as unknown as ConstructorParameters<
					typeof CampaignChatTransport
				>[0],
				{ thinkingEffort: thinkingEffortRef },
			),
		[actorConnection],
	);

	const {
		messages,
		sendMessage,
		status: chatStatus,
		error,
		stop,
		regenerate,
		clearError,
	} = useChat({
		id: `campaign-${campaignId}`,
		messages: initialMessages,
		transport,
		onFinish: () => onTurnSettled(),
		onError: () => onTurnSettled(),
	});

	// Keep the remount cache in sync with the live chat state so a later
	// remount never restores a stale snapshot (and never needs to re-request
	// history). This also prevents the auto-brief effect from re-sending on
	// remount after the first message.
	useEffect(() => {
		historyCache.set(campaignId, messages);
	}, [campaignId, messages]);

	// The campaign's first turn is its brief prompt (like a design's first
	// turn): auto-send it once when the campaign has no history.
	const autoSent = useRef(false);
	useEffect(() => {
		if (!briefPrompt || autoSent.current || messages.length > 0) return;
		autoSent.current = true;
		void sendMessage({ text: briefPrompt });
	}, [briefPrompt, messages.length, sendMessage]);

	const busy = chatStatus === "submitted" || chatStatus === "streaming";
	const lastIsUser = messages[messages.length - 1]?.role === "user";

	// Stuck-turn escape hatch: the server reports a turn still running while
	// the local chat is idle — a wedged agent turn holding the lease. Force-
	// release it so the chat is progressable again immediately, then refresh
	// the campaign detail (status/error) and the transcript.
	const [releasingTurn, setReleasingTurn] = useState(false);
	const releaseStuckTurn = useCallback(async () => {
		if (releasingTurn) return;
		setReleasingTurn(true);
		try {
			await trpc.campaigns.releaseTurn.mutate({ campaignId });
		} finally {
			setReleasingTurn(false);
			onTurnSettled();
			reloadHistory();
		}
	}, [campaignId, releasingTurn, onTurnSettled, reloadHistory]);

	// Remount mid-turn recovery: this instance never streamed the in-flight
	// turn (a panel remount tore down the original useChat), so its
	// onFinish can never fire. When the 4s status poll observes the server
	// finish the turn, force-reload the transcript from D1 so the completed
	// turn's messages appear — without this the partial cached snapshot
	// would sit forever.
	const streamedHereRef = useRef(false);
	if (busy) streamedHereRef.current = true;
	const prevTurnInProgressRef = useRef(turnInProgress);
	useEffect(() => {
		const wasRunning = prevTurnInProgressRef.current;
		prevTurnInProgressRef.current = turnInProgress;
		// Settled (running → not running) and this mount never saw the
		// stream: the finished messages exist only in D1.
		if (wasRunning && !turnInProgress && !streamedHereRef.current) {
			reloadHistory();
		}
	}, [turnInProgress, reloadHistory]);

	// The release banner only makes sense once the turn has looked wedged
	// for a while — a remount mid-turn is locally idle while the server is
	// legitimately still streaming, and the poll above recovers it on
	// settle. Grace period before offering the force-release.
	const [stuckForAWhile, setStuckForAWhile] = useState(false);
	const turnStuck = turnInProgress && !busy;
	useEffect(() => {
		if (!turnStuck) {
			setStuckForAWhile(false);
			return;
		}
		const timer = setTimeout(() => setStuckForAWhile(true), 30_000);
		return () => clearTimeout(timer);
	}, [turnStuck]);
	const showReleaseBanner = turnStuck && stuckForAWhile;

	// "/" skills (KUK-891): while the draft is a bare "/<query>" invocation,
	// a menu above the input lists the enabled skills; picking one inserts
	// its "/slug " and the pipeline resolves it server-side. Dismissed with
	// Escape and re-armed on the next keystroke.
	const { data: allSkills = [] } = useSkills();
	const enabledSkills = useMemo(
		() => allSkills.filter((skill) => skill.enabled),
		[allSkills],
	);
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const [draft, setDraft] = useState("");
	const [menuDismissed, setMenuDismissed] = useState(false);
	const [skillsOpen, setSkillsOpen] = useState(false);
	const slashActive =
		isSlashDraft(draft) && !menuDismissed && enabledSkills.length > 0;
	const slashQuery = draft.startsWith("/") ? draft.slice(1) : "";

	const selectSkill = (skill: Skill) => {
		const next = `/${skill.slug} `;
		if (textareaRef.current) textareaRef.current.value = next;
		setDraft(next);
		setMenuDismissed(false);
		textareaRef.current?.focus();
	};

	const followRef = useRef(true);
	const streamFingerprint = useMemo(() => {
		const last = messages[messages.length - 1];
		if (!last) return "none";
		let length = 0;
		for (const part of last.parts) {
			if ("text" in part && typeof part.text === "string") {
				length += part.text.length;
			}
		}
		return `${last.id}:${last.parts.length}:${length}`;
	}, [messages]);

	// Interactive ask_user buttons disable after the user picks an option.
	const [answeredToolIds, setAnsweredToolIds] = useState<Set<string>>(
		new Set(),
	);

	const answerConfirmation = (toolCallId: string, value: string) => {
		setAnsweredToolIds((prev) => new Set(prev).add(toolCallId));
		void sendMessage({ text: value });
	};

	function askUserCard(tool: ToolPart) {
		if (getToolName(tool) !== "ask_user") return null;
		if (!tool.output || typeof tool.output !== "object") return null;
		const out = tool.output as Record<string, unknown>;
		const question =
			typeof out.question === "string" ? out.question : undefined;
		const actions: ConfirmationAction[] | null = Array.isArray(out.options)
			? out.options
					.filter(
						(opt): opt is { label: string; value: string } =>
							opt != null &&
							typeof opt === "object" &&
							"label" in opt &&
							"value" in opt &&
							typeof (opt as { label?: unknown }).label === "string" &&
							typeof (opt as { value?: unknown }).value === "string",
					)
					.map((opt) => ({ label: opt.label, value: opt.value }))
			: null;
		if (!actions || actions.length === 0 || !question) return null;
		return { actions, question };
	}

	return (
		<div className="flex h-full min-h-0 flex-col">
			<Conversation
				className="design-chat-transcript"
				onWheel={(event) => {
					if (busy && event.deltaY < 0) followRef.current = false;
				}}
			>
				<ConversationContent>
					{messages.length === 0 && !busy && (
						<ConversationEmptyState
							title="Plan the campaign with your agent."
							description="Brief it here — the brief, plan phases, calendar slots and reports it writes show up in the panels beside you."
						/>
					)}
					{messages.map((m, messageIndex) => {
						const isUser = m.role === "user";
						// Interactive confirmations are only actionable while they're
						// the conversation's latest message — a restored history card
						// is already answered or superseded (answeredToolIds is
						// session-scoped, so without this guard a refresh would let
						// an old prompt re-submit).
						const isLatestMessage = messageIndex === messages.length - 1;
						return (
							<MessageScrollerItem
								key={m.id}
								messageId={m.id}
								scrollAnchor={isUser}
							>
								<Message from={m.role as "user" | "assistant"}>
									<MessageContent>
										{m.parts.map((part, i) => {
											if (part.type === "text") {
												return (
													<div
														key={
															// biome-ignore lint/suspicious/noArrayIndexKey: parts are append-only
															i
														}
														className={cnBubble(isUser)}
													>
														<div className="typeset typeset-chat">
															<Streamdown>{part.text}</Streamdown>
														</div>
													</div>
												);
											}
											if (part.type === "reasoning") {
												return (
													<Reasoning
														key={
															// biome-ignore lint/suspicious/noArrayIndexKey: parts are append-only
															i
														}
														isStreaming={part.state === "streaming"}
													>
														<ReasoningTrigger />
														<ReasoningContent>{part.text}</ReasoningContent>
													</Reasoning>
												);
											}
											if (
												part.type.startsWith("tool-") ||
												part.type === "dynamic-tool"
											) {
												const tool = part as ToolPart;
												const toolName = getToolName(tool);
												if (toolName === "ask_user") {
													const card = askUserCard(tool);
													if (card) {
														const answered = answeredToolIds.has(
															tool.toolCallId,
														);
														return (
															<Confirmation
																key={tool.toolCallId}
																title={card.question}
																actions={card.actions}
																disabled={answered || busy || !isLatestMessage}
																onAction={(value) =>
																	answerConfirmation(tool.toolCallId, value)
																}
															/>
														);
													}
												}
												return (
													<Tool
														key={
															// biome-ignore lint/suspicious/noArrayIndexKey: parts are append-only
															i
														}
													>
														{tool.type === "dynamic-tool" ? (
															<ToolHeader
																type={tool.type}
																toolName={tool.toolName}
																state={tool.state}
															/>
														) : (
															<ToolHeader type={tool.type} state={tool.state} />
														)}
														<ToolContent>
															<ToolInput
																input={tool.input}
																state={tool.state}
															/>
															<ToolOutput
																output={tool.output}
																errorText={tool.errorText}
															/>
														</ToolContent>
													</Tool>
												);
											}
											return null;
										})}
									</MessageContent>
								</Message>
							</MessageScrollerItem>
						);
					})}
					{busy && lastIsUser && (
						<p className="muted">
							<Spinner /> streaming…
						</p>
					)}
					{(error || loadError) && (
						<div className="flex items-start gap-2">
							<p className="chat-error">{error ? error.message : loadError}</p>
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="shrink-0"
								onClick={() => {
									if (error) {
										clearError();
										void regenerate();
									} else {
										reloadHistory();
									}
								}}
							>
								Retry
							</Button>
						</div>
					)}
				</ConversationContent>
				<ConversationScrollButton />
				<StreamFollower
					busy={busy}
					fingerprint={streamFingerprint}
					followRef={followRef}
				/>
			</Conversation>
			{showReleaseBanner && (
				<div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
					<p className="min-w-0 flex-1">
						A previous turn is still running on the server. If it looks stuck,
						release it to unblock the chat.
					</p>
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="shrink-0"
						disabled={releasingTurn}
						onClick={() => void releaseStuckTurn()}
					>
						{releasingTurn ? "Releasing…" : "Release stuck turn"}
					</Button>
				</div>
			)}
			{messages.length === 0 && !busy && (
				<Suggestions className="design-chat-suggestions">
					{SUGGESTIONS.map((suggestion) => (
						<Suggestion
							key={suggestion}
							suggestion={suggestion}
							disabled={busy}
							onClick={() => void sendMessage({ text: suggestion })}
						/>
					))}
				</Suggestions>
			)}
			<div className="relative">
				{slashActive && (
					<SkillSlashMenu
						onSelect={selectSkill}
						query={slashQuery}
						skills={enabledSkills}
					/>
				)}
				<PromptInput
					className="design-chat-input"
					onSubmit={(message: PromptInputMessage) => {
						const text = message.text.trim();
						// The form reset clears the textarea without firing React
						// onChange — clear the synced draft too, or a bare "/skill"
						// send would leave the menu open over an empty input.
						setDraft("");
						setMenuDismissed(false);
						if (!text) return;
						void sendMessage({ text });
					}}
				>
					<PromptInputBody data-align="block-start">
						<PromptInputTextarea
							disabled={busy}
							onKeyDown={(event) => {
								if (event.key === "Escape" && slashActive) {
									setMenuDismissed(true);
								}
							}}
							onChange={(event) => {
								setDraft(event.currentTarget.value);
								setMenuDismissed(false);
							}}
							placeholder="e.g. draft the brief, then plan the launch weeks — or / for skills"
							ref={textareaRef}
						/>
					</PromptInputBody>
					<PromptInputFooter>
						<PromptInputTools>
							{/* Thinking effort (KUK-892): per-turn reasoning depth for
							    the selected model. Low / Balanced / Deep map to the
							    wire values low / high / max — GLM cannot fully disable
							    reasoning, so there is no "off". */}
							<Tooltip>
								<TooltipTrigger>
									<Select
										disabled={busy}
										onValueChange={(value) =>
											setThinkingEffort(value as CampaignThinkingEffort)
										}
										value={thinkingEffort}
									>
										<SelectTrigger
											className="h-7 gap-1 border-none bg-transparent px-1 text-xs text-muted-foreground shadow-none hover:bg-accent hover:text-foreground"
											aria-label="Thinking effort"
											size="sm"
										>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{THINKING_EFFORT_OPTIONS.map((option) => (
												<SelectItem key={option.value} value={option.value}>
													{option.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</TooltipTrigger>
								<TooltipContent>{THINKING_EFFORT_TOOLTIP}</TooltipContent>
							</Tooltip>
							<Button
								disabled={busy}
								onClick={() => setSkillsOpen(true)}
								size="sm"
								type="button"
								variant="ghost"
							>
								Skills
							</Button>
						</PromptInputTools>
						<PromptInputSubmit status={chatStatus} onStop={stop} />
					</PromptInputFooter>
				</PromptInput>
			</div>
			<ManageSkillsDialog onOpenChange={setSkillsOpen} open={skillsOpen} />
		</div>
	);
}

/** Message bubble styling shared by both roles (from the design chat). */
function cnBubble(isUser: boolean): string {
	return [
		"w-fit max-w-[85%] rounded-2xl px-4 py-2.5 text-sm",
		isUser ? "ml-auto bg-primary text-primary-foreground" : "bg-muted",
	].join(" ");
}
