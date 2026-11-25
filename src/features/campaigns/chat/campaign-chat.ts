// Container-free campaign chat: the admin converses with a Workers AI
// marketing-strategist model (GLM-5.3) that plans a campaign together with
// the user, researches with the Playwright MCP server's browser tools, and
// asks before assuming (see ./campaign-chat-prompt.ts for the persona).
//
// Modeled on ./design-chat.ts with the same pipeline per turn, driven by the
// RivetKit `campaignChat` actor (src/server/rivet/actors/campaign-chat/):
//   actor sendMessage {message, thinkingEffort}
//     → history (Message) + system prompt
//     → streamText(workers-ai GLM-5.3, tools: ask_user + document tools
//       + browser MCP)
//     → UI-message chunks broadcast over the actor connection
//     → onFinish: persist the assistant turn (ownership-fenced on the turn
//       lease), status ready/failed
//
// Document tools (KUK-870) let the agent write the campaign's structured
// rows — brief, plan phases, calendar slots, reports — the same rows the
// studio UI edits, so panels update live without parsing prose. Every write
// is fenced to this campaign. R2 artifacts and a publish flow remain out of
// scope.
import "@tanstack/react-start/server-only";
import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import {
	hasToolCall,
	type ModelMessage,
	stepCountIs,
	streamText,
	type ToolSet,
	tool,
} from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { z } from "zod";
import {
	type CampaignAssetSeed,
	createCampaignAsset,
} from "@/features/campaigns/assets/campaign-asset-context";
import {
	deriveKpiStatus,
	type KpiStatus,
} from "@/features/campaigns/kpis/kpi-status";
import {
	CAMPAIGN_SKILL_CATEGORIES,
	skillInCategories,
} from "@/features/skills";
import { chatPartsJson } from "@/lib/chat-parts";
import {
	ABANDONED_LEASE_MS as SHARED_ABANDONED_LEASE_MS,
	DEFAULT_TURN_TIMEOUT_MS as SHARED_DEFAULT_TURN_TIMEOUT_MS,
} from "@/lib/chat-turn-limits";
import { getPrisma } from "@/lib/db";
import { validateMessageOwner } from "@/lib/message-owner";
import {
	availableChannelNames,
	replaceCampaignChannels,
} from "@/server/data/channels";
import {
	CAMPAIGN_CHAT_MODEL,
	CAMPAIGN_CHAT_MODELS,
	type CampaignChatModel,
	campaignSystemPrompt,
	parseSlashCommand,
	resolveThinkingEffort,
	type SkillSummary,
	skillContextText,
	thinkingEffortInputs,
} from "./campaign-chat-prompt";

export {
	CAMPAIGN_CHAT_MODEL,
	campaignSystemPrompt,
	parseSlashCommand,
	skillContextText,
	skillsPromptSection,
} from "./campaign-chat-prompt";

export const CAMPAIGN_CHAT_PUBLIC_ERROR = "chat turn failed — try again";
export const CAMPAIGN_CHAT_CONFLICT_ERROR = "chat turn already in progress";
/**
 * Shown when a turn hits the hard wall-clock deadline. Document writes
 * (brief, plan phases, calendar slots, reports) are already stored by the
 * time the deadline fires, so the user can continue from there.
 */
export const CAMPAIGN_CHAT_TIMEOUT_ERROR =
	"campaign chat turn ran out of time — everything it created is saved; send a message to continue";
/** Shown after an admin force-releases a stuck turn (chat/cancel route). */
export const CAMPAIGN_CHAT_CANCELLED_ERROR =
	"stuck chat turn was cancelled — send a message to continue";

/**
 * Client-safe error text for a failed turn: recognized public messages pass
 * through, anything else redacts to the generic retryable error. Used by the
 * `campaignChat` actor when broadcasting `turnFailed` and by failTurn when
 * storing the Campaign row's error, so a deadline or conflict reaches the
 * client without leaking internal error details.
 */
export function campaignChatPublicError(error: unknown): string {
	if (error instanceof Error) {
		if (error.message === CAMPAIGN_CHAT_CONFLICT_ERROR) {
			return CAMPAIGN_CHAT_CONFLICT_ERROR;
		}
		if (error.message === CAMPAIGN_CHAT_TIMEOUT_ERROR) {
			return CAMPAIGN_CHAT_TIMEOUT_ERROR;
		}
	}
	return CAMPAIGN_CHAT_PUBLIC_ERROR;
}

// Campaign ids are crypto.randomUUID() output, same convention as Design ids
// (see DESIGN_ID_RE in design-files.ts).
const CAMPAIGN_ID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isCampaignId(value: string): boolean {
	return CAMPAIGN_ID_RE.test(value);
}

export class CampaignChatTurnConflictError extends Error {
	constructor() {
		super(CAMPAIGN_CHAT_CONFLICT_ERROR);
		this.name = "CampaignChatTurnConflictError";
	}
}

/**
 * Turn input shared by the RivetKit `campaignChat` actor's sendMessage
 * action (the old HTTP route validated the same shape before it was
 * removed). Any string is accepted for model/thinkingEffort and coerced
 * server-side — a hard enum here would 400 stale clients that still send
 * removed ids.
 */
export const campaignChatTurnInput = z.object({
	message: z.string().trim().min(1).max(8000),
	model: z.string().max(120).optional(),
	// Thinking effort (KUK-892): same convention as model — unknown values
	// fall back to "low" so stale clients never hard-fail.
	thinkingEffort: z.string().max(20).optional(),
});

/** Replay at most this many turns of history; older turns are dropped. */
const MAX_HISTORY_MESSAGES = 60;

/** Tool-call rounds per chat turn — research, ask, negotiate, refine. */
const MAX_STEPS = 16;

/**
 * Hard deadline for a whole chat turn (model stream + tool loop). Turns may
 * legitimately run very long (browser research, many tool rounds), so the
 * default allows up to 40 minutes; it exists only as a backstop for a
 * truly hung model stream — without it the lease was held forever and the
 * chat 409'd on every send (the stuck-chat bug). It must stay under the
 * 45-minute abandoned-turn lease window (ABANDONED_LEASE_MS) in
 * runCampaignChatTurnStream: a live turn has to reach onFinish/onError —
 * which clears the lease — before a successor could lazily reclaim it, or
 * healthy long turns would be stolen mid-stream. Overridable for tests via
 * CAMPAIGN_CHAT_TURN_TIMEOUT_MS. Shared with the design and element chats
 * via lib/chat-turn-limits.ts.
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
 * is claimed, so a hung Durable Object stream used to hang the request
 * with the lease already held. On timeout the turn proceeds without
 * browser tools (same as the existing unavailable path). Overridable for
 * tests via CAMPAIGN_CHAT_MCP_CONNECT_TIMEOUT_MS.
 */
const DEFAULT_MCP_CONNECT_TIMEOUT_MS = 30 * 1000;

/** Integer env override (ms) for a timeout knob; falls back on any invalid value. */
function timeoutMs(env: Env, name: string, fallback: number): number {
	const raw = Number((env as unknown as Record<string, unknown>)[name]);
	return Number.isFinite(raw) && raw > 0 ? raw : fallback;
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
	const { agentVisibleOrigin } = await import(
		"@/features/design-studio/chat/design-session"
	);
	const url = `${agentVisibleOrigin(env, origin)}/browser-mcp`;
	const token = env.BROWSER_MCP_TOKEN;
	// The handshake (createMCPClient + tools) has no timeout of its own and
	// runs against a Durable Object over the self binding — a hung stream
	// here used to hang the request after the turn lease was claimed. Race
	// it against a deadline; on timeout the turn continues without browser
	// tools, and the late handshake result is closed so the DO stream does
	// not outlive the request.
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
		console.log("[campaign-chat] browser MCP unavailable, continuing:", reason);
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
	campaignId: string,
): Promise<ModelMessage[]> {
	// Newest turns matter most; take from the descending end and replay in
	// chronological order. (The current user message is persisted before this
	// runs and must never fall out of the window.)
	const rows = await getPrisma(env).message.findMany({
		where: { campaignId },
		orderBy: { createdAt: "desc" },
		take: MAX_HISTORY_MESSAGES,
	});
	return rows.reverse().map((row) => ({
		role: row.role === "user" ? "user" : "assistant",
		content: row.content,
	}));
}

