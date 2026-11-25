// Container-free design chat: the admin converses with a Workers AI coding
// model (GLM-5.3) that authors a self-contained HTML design, publishes it to
// R2 through the `publish_design` tool, and can verify its own work with the
// Playwright MCP server's browser tools (see server/http/browser-mcp.ts and
// agentVisibleOrigin in design-session.ts for why the self-call origin is
// rewritten in local dev).
//
// Pipeline per turn:
//   POST /designs/:id/chat {message}
//     → history (Message) + system prompt
//     → streamText(workers-ai GLM-5.3, tools: publish_design + browser MCP)
//     → SSE text stream back to the admin UI
//     → onFinish: persist the assistant turn, publish fallback (extract HTML
//       from the final text when the model didn't call the tool), status
import "@tanstack/react-start/server-only";
import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import {
	hasToolCall,
	type ModelMessage,
	type StopCondition,
	stepCountIs,
	streamText,
	type ToolSet,
	tool,
} from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { z } from "zod";
import {
	type AssetRef,
	attachmentsContextText,
	parseAttachments,
	serializeAttachments,
} from "@/features/design-studio/assets/design-assets";
import {
	designsKey,
	isDesignId,
} from "@/features/design-studio/assets/design-files";
import { ensureElementChat } from "@/features/design-studio/element-chat/element-chat-session";
import {
	createPublication,
	publishDesignFiles,
} from "@/features/design-studio/publish/design-publish";
import { getProjectTokens } from "@/features/design-studio/tokens/design-tokens";
import { buildComponentHarnessDoc } from "@/features/design-studio/tools/component-harness";
import {
	runComponentSmokeTest,
	smokeErrorsToToolErrors,
} from "@/features/design-studio/tools/component-smoke";
import {
	componentDraftPreviewBase,
	listLibrary,
	publishTurnComponentDrafts,
	saveComponentDraft,
	seedDataCollection,
} from "@/features/design-studio/tools/component-tools";
import { validateComponentDraft } from "@/features/design-studio/tools/component-validate";
import {
	loadComposePageByPath,
	renderTokenCss,
} from "@/features/design-studio/tools/compose";
import {
	bindDataTool,
	composePageTool,
	defineFlowTool,
	defineTemplateTool,
	listPagesTool,
} from "@/features/design-studio/tools/page-tools";
import { loadBrandKit } from "@/features/projects/brand-kit/brand-kit-load";
import {
	DESIGN_SKILL_CATEGORIES,
	parseSlashCommand,
	type SkillSummary,
	skillContextText,
	skillInCategories,
} from "@/features/skills";
import {
	chatPartsFromSteps,
	chatPartsJson,
	chatPartsPayload,
	withTextPart,
} from "@/lib/chat-parts";
import {
	ABANDONED_LEASE_MS as SHARED_ABANDONED_LEASE_MS,
	DEFAULT_TURN_TIMEOUT_MS as SHARED_DEFAULT_TURN_TIMEOUT_MS,
} from "@/lib/chat-turn-limits";
import { getPrisma } from "@/lib/db";
import { validateMessageOwner } from "@/lib/message-owner";
import {
	buildLibraryContextText,
	DESIGN_CHAT_MODEL,
	DESIGN_CHAT_MODELS,
	type DesignChatModel,
	designSystemPrompt,
	draftFileName,
	extractHtml,
} from "./design-chat-prompt";

export { DESIGN_CHAT_MODEL, designSystemPrompt, draftFileName, extractHtml };

/**
 * Shared field schemas for the component authoring tools (`save_component`,
 * `test_component`) — one definition so the two tools can never drift apart.
 */
const componentDraftFields = {
	name: z
		.string()
		.min(1)
		.max(80)
		.describe(
			"library name, e.g. 'PricingCard' — unique per project; saving again under the same name adds a new draft version",
		),
	kind: z
		.enum(["layout", "section", "element"])
		.optional()
		.describe(
			"'section' for full page sections, 'element' for small widgets, 'layout' for structural wrappers (default 'section')",
		),
	tagName: z
		.string()
		.min(1)
		.max(64)
		.describe(
			'custom element name, lowercase "tb-…", e.g. "tb-pricing-card" — unique per project',
		),
	js: z
		.string()
		.min(1)
		.max(100_000)
		.describe(
			"custom element class source — one class extends HTMLElement + one customElements.define matching tagName (see the Building blocks skeleton)",
		),
	html: z
		.string()
		.max(100_000)
		.optional()
		.describe("template markup fragment (optional)"),
	css: z
		.string()
		.max(50_000)
		.optional()
		.describe("component styles using var(--tb-…) tokens (optional)"),
	shadowMode: z
		.enum(["light", "open"])
		.optional()
		.describe(
			'"light" (default) renders into the page DOM and is SSR-friendly; "open" uses an open shadow root',
		),
	apiSchema: z
		.string()
		.max(20_000)
		.optional()
		.describe(
			"JSON contract string: { attributes: {name: {type, description}}, slots: [name], events: [name] }",
		),
	defaults: z
		.string()
		.max(20_000)
		.optional()
		.describe("JSON string of default attribute values"),
} satisfies Record<string, z.ZodTypeAny>;

export const DESIGN_CHAT_PUBLIC_ERROR = "chat turn failed — try again";
export const DESIGN_CHAT_CONFLICT_ERROR = "chat turn already in progress";
/**
 * Shown when a turn hits the hard wall-clock deadline. Tool outputs
 * (drafts, components, publishes) are already stored by the time the
 * deadline fires, so the user can continue the conversation from there.
 */
export const DESIGN_CHAT_TIMEOUT_ERROR =
	"design chat turn ran out of time — everything it created is saved; send a message to continue";

/**
 * Client-safe error text for a failed turn: recognized public messages pass
 * through, anything else redacts to the generic retryable error. Used by the
 * designChat actor when broadcasting `turnFailed` so a deadline or conflict
 * reaches the client without leaking internal error details.
 */
export function designChatPublicError(error: unknown): string {
	if (error instanceof Error) {
		if (error.message === DESIGN_CHAT_TIMEOUT_ERROR) {
			return DESIGN_CHAT_TIMEOUT_ERROR;
		}
		if (error.message === DESIGN_CHAT_CONFLICT_ERROR) {
			return DESIGN_CHAT_CONFLICT_ERROR;
		}
	}
	return DESIGN_CHAT_PUBLIC_ERROR;
}

const SECTION_PREVIEW_FAILED_ERROR = "section preview failed — try again";
const DESIGN_PROPOSAL_FAILED_ERROR = "design proposal failed — try again";
const DESIGN_PUBLISH_FAILED_ERROR = "design publish failed — try again";
const WIREFRAME_FAILED_ERROR = "wireframe failed — try again";

export class DesignChatTurnConflictError extends Error {
	constructor() {
		super(DESIGN_CHAT_CONFLICT_ERROR);
		this.name = "DesignChatTurnConflictError";
	}
}

/** Replay at most this many turns of history; older turns are dropped. */
// Replayed turns per chat request. Cost dial: each turn re-bills the
// entire replay as input tokens, and the system prompt's live library
// context already carries the project state (KUK-926), so deep history is
// mostly redundant narration.
const MAX_HISTORY_MESSAGES = 24;

/** Tool-call rounds per chat turn — publish, verify with a few browser calls, fix. */
const MAX_STEPS = 16;

/**
 * Wall-clock budget for the design chat tool loop. streamText's stopWhen
 * checks this between steps, so a single step may slightly exceed the budget
 * but the loop can never run for many steps after it expires. Sized under
 * the hard turn deadline below so the graceful between-steps stop usually
 * wins and onFinish can persist normally — the deadline is the backstop for
 * a step that hangs (a wedged model stream or tool execute never lets this
 * condition fire, which is how turns used to run for 20+ minutes).
 */
const DESIGN_CHAT_THINKING_BUDGET_MS = 3 * 60 * 1000;

/**
 * Hard deadline for a whole chat turn (model stream + tool loop). Turns may
 * legitimately run very long (deep research, many tool rounds), so the
 * default allows up to 40 minutes; it exists only as a backstop for a
 * truly hung Workers AI stream or browser tool. It must stay under the
 * 45-minute abandoned-turn lease window (ABANDONED_LEASE_MS): a live turn
 * has to reach onFinish/onError/onAbort — which clear the lease — before a
 * successor could lazily reclaim it, or healthy long turns would be stolen
 * mid-stream. Overridable for tests via DESIGN_CHAT_TURN_TIMEOUT_MS.
 * Shared with the campaign and element chats via lib/chat-turn-limits.ts.
 */
