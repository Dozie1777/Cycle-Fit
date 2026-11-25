import { useChat } from "@ai-sdk/react";
import { getToolName, type UIMessage } from "ai";
import { Paperclip } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Streamdown } from "streamdown";
import type {
	DesignAsset,
	DesignChatAssetRef,
	DesignChatMessage,
	Skill,
} from "@/client/api-types";
import { measureMedia } from "@/client/measure-media";
import { useSkills } from "@/client/queries";
import { useActor } from "@/client/rivet-actor-context";
import { parseStoredParts } from "@/client/stored-parts";
import { asJson, trpc } from "@/client/trpc";
import { uploadDesignAsset } from "@/client/uploads";
import { cn } from "@/client/utils";
import { ComponentTestDrive } from "@/components/ai-elements/component-test-drive";
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
import { DesignProposal } from "@/components/ai-elements/design-proposal";
import { Message, MessageContent } from "@/components/ai-elements/message";
import {
	PromptInput,
	PromptInputBody,
	PromptInputButton,
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
import { StyleOptions } from "@/components/ai-elements/style-options";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import {
	Tool,
	ToolContent,
	ToolHeader,
	ToolInput,
	ToolOutput,
	type ToolPart,
} from "@/components/ai-elements/tool";
import { WireframeCard } from "@/components/ai-elements/wireframe-card";
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
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { ManageSkillsDialog } from "@/features/campaigns/components/manage-skills-dialog";
import {
	isSlashDraft,
	SkillSlashMenu,
} from "@/features/campaigns/components/skill-slash-menu";
import { MAX_LIBRARY_ASSETS } from "@/features/design-studio/assets/design-assets";
import { DesignChatTransport } from "@/features/design-studio/chat/transport";
import { ASSET_DRAG_TYPE, AssetChip, AssetThumb } from "./asset-chip";
import type { OpenElementChat } from "./element-chat-panel";
import { StudioAssets } from "./studio-assets";

/** Available models for the design-studio chat selector (mirror of DESIGN_CHAT_MODELS). */
const DESIGN_CHAT_MODELS = [
	"@cf/zai-org/glm-5.3",
	"@cf/thinkingmachines/inkling-2-small",
	"@cf/deepseek-ai/deepseek-v4.1-flash-1017",
	"@cf/swiss-ai/apertus-v1.5-8b",
	"@cf/daily-co/phonellm-mini-alpha-2",
] as const;

type DesignChatModel = (typeof DESIGN_CHAT_MODELS)[number];

const DEFAULT_MODEL: DesignChatModel = DESIGN_CHAT_MODELS[0];

const MODEL_STORAGE_KEY = "design-chat-model";

function displayNameForModel(id: DesignChatModel): string {
	const parts = id.split("/");
	const name = parts[parts.length - 1] ?? id;
	return name.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Design-coaching suggestions, shown above the prompt like the AI Elements chatbot example. */
const SUGGESTIONS = [
	"Show me the hero section first",
	"Make the palette darker",
	"Add a pricing section",
	"Show me the preview of the footer",
] as const;

type Props = {
	projectId: string;
	prompt: string;
	/** Latest project status from the design detail poll. */
	status: string;
	onTurnSettled: () => void;
	/**
	 * Send the project brief automatically when history is empty (default).
	 * Remix forks set this to false: their published files already exist, so
	 * auto-sending the brief would regenerate over the forked design.
	 */
	autoBrief?: boolean;
	/** Canvas select-to-edit: steers the next turn at the named section. */
	selectedSection?: string | null;
	onClearSection?: () => void;
	/**
	 * Orchestrator handoff (KUK-944): called when the user clicks the
	 * affordance rendered from a successful open_element_chat tool result.
	 * The studio mounts the focused element-chat panel for that session.
	 */
	onOpenElementChat?: (session: OpenElementChat) => void;
};

/** UIMessage metadata carrying attachment info through the client chat state. */
type ChatMetadata = {
	/** Full snapshots from server history (toUIMessage). */
	attachments?: DesignChatAssetRef[];
	/** Optimistic sends carry ids, resolved against the loaded asset list. */
	assetIds?: string[];
};

/** A successful open_element_chat tool result (the handoff payload). */
function elementChatFromTool(tool: ToolPart): OpenElementChat | null {
	const out = tool.output as Record<string, unknown> | undefined;
	if (out?.ok !== true || typeof out.elementChatId !== "string") {
		return null;
	}
	return {
		elementChatId: out.elementChatId,
		elementType: String(out.elementType ?? ""),
		elementName: String(out.elementName ?? "element"),
		note: typeof out.note === "string" ? out.note : null,
	};
}

function toUIMessage(row: DesignChatMessage): UIMessage {
	// Rebuild the full live-turn parts (reasoning + tool calls) from the
	// persisted JSON; fall back to the flat text for rows without parts
	// (user messages, pre-feature rows).
	const stored = parseStoredParts(row.parts);
	return {
		id: row.id,
		role: row.role === "user" ? "user" : "assistant",
		parts:
			stored.length > 0
				? (stored as UIMessage["parts"])
				: [{ type: "text", text: row.content }],
		...(row.attachments.length > 0
			? { metadata: { attachments: row.attachments } satisfies ChatMetadata }
			: {}),
	};
}

/** The assets displayed with a message: history snapshots, or optimistic ids resolved against the library. */
function messageAssetRefs(
	message: UIMessage,
	assetsById: Map<string, DesignAsset>,
): DesignChatAssetRef[] {
	const metadata = (message.metadata ?? {}) as ChatMetadata;
	if (metadata.attachments && metadata.attachments.length > 0) {
		return metadata.attachments;
	}
	if (metadata.assetIds && metadata.assetIds.length > 0) {
		return metadata.assetIds
			.map((id) => assetsById.get(id))
			.filter((asset): asset is DesignAsset => asset != null);
	}
	return [];
}

/** Max assets attached per chat message — mirrored server-side. */
const MAX_ATTACHMENTS = 5;

/**
 * Drop target for asset uploads (files dropped from the OS) and drawer
 * drags — HTML5 drag events ride through as props; the paperclip button
 * stays the keyboard path.
 */
function AssetDropzone(props: React.ComponentProps<"div">) {
	return <div {...props} />;
}

/**
 * Design chat with the Workers AI model, built on AI Elements + useChat.
 * The worker streams the AI SDK UI message stream protocol (see
 * lib/design-chat.ts), so DefaultChatTransport parses it directly; the
 * request body is reshaped to this worker's `{ message }` contract because
 * history lives in D1 (Message), not in the client.
 */
// Keep the most recently loaded history in memory so a remount of the chat
// panel (e.g., mobile tab switch or a desktop breakpoint cross while the
// resizable panels reconfigure) doesn't flash the loading state mid-stream.
const historyCache = new Map<string, UIMessage[]>();

export function DesignChat({
	projectId,
	prompt,
	status,
	onTurnSettled,
	autoBrief = true,
	selectedSection,
	onClearSection,
	onOpenElementChat,
}: Props) {
	const [initialMessages, setInitialMessages] = useState<UIMessage[] | null>(
		() => historyCache.get(projectId) ?? null,
	);
	const [loadError, setLoadError] = useState<string | null>(null);
	const bootstrapped = useRef(false);
	const actorKey = useMemo<[string, string]>(
		() => ["design", projectId],
		[projectId],
	);
	const { connection: actorConnection, isConnected: actorConnected } = useActor(
		{
			name: "designChat",
			key: actorKey,
		},
	);

	// Fetch the conversation history. The ref guard keeps StrictMode's double
	// effect invocation from double-fetching; the Retry button calls
	// `reloadHistory()` directly, which bypasses both the guard and the cache.
	// When a cached snapshot exists we serve it and do NOT re-request history
	// in the background — the sync effect in the Inner keeps the cache current
	// as turns stream, so the snapshot never goes stale within the session,
	// and a fresh page load (empty cache) still fetches authoritative
	// history from the worker.
	const load = useCallback(
		(force = false) => {
			const cached = historyCache.get(projectId);
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
						trpc.designs.listMessages.query({ projectId }),
					);
					const messages = history.map(toUIMessage);
					historyCache.set(projectId, messages);
					setInitialMessages(messages);
				} catch (e) {
					setLoadError(e instanceof Error ? e.message : String(e));
					if (force || !cached) {
						setInitialMessages([]);
					}
				}
			})();
		},
		[projectId],
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
		<DesignChatInner
			projectId={projectId}
			prompt={prompt}
			status={status}
			onTurnSettled={onTurnSettled}
			autoBrief={autoBrief}
			selectedSection={selectedSection}
			onClearSection={onClearSection}
			onOpenElementChat={onOpenElementChat}
			initialMessages={initialMessages}
			loadError={loadError}
			reloadHistory={reloadHistory}
			actorConnection={actorConnection}
		/>
	);
}