async function persistMessage(
	env: Env,
	campaignId: string,
	role: "user" | "assistant",
	content: string,
): Promise<void> {
	await getPrisma(env).message.create({
		data: {
			id: crypto.randomUUID(),
			...validateMessageOwner({ campaignId }),
			role,
			content,
		},
	});
}

/**
 * Resolves a "/<slug>" invocation at the start of the latest user message
 * against the enabled Skill rows (KUK-891). Unknown or disabled slugs
 * resolve to null — the message then flows to the model exactly as typed.
 * The persisted row is untouched either way: only this model-facing view
 * carries the injected skill content.
 */
async function resolveSlashSkill(
	prisma: PrismaDb,
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
	const skill = await prisma.skill.findUnique({
		where: { slug: slash.slug },
		select: { name: true, content: true, enabled: true, category: true },
	});
	// Campaign studio resolves its own categories only — a /design-skill
	// invocation here stays plain text.
	if (
		!skill?.enabled ||
		!skillInCategories(skill.category, CAMPAIGN_SKILL_CATEGORIES)
	) {
		return null;
	}
	return { name: skill.name, content: skill.content, rest: slash.rest };
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
	campaignId: string,
	message: string,
): Promise<boolean> {
	const last = await getPrisma(env).message.findFirst({
		where: { campaignId },
		orderBy: { createdAt: "desc" },
	});
	return (
		last?.role === "user" &&
		last.content === message &&
		Date.now() - last.createdAt.getTime() < 5 * 60 * 1000
	);
}

/**
 * Ownership-fenced assistant insert: the row is only written while this
 * turn still owns the Campaign lease, so an abandoned turn that was
 * reclaimed mid-stream can never append history owned by the newer turn.
 */
async function persistAssistantMessage(
	env: Env,
	campaignId: string,
	turnId: string,
	content: string,
	partsJson?: string | null,
): Promise<void> {
	const inserted = await env.DB.prepare(
		`INSERT INTO "Message" ("id", "campaignId", "role", "content", "parts", "createdAt")
		SELECT ?, ?, ?, ?, ?, ?
		WHERE EXISTS (
			SELECT 1 FROM "Campaign" WHERE "id" = ? AND "activeTurnId" = ?
		)`,
	)
		.bind(
			crypto.randomUUID(),
			campaignId,
			"assistant",
			content,
			// Reasoning + tool-call parts for the refresh path; null degrades
			// to the flat text (same as the design chat).
			partsJson ?? null,
			new Date().toISOString(),
			campaignId,
			turnId,
		)
		.run();
	if (inserted.meta.changes !== 1) throw new Error("stale campaign chat turn");
}

/** Prisma client type used by the document tools. */
type PrismaDb = ReturnType<typeof getPrisma>;

/**
 * Keeps only the fields the model actually provided (nulls omitted) while
 * preserving the inferred key/value types for Prisma's update inputs —
 * value types are narrowed to NonNullable so `null` never reaches a
 * Prisma update input for a required column.
 */
function provided<T extends object>(input: T): Provided<T> {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(input)) {
		if (value != null) {
			out[key] = value;
		}
	}
	return out as Provided<T>;
}

type Provided<T extends object> = {
	[K in keyof T as T[K] extends null ? never : K]?: NonNullable<T[K]>;
};

type KpiInput = {
	id?: string | null;
	name: string;
	kind: "number" | "boolean" | "qualitative";
	targetNumber?: number | null;
	targetBoolean?: boolean | null;
	targetText?: string | null;
	unit?: string | null;
	color?: string | null;
	sortOrder?: number;
};

/**
 * Replace the campaign's KPI definitions while preserving stable IDs for KPIs
 * that still exist in the new list. Matching order:
 *   1. explicit id (provided by the model after listing KPIs)
 *   2. name (case-insensitive) for id-less inputs
 * KPIs in the DB that are not matched are deleted. Returns the final id/name
 * list so the brief tools can echo the IDs back to the model.
 */
async function replaceCampaignKpis(
	prisma: PrismaDb,
	campaignId: string,
	kpis: KpiInput[],
): Promise<Array<{ id: string; name: string }>> {
	const existing = await prisma.campaignKpi.findMany({
		where: { campaignId },
		select: { id: true, name: true },
	});
	const byId = new Map(existing.map((row) => [row.id, row]));
	const byName = new Map(existing.map((row) => [row.name.toLowerCase(), row]));
	const matched = new Set<string>();
	const result: Array<{ id: string; name: string }> = [];

	for (let index = 0; index < kpis.length; index++) {
		const input = kpis[index];
		const existingRow = input?.id
			? byId.get(input.id)
			: byName.get(input.name.toLowerCase());
		if (existingRow && !matched.has(existingRow.id)) {
			matched.add(existingRow.id);
			await prisma.campaignKpi.update({
				where: { id: existingRow.id },
				data: {
					name: input.name,
					kind: input.kind,
					targetNumber: input.targetNumber ?? null,
					targetBoolean: input.targetBoolean ?? null,
					targetText: input.targetText ?? null,
					unit: input.unit ?? null,
					color: input.color ?? null,
					sortOrder: input.sortOrder ?? index,
				},
			});
			result.push({ id: existingRow.id, name: input.name });
		} else {
			const id = crypto.randomUUID();
			await prisma.campaignKpi.create({
				data: {
					id,
					campaignId,
					name: input.name,
					kind: input.kind,
					targetNumber: input.targetNumber ?? null,
					targetBoolean: input.targetBoolean ?? null,
					targetText: input.targetText ?? null,
					unit: input.unit ?? null,
					color: input.color ?? null,
					sortOrder: input.sortOrder ?? index,
				},
			});
			result.push({ id, name: input.name });
		}
	}

	const toDelete = existing
		.filter((row) => !matched.has(row.id))
		.map((row) => row.id);
	if (toDelete.length > 0) {
		await prisma.campaignKpi.deleteMany({
			where: { id: { in: toDelete } },
		});
	}

	return result;
}

function normalizeResultStatus(
	kind: string,
	targetNumber: number | null,
	actualNumber: number | null,
	providedStatus: KpiStatus | undefined,
): KpiStatus {
	if (providedStatus) return providedStatus;
	if (kind === "number" && targetNumber != null && actualNumber != null) {
		return deriveKpiStatus({ target: targetNumber, actual: actualNumber });
	}
	return "pending";
}

/** Accepts ISO 8601 dates and datetimes the model passes for scheduling. */
const ISO_DATE_HINT =
	"ISO 8601 date or datetime, e.g. 2026-03-02 or 2026-03-02T09:00:00Z";
const isoDateOrDatetime = z
	.string()
	.max(64)
	.refine(
		(value) =>
			/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(
				value,
			) && !Number.isNaN(Date.parse(value)),
		ISO_DATE_HINT,
	)
	.describe(ISO_DATE_HINT);

/**
 * Structured document tools (KUK-870): the agent writes the campaign's
 * brief, plan phases, calendar slots and reports as database rows — the
 * same rows the studio UI edits, so dashboard panels update live without
 * parsing chat prose. Success returns a compact confirmation string the
 * model can echo; recoverable failures (fencing, no fields, unknown ids)
 * return a structured { ok: false, error } result the model can see and
 * correct from — a thrown tool error would instead be masked as the
 * public turn error ("chat turn failed") and fail the whole turn.
 *
 * Fencing (defense in depth):
 *  - every id the model passes (planId, phaseId, eventId) is resolved and
 *    must belong to THIS campaign — cross-campaign writes are rejected;
 *  - the raw phase INSERT additionally checks the plan's campaign in the
 *    same statement, so the position append stays atomic and fenced;
 *  - every execute runs only while this turn still owns the campaign lease
 *    (assertTurnActive) — a lost lease throws and fails the turn, mirroring
 *    design-chat's write fence.
 *
 * Asset tools (KUK-871) extend the same set: create_asset seeds a Design
 * filed in this campaign's project + linked to this campaign, and
 * list_assets enumerates them. Both are campaign-scoped by construction —
 * they take no ids from the model, so cross-campaign writes are impossible.
 */