const DEFAULT_TURN_TIMEOUT_MS = SHARED_DEFAULT_TURN_TIMEOUT_MS;

/**
 * Lazy abandoned-turn reclaim window. A successor turn may steal the lease
 * only once the previous claim is older than this. Must exceed the turn
 * deadline above so a live turn always settles first.
 */
const ABANDONED_LEASE_MS = SHARED_ABANDONED_LEASE_MS;

/**
 * Cap on the browser-MCP connect handshake. It runs after the turn lease
 * is claimed, so a hung Durable Object stream used to hang the turn with
 * the lease already held. On timeout the turn proceeds without browser
 * tools (same as the existing unavailable path). Overridable for tests via
 * DESIGN_CHAT_MCP_CONNECT_TIMEOUT_MS.
 */
const DEFAULT_MCP_CONNECT_TIMEOUT_MS = 30 * 1000;

/** Integer env override (ms) for a timeout knob; falls back on any invalid value. */
function timeoutMs(env: Env, name: string, fallback: number): number {
	const raw = Number((env as unknown as Record<string, unknown>)[name]);
	return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function thinkingBudgetIs<TTools extends ToolSet>(
	budgetMs: number,
): StopCondition<TTools> {
	const startedAt = Date.now();
	return ({ steps }) => {
		if (Date.now() - startedAt > budgetMs) {
			console.log(
				`[design-chat] thinking budget exhausted after ${steps.length} step(s)`,
			);
			return true;
		}
		return false;
	};
}

/**
 * Fetch the Playwright MCP server's browser tools, plus the client so the
 * caller can close the MCP session once the turn ends — the service-binding
 * stream to the MCP_OBJECT Durable Object must not outlive the request.
 * Null tools + null client when the server is unavailable.
 */
async function browserTools(
	env: Env,
	origin: string,
	connectTimeoutMs: number,
): Promise<{
	tools: ToolSet | null;
	client: MCPClient | null;
}> {
	if (!env.BROWSER_MCP_TOKEN) {
		return { tools: null, client: null };
	}
	const { agentVisibleOrigin } = await import("./design-session");
	const url = `${agentVisibleOrigin(env, origin)}/browser-mcp`;
	const token = env.BROWSER_MCP_TOKEN;
	// The handshake (createMCPClient + tools) has no timeout of its own and
	// runs against a Durable Object over the self binding — a hung stream
	// here used to hang the turn after the lease was claimed. Race it
	// against a deadline; on timeout the turn continues without browser
	// tools, and the late handshake result is closed so the DO stream does
	// not outlive the turn.
	const handshake = (async (): Promise<{
		tools: ToolSet;
		client: MCPClient;
	}> => {
		const client = await createMCPClient({
			transport: {
				type: "http",
				url,
				headers: { Authorization: `Bearer ${token}` },
				// Route through the self service binding instead of a network
				// self-call — workerd's local dev runtime throws "internal
				// error" on loopback fetches. The binding needs a Request
				// object (not URL + init), so assemble one here.
				fetch: (input, init) => env.SELF.fetch(new Request(input, init)),
				// The transport defaults to "error", which the Workers
				// runtime rejects outright ("use manual and check the
				// status code") — follow is the right behavior here anyway.
				redirect: "follow",
			},
		});
		// client.tools() returns a wider shape than v6's ToolSet (its
		// `description` may be a function); the runtime contract is
		// compatible, so narrow with a cast.
		const tools = await client.tools();
		return { tools: tools as unknown as ToolSet, client };
	})();
	try {
		return await Promise.race([
			handshake,
			new Promise<never>((_, reject) =>
				setTimeout(
					() =>
						reject(
							new Error(
								`browser MCP connect timed out after ${connectTimeoutMs}ms`,
							),
						),
					connectTimeoutMs,
				),
			),
		]);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		console.log("[design-chat] browser MCP unavailable, continuing:", reason);
		// Close whatever the handshake eventually produces — it may still be
		// in flight after a timeout. The caller never owns a client on this
		// path; if the handshake already failed there is nothing to close.
		void handshake.then(
			(result) => {
				void result.client.close().catch(() => {});
			},
			() => {},
		);
		return { tools: null, client: null };
	}
}

async function loadHistory(
	env: Env,
	projectId: string,
): Promise<ModelMessage[]> {
	// Newest turns matter most; take from the descending end and replay in
	// chronological order. (The current user message is persisted before this
	// runs and must never fall out of the window.) The cap is a cost dial as
	// much as a context one: every turn re-bills the whole replay, and the
	// system prompt's live library context (components/pages/collections)
	// already carries the project state older turns would repeat. 24 turns
	// keeps conversational continuity without re-shipping a full session.
	const rows = await getPrisma(env).message.findMany({
		where: { designId: projectId },
		orderBy: { createdAt: "desc" },
		take: MAX_HISTORY_MESSAGES,
	});
	return rows.reverse().map((row) => {
		// Asset descriptions were frozen into the message at send time, so
		// replay is a pure string read that survives asset deletion.
		const attachments = parseAttachments(row.attachments);
		const content =
			attachments.length > 0
				? `${row.content}\n\n${attachmentsContextText(attachments)}`
				: row.content;
		return {
			role: row.role === "user" ? "user" : "assistant",
			content,
		};
	});
}

async function persistMessage(
	env: Env,
	projectId: string,
	role: "user" | "assistant",
	content: string,
	attachments?: string,
): Promise<void> {
	await getPrisma(env).message.create({
		data: {
			id: crypto.randomUUID(),
			...validateMessageOwner({ designId: projectId }),
			role,
			content,
			...(attachments !== undefined ? { attachments } : {}),
		},
	});
}

/**
 * A retry of a failed turn re-POSTs the same user message (client Retry
 * button or a manual resend). Without this guard the transcript would grow
 * a duplicate user row per attempt. Only a trailing unanswered user message
 * matches, so repeated-but-answered requests still persist normally.
 * The window compares worker-clock time against D1 timestamps — both UTC on
 * Cloudflare; advisory-only if the clock ever drifts.
 */
async function isUserRetry(
	env: Env,
	projectId: string,
	message: string,
): Promise<boolean> {
	const last = await getPrisma(env).message.findFirst({
		where: { designId: projectId },
		orderBy: { createdAt: "desc" },
	});
	return (
		last?.role === "user" &&
		last.content === message &&
		Date.now() - last.createdAt.getTime() < 5 * 60 * 1000
	);
}

/**
 * Resolves a "/<slug>" invocation at the start of the latest user message
 * against the enabled design-category Skill rows (same pattern as the
 * campaign chat's resolveSlashSkill). Unknown, disabled or out-of-category
 * slugs resolve to null — the message then flows to the model exactly as
 * typed. The persisted row is untouched either way: only this model-facing
 * view carries the injected skill content.
 */
async function resolveDesignSlashSkill(
	env: Env,
	history: ModelMessage[],
): Promise<{ name: string; content: string; rest: string } | null> {
	const last = history[history.length - 1];
	if (
		last?.role !== "user" ||
		typeof last.content !== "string" ||
		!last.content.trim().startsWith("/")
	) {
		return null;
	}
	const slash = parseSlashCommand(last.content);
	if (!slash) return null;
	const skill = await getPrisma(env).skill.findUnique({
		where: { slug: slash.slug },
		select: { name: true, content: true, enabled: true, category: true },
	});
	if (
		!skill?.enabled ||
		!skillInCategories(skill.category, DESIGN_SKILL_CATEGORIES)
	) {
		return null;
	}
	return { name: skill.name, content: skill.content, rest: slash.rest };
}

async function persistAssistantMessage(
	env: Env,
	projectId: string,
	turnId: string,
	content: string,
	partsJson?: string | null,
): Promise<void> {
	const inserted = await env.DB.prepare(
		`INSERT INTO "Message" ("id", "designId", "role", "content", "parts", "createdAt")
		SELECT ?, ?, ?, ?, ?, ?
		WHERE EXISTS (
			SELECT 1 FROM "Design" WHERE "id" = ? AND "activeTurnId" = ?
		)`,
	)
		.bind(
			crypto.randomUUID(),
			projectId,
			"assistant",
			content,
			// Reasoning + tool-call parts so a refresh rebuilds what the live
			// stream showed; null degrades to the flat text (pre-feature rows).
			partsJson ?? null,
			new Date().toISOString(),
			projectId,
			turnId,
		)
		.run();
	if (inserted.meta.changes !== 1) throw new Error("stale design chat turn");
}

/**
 * Shared setup for one design chat turn. Returns the streamText result so the
 * HTTP route can pipe it to a Response and the RivetKit actor can broadcast
 * individual UI-message chunks to connected clients. The assistant turn is
 * persisted (and status/error updated) by the completion handlers — onFinish
 * for completed streams, onAbort/watchdog for a deadline hit — all of which
 * also release the turn lease before this returns its promises.
 */
async function createDesignChatStreamResult(
	env: Env,
	projectId: string,
	options: {
		message: string;
		section?: string;
		/** Any model id is accepted; unknown ones coerce to DESIGN_CHAT_MODEL. */
		model?: string;
		/** Resolved asset snapshots for this turn's attachments. */
		assets?: AssetRef[];
		origin: string;
		abortSignal?: AbortSignal;
	},
) {
	if (!isDesignId(projectId)) {
		throw new Error(`invalid design project id: ${projectId}`);
	}
	const prisma = getPrisma(env);
	const project = await prisma.design.findUnique({
		where: { id: projectId },
	});
	if (!project) {
		throw new Error(`design project ${projectId} not found`);
	}

	// Brand kit (KUK-898): when the design's project defines one, its
	// tokens, typography and fonts are injected into the system prompt as
	// the source of truth — the model no longer derives or offers style.
	const brandKit = project.projectId
		? await loadBrandKit(prisma, project.projectId)
		: null;

	// Library context injection (KUK-926): the project's current components,
	// collections, pages, templates and flows ride in the system prompt so
	// the model composes against reality instead of spending tool calls on
	// list_components/list_pages discovery every turn. Reuses the exact
	// summaries the list tools report (one source, two views). Fail-soft:
	// a read problem drops the section, never the turn.
	let libraryContext: string | null = null;
	if (project.projectId) {
		try {
			const [library, pages] = await Promise.all([
				listLibrary(prisma, { projectId: project.projectId }),
				listPagesTool(prisma, { projectId: project.projectId }),
			]);
			libraryContext = buildLibraryContextText(library, pages);
		} catch (error) {
			console.log("[design-chat] library context skipped:", error);
		}
	}

	// Select-to-edit: a canvas selection steers the model to that section.
	// The context rides in the user turn (and is persisted with it), so the
	// transcript shows exactly what the model saw.
	const message = options.section
		? `[Selected section: ${options.section}] ${options.message}`
		: options.message;

	const siteUrl = `${options.origin}/designs/${projectId}/site`;
	const turnId = crypto.randomUUID();
	const turnClaimedAt = new Date();
	let claimed = await prisma.design.updateMany({
		where: { id: projectId, activeTurnId: null },
		data: {
			activeTurnId: turnId,
			turnClaimedAt,
			status: "chatting",
			error: null,
		},
	});
	if (claimed.count !== 1) {
		claimed = await prisma.design.updateMany({
			where: {
				id: projectId,
				activeTurnId: { not: null },
				OR: [
					{ turnClaimedAt: null },
					{
						turnClaimedAt: {
							lt: new Date(turnClaimedAt.getTime() - ABANDONED_LEASE_MS),
						},
					},
				],
			},
			data: {
				activeTurnId: turnId,
				turnClaimedAt,
				status: "chatting",
				error: null,
			},
		});
	}
	if (claimed.count !== 1) {
		const current = await prisma.design.findUnique({
			where: { id: projectId },
			select: { id: true },
		});
		if (current) throw new DesignChatTurnConflictError();
		throw new Error(`design project ${projectId} not found`);
	}

	let mcpClient: MCPClient | null = null;
	let failureFinalized = false;
	let mcpClosed = false;
	const closeMcp = async (): Promise<void> => {
		if (mcpClosed) return;
		mcpClosed = true;
		await mcpClient?.close().catch(() => {});
	};
	// Resolved once the turn's completion handlers have fully run (onFinish,
	// onError, onAbort, or failTurn). The deadline watchdog must not fire past
	// this point, and the deadline promise itself must not be left pending on
	// a timer the turn already outlived.
	let resolveTurnComplete!: () => void;
	const turnComplete = new Promise<void>((resolve) => {
		resolveTurnComplete = resolve;
	});
	const failTurn = async (
		error: unknown,
		publicError: string = DESIGN_CHAT_PUBLIC_ERROR,
	): Promise<void> => {
		if (failureFinalized) return;
		failureFinalized = true;
		console.log(`[design-chat] turn failed for ${projectId}:`, error);
		await prisma.design
			.updateMany({
				where: { id: projectId, activeTurnId: turnId },
				data: {
					activeTurnId: null,
					turnClaimedAt: null,
					status: "failed",
					error: publicError,
				},
			})
			.catch(() => {});
		await closeMcp();
		resolveTurnComplete();
	};

	let history: ModelMessage[];
	let designSkills: SkillSummary[] = [];
	let workersai: ReturnType<typeof createWorkersAI>;
	let mcpTools: ToolSet | null;
	let published = false;
	let publishFailure: unknown;
	let streamFailed = false;
	// Component drafts this turn authored via save_component (KUK-924).
	// publish_design auto-publishes the latest draft of each before
	// snapshotting the publication (closes the KUK-921 gap).
	const turnComponents: Array<{ componentId: string; versionId: string }> = [];

	const assertTurnActive = async (): Promise<void> => {
		if (failureFinalized || streamFailed) {
			throw new Error("stale design chat turn");
		}
		const owned = await prisma.design.updateMany({
			where: { id: projectId, activeTurnId: turnId },
			data: { activeTurnId: turnId },
		});
		if (owned.count !== 1) throw new Error("stale design chat turn");
	};

	const publish = async (html: string): Promise<void> => {
		await assertTurnActive();
		// Staged live keys commit through the same ownership fence.
		await publishDesignFiles(env, projectId, html, { turnId });
		publishFailure = undefined;
		published = true;
	};

	/**
	 * Assembles the component test harness for a draft: project tokens
	 * included so `var(--tb-…)` resolves like it does on a published page
	 * (best effort — a token fetch failure yields a tokenless harness, same
	 * as before the harness existed).
	 */
	const componentHarnessHtml = async (input: {
		js: string;
		css?: string | null;
		html?: string | null;
		title?: string;
	}): Promise<string> => {
		let tokenCss: string | null = null;
		if (project.projectId) {
			try {
				const tokens = await getProjectTokens(prisma, project.projectId);
				tokenCss = renderTokenCss(tokens) || null;
			} catch (error) {
				console.log("[design-chat] harness tokens skipped:", error);
			}
		}
		return buildComponentHarnessDoc({ ...input, tokenCss });
	};

	/**
	 * Serves a harness document through the drafts file route (same route as
	 * preview_section — `allow-scripts` sandbox CSP). Best effort: a preview
	 * failure never fails the tool result; undefined when it cannot serve.
	 *
	 * `unique: true` (test/rejected attempts) adds a random attempt suffix:
	 * those attempts repeat within a design, and a reused key would (a)
	 * replace the bytes behind every earlier card with the same base name
	 * and (b) race the route's 60s cache — the displayed preview would then
	 * disagree with the smoke verdict it is supposed to explain. Saved
	 * version previews (`-v<n>`) MUST stay suffix-free: they are unique per
	 * save AND the library demo-doc lookup (`component-library.ts`)
	 * resolves exactly that name.
	 */
	const putComponentHarness = async (
		harnessHtml: string,
		base: string,
		serve: { unique?: boolean } = {},
	): Promise<string | undefined> => {
		const fileName = draftFileName(
			serve.unique ? `${base}-${crypto.randomUUID().slice(0, 8)}` : base,
		);
		if (!fileName) return undefined;
		try {
			const rel = `drafts/${fileName}`;
			await env.DESIGNS.put(designsKey(projectId, rel), harnessHtml, {
				httpMetadata: { contentType: "text/html; charset=utf-8" },
			});
			return `${options.origin}/designs/${projectId}/file/${rel}`;
		} catch (error) {
			console.log("[design-chat] component preview skipped:", error);
			return undefined;
		}
	};

	// Unknown/removed model ids (e.g. stale localStorage from a client
	// whose selector predates the list cleanup) coerce to the default
	// instead of failing the turn — every listed model works; the ones
	// that didn't were removed.
	const modelId =
		options.model &&
		DESIGN_CHAT_MODELS.includes(options.model as DesignChatModel)
			? options.model
			: DESIGN_CHAT_MODEL;
	const attachments =
		options.assets && options.assets.length > 0
			? serializeAttachments(options.assets)
			: undefined;
	try {
		if (!(await isUserRetry(env, projectId, message))) {
			await persistMessage(env, projectId, "user", message, attachments);
		}
		history = await loadHistory(env, projectId);
		// Studio skills (0020): design-category metadata for the system
		// prompt, plus a "/<slug>" slash invocation resolved against the
		// enabled design rows — the injected content lives only in this
		// model-facing view (the persisted row keeps the typed message).
		designSkills = await prisma.skill.findMany({
			where: { enabled: true, category: { in: [...DESIGN_SKILL_CATEGORIES] } },
			orderBy: { slug: "asc" },
			select: { name: true, slug: true, description: true },
		});
		const slashSkill = await resolveDesignSlashSkill(env, history);
		if (slashSkill) {
			const last = history[history.length - 1];
			last.content = `${skillContextText(slashSkill)}\n\n${slashSkill.rest}`;
		}
		workersai = createWorkersAI({ binding: env.AI });
		const browser = await browserTools(
			env,
			options.origin,
			timeoutMs(
				env,
				"DESIGN_CHAT_MCP_CONNECT_TIMEOUT_MS",
				DEFAULT_MCP_CONNECT_TIMEOUT_MS,
			),
		);
		mcpTools = browser.tools;
		mcpClient = browser.client;
		if (options.model && options.model !== modelId) {
			console.log(
				`[design-chat] unknown model "${options.model}", using ${modelId}`,
			);
		}
	} catch (error) {
		await failTurn(error);
		throw error;
	}

	// Hard deadline for the whole turn: aborts the model loop (providers that
	// honor the signal stop streaming), closes the UI stream with an error
	// part, and — via the watchdog below — releases the lease even when a
	// hung tool execute keeps the loop from noticing the abort. Sized under
	// the 45-minute abandoned-lease window so a live turn always settles
	// before a successor could lazily reclaim it.
	const turnTimeoutMs = timeoutMs(
		env,
		"DESIGN_CHAT_TURN_TIMEOUT_MS",
		DEFAULT_TURN_TIMEOUT_MS,
	);
	const turnDeadline = new AbortController();
	const deadlineTimer = setTimeout(
		() =>
			turnDeadline.abort(
				new Error(`design chat turn exceeded ${turnTimeoutMs}ms`),
			),
		turnTimeoutMs,
	);
	// Combine the deadline with the caller's signal (the actor's connection
	// abort) into the single signal streamText honors. Listeners are removed
	// in the turn teardown so per-turn closures never accumulate on the
	// (possibly long-lived) caller signal.
	const callerSignal = options.abortSignal;
	const abortController = new AbortController();
	const forwardAbort = (reason: unknown): void => {
		if (!abortController.signal.aborted) abortController.abort(reason);
	};
	const deadlineForward = (): void => forwardAbort(turnDeadline.signal.reason);
	const callerForward = (): void => forwardAbort(callerSignal?.reason);
	turnDeadline.signal.addEventListener("abort", deadlineForward, {
		once: true,
	});
	callerSignal?.addEventListener("abort", callerForward, { once: true });
	const detachAbortForwarding = (): void => {
		turnDeadline.signal.removeEventListener("abort", deadlineForward);
		callerSignal?.removeEventListener("abort", callerForward);
	};

	const result = await Promise.resolve()
		.then(() =>
			streamText({
				model: workersai(modelId, {}),
				system: designSystemPrompt({
					prompt: project.prompt,
					siteUrl,
					brandKit,
					skills: designSkills,
					libraryContext,
				}),
				messages: history,
				// Hard deadline for the model loop (combined with the caller's
				// client-disconnect signal above): without it a hung Workers AI
				// stream held the lease for the actor's whole actionTimeout.
				// Aborting routes through onAbort → failTurn, releasing the lease.
				abortSignal: abortController.signal,
				// ask_user and style_options end the turn: interactive pickers
				// must never be followed by more text, reasoning, or tool calls
				// while the user is deciding.
				stopWhen: [
					stepCountIs(MAX_STEPS),
					hasToolCall("ask_user"),
					hasToolCall("style_options"),
					thinkingBudgetIs(DESIGN_CHAT_THINKING_BUDGET_MS),
				],
				tools: {
					wireframe: tool({
						description:
							"Sketch the CONCEPT of the page or of ONE section as a low-fidelity SVG wireframe BEFORE styling anything: grey boxes and blocks for regions, real text labels, short annotations, simple arrows. Use it early to agree on layout and content placement with the user — never for finished, styled designs (use preview_section / propose_design for those). The sketch renders inline in the chat.",
						inputSchema: z.object({
							name: z
								.string()
								.min(1)
								.max(60)
								.describe(
									"short sketch name, e.g. page-overview, hero-wireframe",
								),
							svg: z
								.string()
								.min(50)
								.max(16_384)
								.refine(
									(s) => /^\s*<svg\b[^>]*\bxmlns=/i.test(s),
									"must be a standalone <svg> document with an xmlns attribute",
								)
								.describe(
									"a complete standalone <svg> document starting with <svg xmlns=…>",
								),
							note: z
								.string()
								.max(300)
								.optional()
								.describe(
									"one sentence about what to look at or decide in this sketch",
								),
						}),
						execute: async ({ name, svg, note }) => {
							await assertTurnActive();
							const fileName = draftFileName(name, "svg");
							if (!fileName) {
								return { ok: false, error: "invalid sketch name" };
							}
							try {
								const rel = `drafts/${fileName}`;
								await env.DESIGNS.put(designsKey(projectId, rel), svg, {
									httpMetadata: { contentType: "image/svg+xml" },
								});
								return {
									ok: true,
									previewUrl: `${options.origin}/designs/${projectId}/file/${rel}`,
									note,
								};
							} catch (error) {
								console.log("[design-chat] wireframe failed:", error);
								return { ok: false, error: WIREFRAME_FAILED_ERROR };
							}
						},
					}),
					preview_section: tool({
						description:
							"Publish a small standalone HTML page demonstrating ONE page section so the user can view it in isolation during the design discussion. Use it while walking through the design section by section — NOT for the final composed page (use publish_design for that). Returns a public preview URL.",
						inputSchema: z.object({
							name: z
								.string()
								.min(1)
								.max(60)
								.describe("short section name, e.g. hero, pricing, footer"),
							html: z.string().min(50).max(8_192),
						}),
						execute: async ({ name, html }) => {
							await assertTurnActive();
							const fileName = draftFileName(name);
							if (!fileName) {
								return { ok: false, error: "invalid section name" };
							}
							try {
								const rel = `drafts/${fileName}`;
								await env.DESIGNS.put(designsKey(projectId, rel), html, {
									httpMetadata: { contentType: "text/html; charset=utf-8" },
								});
								return {
									ok: true,
									previewUrl: `${options.origin}/designs/${projectId}/file/${rel}`,
								};
							} catch (error) {
								console.log("[design-chat] section preview failed:", error);
								return { ok: false, error: SECTION_PREVIEW_FAILED_ERROR };
							}
						},
					}),
					propose_design: tool({
						description:
							"Show the user a proposed design before finalizing it. Pass an HTML document or a major section (self-contained except pinned-CDN library scripts). The user sees both the rendered preview and the HTML source and can ask for revisions. Use this repeatedly to iterate and build the design together — only call publish_design when the user explicitly approves the proposal.",
						inputSchema: z.object({
							name: z
								.string()
								.min(1)
								.max(60)
								.describe(
									"short proposal name, e.g. hero-v1, full-page-draft, dark-hero",
								),
							html: z.string().min(50).max(2_000_000),
						}),
						execute: async ({ name, html }) => {
							await assertTurnActive();
							const fileName = draftFileName(name);
							if (!fileName) {
								return { ok: false, error: "invalid proposal name" };
							}
							try {
								const rel = `drafts/${fileName}`;
								await env.DESIGNS.put(designsKey(projectId, rel), html, {
									httpMetadata: { contentType: "text/html; charset=utf-8" },
								});
								return {
									ok: true,
									name,
									previewUrl: `${options.origin}/designs/${projectId}/file/${rel}`,
									html,
								};
							} catch (error) {
								console.log("[design-chat] design proposal failed:", error);
								return { ok: false, error: DESIGN_PROPOSAL_FAILED_ERROR };
							}
						},
					}),
					save_component: tool({
						description:
							"Save or update a reusable tb-* web component in the project library as a DRAFT version. Use it to author building blocks the page composes (sections, widgets) instead of duplicating their markup inline. Pass the element source exactly per the Building blocks conventions. The draft is executed in a real headless browser BEFORE it is saved: convention violations come back verbatim, and runtime errors (throws, console.error, the element never registering) block the save until you fix them. Returns the component ids/version and a test-drive preview URL the user can interact with.",
						inputSchema: z.object({
							...componentDraftFields,
							changeNote: z
								.string()
								.max(300)
								.optional()
								.describe("one-line summary of what changed in this version"),
						}),
						execute: async (input) => {
							await assertTurnActive();
							if (!project.projectId) {
								return {
									ok: false,
									error:
										"this design has no project — reusable components live per project",
								};
							}
							try {
								// Static gate first — no browser launch while the
								// draft still violates the written conventions.
								const staticValidation = validateComponentDraft(input);
								if (!staticValidation.ok) {
									return {
										ok: false,
										status: 400,
										errors: staticValidation.errors,
									};
								}
								// Runtime gate (KUK-926): execute the harness in a
								// real browser and only persist a draft that runs
								// clean — failures return to the model verbatim, the
								// same self-correction contract as the static gate.
								const harnessHtml = await componentHarnessHtml({
									js: input.js,
									css: input.css ?? null,
									html: input.html ?? null,
									title: `${input.name} — component test drive`,
								});
								const smoke = await runComponentSmokeTest(
									env.BROWSER,
									harnessHtml,
									{ tagName: input.tagName },
								);
								if (!smoke.ok) {
									// The user should still SEE the broken render:
									// serve the harness even for a rejected draft.
									const rejectedUrl = await putComponentHarness(
										harnessHtml,
										`${input.name.slice(0, 40)}-rejected`,
										{ unique: true },
									);
									return {
										ok: false,
										status: 422,
										errors: smokeErrorsToToolErrors(smoke.errors),
										...(rejectedUrl ? { previewUrl: rejectedUrl } : {}),
									};
								}
								const result = await saveComponentDraft(prisma, {
									projectId: project.projectId,
									turnId,
									input,
								});
								if (!result.ok) return result;
								// Track the draft for this turn's publish_design
								// auto-publish (KUK-921 gap closure).
								turnComponents.push({
									componentId: result.componentId,
									versionId: result.versionId,
								});
								// Test-drive preview: the exact harness the smoke
								// test ran (tokens + fragment + element source +
								// runtime error bridge) through the drafts file
								// route. Best effort — a preview failure never
								// fails the save.
								const previewUrl = await putComponentHarness(
									harnessHtml,
									componentDraftPreviewBase(input.name, result.version),
								);
								return {
									...result,
									...(previewUrl ? { previewUrl } : {}),
									smoke: smoke.skipped
										? { ok: true, skipped: true, reason: smoke.reason }
										: { ok: true },
								};
							} catch (error) {
								console.log("[design-chat] save_component failed:", error);
								return {
									ok: false,
									error: "component save failed — try again",
								};
							}
						},
					}),
					test_component: tool({
						description:
							"Render a tb-* component draft in a live test drive for the user WITHOUT saving it to the library. Executes the draft in a real headless browser (same runtime check as save_component), serves a sandboxed interactive preview, and reports every runtime error verbatim. Use it when the user wants to see or try a component before it becomes a library draft — or before every first save when unsure. Nothing is persisted to the component library; save with save_component once the user approves.",
						inputSchema: z.object(componentDraftFields),
						execute: async (input) => {
							await assertTurnActive();
							if (!project.projectId) {
								return {
									ok: false,
									error:
										"this design has no project — reusable components live per project",
								};
							}
							try {
								const staticValidation = validateComponentDraft(input);
								if (!staticValidation.ok) {
									return {
										ok: false,
										status: 400,
										saved: false,
										errors: staticValidation.errors,
									};
								}
								const harnessHtml = await componentHarnessHtml({
									js: input.js,
									css: input.css ?? null,
									html: input.html ?? null,
									title: `${input.name} — component test drive`,
								});
								const smoke = await runComponentSmokeTest(
									env.BROWSER,
									harnessHtml,
									{ tagName: input.tagName },
								);
								// Serve the drive either way: a failing draft is
								// exactly what the user needs to see in context.
								const previewUrl = await putComponentHarness(
									harnessHtml,
									`${input.name.slice(0, 40)}-test`,
									{ unique: true },
								);
								if (!smoke.ok) {
									return {
										ok: false,
										saved: false,
										errors: smokeErrorsToToolErrors(smoke.errors),
										...(previewUrl ? { previewUrl } : {}),
									};
								}
								return {
									ok: true,
									saved: false,
									name: input.name,
									tagName: input.tagName,
									...(previewUrl ? { previewUrl } : {}),
									smoke: smoke.skipped
										? { ok: true, skipped: true, reason: smoke.reason }
										: { ok: true },
								};
							} catch (error) {
								console.log("[design-chat] test_component failed:", error);
								return {
									ok: false,
									error: "component test drive failed — try again",
								};
							}
						},
					}),
					seed_data: tool({
						description:
							"Fill a named dummy-data collection with records (plain JSON objects) that components and pages bind to. 'append' (default) adds rows after the existing ones; 'replace' rewrites the whole collection. Call list_components first to see which collections already exist.",
						inputSchema: z.object({
							collection: z
								.string()
								.min(1)
								.max(80)
								.describe(
									"collection name, e.g. 'courses' — unique per project",
								),
							records: z
								.array(z.record(z.string(), z.unknown()))
								.min(1)
								.max(200)
								.describe(
									"dummy-data records as plain JSON objects, in display order",
								),
							mode: z
								.enum(["replace", "append"])
								.optional()
								.describe(
									"'append' (default) adds rows; 'replace' deletes and rewrites the collection",
								),
						}),
						execute: async ({ collection, records, mode }) => {
							await assertTurnActive();
							if (!project.projectId) {
								return {
									ok: false,
									error:
										"this design has no project — data collections live per project",
								};
							}
							try {
								return await seedDataCollection(prisma, env.DB, {
									projectId: project.projectId,
									name: collection,
									records,
									mode,
								});
							} catch (error) {
								console.log("[design-chat] seed_data failed:", error);
								return { ok: false, error: "data seed failed — try again" };
							}
						},
					}),
					open_element_chat: tool({
						description:
							"Open (or create) the focused chat for ONE design element — a component, page, template, data collection or flow — and hand it to the user. You are the orchestrator: create the element with your tools, then call this so the user continues that element's work in its own scoped chat. Do NOT iterate on the element's internals here once its chat is open; keep this transcript at the orchestration level. Returns the elementChatId the UI uses to open the panel.",
						inputSchema: z.object({
							elementType: z
								.enum(["component", "page", "template", "data", "flow"])
								.describe("The element's type."),
							elementId: z
								.string()
								.min(1)
								.max(64)
								.describe(
									"The element's id, exactly as returned by the tool that created or listed it (e.g. save_component / compose_page / define_template / define_flow / seed_data).",
								),
							note: z
								.string()
								.max(300)
								.optional()
								.describe(
									"One-line opener for the element chat, e.g. what the user asked for. Shown to the user when the chat opens.",
								),
						}),
						execute: async (input) => {
							await assertTurnActive();
							if (!project.projectId) {
								return {
									ok: false,
									error:
										"this design has no project — element chats live per project",
								};
							}
							try {
								const { session, created, elementName } =
									await ensureElementChat(
										prisma,
										project.projectId,
										input.elementType,
										input.elementId,
									);
								return {
									ok: true,
									elementChatId: session.id,
									elementType: input.elementType,
									elementName,
									created,
									note: input.note ?? null,
								};
							} catch (error) {
								// Recoverable: an unknown or cross-project element id
								// must never fail the turn — the model can list
								// elements and retry.
								console.log("[design-chat] open_element_chat failed:", error);
								return {
									ok: false,
									error: `${input.elementType} ${input.elementId} not found in this design's project — check the id with list_components/list_pages and retry`,
								};
							}
						},
					}),
					list_components: tool({
						description:
							"List the project's component library and data collections: component names, tag names, kinds, published/draft version numbers, and collection record counts. Call it before authoring or reusing components so you don't duplicate something that exists (or collide with its tag name).",
						inputSchema: z.object({}),
						execute: async () => {
							await assertTurnActive();
							if (!project.projectId) {
								return {
									ok: false,
									error:
										"this design has no project — reusable components live per project",
								};
							}
							try {
								return await listLibrary(prisma, {
									projectId: project.projectId,
								});
							} catch (error) {
								console.log("[design-chat] list_components failed:", error);
								return { ok: false, error: "library read failed — try again" };
							}
						},
					}),
					compose_page: tool({
						description:
							"Compose or redefine a page of the project's site: an ordered block list where each block pins ONE published library component ({ component: { name, version? } } — omit version for the published one), a named template ({ template: 'name' }), or one-off inline HTML ({ sourceHtml }). Optional per-block propsOverrides (string attributes from the component's apiSchema) and dataBindings ({ items: { collection, limit?, filter? } } bound to a seeded collection). Replace-all: re-sending blocks redefines the page. Returns the block pins and a rendered draft preview URL. Pass publish:true to publish the page — published pages are what publish_design snapshots into the live publication; draft pages stay preview-only.",
						inputSchema: z.object({
							path: z
								.string()
								.min(1)
								.max(200)
								.regex(/^\//)
								.describe(
									'site path starting with "/", e.g. "/" (home) or "/pricing" — unique per project',
								),
							title: z
								.string()
								.min(1)
								.max(200)
								.describe("page title, e.g. 'Pricing — Acme'"),
							blocks: z
								.array(
									z.object({
										component: z
											.object({
												name: z.string().min(1).max(80),
												version: z.number().int().min(1).optional(),
											})
											.optional()
											.describe(
												"library component pin; version omitted = the published version",
											),
										template: z
											.string()
											.min(1)
											.max(80)
											.optional()
											.describe("a template defined with define_template"),
										sourceHtml: z
											.string()
											.min(1)
											.max(100_000)
											.optional()
											.describe(
												"one-off inline HTML — rare escape hatch when no library component fits",
											),
										propsOverrides: z
											.record(z.string(), z.unknown())
											.optional()
											.describe(
												"string attribute overrides validated against the component's apiSchema",
											),
										dataBindings: z
											.record(z.string(), z.unknown())
											.optional()
											.describe(
												"{ prop: { collection, limit?, filter? } } — binds seeded dummy-data collections; component blocks only",
											),
									}),
								)
								.max(100)
								.describe(
									"ordered blocks, top of page first (0-based ordinals)",
								),
							publish: z
								.boolean()
								.optional()
								.describe(
									"true publishes the page so the next publish_design includes it in the live publication (default draft)",
								),
						}),
						execute: async ({ path, title, blocks, publish }) => {
							await assertTurnActive();
							if (!project.projectId) {
								return {
									ok: false,
									error: "this design has no project — pages live per project",
								};
							}
							try {
								const result = await composePageTool(prisma, env.DB, {
									projectId: project.projectId,
									designId: projectId,
									path,
									title,
									blocks,
									publish,
								});
								if (!result.ok) return result;
								// KUK-920 engine for the result summary: compose the
								// saved page (drafts render too) into a draft preview
								// doc through the same drafts file route as
								// save_component. Best effort — a preview failure
								// never fails the compose; composition problems
								// surface as warnings in the tool output.
								try {
									const composed = await loadComposePageByPath(
										prisma,
										project.projectId,
										path,
									);
									const base = path === "/" ? "home" : path.replace(/^\//, "");
									const fileName = draftFileName(`${base}-draft`);
									if (fileName) {
										const rel = `drafts/${fileName}`;
										await env.DESIGNS.put(
											designsKey(projectId, rel),
											composed.html,
											{
												httpMetadata: {
													contentType: "text/html; charset=utf-8",
												},
											},
										);
										return {
											...result,
											previewUrl: `${options.origin}/designs/${projectId}/file/${rel}`,
											...(composed.errors.length > 0
												? { compositionWarnings: composed.errors }
												: {}),
										};
									}
								} catch (error) {
									console.log(
										"[design-chat] compose_page preview skipped:",
										error,
									);
								}
								return result;
							} catch (error) {
								console.log("[design-chat] compose_page failed:", error);
								return { ok: false, error: "page compose failed — try again" };
							}
						},
					}),
					bind_data: tool({
						description:
							"Set or replace ONE page block's data bindings: { prop: { collection, limit?, filter? } } referencing a seeded dummy-data collection by name. The records render into the component as a JSON slot child at publish time. ordinal is the block's 0-based position from compose_page; bindings only work on component blocks.",
						inputSchema: z.object({
							path: z
								.string()
								.min(1)
								.max(200)
								.regex(/^\//)
								.describe("the page's site path, e.g. '/pricing'"),
							ordinal: z
								.number()
								.int()
								.min(0)
								.describe("the block's 0-based position from compose_page"),
							bindings: z
								.record(
									z.string(),
									z.object({
										collection: z.string().min(1).max(80),
										limit: z.number().int().min(0).optional(),
										filter: z
											.record(
												z.string(),
												z.union([z.string(), z.number(), z.boolean()]),
											)
											.optional(),
									}),
								)
								.describe(
									"{ prop: { collection, limit?, filter? } } — an empty object clears the block's bindings",
								),
						}),
						execute: async ({ path, ordinal, bindings }) => {
							await assertTurnActive();
							if (!project.projectId) {
								return {
									ok: false,
									error:
										"this design has no project — data collections live per project",
								};
							}
							try {
								return await bindDataTool(prisma, {
									projectId: project.projectId,
									path,
									ordinal,
									bindings,
								});
							} catch (error) {
								console.log("[design-chat] bind_data failed:", error);
								return { ok: false, error: "data bind failed — try again" };
							}
						},
					}),
					define_template: tool({
						description:
							"Define or redefine a named reusable template: an ordered slot list over the component library ({ component: { name, version? }, propsOverrides? } per slot). Use it as a block in compose_page ({ template: 'name' }) to repeat a slot sequence across pages. Redefining replaces all slots.",
						inputSchema: z.object({
							name: z
								.string()
								.min(1)
								.max(80)
								.describe(
									"template name, e.g. 'LandingHero' — unique per project; redefining replaces its slots",
								),
							slots: z
								.array(
									z.object({
										component: z.object({
											name: z.string().min(1).max(80),
											version: z.number().int().min(1).optional(),
										}),
										propsOverrides: z
											.record(z.string(), z.unknown())
											.optional()
											.describe(
												"string attribute overrides for this slot's component",
											),
									}),
								)
								.min(1)
								.max(50)
								.describe("ordered component slots"),
						}),
						execute: async ({ name, slots }) => {
							await assertTurnActive();
							if (!project.projectId) {
								return {
									ok: false,
									error:
										"this design has no project — templates live per project",
								};
							}
							try {
								return await defineTemplateTool(prisma, env.DB, {
									projectId: project.projectId,
									name,
									slots,
								});
							} catch (error) {
								console.log("[design-chat] define_template failed:", error);
								return {
									ok: false,
									error: "template define failed — try again",
								};
							}
						},
					}),
					define_flow: tool({
						description:
							"Define or redefine a named user journey across the project's pages: ordered steps ({ path, entryAction?, exitTarget? }) where path is a page you composed with compose_page. entryAction/exitTarget describe the transition (e.g. 'click .cta'), resolved by the preview player — never raw JS. Redefining replaces all steps.",
						inputSchema: z.object({
							name: z
								.string()
								.min(1)
								.max(80)
								.describe(
									"flow name, e.g. 'Onboarding' — unique per project; redefining replaces its steps",
								),
							steps: z
								.array(
									z.object({
										path: z
											.string()
											.min(1)
											.max(200)
											.describe("the page's site path — must exist"),
										entryAction: z
											.string()
											.max(300)
											.optional()
											.describe("how the user arrives at this step"),
										exitTarget: z
											.string()
											.max(300)
											.optional()
											.describe("the action/selector leading to the next step"),
									}),
								)
								.min(1)
								.max(50)
								.describe("ordered journey steps"),
						}),
						execute: async ({ name, steps }) => {
							await assertTurnActive();
							if (!project.projectId) {
								return {
									ok: false,
									error: "this design has no project — flows live per project",
								};
							}
							try {
								return await defineFlowTool(prisma, env.DB, {
									projectId: project.projectId,
									name,
									steps,
								});
							} catch (error) {
								console.log("[design-chat] define_flow failed:", error);
								return { ok: false, error: "flow define failed — try again" };
							}
						},
					}),
					list_pages: tool({
						description:
							"List the project's pages (path, title, status, block count), templates (slot count) and flows (step count). Call it before composing so you don't duplicate a path, template or flow name.",
						inputSchema: z.object({}),
						execute: async () => {
							await assertTurnActive();
							if (!project.projectId) {
								return {
									ok: false,
									error: "this design has no project — pages live per project",
								};
							}
							try {
								return await listPagesTool(prisma, {
									projectId: project.projectId,
								});
							} catch (error) {
								console.log("[design-chat] list_pages failed:", error);
								return { ok: false, error: "page list failed — try again" };
							}
						},
					}),
					publish_design: tool({
						description:
							"Publish the design as the live site. Pass the COMPLETE HTML document (self-contained except pinned-CDN library scripts — see the Use libraries section). Only call this after the user has approved a proposal. Returns the public site URL and a fresh screenshot.",
						inputSchema: z.object({
							html: z.string().min(50).max(2_000_000),
						}),
						execute: async ({ html }) => {
							try {
								await publish(html);
								// KUK-921 v2 pipeline, additive after the monolithic
								// publish:
								// (a) Component drafts this turn authored via
								//     save_component are auto-published BEFORE the
								//     publication snapshot (KUK-924 closes the gap
								//     KUK-921 flagged): the snapshot composes pages
								//     that pin the freshest drafts. A failed
								//     component publish must NOT abort the already-
								//     committed monolithic publish — it is
								//     collected and reported in the tool output.
								let componentPublish:
									| Awaited<ReturnType<typeof publishTurnComponentDrafts>>
									| undefined;
								if (project.projectId && turnComponents.length > 0) {
									componentPublish = await publishTurnComponentDrafts(
										prisma,
										env,
										{ turnId, drafts: turnComponents },
									);
								}
								// (b) When the container project has published
								//     pages, snapshot a composed Publication —
								//     this re-points the live site at the
								//     composed pages (the component/page pipeline
								//     is the v2 truth). Legacy designs without
								//     pages get null back and behave exactly as
								//     before. A publication failure must not undo
								//     the already-committed monolithic publish,
								//     so it is logged, not thrown.
								let publicationVersion: number | null = null;
								if (project.projectId) {
									try {
										const publication = await createPublication(
											prisma,
											env,
											projectId,
											{ turnId },
										);
										publicationVersion = publication?.version ?? null;
									} catch (error) {
										console.log(
											"[design-chat] page publication failed:",
											error,
										);
									}
								}
								return {
									ok: true,
									siteUrl,
									publishedAt: new Date().toISOString(),
									...(componentPublish ? { components: componentPublish } : {}),
									...(publicationVersion !== null
										? { publicationVersion }
										: {}),
								};
							} catch (error) {
								publishFailure = error;
								console.log("[design-chat] design publish failed:", error);
								return { ok: false, error: DESIGN_PUBLISH_FAILED_ERROR };
							}
						},
					}),
					ask_user: tool({
						description:
							"Ask the user an interactive question with clickable buttons. Use this when you need a decision or preference before continuing (style, layout, color, audience, section copy, etc.). Provide 2-5 short options. The user will see the buttons and their click will be sent back as the next user message. The call ends the turn automatically: nothing may follow it — no further text or tool calls — until the user answers.",
						inputSchema: z.object({
							question: z
								.string()
								.min(1)
								.max(500)
								.describe("The question to show the user."),
							options: z
								.array(
									z.object({
										label: z.string().min(1).max(100),
										value: z.string().min(1).max(100),
									}),
								)
								.min(2)
								.max(5)
								.describe(
									"The button choices the user can pick from. Label is shown on the button; value is sent back as the answer.",
								),
						}),
						execute: async ({ question, options }) => {
							return {
								status: "displayed",
								message:
									"The question is now shown to the user as interactive buttons. Do not call any other tools; wait for the user's answer in the next turn.",
								question,
								options,
							};
						},
					}),
					style_options: tool({
						// With a brand kit the palette and typography are fixed — the
						// picker must never offer options that override the brand.
						description: brandKit
							? "Interactive style pickers. This project has a brand kit that fixes the palette, typography and fonts — do NOT call it to offer color palettes or font pairings (nothing may override the brand kit). Propose layout or composition choices with the wireframe tool or ask_user instead."
							: "Recommend concrete style directions — color palettes and font pairings — as interactive pickers the user clicks. Use it when the brief needs a visual direction (brand mood, palette, typography): offer 2-4 coherent palettes and/or 2-4 font pairings, each with a one-line rationale. They render as color swatches and font samples in the chat. The call ends the turn automatically: nothing may follow it — no further text or tool calls — until the user picks.",
						inputSchema: z
							.object({
								palettes: z
									.array(
										z.object({
											name: z
												.string()
												.min(1)
												.max(60)
												.describe('palette name, e.g. "Warm bakery"'),
											colors: z
												.array(z.string().regex(/^#[0-9a-fA-F]{3,8}$/))
												.min(3)
												.max(6)
												.describe(
													"hex colors, ordered: background, surface, primary, text, accents",
												),
											rationale: z
												.string()
												.min(1)
												.max(200)
												.describe("one line on the mood and why it fits"),
										}),
									)
									.min(2)
									.max(4)
									.optional()
									.describe("color palette options to pick from"),
								fonts: z
									.array(
										z.object({
											name: z
												.string()
												.min(1)
												.max(60)
												.describe('pairing name, e.g. "Editorial"'),
											heading: z
												.string()
												.min(1)
												.max(120)
												.describe(
													"heading font-family value, e.g. '\"Playfair Display\", Georgia, serif'",
												),
											body: z
												.string()
												.min(1)
												.max(120)
												.describe(
													"body font-family value, e.g. 'Inter, system-ui, sans-serif'",
												),
											rationale: z
												.string()
												.min(1)
												.max(200)
												.describe("one line on the voice it gives the page"),
										}),
									)
									.min(2)
									.max(4)
									.optional()
									.describe("font pairing options to pick from"),
							})
							.refine(
								(v) => (v.palettes?.length ?? 0) + (v.fonts?.length ?? 0) >= 2,
								"offer options in at least one category",
							),
						execute: async () => {
							return {
								status: "displayed",
								message:
									"The style pickers are now shown to the user as interactive cards. Do not call any other tools; wait for the user's pick in the next turn.",
							};
						},
					}),
					load_skill: tool({
						description:
							"Load a studio skill's full markdown instructions by slug (from the Available skills list in the system prompt). Use it when the user invokes a skill with its /slug or asks for one of those topics, then follow the returned instructions for the rest of the turn. Skills are admin-managed — you cannot create or edit them.",
						inputSchema: z.object({
							slug: z
								.string()
								.min(1)
								.max(64)
								.describe("Skill slug, e.g. 'design-critique'."),
						}),
						execute: async ({ slug }) => {
							const skill = await prisma.skill.findUnique({
								where: { slug },
								select: {
									name: true,
									content: true,
									enabled: true,
									category: true,
								},
							});
							// Design studio surfaces only the design category —
							// campaign/marketing/sales skills belong to the other
							// chat and must not resolve here.
							const inScope =
								skill?.enabled === true &&
								skillInCategories(skill.category, DESIGN_SKILL_CATEGORIES);
							if (!skill || !inScope) {
								return {
									ok: false,
									error: `No enabled skill "${slug}". Check the Available skills list in the system prompt and pass one of those slugs exactly.`,
								};
							}
							return skill.content;
						},
					}),
					...(mcpTools ?? {}),
				},
				onFinish: async ({ text, toolResults, steps }) => {
					if (streamFailed) return;
					try {
						if (publishFailure) throw publishFailure;
						const askUser = toolResults.find((r) => r.toolName === "ask_user");
						const askUserQuestion =
							askUser &&
							typeof askUser.output === "object" &&
							askUser.output != null
								? String(
										(askUser.output as Record<string, unknown>).question ?? "",
									)
								: "";
						const finalText =
							text || !askUser ? text : `I'd like to know: ${askUserQuestion}`;

						// Tool-call fallback, first-publish only: some first turns end
						// with the document in the final text instead of a tool call.
						// Once a design is live, never overwrite it from prose — a
						// Q&A turn quoting the HTML must not republish it.
						if (!published && !askUser) {
							const existing = project.liveTurnId
								? true
								: await env.DESIGNS.head(designsKey(projectId, "index.html"));
							if (!existing) {
								const html = extractHtml(finalText);
								if (html) await publish(html);
							}
						}
						await persistAssistantMessage(
							env,
							projectId,
							turnId,
							finalText,
							// Reasoning + tool parts from the finished steps, so a
							// refresh rebuilds the thoughts and tool cards the live
							// stream rendered.
							chatPartsJson(steps, finalText),
						);
						// The turn is over: "chatting" is reserved for an in-flight
						// stream. ready covers both published turns and plain Q&A
						// turns (the site may be current from an earlier publish).
						await prisma.design.updateMany({
							where: { id: projectId, activeTurnId: turnId },
							data: {
								activeTurnId: null,
								turnClaimedAt: null,
								status: "ready",
								error: null,
							},
						});
					} catch (error) {
						await failTurn(error);
					} finally {
						await closeMcp();
						// A finished turn releases the deadline: the watchdog race
						// below resolves and the timer is cleared.
						resolveTurnComplete();
					}
				},
				onError: async ({ error }) => {
					streamFailed = true;
					await failTurn(error);
				},
				// Fires when the abortSignal above aborts the model loop: today
				// that is only the turn deadline (timedOut below); the actor no
				// longer forwards its connection-scoped signal, so a WebSocket
				// drop mid-turn must NOT kill the turn — it keeps running and
				// persists server-side, and the client recovers via its live
				// status poll. On a deadline the partial
				// assistant text is persisted with a continuation note — tool
				// outputs (drafts, components, publishes) are already stored by
				// the tools themselves — so the conversation can continue. The
				// lease is still held here; persist before failTurn clears it
				// (the fenced insert refuses a released lease).
				onAbort: async ({ steps }) => {
					if (streamFailed) return;
					streamFailed = true;
					const timedOut = turnDeadline.signal.aborted;
					if (timedOut) {
						const partialText = steps
							.map((step) => step.text)
							.filter(Boolean)
							.join("\n\n")
							.trim();
						const content = partialText
							? `${partialText}\n\n${DESIGN_CHAT_TIMEOUT_ERROR}`
							: DESIGN_CHAT_TIMEOUT_ERROR;
						// Streamed parts plus the continuation note as an explicit
						// final text part — the fallback alone would drop the note
						// whenever the partial text already produced text parts.
						const parts = chatPartsFromSteps(steps, partialText);
						withTextPart(parts, DESIGN_CHAT_TIMEOUT_ERROR);
						await persistAssistantMessage(
							env,
							projectId,
							turnId,
							content,
							chatPartsPayload(parts),
						).catch(() => {});
					}
					await failTurn(
						timedOut
							? new Error(`design chat turn exceeded ${turnTimeoutMs}ms`)
							: new Error("design chat turn aborted"),
						timedOut ? DESIGN_CHAT_TIMEOUT_ERROR : DESIGN_CHAT_PUBLIC_ERROR,
					);
				},
			}),
		)
		.catch(async (error) => {
			await failTurn(error);
			throw error;
		});

	// Deadline watchdog, independent of the model loop: the abort signal does
	// not reach a tool execute that hangs (the loop only checks between
	// steps), so this fails the turn — clearing the lease — no matter where
	// the model loop is wedged. Idempotent with onFinish/onError/onAbort via
	// failureFinalized; racing turnComplete keeps a settled turn from leaving
	// this waitUntil pending on the (cleared) timer.
	const deadlineSettled = new Promise<never>((_, reject) => {
		turnDeadline.signal.addEventListener(
			"abort",
			() =>
				reject(
					turnDeadline.signal.reason instanceof Error
						? turnDeadline.signal.reason
						: new Error("design chat turn deadline"),
				),
			{ once: true },
		);
	});
	void deadlineSettled.catch(() => {});

	void Promise.race([deadlineSettled, turnComplete]).catch(async (error) => {
		// A turn that already released its lease (onFinish/onError/onAbort/
		// failTurn) must not be logged as a late failure.
		if (failureFinalized) return;
		streamFailed = true;
		// Store a continuation note so the transcript stays answerable, then
		// release the lease. (Tool outputs from this turn are already stored.)
		await persistAssistantMessage(
			env,
			projectId,
			turnId,
			DESIGN_CHAT_TIMEOUT_ERROR,
		).catch(() => {});
		await failTurn(error, DESIGN_CHAT_TIMEOUT_ERROR);
	});
	// Once the turn's completion handlers have run the deadline is moot: stop
	// the timer so a post-turn abort can never fire and leave a caller
	// pending on the (cleared) timer, and detach the abort forwarders so
	// per-turn listeners never accumulate on the caller's signal.
	void turnComplete.then(() => {
		clearTimeout(deadlineTimer);
		detachAbortForwarding();
	});

	return { result, closeMcp, turnComplete, deadlineSettled, failTurn };
}

/**
 * Runs one chat turn and returns the streamed assistant response over HTTP.
 * The assistant turn is persisted (and status/error updated) from onFinish,
 * which fires when the stream completes. Pass `waitUntil` from the request
 * context so the turn keeps running after the client disconnects/refreshes.
 */
export async function runDesignChatTurn(
	env: Env,
	projectId: string,
	options: {
		message: string;
		section?: string;
		model?: string;
		assets?: AssetRef[];
		origin: string;
		waitUntil?: (promise: Promise<unknown>) => void;
	},
): Promise<Response> {
	const { result } = await createDesignChatStreamResult(
		env,
		projectId,
		options,
	);

	options.waitUntil?.(Promise.resolve(result.consumeStream()));

	// UI message stream protocol (AI SDK v6) — consumed by useChat in the
	// admin UI (AI Elements Conversation/Message components).
	return result.toUIMessageStreamResponse({
		onError: () => DESIGN_CHAT_PUBLIC_ERROR,
		headers: {
			// Per the Workers AI + AI SDK docs: these keep the response chunked
			// and streamed end to end through Cloudflare's edge.
			"content-encoding": "identity",
			"transfer-encoding": "chunked",
			"cache-control": "no-store",
		},
	});
}

/**
 * Runs one chat turn for the RivetKit realtime actor. Each UI-message chunk
 * is emitted to the callback so it can be broadcast to connected clients.
 * The turn is fully persisted before this resolves.
 */
export async function runDesignChatTurnStream(
	env: Env,
	projectId: string,
	options: {
		message: string;
		section?: string;
		model?: string;
		assets?: AssetRef[];
		origin: string;
		abortSignal?: AbortSignal;
	},
	emit: (chunk: import("ai").UIMessageChunk) => void,
): Promise<void> {
	const { result, closeMcp, turnComplete, deadlineSettled, failTurn } =
		await createDesignChatStreamResult(env, projectId, options);
	try {
		const pump = (async () => {
			for await (const chunk of result.toUIMessageStream()) {
				emit(chunk);
			}
			await result.consumeStream();
		})();
		// A hung provider or tool execute leaves the UI stream open forever
		// even after the deadline watchdog released the lease — the race below
		// keeps the actor action (and its client) from spinning forever. If
		// the deadline settles first its rejection propagates: the actor
		// broadcasts `turnFailed` and the chat shows the retryable error.
		const settled = Promise.race([deadlineSettled, turnComplete]);
		const outcome = await Promise.race([
			pump.then(() => "pumped" as const),
			settled.then(() => "settled" as const),
		]);
		if (outcome === "settled") {
			// The completion handlers have run — drain the rest of the UI
			// stream. A late pump failure after the turn settled is moot (the
			// lease and status are already authoritative in D1).
			await pump.catch(() => {});
		}
	} catch (error) {
		// Safety net matching the old SSE path: a stream failure that slipped
		// past onError/onAbort must still release the turn lease.
		await failTurn(error);
		throw error;
	} finally {
		await closeMcp();
	}
}