/**
 * Keeps the transcript pinned to the bottom while the assistant is
 * streaming. The scroller primitive anchors each new user message to the
 * viewport top and only re-engages its resize-follow after a manual
 * scroll, so without this the growing response overflows out of view.
 * The follow cancels when the user scrolls up (wheel intent or the
 * scroller reporting distance from the bottom) and resumes when they
 * return to the bottom or send a new message.
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
	// Whether this turn's follow has actually pinned once: end-based cancels
	// are ignored until then, because the user-message anchor jump leaves
	// the viewport away from the bottom at turn start and would otherwise
	// disarm the follow before the first assistant chunk arrives.
	const followedOnceRef = useRef(false);

	// A new turn always (re)engages the follow; skip its first content
	// change so the user-message anchor jump lands undisturbed.
	useEffect(() => {
		if (busy) {
			followRef.current = true;
			skipFirstRef.current = true;
			followedOnceRef.current = false;
		}
	}, [busy, followRef]);

	// Catch-all for intents the wheel handler can't see (scrollbar drag,
	// keyboard): away from the bottom cancels (once the turn has followed at
	// least once — see followedOnceRef), back at it re-engages.
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

function DesignChatInner({
	projectId,
	prompt,
	status,
	onTurnSettled,
	autoBrief,
	selectedSection,
	onClearSection,
	onOpenElementChat,
	initialMessages,
	loadError,
	reloadHistory,
	actorConnection,
}: Props & {
	initialMessages: UIMessage[];
	loadError: string | null;
	reloadHistory: () => void;
	actorConnection: NonNullable<
		ReturnType<typeof useActor<"designChat">>["connection"]
	>;
}) {
	// The canvas selection and model choice are read at send time via refs —
	// the transport is created once and must not capture stale state.
	const selectedSectionRef = useRef<string | null>(selectedSection ?? null);
	selectedSectionRef.current = selectedSection ?? null;

	const [model, setModel] = useState<DesignChatModel>(() => {
		if (typeof window === "undefined") return DEFAULT_MODEL;
		const saved = localStorage.getItem(
			MODEL_STORAGE_KEY,
		) as DesignChatModel | null;
		return saved && DESIGN_CHAT_MODELS.includes(saved) ? saved : DEFAULT_MODEL;
	});
	useEffect(() => {
		localStorage.setItem(MODEL_STORAGE_KEY, model);
	}, [model]);
	const modelRef = useRef<DesignChatModel>(model);
	modelRef.current = model;

	// "/" skills (0020): while the draft is a bare "/<query>" invocation, a
	// menu above the input lists the enabled design-category skills; picking
	// one inserts its "/slug " and the pipeline resolves it server-side.
	// Dismissed with Escape and re-armed on the next keystroke. Same pattern
	// as the campaign studio chat.
	const { data: allSkills = [] } = useSkills();
	const designSkills = useMemo(
		() =>
			allSkills.filter((skill) => skill.enabled && skill.category === "design"),
		[allSkills],
	);
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const [draft, setDraft] = useState("");
	const [menuDismissed, setMenuDismissed] = useState(false);
	const [skillsOpen, setSkillsOpen] = useState(false);
	const slashActive =
		isSlashDraft(draft) && !menuDismissed && designSkills.length > 0;
	const slashQuery = draft.startsWith("/") ? draft.slice(1) : "";
	const selectSkill = (skill: Skill) => {
		const next = `/${skill.slug} `;
		if (textareaRef.current) textareaRef.current.value = next;
		setDraft(next);
		setMenuDismissed(false);
		textareaRef.current?.focus();
	};

	// Asset library (KUK-864). Fetched with the same plain-api pattern as the
	// history bootstrap — no react-query provider needed in this tree.
	const [assets, setAssets] = useState<DesignAsset[]>([]);
	const [assetsLoading, setAssetsLoading] = useState(true);
	const [attachedIds, setAttachedIds] = useState<string[]>([]);
	const [assetError, setAssetError] = useState<string | null>(null);
	const assetsByIdRef = useRef<Map<string, DesignAsset>>(new Map());
	assetsByIdRef.current = new Map(assets.map((asset) => [asset.id, asset]));

	const refreshAssets = useCallback(async () => {
		try {
			setAssets(await asJson(trpc.designs.assets.list.query({ projectId })));
		} catch {
			// Non-fatal: the drawer keeps showing whatever it has.
		} finally {
			setAssetsLoading(false);
		}
	}, [projectId]);

	useEffect(() => {
		void refreshAssets();
	}, [refreshAssets]);

	// Auto-described images land seconds after upload — poll until none are
	// pending so the "describing…" state resolves on its own.
	useEffect(() => {
		if (!assets.some((asset) => asset.descriptionStatus === "pending")) return;
		const timer = setInterval(() => void refreshAssets(), 3000);
		return () => clearInterval(timer);
	}, [assets, refreshAssets]);

	const uploadAssets = async (files: File[]) => {
		setAssetError(null);
		// Clamp drops to the library cap — the server enforces it
		// authoritatively; this keeps the client honest and surfaces skips.
		const room = MAX_LIBRARY_ASSETS - assets.length;
		if (room <= 0) {
			setAssetError(`Asset library is full (${MAX_LIBRARY_ASSETS})`);
			return;
		}
		const batch = files.slice(0, Math.min(3, room));
		for (const file of batch) {
			try {
				const meta = await measureMedia(file);
				const asset = await uploadDesignAsset(projectId, file, meta);
				setAssets((prev) => [asset, ...prev.filter((a) => a.id !== asset.id)]);
			} catch (e) {
				setAssetError(e instanceof Error ? e.message : String(e));
			}
		}
		const skipped = files.length - batch.length;
		if (skipped > 0) {
			setAssetError(`${skipped} file(s) skipped — library cap reached`);
		}
	};

	// Shared by the composer chips and the assets drawer — refreshing the
	// shared asset state is what unblocks sending after a video is described.
	const describeAsset = (asset: DesignAsset, description: string) => {
		if (!description) return;
		setAssetError(null);
		void trpc.designs.assets.update
			.mutate({ projectId, assetId: asset.id, description })
			.then(() => refreshAssets())
			.catch((e) => setAssetError(e instanceof Error ? e.message : String(e)));
	};

	const attachAsset = (asset: DesignAsset) => {
		setAssetError(null);
		setAttachedIds((prev) =>
			prev.includes(asset.id) || prev.length >= MAX_ATTACHMENTS
				? prev
				: [...prev, asset.id],
		);
	};
	const detachAsset = (assetId: string) =>
		setAttachedIds((prev) => prev.filter((id) => id !== assetId));

	const attachedAssets = attachedIds
		.map((id) => assetsByIdRef.current.get(id))
		.filter((asset): asset is DesignAsset => asset != null);
	// Sending is blocked until every attached video carries its description.
	const undescribed = attachedAssets.find(
		(asset) => asset.descriptionStatus === "needs_description",
	);

	const [dragDepth, setDragDepth] = useState(0);
	const dragOver = dragDepth > 0;

	const transport = useMemo(
		() =>
			new DesignChatTransport(
				actorConnection as unknown as ConstructorParameters<
					typeof DesignChatTransport
				>[0],
				{
					section: selectedSectionRef,
					model: modelRef,
				},
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
		id: `design-${projectId}`,
		messages: initialMessages,
		transport,
		onFinish: () => onTurnSettled(),
		onError: () => onTurnSettled(),
	});

	// Keep the remount cache in sync with the live chat state so a later
	// remount never restores a stale snapshot. This also prevents the
	// auto-brief effect from re-sending on remount after the first message.
	useEffect(() => {
		historyCache.set(projectId, messages);
	}, [projectId, messages]);

	// Remount mid-turn recovery (mirrors the campaign chat): this instance
	// never streamed the in-flight turn (a panel remount tore down the
	// original useChat), so its onFinish can never fire. When the studio's
	// live status poll (useDesign { live: true }) observes the server finish
	// the turn, force-reload the transcript from D1 so the completed turn's
	// messages appear — without this the partial cached snapshot would sit
	// forever.
	const streamedHereRef = useRef(false);
	if (chatStatus === "submitted" || chatStatus === "streaming") {
		streamedHereRef.current = true;
	}
	// Latest chat status for the settle-recovery timer below, without the
	// effect depending on it (the effect must only run on status changes).
	const chatStatusRef = useRef(chatStatus);
	chatStatusRef.current = chatStatus;
	const prevStatusRef = useRef(status);
	useEffect(() => {
		const wasChatting = prevStatusRef.current;
		prevStatusRef.current = status;
		if (wasChatting !== "chatting" || status === "chatting") return;
		if (!streamedHereRef.current) {
			// Settled (chatting → not chatting) and this mount never saw the
			// stream: the finished messages exist only in D1.
			reloadHistory();
			return;
		}
		// Connection-drop recovery: this mount streamed the turn, but the
		// WebSocket died mid-turn (the server keeps the turn running and
		// persists it server-side). turnFinished then never arrives on the
		// dead connection, so useChat stays busy forever. When the live
		// status poll sees the server settle while the local chat is still
		// busy, the stream is dead: give the healthy tail a few seconds to
		// drain, then force-reload the transcript from D1 so the completed
		// turn replaces the hung stream.
		const busyNow =
			chatStatusRef.current === "submitted" ||
			chatStatusRef.current === "streaming";
		if (!busyNow) return;
		const timer = setTimeout(() => {
			if (
				chatStatusRef.current === "submitted" ||
				chatStatusRef.current === "streaming"
			) {
				reloadHistory();
			}
		}, 5000);
		return () => clearTimeout(timer);
	}, [status, reloadHistory]);

	// A design's first turn is its own brief: auto-send it once when the
	// project has no history. Remix forks (autoBrief=false) already carry
	// published files — auto-sending the brief would regenerate over the
	// fork, so the user steers the first turn themselves.
	const autoSent = useRef(false);
	useEffect(() => {
		if (!autoBrief || autoSent.current || messages.length > 0) return;
		autoSent.current = true;
		void sendMessage({ text: prompt });
	}, [autoBrief, messages.length, prompt, sendMessage]);

	const busy = chatStatus === "submitted" || chatStatus === "streaming";
	const lastIsUser = messages[messages.length - 1]?.role === "user";

	// Stream-follower wiring: a cheap fingerprint of the newest message
	// (id + parts + text length) that changes on every streamed chunk.
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

	// Track which interactive confirmations have already been answered so the
	// buttons disable after the user picks an option.
	const [answeredToolIds, setAnsweredToolIds] = useState<Set<string>>(
		new Set(),
	);

	const answerConfirmation = (toolCallId: string, value: string) => {
		setAnsweredToolIds((prev) => new Set(prev).add(toolCallId));
		void sendMessage({ text: value });
	};

	function askUserActions(tool: ToolPart): ConfirmationAction[] | null {
		if (!tool.output || typeof tool.output !== "object") return null;
		const out = tool.output as Record<string, unknown>;
		if (!out.question || !Array.isArray(out.options)) return null;
		return out.options
			.filter(
				(opt): opt is { label: string; value: string } =>
					opt != null &&
					typeof opt === "object" &&
					"label" in opt &&
					"value" in opt &&
					typeof opt.label === "string" &&
					typeof opt.value === "string",
			)
			.map((opt) => ({ label: opt.label, value: opt.value }));
	}

	/**
	 * Extracts a renderable ask_user card (question + validated actions) from
	 * a tool part. null when the part isn't ask_user or its payload doesn't
	 * form a usable question — malformed calls keep their surrounding text
	 * visible instead of blanking the turn.
	 */
	function askUserCard(tool: ToolPart) {
		if (getToolName(tool) !== "ask_user") return null;
		const actions = askUserActions(tool);
		const question =
			tool.output && typeof tool.output === "object"
				? ((tool.output as Record<string, unknown>).question as string)
				: undefined;
		if (!actions || actions.length === 0 || !question) return null;
		return { actions, question };
	}

	function proposalFromTool(tool: ToolPart) {
		if (!tool.output || typeof tool.output !== "object") return null;
		const out = tool.output as Record<string, unknown>;
		if (out.ok !== true) return null;
		const html = typeof out.html === "string" ? out.html : null;
		const previewUrl =
			typeof out.previewUrl === "string" ? out.previewUrl : null;
		const name = typeof out.name === "string" ? out.name : undefined;
		if (!html || !previewUrl) return null;
		return { html, previewUrl, name };
	}

	/**
	 * Extracts a renderable test drive from `save_component` / `test_component`
	 * tool parts. Renders whenever a harness preview URL exists — including a
	 * failed runtime check (ok:false with errors), where seeing the broken
	 * render next to the error list is the point. null without a preview URL:
	 * those fall through to the generic collapsible Tool view.
	 */
	function componentTestFromTool(tool: ToolPart) {
		const toolName = getToolName(tool);
		if (toolName !== "save_component" && toolName !== "test_component") {
			return null;
		}
		if (!tool.output || typeof tool.output !== "object") return null;
		const out = tool.output as Record<string, unknown>;
		const previewUrl =
			typeof out.previewUrl === "string" ? out.previewUrl : null;
		if (!previewUrl) return null;
		const name = typeof out.name === "string" ? out.name : undefined;
		const tagName = typeof out.tagName === "string" ? out.tagName : undefined;
		const smoke =
			out.smoke != null && typeof out.smoke === "object"
				? (out.smoke as Record<string, unknown>)
				: null;
		const errors = Array.isArray(out.errors)
			? out.errors.filter((error): error is string => typeof error === "string")
			: [];
		// Note: a rejected save_component / test_component failure carries no
		// name in the output (the save never happened) — fall back to input.
		const inputRecord =
			tool.input && typeof tool.input === "object"
				? (tool.input as Record<string, unknown>)
				: null;
		const inputName =
			inputRecord && typeof inputRecord.name === "string"
				? inputRecord.name
				: undefined;
		const inputTagName =
			inputRecord && typeof inputRecord.tagName === "string"
				? inputRecord.tagName
				: undefined;
		return {
			name: name ?? inputName,
			tagName: tagName ?? inputTagName,
			previewUrl,
			saved: toolName === "save_component" && out.ok === true,
			smokePassed: smoke ? smoke.ok === true : undefined,
			smokeSkipped: smoke ? smoke.skipped === true : undefined,
			smokeReason:
				smoke && typeof smoke.reason === "string" ? smoke.reason : undefined,
			initialErrors: errors,
		};
	}

	function wireframeFromTool(tool: ToolPart) {
		if (getToolName(tool) !== "wireframe") return null;
		if (!tool.output || typeof tool.output !== "object") return null;
		const out = tool.output as Record<string, unknown>;
		if (out.ok !== true) return null;
		const previewUrl =
			typeof out.previewUrl === "string" ? out.previewUrl : null;
		if (!previewUrl) return null;
		const name =
			tool.input && typeof tool.input === "object" && "name" in tool.input
				? String((tool.input as Record<string, unknown>).name)
				: undefined;
		const note =
			typeof out.note === "string" && out.note.trim() !== ""
				? out.note
				: undefined;
		return { previewUrl, name, note };
	}

	function styleOptionsFromTool(tool: ToolPart) {
		if (getToolName(tool) !== "style_options") return null;
		// The options live in the tool input — don't render while it streams.
		if (tool.state === "input-streaming") return null;
		if (!tool.input || typeof tool.input !== "object") return null;
		const input = tool.input as Record<string, unknown>;

		const palettes = Array.isArray(input.palettes)
			? input.palettes
					.filter(
						(p): p is { name: string; colors: unknown; rationale?: unknown } =>
							p != null &&
							typeof p === "object" &&
							"name" in p &&
							typeof (p as { name?: unknown }).name === "string",
					)
					.map((p) => ({
						name: p.name,
						colors: (Array.isArray(p.colors) ? p.colors : []).filter(
							(c): c is string =>
								typeof c === "string" && /^#[0-9a-fA-F]{3,8}$/.test(c),
						),
						rationale:
							typeof p.rationale === "string" ? p.rationale : undefined,
					}))
					.filter((p) => p.colors.length >= 3)
			: [];

		const fonts = Array.isArray(input.fonts)
			? input.fonts
					.filter(
						(
							f,
						): f is {
							name: string;
							heading: string;
							body: string;
							rationale?: unknown;
						} =>
							f != null &&
							typeof f === "object" &&
							"name" in f &&
							typeof (f as { name?: unknown }).name === "string" &&
							typeof (f as { heading?: unknown }).heading === "string" &&
							typeof (f as { body?: unknown }).body === "string",
					)
					.map((f) => ({
						name: f.name,
						heading: f.heading,
						body: f.body,
						rationale:
							typeof f.rationale === "string" ? f.rationale : undefined,
					}))
			: [];

		if (palettes.length === 0 && fonts.length === 0) return null;
		return { palettes, fonts };
	}

	return (
		<div className="design-chat">
			<Conversation
				className="design-chat-transcript"
				onWheel={(event) => {
					// Scrolling up while a response streams pauses the follow.
					if (busy && event.deltaY < 0) followRef.current = false;
				}}
			>
				<ConversationContent>
					{messages.length === 0 && !busy && (
						<ConversationEmptyState
							title="Say something to start the design."
							description="The designer asks questions, walks through sections with live previews, then composes and publishes the page."
						/>
					)}
					{messages.map((m, messageIndex) => {
						const isUser = m.role === "user";
						// Interactive tool cards (confirmations, style pickers) are
						// only actionable while they're the conversation's latest
						// message — a restored history card is already answered or
						// superseded (answeredToolIds is session-scoped, so without
						// this guard a refresh would let an old prompt re-submit).
						const isLatestMessage = messageIndex === messages.length - 1;
						const assetRefs = messageAssetRefs(m, assetsByIdRef.current);
						return (
							<MessageScrollerItem
								key={m.id}
								messageId={m.id}
								scrollAnchor={isUser}
							>
								<Message from={m.role as "user" | "assistant"}>
									<MessageContent>
										{assetRefs.length > 0 && (
											<div
												className={cn(
													"mb-1.5 flex flex-wrap gap-1.5",
													isUser && "justify-end",
												)}
											>
												{assetRefs.map((ref) => (
													<AssetThumb
														key={ref.id}
														asset={ref}
														className="h-12 w-16 border border-border"
													/>
												))}
											</div>
										)}
										{m.parts.map((part, i) => {
											if (part.type === "text") {
												return (
													<div
														key={
															// biome-ignore lint/suspicious/noArrayIndexKey: parts are append-only
															i
														}
														className={cn(
															"w-fit max-w-[85%] rounded-2xl px-4 py-2.5 text-sm",
															isUser
																? "ml-auto bg-primary text-primary-foreground"
																: "bg-muted",
														)}
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

												if (toolName === "style_options") {
													const options = styleOptionsFromTool(tool);
													if (options) {
														return (
															<StyleOptions
																key={tool.toolCallId}
																palettes={options.palettes}
																fonts={options.fonts}
																disabled={busy || !isLatestMessage}
																onApply={(text) => {
																	void sendMessage({ text });
																}}
															/>
														);
													}
												}

												if (toolName === "wireframe") {
													const wireframe = wireframeFromTool(tool);
													if (wireframe) {
														return (
															<WireframeCard
																key={tool.toolCallId}
																name={wireframe.name}
																previewUrl={wireframe.previewUrl}
																note={wireframe.note}
															/>
														);
													}
												}

												if (toolName === "open_element_chat") {
													const handoff = elementChatFromTool(tool);
													if (handoff) {
														return (
															<div
																key={tool.toolCallId}
																className="flex items-center justify-between gap-2 rounded-lg border bg-muted/30 p-2.5"
															>
																<div className="min-w-0">
																	<p className="truncate text-sm font-medium">
																		{handoff.elementName}{" "}
																		<span className="font-normal text-muted-foreground">
																			({handoff.elementType})
																		</span>
																	</p>
																	<p className="text-xs text-muted-foreground">
																		Element chat ready
																	</p>
																</div>
																<Button
																	type="button"
																	size="sm"
																	onClick={() => onOpenElementChat?.(handoff)}
																>
																	Open chat
																</Button>
															</div>
														);
													}
												}

												if (toolName === "propose_design") {
													const proposal = proposalFromTool(tool);
													if (proposal) {
														return (
															<DesignProposal
																key={tool.toolCallId}
																name={proposal.name}
																html={proposal.html}
																previewUrl={proposal.previewUrl}
															/>
														);
													}
												}

												if (
													toolName === "save_component" ||
													toolName === "test_component"
												) {
													const testDrive = componentTestFromTool(tool);
													if (testDrive) {
														return (
															<ComponentTestDrive
																key={tool.toolCallId}
																name={testDrive.name}
																tagName={testDrive.tagName}
																previewUrl={testDrive.previewUrl}
																saved={testDrive.saved}
																smokePassed={testDrive.smokePassed}
																smokeSkipped={testDrive.smokeSkipped}
																smokeReason={testDrive.smokeReason}
																initialErrors={testDrive.initialErrors}
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
							<Spinner />{" "}
							{status === "chatting"
								? "designer is working — authoring, previewing and verifying…"
								: "streaming…"}
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
			{selectedSection && (
				<div className="design-chat-selection">
					<span className="section-chip">
						Selected: <strong>{selectedSection}</strong>
					</span>
					<button
						type="button"
						className="section-chip-clear"
						onClick={onClearSection}
						aria-label="Clear selection"
					>
						✕
					</button>
				</div>
			)}
			<AssetDropzone
				className={cn(
					"rounded-lg transition-colors",
					dragOver && "ring-2 ring-primary/50",
				)}
				onDragEnter={(e) => {
					if (busy) return;
					e.preventDefault();
					// dragenter/dragleave pair (dragover fires continuously, so an
					// increment there would leave the ring stuck after a drop
					// outside the zone).
					setDragDepth((depth) => depth + 1);
				}}
				onDragOver={(e) => {
					// Must preventDefault continuously for the drop to be allowed.
					e.preventDefault();
				}}
				onDragLeave={(e) => {
					e.preventDefault();
					setDragDepth((depth) => Math.max(0, depth - 1));
				}}
				onDrop={(e) => {
					e.preventDefault();
					setDragDepth(0);
					if (busy) return;
					const files = Array.from(e.dataTransfer.files ?? []);
					if (files.length > 0) {
						void uploadAssets(files);
						return;
					}
					// Dragged from the assets drawer (StudioAssets sets this data).
					const asset = assetsByIdRef.current.get(
						e.dataTransfer.getData(ASSET_DRAG_TYPE),
					);
					if (asset) attachAsset(asset);
				}}
			>
				{attachedAssets.length > 0 && (
					<div className="mb-2 grid grid-cols-1 gap-1.5">
						{attachedAssets.map((asset) => (
							<AssetChip
								key={asset.id}
								asset={asset}
								onRemove={() => detachAsset(asset.id)}
								onDescribe={(description) => describeAsset(asset, description)}
							/>
						))}
					</div>
				)}
				<div className="relative">
					{slashActive && (
						<SkillSlashMenu
							onSelect={selectSkill}
							query={slashQuery}
							skills={designSkills}
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
							if (undescribed) {
								setAssetError(
									`Describe ${undescribed.filename} before sending`,
								);
								return;
							}
							setAssetError(null);
							if (attachedIds.length > 0) {
								void sendMessage({
									text,
									metadata: { assetIds: [...attachedIds] },
								});
								setAttachedIds([]);
							} else {
								void sendMessage({ text });
							}
						}}
					>
						<PromptInputBody data-align="block-start">
							<PromptInputTextarea
								placeholder="e.g. make the hero darker and add a pricing section — or / for skills"
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
								ref={textareaRef}
							/>
						</PromptInputBody>
						<PromptInputFooter>
							<PromptInputTools>
								<Sheet>
									<SheetTrigger
										render={
											<PromptInputButton
												type="button"
												disabled={busy}
												title="Attach assets"
											/>
										}
									>
										<Paperclip className="h-3.5 w-3.5" />
										Assets{assets.length > 0 ? ` (${assets.length})` : ""}
									</SheetTrigger>
									<SheetContent
										side="right"
										className="w-[min(90vw,340px)]! p-0 sm:w-[320px]!"
									>
										<StudioAssets
											assets={assets}
											isLoading={assetsLoading}
											busy={busy}
											onAttach={attachAsset}
											onUpload={(files) => void uploadAssets(files)}
											onDescribe={describeAsset}
											onRetry={(asset) => {
												setAssetError(null);
												void trpc.designs.assets.describe
													.mutate({ projectId, assetId: asset.id })
													.then(() => refreshAssets())
													.catch((e) =>
														setAssetError(
															e instanceof Error ? e.message : String(e),
														),
													);
											}}
											onDelete={(asset) => {
												setAssetError(null);
												void trpc.designs.assets.delete
													.mutate({ projectId, assetId: asset.id })
													.then(() => {
														setAssets((prev) =>
															prev.filter((a) => a.id !== asset.id),
														);
														detachAsset(asset.id);
													})
													.catch((e) =>
														setAssetError(
															e instanceof Error ? e.message : String(e),
														),
													);
											}}
										/>
									</SheetContent>
								</Sheet>
								<Button
									disabled={busy}
									onClick={() => setSkillsOpen(true)}
									size="sm"
									type="button"
									variant="ghost"
									className="h-7 gap-1 border-none bg-transparent px-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
								>
									Skills
								</Button>
								<Select
									value={model}
									onValueChange={(value) => setModel(value as DesignChatModel)}
									disabled={busy}
								>
									<SelectTrigger
										className="h-7 gap-1 border-none bg-transparent px-1 text-xs text-muted-foreground shadow-none hover:bg-accent hover:text-foreground"
										size="sm"
									>
										<SelectValue placeholder="Select model" />
									</SelectTrigger>
									<SelectContent className="max-h-72">
										{DESIGN_CHAT_MODELS.map((id) => (
											<SelectItem key={id} value={id}>
												{displayNameForModel(id)}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</PromptInputTools>
							<PromptInputSubmit status={chatStatus} onStop={stop} />
						</PromptInputFooter>
					</PromptInput>
				</div>
			</AssetDropzone>
			{assetError && <p className="chat-error">{assetError}</p>}
			<ManageSkillsDialog onOpenChange={setSkillsOpen} open={skillsOpen} />
		</div>
	);
}
