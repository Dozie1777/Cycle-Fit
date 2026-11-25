/**
 * Element chat turn pipeline (KUK-941): one scoped chat per design element
 * (component / page / template / data collection / flow) inside a project.
 * The lease lives on the ElementChat row with the exact semantics of the
 * design and campaign chats — claim on turn start, lazy abandoned-lease
 * reclaim, terminal fencing — reusing the shared turn limits
 * (lib/chat-turn-limits.ts: 40-min deadline, 45-min reclaim window).
 *
 * The system prompt is the session's distilled contextPrompt (seeded at
 * session creation by the context builders / orchestrator), so the model
 * sees only this element, its neighbors, and the project's tokens — never
 * the whole design history. That isolation is the point of the feature.
 *
 * The RivetKit actor (KUK-942) calls runElementChatTurnStream per turn and
 * may inject element-specific tools through assembleTools; every injected
 * tool fences its executes through the turn lease.
 */

import type { ModelMessage } from "ai";
import { hasToolCall, stepCountIs, streamText, type ToolSet, tool } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { z } from "zod";
import { chatPartsJson } from "@/lib/chat-parts";
import {
	ABANDONED_LEASE_MS,
	DEFAULT_TURN_TIMEOUT_MS,
	timeoutMs,
} from "@/lib/chat-turn-limits";
import { getPrisma } from "@/lib/db";
import { validateMessageOwner } from "@/lib/message-owner";

/**
 * Element chats run on the same flash model family as the design and
 * campaign chats; caller-supplied ids are coerced against this list (same
 * contract as the design and campaign chats).
 */
export const ELEMENT_CHAT_MODEL = "@cf/zai-org/glm-5.3";
export const ELEMENT_CHAT_MODELS: readonly string[] = [ELEMENT_CHAT_MODEL];

/** Replay at most this many turns of history; older turns are dropped. */
const MAX_HISTORY_MESSAGES = 24;

/** Tool-call rounds per element chat turn. */
const MAX_STEPS = 12;

export const ELEMENT_CHAT_PUBLIC_ERROR = "chat turn failed — try again";
export const ELEMENT_CHAT_CONFLICT_ERROR = "chat turn already in progress";
export const ELEMENT_CHAT_TIMEOUT_ERROR =
	"chat turn exceeded its time limit — try again";

/** Model-facing name of the injected ask_user tool (ends the turn). */
const ASK_USER_TOOL = "ask_user";

/**
 * Message-body input for the RivetKit `elementChat` actor's sendMessage
 * action (KUK-942) — the same validation contract the design and campaign
 * chats use: one shared exported schema, never a weaker copy in the actor.
 * Any string is accepted for model (unknown ids coerce server-side).
 *
 * The conversation id is NOT part of this payload: the studio passes it as
 * connection params (`useActor({ …, params: { elementChatId } })`), the
 * actor validates it against the project from its own key at connect time
 * and stores it in the connection state — a client can never target
 * another conversation through a message body.
 */
export const elementChatMessageInput = z.object({
	message: z.string().trim().min(1).max(8000),
	model: z.string().max(120).optional(),
});

/**
 * Connection params for the `elementChat` actor: the conversation the
 * connection participates in. Validated and project-fenced in
 * createConnState at connect time, then trusted for the connection's life.
 */
export const elementChatConnParams = z.object({
	elementChatId: z.string().min(1),
});

/** Full turn input including an explicit session id (non-actor callers). */
export const elementChatTurnInput = elementChatMessageInput.extend({
	elementChatId: z.string().min(1),
});

export class ElementChatTurnConflictError extends Error {
	constructor() {
		super(ELEMENT_CHAT_CONFLICT_ERROR);
		this.name = "ElementChatTurnConflictError";
	}
}

/** Maps any pipeline error to the public text the studio shows. */
export function elementChatPublicError(error: unknown): string {
	if (error instanceof ElementChatTurnConflictError) {
		return ELEMENT_CHAT_CONFLICT_ERROR;
	}
	const message = error instanceof Error ? error.message : String(error);
	if (message.includes(ELEMENT_CHAT_TIMEOUT_ERROR)) {
		return ELEMENT_CHAT_TIMEOUT_ERROR;
	}
	return ELEMENT_CHAT_PUBLIC_ERROR;
}

/**
 * The element chat's system prompt: a short role preamble plus the
 * session's distilled element context. The contextPrompt is the source of
 * truth for what this chat is about — it carries the element's own
 * definition, its neighbors, and the project's tokens/brand kit.
 */