export function campaignDocumentTools(deps: {
	env: Env;
	prisma: PrismaDb;
	campaignId: string;
	campaign: CampaignAssetSeed;
	assertTurnActive: () => Promise<void>;
}): ToolSet {
	const { env, prisma, campaignId, campaign, assertTurnActive } = deps;

	/** Structured tool error the model sees as the tool result. */
	const toolError = (error: string) => ({ ok: false as const, error });

	/** Prisma wants Date objects for DateTime columns, even date-only input. */
	const dateValue = (value: string | null | undefined): Date | null =>
		value != null ? new Date(value) : null;

	/**
	 * Channels are admin-owned (KUK-890): the agent picks by id but cannot
	 * create. An unknown channelId is a recoverable error that lists the
	 * available channel names so the model can correct itself mid-turn.
	 */
	const resolveChannel = async (
		channelId: string,
	): Promise<{ id: string; name: string } | string> => {
		const channel = await prisma.channel.findUnique({
			where: { id: channelId },
			select: { id: true, name: true },
		});
		if (channel) return channel;
		const names = await availableChannelNames(prisma);
		return `Unknown channel id ${channelId}. Available channels: ${
			names.join(", ") || "(none yet)"
		}. Call list_channels for the current ids.`;
	};

	/** Validates a channelIds set; returns the error message or null. */
	const validateBriefChannelIds = async (
		channelIds: string[],
	): Promise<string | null> => {
		const unique = [...new Set(channelIds)];
		const found = await prisma.channel.findMany({
			where: { id: { in: unique } },
			select: { id: true },
		});
		const known = new Set(found.map((channel) => channel.id));
		const missing = unique.filter((id) => !known.has(id));
		if (missing.length === 0) return null;
		const names = await availableChannelNames(prisma);
		return `Unknown channel id(s): ${missing.join(", ")}. Available channels: ${
			names.join(", ") || "(none yet)"
		}. Call list_channels for the current ids.`;
	};

	const briefFields = {
		objective: z
			.string()
			.min(1)
			.max(1_000)
			.nullish()
			.describe("What the campaign must achieve, 1-2 sentences."),
		// The legacy free-text `audience` brief field is gone from the tool
		// schema: target audiences are per-campaign TargetAudience rows,
		// created/edited through the audience tools below. The old markdown
		// column stays in the DB, deprecated, for legacy display only.
		keyMessage: z
			.string()
			.min(1)
			.max(4_000)
			.nullish()
			.describe("The core promise the campaign leads with."),
		tone: z
			.string()
			.min(1)
			.max(1_000)
			.nullish()
			.describe("Brand voice, e.g. 'warm, plain-spoken, confident'."),
		// The legacy free-text `channels` brief field is gone from the tool
		// schema (KUK-890): the channel mix is CampaignChannel links written
		// through channelIds below. The old text column stays in the DB,
		// deprecated, for legacy display only.
		channelIds: z
			.array(z.string().min(1).max(64))
			.max(50)
			.nullish()
			.describe(
				"Channel mix as channel ids — REPLACES the campaign's channel set with exactly these. Get the ids from list_channels; every id must exist.",
			),
		budget: z
			.string()
			.min(1)
			.max(1_000)
			.nullish()
			.describe("Budget as agreed, e.g. '$15k total, 60% paid social'."),
		kpis: z
			.array(
				z.object({
					name: z.string().min(1).max(200),
					kind: z.enum(["number", "boolean", "qualitative"]),
					targetNumber: z.number().finite().nullish(),
					targetBoolean: z.boolean().nullish(),
					targetText: z.string().max(2_000).nullish(),
					unit: z.string().max(50).nullish(),
					color: z.string().max(7).nullish(),
					id: z
						.string()
						.min(1)
						.max(64)
						.nullish()
						.describe(
							"Existing KPI id from list_kpis. Include it to update that KPI in place (preserving its recorded results). Omit it to create a new KPI or match by name.",
						),
				}),
			)
			.max(50)
			.nullish()
			.describe(
				"Structured KPI targets for the campaign. Each KPI has a name, kind (number/boolean/qualitative), target value matching the kind, optional unit, and optional hex color. To update existing KPIs without losing their recorded results, pass the id from list_kpis.",
			),
		body: z
			.string()
			.min(1)
			.max(20_000)
			.nullish()
			.describe("Freeform markdown prose (context, positioning, offers)."),
	} as const;

	return {
		save_brief: tool({
			description:
				"Create or merge the campaign brief (a 1:1 document). Capture the brief as it is negotiated: as soon as the user confirms objective, key message, tone, channel mix, budget, KPIs or context, write them down. Pass only the fields you know — other fields are left untouched, and later calls merge new decisions in. For the channel mix pass channelIds (from list_channels) — it REPLACES the campaign's channel set. For KPIs pass a structured array of targets — it REPLACES the campaign's KPI set. Target audiences are NOT brief fields — capture them with create_audience.",
			inputSchema: z.object(briefFields),
			execute: async (input) => {
				await assertTurnActive();
				const { channelIds, kpis, ...scalarInput } = input;
				const fields = provided(scalarInput);
				const written = Object.keys(fields);
				if (channelIds == null && kpis == null && written.length === 0) {
					return "No fields provided — nothing saved. Pass at least one brief field (e.g. objective, budget).";
				}
				if (channelIds != null) {
					const invalid = await validateBriefChannelIds(channelIds);
					if (invalid) return toolError(invalid);
				}
				if (written.length > 0) {
					await prisma.campaignBrief.upsert({
						where: { campaignId },
						create: { id: crypto.randomUUID(), campaignId, ...fields },
						update: fields,
					});
				}
				if (channelIds != null) {
					// Atomic replace: one batched delete + reinsert.
					await replaceCampaignChannels(env, campaignId, channelIds);
				}
				let kpiList: Array<{ id: string; name: string }> | null = null;
				if (kpis != null) {
					kpiList = await replaceCampaignKpis(prisma, campaignId, kpis);
				}
				const saved = [
					...written,
					...(channelIds != null ? ["channelIds"] : []),
					...(kpis != null ? ["kpis"] : []),
				];
				const kpiNote =
					kpiList && kpiList.length > 0
						? ` KPI ids: ${kpiList
								.map((kpi) => `${kpi.name}=${kpi.id}`)
								.join(", ")}.`
						: "";
				return `Brief saved (fields: ${saved.join(", ")}).${kpiNote}`;
			},
		}),
		update_brief: tool({
			description:
				"Patch the existing campaign brief with only the fields you pass. Use it to keep the brief current after each agreed change. For the channel mix pass channelIds (from list_channels) — it REPLACES the campaign's channel set. For KPIs pass a structured array of targets — it REPLACES the campaign's KPI set. Target audiences are NOT brief fields — edit them with create_audience/update_audience/remove_audience. Fails if the brief does not exist yet — call save_brief first.",
			inputSchema: z.object(briefFields),
			execute: async (input) => {
				await assertTurnActive();
				const { channelIds, kpis, ...scalarInput } = input;
				const fields = provided(scalarInput);
				const written = Object.keys(fields);
				if (channelIds == null && kpis == null && written.length === 0) {
					return toolError(
						"update_brief needs at least one field to patch (e.g. objective, budget), a channelIds set, or a kpis array.",
					);
				}
				if (channelIds != null) {
					const invalid = await validateBriefChannelIds(channelIds);
					if (invalid) return toolError(invalid);
				}
				const existing = await prisma.campaignBrief.findUnique({
					where: { campaignId },
					select: { id: true },
				});
				if (!existing) {
					return toolError(
						"No brief exists yet for this campaign — call save_brief first.",
					);
				}
				if (written.length > 0) {
					await prisma.campaignBrief.update({
						where: { campaignId },
						data: fields,
					});
				}
				if (channelIds != null) {
					// Atomic replace: one batched delete + reinsert.
					await replaceCampaignChannels(env, campaignId, channelIds);
				}
				let kpiList: Array<{ id: string; name: string }> | null = null;
				if (kpis != null) {
					kpiList = await replaceCampaignKpis(prisma, campaignId, kpis);
				}
				const saved = [
					...written,
					...(channelIds != null ? ["channelIds"] : []),
					...(kpis != null ? ["kpis"] : []),
				];
				const kpiNote =
					kpiList && kpiList.length > 0
						? ` KPI ids: ${kpiList
								.map((kpi) => `${kpi.name}=${kpi.id}`)
								.join(", ")}.`
						: "";
				return `Brief updated (fields: ${saved.join(", ")}).${kpiNote}`;
			},
		}),
		save_plan: tool({
			description:
				"Create a named campaign plan (e.g. 'Q1 launch plan'). A campaign can hold several plans. After creating one, add its ordered phases with add_phase.",
			inputSchema: z.object({
				name: z
					.string()
					.min(1)
					.max(120)
					.describe("Plan name, e.g. 'Q1 launch plan'."),
				status: z
					.enum(["draft", "final"])
					.nullish()
					.describe(
						"Defaults to 'draft'; set 'final' once the user approves the plan.",
					),
			}),
			execute: async ({ name, status }) => {
				await assertTurnActive();
				const plan = await prisma.campaignPlan.create({
					data: {
						id: crypto.randomUUID(),
						campaignId,
						name,
						...(status != null ? { status } : {}),
					},
				});
				return `Plan "${plan.name}" created (id ${plan.id}, status ${plan.status}). Add phases with add_phase.`;
			},
		}),
		add_phase: tool({
			description:
				"Append a phase to a plan (Teaser, Launch week, Sustain, ...). Order is managed for you: the phase is appended after the plan's existing phases. planId must be a plan of THIS campaign — use an id returned by save_plan.",
			inputSchema: z.object({
				planId: z.string().min(1).max(64).describe("Plan id from save_plan."),
				name: z
					.string()
					.min(1)
					.max(120)
					.describe("Phase name, e.g. 'Teaser week'."),
				objective: z
					.string()
					.min(1)
					.max(2_000)
					.nullish()
					.describe("What this phase must achieve."),
				startsAt: isoDateOrDatetime.nullish(),
				endsAt: isoDateOrDatetime.nullish(),
				body: z
					.string()
					.min(1)
					.max(20_000)
					.nullish()
					.describe("Markdown detail for the phase."),
			}),
			execute: async (input) => {
				await assertTurnActive();
				const plan = await prisma.campaignPlan.findUnique({
					where: { id: input.planId },
					select: { campaignId: true, name: true },
				});
				if (!plan || plan.campaignId !== campaignId) {
					return toolError(
						`Plan ${input.planId} does not belong to this campaign. Use a plan id returned by save_plan.`,
					);
				}
				const id = crypto.randomUUID();
				// One atomic statement: the EXISTS clause fences the insert to
				// this campaign's plan and position = MAX + 1 is computed in
				// the same transaction, so concurrent appends cannot collide.
				const inserted = await env.DB.prepare(
					`INSERT INTO "PlanPhase" (id, planId, name, objective, startsAt, endsAt, position, body)
					SELECT ?, ?, ?, ?, ?, ?, COALESCE((SELECT MAX(position) + 1 FROM "PlanPhase" WHERE "planId" = ?), 0), ?
					WHERE EXISTS (SELECT 1 FROM "CampaignPlan" WHERE id = ? AND "campaignId" = ?)`,
				)
					.bind(
						id,
						input.planId,
						input.name,
						input.objective ?? null,
						input.startsAt ? new Date(input.startsAt).toISOString() : null,
						input.endsAt ? new Date(input.endsAt).toISOString() : null,
						input.planId,
						input.body ?? null,
						input.planId,
						campaignId,
					)
					.run();
				if (inserted.meta.changes !== 1) {
					return toolError("Could not add the phase to this plan.");
				}
				const row = await env.DB.prepare(
					'SELECT position FROM "PlanPhase" WHERE id = ?',
				)
					.bind(id)
					.first<{ position: number }>();
				return `Phase "${input.name}" added to plan "${plan.name}" (position ${row?.position ?? "?"}).`;
			},
		}),
		update_phase: tool({
			description:
				"Patch a plan phase (name, objective, dates, detail) by id. The phase must belong to a plan of THIS campaign. Position/order is managed by add_phase, not by this tool.",
			inputSchema: z.object({
				phaseId: z
					.string()
					.min(1)
					.max(64)
					.describe("Phase id (from the add_phase confirmation)."),
				name: z.string().min(1).max(120).nullish(),
				objective: z.string().min(1).max(2_000).nullish(),
				startsAt: isoDateOrDatetime.nullish(),
				endsAt: isoDateOrDatetime.nullish(),
				body: z.string().min(1).max(20_000).nullish(),
			}),
			execute: async (input) => {
				await assertTurnActive();
				const phase = await prisma.planPhase.findUnique({
					where: { id: input.phaseId },
					select: {
						name: true,
						plan: { select: { campaignId: true, name: true } },
					},
				});
				if (!phase || phase.plan.campaignId !== campaignId) {
					return toolError(
						`Phase ${input.phaseId} does not belong to this campaign.`,
					);
				}
				const { phaseId, ...rest } = input;
				const fields = provided(rest);
				const written = Object.keys(fields);
				if (written.length === 0) {
					return toolError(
						"update_phase needs at least one field to patch (name, objective, startsAt, endsAt or body).",
					);
				}
				await prisma.planPhase.update({
					where: { id: phaseId },
					data: {
						...fields,
						...(fields.startsAt != null
							? { startsAt: new Date(fields.startsAt) }
							: {}),
						...(fields.endsAt != null
							? { endsAt: new Date(fields.endsAt) }
							: {}),
					},
				});
				return `Phase "${phase.name}" updated (fields: ${written.join(", ")}).`;
			},
		}),
		add_event: tool({
			description:
				"Add a slot to the campaign content calendar: title, channel, concrete date/time, status and notes. Once the timeline is agreed, use real dated slots — the dashboard renders them directly on the calendar. channelId must be a channel id from list_channels — channels are admin-managed, you cannot invent one.",
			inputSchema: z.object({
				title: z
					.string()
					.min(1)
					.max(200)
					.describe("Slot title, e.g. 'Launch email to waitlist'."),
				// KUK-890: the legacy free-text `channel` input is gone — new
				// slots link the enumerated Channel by id and never write the
				// deprecated text column.
				channelId: z
					.string()
					.min(1)
					.max(64)
					.nullish()
					.describe("Channel id from list_channels, e.g. 'chan-email'."),
				scheduledAt: isoDateOrDatetime.nullish(),
				status: z
					.enum(["planned", "draft", "scheduled", "published"])
					.nullish()
					.describe("Defaults to 'planned'."),
				notes: z
					.string()
					.min(1)
					.max(2_000)
					.nullish()
					.describe("Markdown notes (copy angle, CTA, dependencies)."),
			}),
			execute: async (input) => {
				await assertTurnActive();
				let channel: { id: string; name: string } | null = null;
				if (input.channelId != null) {
					const resolved = await resolveChannel(input.channelId);
					if (typeof resolved === "string") return toolError(resolved);
					channel = resolved;
				}
				const event = await prisma.calendarEvent.create({
					data: {
						id: crypto.randomUUID(),
						campaignId,
						title: input.title,
						channelId: channel?.id ?? null,
						scheduledAt: dateValue(input.scheduledAt),
						status: input.status ?? "planned",
						notes: input.notes ?? null,
					},
				});
				return `Calendar event "${event.title}" added (${channel?.name ?? "no channel"}, ${
					event.scheduledAt?.toISOString().slice(0, 10) ?? "unscheduled"
				}, ${event.status}).`;
			},
		}),
		update_event: tool({
			description:
				"Patch a calendar slot (title, channel, date, status, notes) by id. The event must belong to THIS campaign. channelId must be a channel id from list_channels (pass null to clear the channel).",
			inputSchema: z.object({
				eventId: z
					.string()
					.min(1)
					.max(64)
					.describe("Calendar event id (from the add_event confirmation)."),
				title: z.string().min(1).max(200).nullish(),
				// KUK-890: channels are linked by id; null clears the link. The
				// legacy free-text `channel` input is gone (the text column is
				// deprecated and no longer written).
				channelId: z.string().min(1).max(64).nullish(),
				scheduledAt: isoDateOrDatetime.nullish(),
				status: z
					.enum(["planned", "draft", "scheduled", "published"])
					.nullish(),
				notes: z.string().min(1).max(2_000).nullish(),
			}),
			execute: async (input) => {
				await assertTurnActive();
				const event = await prisma.calendarEvent.findUnique({
					where: { id: input.eventId },
					select: { title: true, campaignId: true },
				});
				if (!event || event.campaignId !== campaignId) {
					return toolError(
						`Calendar event ${input.eventId} does not belong to this campaign.`,
					);
				}
				const { eventId, channelId, ...rest } = input;
				const fields = provided(rest);
				const written = Object.keys(fields);
				let channel: { id: string; name: string } | null = null;
				if (channelId !== undefined && channelId !== null) {
					const resolved = await resolveChannel(channelId);
					if (typeof resolved === "string") return toolError(resolved);
					channel = resolved;
				}
				if (written.length === 0 && channelId === undefined) {
					return toolError(
						"update_event needs at least one field to patch (title, channelId, scheduledAt, status or notes).",
					);
				}
				await prisma.calendarEvent.update({
					where: { id: eventId },
					data: {
						...fields,
						// Explicit null clears the link; undefined leaves it untouched.
						...(channelId !== undefined
							? { channelId: channel?.id ?? null }
							: {}),
						...(fields.scheduledAt != null
							? { scheduledAt: new Date(fields.scheduledAt) }
							: {}),
					},
				});
				return `Calendar event "${event.title}" updated (fields: ${[
					...written,
					...(channelId !== undefined ? ["channelId"] : []),
				].join(", ")}).`;
			},
		}),
		remove_event: tool({
			description:
				"Remove a calendar slot by id. The event must belong to THIS campaign.",
			inputSchema: z.object({
				eventId: z
					.string()
					.min(1)
					.max(64)
					.describe("Calendar event id (from the add_event confirmation)."),
			}),
			execute: async ({ eventId }) => {
				await assertTurnActive();
				const event = await prisma.calendarEvent.findUnique({
					where: { id: eventId },
					select: { title: true, campaignId: true },
				});
				if (!event || event.campaignId !== campaignId) {
					return toolError(
						`Calendar event ${eventId} does not belong to this campaign.`,
					);
				}
				await prisma.calendarEvent.delete({ where: { id: eventId } });
				return `Calendar event "${event.title}" removed.`;
			},
		}),
		save_report: tool({
			description:
				"Save a performance report row (reports accumulate over time). Only write reports when the user asks for one or a reporting period closes. body (the full markdown report) is required; title, period, a one-paragraph summary and the KPI table are recommended.",
			inputSchema: z.object({
				title: z
					.string()
					.min(1)
					.max(200)
					.describe("Report title, e.g. 'Week 1 performance'."),
				periodStart: isoDateOrDatetime.nullish(),
				periodEnd: isoDateOrDatetime.nullish(),
				summary: z
					.string()
					.min(1)
					.max(4_000)
					.nullish()
					.describe("One-paragraph executive summary."),
				metrics: z
					.string()
					.min(1)
					.max(8_000)
					.nullish()
					.describe("KPI table; markdown."),
				body: z
					.string()
					.min(1)
					.max(100_000)
					.describe("Full markdown report body."),
			}),
			execute: async (input) => {
				await assertTurnActive();
				const report = await prisma.campaignReport.create({
					data: {
						id: crypto.randomUUID(),
						campaignId,
						title: input.title,
						periodStart: dateValue(input.periodStart),
						periodEnd: dateValue(input.periodEnd),
						summary: input.summary ?? null,
						metrics: input.metrics ?? null,
						body: input.body,
					},
				});
				return `Report "${report.title}" saved${
					report.periodStart
						? ` (period from ${report.periodStart.toISOString().slice(0, 10)})`
						: ""
				}.`;
			},
		}),
		record_kpi_results: tool({
			description:
				"Record actual results for the campaign's KPIs. Use at campaign end or when a reporting period closes. For numeric KPIs you can omit status and the system will derive it from target vs actual.",
			inputSchema: z.object({
				results: z
					.array(
						z.object({
							kpiId: z.string().min(1).max(64),
							actualNumber: z.number().finite().nullish(),
							actualBoolean: z.boolean().nullish(),
							actualText: z.string().max(2_000).nullish(),
							status: z
								.enum(["not_met", "partial", "met", "exceeded"])
								.nullish(),
							reportId: z.string().min(1).max(64).nullish(),
							recordedAt: isoDateOrDatetime.nullish(),
						}),
					)
					.max(50),
			}),
			execute: async (input) => {
				await assertTurnActive();
				if (input.results.length === 0) {
					return toolError(
						"No results provided — pass at least one KPI result.",
					);
				}
				const kpiIds = [...new Set(input.results.map((r) => r.kpiId))];
				const reportIds = [
					...new Set(
						input.results
							.map((r) => r.reportId)
							.filter((id): id is string => id != null),
					),
				];
				const [kpis, reports] = await Promise.all([
					prisma.campaignKpi.findMany({
						where: { id: { in: kpiIds } },
						select: {
							id: true,
							campaignId: true,
							kind: true,
							targetNumber: true,
						},
					}),
					reportIds.length > 0
						? prisma.campaignReport.findMany({
								where: { id: { in: reportIds } },
								select: { id: true, campaignId: true },
							})
						: Promise.resolve([]),
				]);
				const kpiById = new Map(kpis.map((k) => [k.id, k]));
				const reportById = new Map(reports.map((r) => [r.id, r]));
				for (const result of input.results) {
					const kpi = kpiById.get(result.kpiId);
					if (!kpi || kpi.campaignId !== campaignId) {
						return toolError(
							`KPI ${result.kpiId} does not belong to this campaign.`,
						);
					}
					if (result.reportId != null) {
						const report = reportById.get(result.reportId);
						if (!report || report.campaignId !== campaignId) {
							return toolError(
								`Report ${result.reportId} does not belong to this campaign.`,
							);
						}
					}
				}
				const created: Array<{ id: string; status: string }> = [];
				for (const result of input.results) {
					const kpi = kpiById.get(result.kpiId);
					if (!kpi) {
						throw new Error(
							`KPI ${result.kpiId} disappeared during batch write`,
						);
					}
					const status = normalizeResultStatus(
						kpi.kind,
						kpi.targetNumber,
						result.actualNumber ?? null,
						result.status as KpiStatus | undefined,
					);
					const row = await prisma.campaignKpiResult.create({
						data: {
							id: crypto.randomUUID(),
							kpiId: result.kpiId,
							actualNumber: result.actualNumber ?? null,
							actualBoolean: result.actualBoolean ?? null,
							actualText: result.actualText ?? null,
							status,
							reportId: result.reportId ?? null,
							recordedAt: dateValue(result.recordedAt) ?? new Date(),
						},
					});
					created.push({ id: row.id, status: row.status });
				}
				return `Recorded ${created.length} KPI result(s): ${created
					.map((r) => `${r.id} (${r.status})`)
					.join(", ")}`;
			},
		}),
		create_asset: tool({
			description:
				"Create a campaign asset — a design workspace (deck, landing page, one-pager) filed in this campaign's project and linked to this campaign. Its brief is seeded with a distilled summary of the campaign context (brief fields + plan phases), so the studio continues from the campaign. Returns the asset id and its studio URL (/studio/<id>). Seeded assets have no upload token: file uploads are NOT available for them — build their content through the studio chat instead. Check list_assets first to avoid duplicating an asset.",
			inputSchema: z.object({
				focus: z
					.string()
					.min(1)
					.max(500)
					.describe(
						"What this asset is for, e.g. 'launch deck for the teaser phase' or 'one-page campaign summary'.",
					),
			}),
			execute: async ({ focus }) => {
				await assertTurnActive();
				const asset = await createCampaignAsset(
					env,
					campaign,
					`Create the campaign asset: ${focus}.`,
				);
				return `Asset created (id ${asset.id}) — studio: ${asset.studioUrl}. Seeded with the distilled campaign context. Uploads are not available for seeded assets.`;
			},
		}),
		list_assets: tool({
			description:
				"List this campaign's existing assets (design workspaces): id, prompt excerpt and publish state. Use it to reference an asset id or before create_asset so you don't duplicate one.",
			inputSchema: z.object({}),
			execute: async () => {
				// Cheap listing: Design rows only — no R2 calls, no file reads.
				const assets = await prisma.design.findMany({
					where: { campaignId },
					orderBy: { createdAt: "desc" },
					take: 20,
					select: { id: true, prompt: true, liveTurnId: true },
				});
				if (assets.length === 0) {
					return "No assets yet for this campaign — create one with create_asset.";
				}
				return assets
					.map((asset) => {
						const focus =
							asset.prompt.length <= 80
								? asset.prompt
								: `${asset.prompt.slice(0, 79)}…`;
						return `- ${asset.id} [${
							asset.liveTurnId ? "published" : "unpublished"
						}] ${focus}`;
					})
					.join("\n");
			},
		}),
		list_channels: tool({
			description:
				"List the platform's channels (id, name, color). Channels are admin-managed — you pick a channelId from this enumeration for add_event/update_event and brief channelIds, but you CANNOT create, rename or delete channels. Call this before picking channels.",
			inputSchema: z.object({}),
			// Cheap enumeration: one indexed read of the small Channel table.
			execute: async () => {
				const channels = await prisma.channel.findMany({
					orderBy: { name: "asc" },
					select: { id: true, name: true, color: true },
				});
				if (channels.length === 0) {
					return "No channels exist yet — ask an admin to create them in the admin UI. Calendar slots and the brief channel mix stay unlinked until then.";
				}
				return channels
					.map(
						(channel) =>
							`- ${channel.id} ${channel.name}${
								channel.color ? ` (${channel.color})` : ""
							}`,
					)
					.join("\n");
			},
		}),
		list_audiences: tool({
			description:
				"List this campaign's target audiences: id, name, demographics, psychographics, buying stage, and notes. A campaign can hold several (ICP, secondary segments). Use this to discover audience ids before update_audience/remove_audience, and to see what is already defined before creating another.",
			inputSchema: z.object({}),
			execute: async () => {
				const audiences = await prisma.targetAudience.findMany({
					where: { campaignId },
					orderBy: { createdAt: "asc" },
					select: {
						id: true,
						name: true,
						demographics: true,
						psychographics: true,
						buyingStage: true,
						body: true,
					},
				});
				if (audiences.length === 0) {
					return "No target audiences defined yet for this campaign — create one with create_audience.";
				}
				return audiences
					.map((audience) => {
						const parts = [
							audience.demographics
								? `demographics: ${audience.demographics}`
								: null,
							audience.psychographics
								? `psychographics: ${audience.psychographics}`
								: null,
							audience.buyingStage ? `stage: ${audience.buyingStage}` : null,
							audience.body ? `notes: ${audience.body}` : null,
						].filter((entry): entry is string => entry !== null);
						return `- ${audience.id} ${audience.name}${
							parts.length > 0 ? ` — ${parts.join("; ")}` : ""
						}`;
					})
					.join("\n");
			},
		}),
		create_audience: tool({
			description:
				"Add a target audience to this campaign (the campaign can hold several — ICP, secondary segments, ...). Capture each segment as soon as the user defines it: name plus whichever segmentation details are known (demographics, psychographics, buying stage, notes). Pass only the fields you know — the rest can be filled in later with update_audience.",
			inputSchema: z.object({
				name: z
					.string()
					.min(1)
					.max(200)
					.describe("Segment name, e.g. 'Gen Z shoppers'."),
				demographics: z
					.string()
					.min(1)
					.max(4_000)
					.nullish()
					.describe("Roles, industries, company size, geo; markdown bullets."),
				psychographics: z
					.string()
					.min(1)
					.max(4_000)
					.nullish()
					.describe("Pain points, motivations, goals, objections; markdown."),
				buyingStage: z
					.string()
					.min(1)
					.max(120)
					.nullish()
					.describe(
						"Funnel/buying stage, e.g. 'awareness' or 'decision-makers'.",
					),
				body: z
					.string()
					.min(1)
					.max(20_000)
					.nullish()
					.describe("Freeform markdown notes for this segment."),
			}),
			execute: async (input) => {
				await assertTurnActive();
				const audience = await prisma.targetAudience.create({
					data: {
						id: crypto.randomUUID(),
						campaignId,
						name: input.name,
						demographics: input.demographics ?? null,
						psychographics: input.psychographics ?? null,
						buyingStage: input.buyingStage ?? null,
						body: input.body ?? null,
					},
				});
				return `Audience "${audience.name}" created (id ${audience.id}). List them all with list_audiences.`;
			},
		}),
		update_audience: tool({
			description:
				"Patch a target audience of THIS campaign by id with only the fields you pass. Use it to refine segmentation details as they are agreed. The audience id must come from list_audiences.",
			inputSchema: z.object({
				audienceId: z
					.string()
					.min(1)
					.max(64)
					.describe("Audience id from list_audiences."),
				name: z.string().min(1).max(200).nullish(),
				demographics: z.string().min(1).max(4_000).nullish(),
				psychographics: z.string().min(1).max(4_000).nullish(),
				buyingStage: z.string().min(1).max(120).nullish(),
				body: z.string().min(1).max(20_000).nullish(),
			}),
			execute: async (input) => {
				await assertTurnActive();
				const { audienceId, ...patch } = input;
				const fields = provided(patch);
				const existing = await prisma.targetAudience.findUnique({
					where: { id: audienceId },
					select: { id: true, campaignId: true },
				});
				if (!existing || existing.campaignId !== campaignId) {
					return toolError(
						`Unknown audience id ${audienceId} — it does not belong to this campaign. Call list_audiences for the current ids.`,
					);
				}
				if (Object.keys(fields).length === 0) {
					return toolError(
						"update_audience needs at least one field to patch (e.g. name, demographics).",
					);
				}
				await prisma.targetAudience.update({
					where: { id: audienceId },
					data: fields,
				});
				return `Audience updated (fields: ${Object.keys(fields).join(", ")}).`;
			},
		}),
		remove_audience: tool({
			description:
				"Remove a target audience from THIS campaign by id. Use it when the user drops a segment. The audience id must come from list_audiences.",
			inputSchema: z.object({
				audienceId: z
					.string()
					.min(1)
					.max(64)
					.describe("Audience id from list_audiences."),
			}),
			execute: async ({ audienceId }) => {
				await assertTurnActive();
				const existing = await prisma.targetAudience.findUnique({
					where: { id: audienceId },
					select: { id: true, campaignId: true, name: true },
				});
				if (!existing || existing.campaignId !== campaignId) {
					return toolError(
						`Unknown audience id ${audienceId} — it does not belong to this campaign. Call list_audiences for the current ids.`,
					);
				}
				await prisma.targetAudience.delete({ where: { id: audienceId } });
				return `Audience "${existing.name}" removed.`;
			},
		}),
		list_kpis: tool({
			description:
				"List this campaign's KPI definitions: id, name, kind, target value, unit, and color. Use this to discover KPI ids before calling record_kpi_results or to include ids when updating KPIs through save_brief/update_brief.",
			inputSchema: z.object({}),
			execute: async () => {
				const kpis = await prisma.campaignKpi.findMany({
					where: { campaignId },
					orderBy: { sortOrder: "asc" },
					select: {
						id: true,
						name: true,
						kind: true,
						targetNumber: true,
						targetBoolean: true,
						targetText: true,
						unit: true,
						color: true,
					},
				});
				if (kpis.length === 0) {
					return "No KPIs defined yet — set them in the brief with save_brief or update_brief.";
				}
				return kpis
					.map((kpi) => {
						let target: string;
						if (kpi.kind === "number") {
							target = `${kpi.targetNumber ?? "?"}${
								kpi.unit ? ` ${kpi.unit}` : ""
							}`;
						} else if (kpi.kind === "boolean") {
							target = kpi.targetBoolean === true ? "true" : "false";
						} else {
							target = kpi.targetText ?? "?";
						}
						return `- ${kpi.id} ${kpi.name} (${kpi.kind}, target ${target})${
							kpi.color ? ` ${kpi.color}` : ""
						}`;
					})
					.join("\n");
			},
		}),
		/**
		 * load_skill (KUK-891) returns a studio skill's full markdown
		 * instructions by slug. Skills are admin-owned like channels: the
		 * agent loads them but can never create or edit. Only enabled skills
		 * resolve — unknown or disabled slugs are recoverable { ok: false }
		 * errors the model can see and route around; a thrown error would
		 * instead fail the whole turn with the public message.
		 */
		load_skill: tool({
			description:
				"Load a studio skill's full markdown instructions by slug (from the Available skills list in the system prompt). Use it when the user invokes a skill with its /slug or asks for one of those topics, then follow the returned instructions. Skills are admin-managed — you cannot create or edit them.",
			inputSchema: z.object({
				slug: z
					.string()
					.min(1)
					.max(64)
					.describe("Skill slug, e.g. 'campaign-basics'."),
			}),
			execute: async ({ slug }) => {
				const skill = await prisma.skill.findUnique({
					where: { slug },
					select: { name: true, content: true, enabled: true, category: true },
				});
				// Campaign studio surfaces the campaign/marketing/sales
				// categories; design-category skills are the design chat's
				// library and must not resolve here.
				const inScope =
					skill?.enabled === true &&
					skillInCategories(skill.category, CAMPAIGN_SKILL_CATEGORIES);
				if (!skill || !inScope) {
					return toolError(
						`No enabled skill "${slug}". Check the Available skills list in the system prompt and pass one of those slugs exactly.`,
					);
				}
				return skill.content;
			},
		}),
	};
}