function elementSystemPrompt(contextPrompt: string): string {
	return `# Role

You are a focused design assistant working on ONE element of a larger design
project, in a live chat with the user. You discuss, refine and iterate on
this element only — other elements have their own chats, and the main
design chat orchestrates the whole design. Keep answers short, concrete and
specific to this element.

# Element context

${contextPrompt}`;
}

async function loadHistory(
	env: Env,
	elementChatId: string,
): Promise<ModelMessage[]> {
	// Newest turns matter most; take from the descending end and replay in
	// chronological order. The cap keeps the scoped context small — the
	// whole point of per-element chats is a tight, focused window.
	const rows = await getPrisma(env).message.findMany({
		where: { elementId: elementChatId },
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
	elementChatId: string,
	role: "user" | "assistant",
	content: string,
): Promise<void> {
	await getPrisma(env).message.create({
		data: {
			id: crypto.randomUUID(),
			...validateMessageOwner({ elementId: elementChatId }),
			role,
			content,
		},
	});
}

/**
 * A retry of a failed turn re-sends the same user message. Without this
 * guard the transcript would grow a duplicate user row per attempt. Only a
 * trailing unanswered user message matches (same window as design chat).
 */
async function isUserRetry(
	env: Env,
	elementChatId: string,
	message: string,
): Promise<boolean> {
	const last = await getPrisma(env).message.findFirst({
		where: { elementId: elementChatId },
		orderBy: { createdAt: "desc" },
	});
	return (
		last?.role === "user" &&
		last.content === message &&
		Date.now() - last.createdAt.getTime() < 5 * 60 * 1000
	);
}

/**
 * Fenced assistant persist: the INSERT only lands while THIS turn still
 * owns the ElementChat lease, so a turn abandoned mid-stream (its lease
 * reclaimed by a successor) can never pollute the newer turn's history.
 * Same conditional-INSERT pattern as the design and campaign chats.
 */
async function persistAssistantMessage(
	env: Env,
	elementChatId: string,
	turnId: string,
	content: string,
	partsJson?: string | null,
): Promise<void> {
	const inserted = await env.DB.prepare(
		`INSERT INTO "Message" ("id", "elementId", "role", "content", "parts", "createdAt")
		SELECT ?, ?, ?, ?, ?, ?
		WHERE EXISTS (
			SELECT 1 FROM "ElementChat" WHERE "id" = ? AND "activeTurnId" = ?
		)`,
	)
		.bind(
			crypto.randomUUID(),
			elementChatId,
			"assistant",
			content,
			// Reasoning + tool-call parts for the refresh path; null degrades
			// to the flat text (same as the design chat).
			partsJson ?? null,
			new Date().toISOString(),
			elementChatId,
			turnId,
		)
		.run();
	if (inserted.meta.changes !== 1) {
		throw new Error("element chat turn no longer owns its lease");
	}
}

async function createElementChatStreamResult(
	env: Env,
	elementChatId: string,
	options: {
		message: string;
		/** Any model id is accepted; unknown ones coerce to ELEMENT_CHAT_MODEL. */
		model?: string;
		abortSignal?: AbortSignal;
		/**
		 * Element-specific tool factory (KUK-942): receives the turn-lease
		 * fence and returns the tools this element type supports. Every
		 * injected tool must call the fence before writing.
		 */
		assembleTools?: (fence: () => Promise<void>) => ToolSet;
	},
) {
	const prisma = getPrisma(env);
	const session = await prisma.elementChat.findUnique({
		where: { id: elementChatId },
	});
	if (!session) {
		throw new Error(`element chat session ${elementChatId} not found`);
	}
	// Unknown/removed model ids coerce to the default instead of failing
	// the turn (same contract as the design and campaign chats).
	const modelId =
		options.model && ELEMENT_CHAT_MODELS.includes(options.model)
			? options.model
			: ELEMENT_CHAT_MODEL;

	const turnId = crypto.randomUUID();
	const turnClaimedAt = new Date();
	let claimed = await prisma.elementChat.updateMany({
		where: { id: elementChatId, activeTurnId: null },
		data: {
			activeTurnId: turnId,
			turnClaimedAt,
			status: "chatting",
			error: null,
		},
	});
	if (claimed.count !== 1) {
		claimed = await prisma.elementChat.updateMany({
			where: {
				id: elementChatId,
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
		const current = await prisma.elementChat.findUnique({
			where: { id: elementChatId },
			select: { id: true },
		});
		if (current) throw new ElementChatTurnConflictError();
		throw new Error(`element chat session ${elementChatId} not found`);
	}

	let failureFinalized = false;
	let streamFailed = false;
	// Resolved once the turn's completion handlers have fully run (onFinish,
	// onError, onAbort, or failTurn). The deadline watchdog must not fire
	// past this point, and the deadline promise itself must not be left
	// pending on a timer the turn already outlived.
	let resolveTurnComplete!: () => void;
	const turnComplete = new Promise<void>((resolve) => {
		resolveTurnComplete = resolve;
	});
	const failTurn = async (
		error: unknown,
		publicError?: string,
	): Promise<void> => {
		if (!failureFinalized) {
			failureFinalized = true;
			console.log(`[element-chat] turn failed for ${elementChatId}:`, error);
			await prisma.elementChat
				.updateMany({
					where: { id: elementChatId, activeTurnId: turnId },
					data: {
						activeTurnId: null,
						turnClaimedAt: null,
						status: "failed",
						error: publicError ?? elementChatPublicError(error),
					},
				})
				.catch(() => {});
		}
		// Always resolved, even when already finalized, so a racing watchdog
		// never hangs on turnComplete.
		resolveTurnComplete();
	};

	// Turn-lease fence for every injected tool execute: re-asserts ownership
	// (and rejects when the turn is stale) before any write.
	const assertTurnActive = async (): Promise<void> => {
		if (failureFinalized || streamFailed) {
			throw new Error("stale element chat turn");
		}
		const owned = await prisma.elementChat.updateMany({
			where: { id: elementChatId, activeTurnId: turnId },
			data: { activeTurnId: turnId },
		});
		if (owned.count !== 1) throw new Error("stale element chat turn");
	};

	// The user message is persisted before the model sees it (unless it is a
	// retry of a failed turn), so the transcript shows exactly what the
	// model saw. Post-claim setup is wrapped: any failure here releases the
	// lease immediately through failTurn (the deadline watchdog does not
	// exist yet at this point) instead of wedging the session "chatting"
	// until the 45-minute lazy reclaim — same as the design and campaign
	// pipelines.
	let history: ModelMessage[];
	try {
		if (!(await isUserRetry(env, elementChatId, options.message))) {
			await persistMessage(env, elementChatId, "user", options.message);
		}
		history = await loadHistory(env, elementChatId);
	} catch (error) {
		await failTurn(error);
		throw error;
	}

	// Hard deadline for the whole turn (shared limits module): sized under
	// the 45-minute abandoned-lease window so a live turn always settles
	// before a successor could lazily reclaim it.
	const turnTimeoutMs = timeoutMs(
		env,
		"ELEMENT_CHAT_TURN_TIMEOUT_MS",
		DEFAULT_TURN_TIMEOUT_MS,
	);
	const turnDeadline = new AbortController();
	const deadlineTimer = setTimeout(
		() =>
			turnDeadline.abort(
				new Error(`element chat turn exceeded ${turnTimeoutMs}ms`),
			),
		turnTimeoutMs,
	);
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

	const workersai = createWorkersAI({ binding: env.AI });
	const result = await Promise.resolve()
		.then(() =>
			streamText({
				model: workersai(modelId, {}),
				system: elementSystemPrompt(session.contextPrompt),
				messages: history,
				// Hard deadline for the model loop: aborting routes through
				// onAbort → failTurn, releasing the lease.
				abortSignal: abortController.signal,
				// ask_user ends the turn: interactive pickers must never be
				// followed by more text or tool calls while the user decides.
				stopWhen: [stepCountIs(MAX_STEPS), hasToolCall(ASK_USER_TOOL)],
				tools: {
					// ask_user is reserved: injected element tools spread first
					// so a name collision can never override it.
					...(options.assembleTools?.(assertTurnActive) ?? {}),
					[ASK_USER_TOOL]: tool({
						description:
							"Ask the user an interactive question with clickable buttons. Use this when you need a decision or preference about this element before continuing (variant, copy, data shape, behavior, etc.). Provide 2-5 short options. The call ends the turn automatically: nothing may follow it — no further text or tool calls — until the user answers.",
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
				},
				onFinish: async ({ text, toolResults, steps }) => {
					if (streamFailed) return;
					try {
						const askUser = toolResults.find(
							(r) => r.toolName === ASK_USER_TOOL,
						);
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
							elementChatId,
							turnId,
							finalText,
							// Reasoning + tool parts from the finished steps, so a
							// refresh rebuilds the thoughts and tool cards the live
							// stream rendered.
							chatPartsJson(steps, finalText),
						);
						// The turn is over: "chatting" is reserved for an
						// in-flight stream; ready covers completed Q&A turns.
						await prisma.elementChat.updateMany({
							where: { id: elementChatId, activeTurnId: turnId },
							data: {
								activeTurnId: null,
								turnClaimedAt: null,
								status: "ready",
								error: null,
							},
						});
						// The lease is released: late failure handlers (the
						// deadline watchdog) must not log spurious failures.
						failureFinalized = true;
					} catch (error) {
						await failTurn(error);
					} finally {
						detachAbortForwarding();
						resolveTurnComplete();
					}
				},
				onError: async ({ error }) => {
					streamFailed = true;
					await failTurn(error);
				},
				// Fires when the abortSignal aborts the model loop (deadline
				// or client disconnect). Same failure path as onError.
				onAbort: async () => {
					streamFailed = true;
					await failTurn(new Error(ELEMENT_CHAT_TIMEOUT_ERROR));
				},
			}),
		)
		.catch(async (error) => {
			await failTurn(error);
			throw error;
		});

	// Deadline watchdog, independent of the model loop: the abort signal does
	// not reach a tool execute that hangs, so this fails the turn — clearing
	// the lease — no matter where the model loop is wedged. Idempotent with
	// onFinish/onError via failureFinalized; racing turnComplete keeps a
	// settled turn from leaving this waitUntil pending on the timer.
	const deadlineSettled = new Promise<never>((_, reject) => {
		turnDeadline.signal.addEventListener(
			"abort",
			() =>
				reject(
					turnDeadline.signal.reason instanceof Error
						? turnDeadline.signal.reason
						: new Error("element chat turn deadline"),
				),
			{ once: true },
		);
	});
	void deadlineSettled.catch(() => {});

	void Promise.race([deadlineSettled, turnComplete]).catch(async (error) => {
		// A turn that already released its lease must not be logged as a
		// late failure.
		if (failureFinalized) return;
		streamFailed = true;
		// The watchdog only fires on the deadline (or the caller's abort
		// already routed through onAbort): persist the timeout-specific
		// public text, log the underlying reason.
		await failTurn(error, ELEMENT_CHAT_TIMEOUT_ERROR);
	});
	// Once the turn's completion handlers have run the deadline is moot.
	void turnComplete.then(() => clearTimeout(deadlineTimer));

	return { result, turnComplete, deadlineSettled, failTurn };
}

/**
 * Runs one element chat turn for the RivetKit actor (KUK-942). Each
 * UI-message chunk is emitted to the callback so it can be broadcast to the
 * clients bound to this element chat. The turn is fully persisted before
 * this resolves; a turn-deadline abort rejects, which the actor surfaces as
 * `turnFailed`.
 */
export async function runElementChatTurnStream(
	env: Env,
	elementChatId: string,
	options: {
		message: string;
		model?: string;
		abortSignal?: AbortSignal;
		assembleTools?: (fence: () => Promise<void>) => ToolSet;
	},
	emit: (chunk: import("ai").UIMessageChunk) => void,
): Promise<void> {
	const { result, turnComplete, deadlineSettled, failTurn } =
		await createElementChatStreamResult(env, elementChatId, options);
	try {
		const pump = (async () => {
			for await (const chunk of result.toUIMessageStream()) {
				emit(chunk);
			}
			await result.consumeStream();
		})();
		// A hung provider or tool execute leaves the UI stream open forever
		// even after the deadline watchdog released the lease — the race
		// below keeps the actor action (and its client) from spinning
		// forever. If the deadline settles first its rejection propagates:
		// the actor broadcasts `turnFailed` and the chat shows the retryable
		// error.
		const settled = Promise.race([deadlineSettled, turnComplete]);
		const outcome = await Promise.race([
			pump.then(() => "pumped" as const),
			settled.then(() => "settled" as const),
		]);
		if (outcome === "settled") {
			// The completion handlers have run — drain the rest of the UI
			// stream. A late pump failure after the turn settled is moot.
			await pump.catch(() => {});
		}
	} catch (error) {
		// Safety net: a stream failure that slipped past onError/onAbort
		// must still release the turn lease.
		await failTurn(error);
		throw error;
	}
}