/**
 * Shared setup for one campaign chat turn: claims the Campaign turn lease,
 * loads history + skills, connects the browser MCP tools, and starts the
 * model loop. Returns the streamText result so the RivetKit `campaignChat`
 * actor can broadcast individual UI-message chunks to connected clients.
 * The assistant turn is persisted (and status/error updated) from onFinish,
 * which fires when the stream completes.
 */
async function createCampaignChatStreamResult(
	env: Env,
	campaignId: string,
	options: {
		message: string;
		/** Any model id is accepted; unknown ones coerce to CAMPAIGN_CHAT_MODEL. */
		model?: string;
		/**
		 * "low" | "high" | "max" as a raw client string; unknown values
		 * coerce to the default ("low") with the same convention as model.
		 * KUK-892: effort is a PER-TURN parameter, deliberately not persisted
		 * on the Campaign row — it rides the request body and applies only
		 * to this turn's model calls.
		 */
		thinkingEffort?: string;
		origin: string;
	},
) {
	if (!isCampaignId(campaignId)) {
		throw new Error(`invalid campaign id: ${campaignId}`);
	}
	const prisma = getPrisma(env);
	const campaign = await prisma.campaign.findUnique({
		where: { id: campaignId },
	});
	if (!campaign) {
		throw new Error(`campaign ${campaignId} not found`);
	}

	const turnId = crypto.randomUUID();
	const turnClaimedAt = new Date();
	let claimed = await prisma.campaign.updateMany({
		where: { id: campaignId, activeTurnId: null },
		data: {
			activeTurnId: turnId,
			turnClaimedAt,
			status: "chatting",
			error: null,
		},
	});
	if (claimed.count !== 1) {
		claimed = await prisma.campaign.updateMany({
			where: {
				id: campaignId,
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
		const current = await prisma.campaign.findUnique({
			where: { id: campaignId },
			select: { id: true },
		});
		if (current) throw new CampaignChatTurnConflictError();
		throw new Error(`campaign ${campaignId} not found`);
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
	// onError, or failTurn). The deadline watchdog below must not fire past
	// this point, and the deadline promise itself must not be left pending
	// on a timer the turn already outlived.
	let resolveTurnComplete!: () => void;
	const turnComplete = new Promise<void>((resolve) => {
		resolveTurnComplete = resolve;
	});
	const failTurn = async (error: unknown): Promise<void> => {
		if (!failureFinalized) {
			failureFinalized = true;
			console.log(`[campaign-chat] turn failed for ${campaignId}:`, error);
			await prisma.campaign
				.updateMany({
					where: { id: campaignId, activeTurnId: turnId },
					data: {
						activeTurnId: null,
						turnClaimedAt: null,
						status: "failed",
						error: campaignChatPublicError(error),
					},
				})
				.catch(() => {});
			await closeMcp();
		}
		resolveTurnComplete();
	};

	let history: ModelMessage[];
	let enabledSkills: SkillSummary[] = [];
	let workersai: ReturnType<typeof createWorkersAI>;
	let mcpTools: ToolSet | null;
	let streamFailed = false;

	// Unknown/removed model ids (e.g. stale localStorage from a client
	// whose selector predates the list cleanup) coerce to the default
	// instead of failing the turn — every listed model works; the ones
	// that didn't were removed.
	const modelId =
		options.model &&
		CAMPAIGN_CHAT_MODELS.includes(options.model as CampaignChatModel)
			? options.model
			: CAMPAIGN_CHAT_MODEL;
	// Per-turn thinking effort (KUK-892), coerced like the model id above.
	const thinkingEffort = resolveThinkingEffort(options.thinkingEffort);
	// Hard deadlines (see constants above): the turn deadline also gates the
	// streamText abort signal and the watchdog below.
	const turnTimeoutMs = timeoutMs(
		env,
		"CAMPAIGN_CHAT_TURN_TIMEOUT_MS",
		DEFAULT_TURN_TIMEOUT_MS,
	);
	const mcpConnectTimeoutMs = timeoutMs(
		env,
		"CAMPAIGN_CHAT_MCP_CONNECT_TIMEOUT_MS",
		DEFAULT_MCP_CONNECT_TIMEOUT_MS,
	);
	try {
		if (!(await isUserRetry(env, campaignId, options.message))) {
			await persistMessage(env, campaignId, "user", options.message);
		}
		history = await loadHistory(env, campaignId);
		// Skills (KUK-891, categories via 0020): metadata for the system
		// prompt every turn, plus a "/<slug>" slash invocation resolved
		// against the enabled campaign/marketing/sales rows — the injected
		// content lives only in this model-facing view.
		enabledSkills = await prisma.skill.findMany({
			where: {
				enabled: true,
				category: { in: [...CAMPAIGN_SKILL_CATEGORIES] },
			},
			orderBy: { slug: "asc" },
			select: { name: true, slug: true, description: true },
		});
		const slashSkill = await resolveSlashSkill(prisma, history);
		if (slashSkill) {
			const last = history[history.length - 1];
			last.content = `${skillContextText(slashSkill)}\n\n${slashSkill.rest}`;
		}
		workersai = createWorkersAI({ binding: env.AI });
		const browser = await browserTools(
			env,
			options.origin,
			mcpConnectTimeoutMs,
		);
		mcpTools = browser.tools;
		mcpClient = browser.client;
		if (options.model && options.model !== modelId) {
			console.log(
				`[campaign-chat] unknown model "${options.model}", using ${modelId}`,
			);
		}
	} catch (error) {
		await failTurn(error);
		throw error;
	}

	// Write fence for the document tools: they may only write while this
	// turn still owns the campaign lease (same discipline as design-chat).
	const assertTurnActive = async (): Promise<void> => {
		if (failureFinalized || streamFailed) {
			throw new Error("stale campaign chat turn");
		}
		const owned = await prisma.campaign.updateMany({
			where: { id: campaignId, activeTurnId: turnId },
			data: { activeTurnId: turnId },
		});
		if (owned.count !== 1) throw new Error("stale campaign chat turn");
	};
	const documentTools = campaignDocumentTools({
		env,
		prisma,
		campaignId,
		campaign: {
			id: campaign.id,
			projectId: campaign.projectId,
			name: campaign.name,
		},
		assertTurnActive,
	});

	// Hard deadline for the whole turn: aborts the model loop (providers that
	// honor the signal stop streaming), closes the UI stream with an error
	// part (see withDeadlineClose), and — via the watchdog below — releases
	// the lease even when a hung tool execute keeps the loop from noticing
	// the abort. Sized under the 45-minute abandoned-lease window so a live
	// turn always settles before a successor could lazily reclaim it.
	const turnDeadline = new AbortController();
	const deadlineTimer = setTimeout(
		// The reason's message is the public timeout text: the watchdog and
		// onAbort surface it to the client via campaignChatPublicError.
		() => turnDeadline.abort(new Error(CAMPAIGN_CHAT_TIMEOUT_ERROR)),
		turnTimeoutMs,
	);

	const result = await Promise.resolve()
		.then(() =>
			streamText({
				model: workersai(modelId, {}),
				// Thinking effort (KUK-892): forwarded per-model by
				// thinkingEffortInputs — GLM gets reasoning_effort, Kimi gets
				// chat_template_kwargs.clear_thinking — through the provider's
				// per-call providerOptions channel onto binding.run() INPUTS
				// (workers-ai-provider 3.1.12, proven by
				// campaign-chat-thinking.test.ts). Per-turn, not persisted.
				providerOptions: {
					"workers-ai": thinkingEffortInputs(
						modelId as CampaignChatModel,
						thinkingEffort,
					),
				},
				system: campaignSystemPrompt({
					briefPrompt: campaign.briefPrompt ?? "No brief yet — ask the user.",
					skills: enabledSkills,
				}),
				messages: history,
				// ask_user ends the turn: interactive pickers must never be
				// followed by more text, reasoning, or tool calls while the
				// user is deciding.
				stopWhen: [stepCountIs(MAX_STEPS), hasToolCall("ask_user")],
				// Hard deadline for the model loop: without it a hung Workers AI
				// stream held the lease forever (the stuck-chat bug). Aborting
				// routes through onAbort → failTurn, releasing the lease.
				abortSignal: turnDeadline.signal,
				tools: {
					ask_user: tool({
						description:
							"Ask the user an interactive question with clickable buttons. Use this when you need a decision or preference before continuing (audience, budget band, channel mix, timeline, tone, etc.). Provide 2-5 short options. The user will see the buttons and their click will be sent back as the next user message. The call ends the turn automatically: nothing may follow it — no further text or tool calls — until the user answers.",
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
						execute: async ({ question, options: choices }) => {
							return {
								status: "displayed",
								message:
									"The question is now shown to the user as interactive buttons. Do not call any other tools; wait for the user's answer in the next turn.",
								question,
								options: choices,
							};
						},
					}),
					...documentTools,
					...(mcpTools ?? {}),
				},
				onFinish: async ({ text, toolResults, steps }) => {
					if (streamFailed) return;
					try {
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

						await persistAssistantMessage(
							env,
							campaignId,
							turnId,
							finalText,
							// Reasoning + tool parts from the finished steps, so a
							// refresh rebuilds the thoughts and tool cards the live
							// stream rendered.
							chatPartsJson(steps, finalText),
						);
						// The turn is over: "chatting" is reserved for an in-flight
						// stream. ready covers completed Q&A turns.
						await prisma.campaign.updateMany({
							where: { id: campaignId, activeTurnId: turnId },
							data: {
								activeTurnId: null,
								turnClaimedAt: null,
								status: "ready",
								error: null,
							},
						});
						// The lease is released: late failure handlers (the deadline
						// watchdog) must not log spurious failures for this turn.
						failureFinalized = true;
					} catch (error) {
						await failTurn(error);
					} finally {
						await closeMcp();
						resolveTurnComplete();
					}
				},
				onError: async ({ error }) => {
					streamFailed = true;
					await failTurn(error);
				},
				// Fires when the abortSignal above aborts the model loop (there
				// is no client abort path here — the only signal is the turn
				// deadline). Same failure path as onError.
				onAbort: async () => {
					streamFailed = true;
					await failTurn(new Error(CAMPAIGN_CHAT_TIMEOUT_ERROR));
				},
			}),
		)
		.catch(async (error) => {
			await failTurn(error);
			throw error;
		});

	// Deadline watchdog, independent of the model loop: the abort signal
	// does not reach a tool execute that hangs (the loop only checks between
	// steps), so this fails the turn — clearing the lease — no matter where
	// the model loop is wedged. Idempotent with onFinish/onError via
	// failureFinalized; racing turnComplete keeps a settled turn from
	// leaving this waitUntil pending on the (cleared) timer.
	const deadlineSettled = new Promise<never>((_, reject) => {
		turnDeadline.signal.addEventListener(
			"abort",
			() =>
				reject(
					turnDeadline.signal.reason instanceof Error
						? turnDeadline.signal.reason
						: new Error("campaign chat turn deadline"),
				),
			{ once: true },
		);
	});
	void deadlineSettled.catch(() => {});

	void Promise.race([deadlineSettled, turnComplete]).catch(async (error) => {
		// A turn that already released its lease (onFinish/onError/failTurn)
		// must not be logged as a late failure.
		if (failureFinalized) return;
		streamFailed = true;
		await failTurn(error);
	});
	// Once the turn's completion handlers have run the deadline is moot:
	// stop the timer so a post-turn abort can never fire and leave a caller
	// pending on the (cleared) timer.
	void turnComplete.then(() => clearTimeout(deadlineTimer));

	return { result, closeMcp, turnComplete, deadlineSettled, failTurn };
}

/**
 * Runs one chat turn for the RivetKit `campaignChat` actor. Each UI-message
 * chunk is emitted to the callback so it can be broadcast to connected
 * clients. The turn is fully persisted before this resolves; a turn-deadline
 * abort rejects, which the actor surfaces as `turnFailed`.
 */
export async function runCampaignChatTurnStream(
	env: Env,
	campaignId: string,
	options: {
		message: string;
		model?: string;
		thinkingEffort?: string;
		origin: string;
	},
	emit: (chunk: import("ai").UIMessageChunk) => void,
): Promise<void> {
	const { result, closeMcp, turnComplete, deadlineSettled, failTurn } =
		await createCampaignChatStreamResult(env, campaignId, options);
	try {
		const pump = (async () => {
			for await (const chunk of result.toUIMessageStream({
				// Redact model internals exactly like the old SSE path did.
				onError: () => CAMPAIGN_CHAT_PUBLIC_ERROR,
			})) {
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
