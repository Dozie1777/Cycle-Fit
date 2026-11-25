import { env } from "cloudflare:workers";
import type { UIMessageChunk } from "ai";
import { actor, event, UserError } from "rivetkit";
import { getAuth } from "@/lib/auth";
import { getPrisma } from "@/lib/db";

export type ElementChatConnState = {
	userId: string;
	role: "user" | "admin" | "agent" | "system" | null;
	/**
	 * The one conversation this connection participates in, taken from the
	 * CONNECTION PARAMS at connect time (`useActor({ …, params: {
	 * elementChatId } })` / `getOrCreate(key, { params })`) — never from a
	 * message body. Validated and project-fenced in createConnState, so it
	 * is trusted for the connection's life: every event routed by it
	 * reaches exactly the participants of that conversation (multiplayer),
	 * and no connection can ever see another conversation's stream.
	 */
	elementChatId: string;
};

// Loaded lazily (same discipline as the design and campaign chat actors,
// see 0da6953bf) so the worker entry does not eagerly pull in
// @/lib/element-chat — the workers-ai-provider import it carries must stay
// out of the boot graph or workerd/Vitest mocks never apply.
let elementChatModule:
	| typeof import("@/features/design-studio/element-chat/element-chat")
	| undefined;
async function loadElementChatModule() {
	if (!elementChatModule) {
		elementChatModule = await import(
			"@/features/design-studio/element-chat/element-chat"
		);
	}
	return elementChatModule;
}

async function resolveCaller(c: {
	request: Request | undefined;
}): Promise<Omit<ElementChatConnState, "elementChatId">> {
	if (c.request === undefined) {
		throw new UserError("unauthorized", { code: "unauthorized" });
	}
	// Inline/system callers (createInlineClient inside this worker — the test
	// harness today, future server-side orchestration) dispatch through the
	// ACTOR_DO binding with the framework's synthetic `http://actor` origin
	// and no credentials. The actor DO is only reachable from in-worker code
	// (the /rivet gateway is session-gated in src/server.ts), so that origin
	// is a trusted system-caller marker — same shape as the campaign chat
	// actor.
	if (new URL(c.request.url).origin === "http://actor") {
		return { userId: "system", role: "system" };
	}

	const session = await getAuth(env).api.getSession({
		headers: c.request.headers,
	});
	if (!session) {
		throw new UserError("unauthorized", { code: "unauthorized" });
	}

	return {
		userId: session.user.id,
		role: (session.user.role as ElementChatConnState["role"]) ?? null,
	};
}

function parseActorKey(key: string[]): string {
	if (key.length !== 2 || key[0] !== "elementChat") {
		throw new UserError("invalid element chat actor key", {
			code: "invalid_actor_key",
		});
	}
	return key[1];
}

/**
 * Validates that the conversation from the connection params resolves to a
 * session owned by THIS actor's project (from the key) — a chat id from
 * another project is rejected at connect, before any event or write.
 */
async function fenceConnParams(projectId: string, elementChatId: string) {
	const row = await getPrisma(env).elementChat.findUnique({
		where: { id: elementChatId },
		select: { projectId: true },
	});
	if (!row) {
		throw new UserError("element chat session not found", {
			code: "not_found",
		});
	}
	if (row.projectId !== projectId) {
		throw new UserError("forbidden", { code: "forbidden" });
	}
}

const MINUTE = 60 * 1000;

export const elementChat = actor({
	options: {
		// Every turn is bounded by the shared 40-minute hard deadline in
		// runElementChatTurnStream (abort + watchdog release the lease), so
		// the action only needs headroom past that for persistence — not an
		// unbounded budget, or a hung model stream could wedge the actor
		// (mirrors the design chat actor).
		actionTimeout: 50 * MINUTE,
		sleepTimeout: 10 * MINUTE,
	},
	createConnState: async (c, params) => {
		const caller = await resolveCaller(c);
		const projectId = parseActorKey(c.key);
		// Element chats are an admin-only studio surface until a project
		// membership model is introduced; system callers bypass the HTTP
		// gateway by construction.
		if (caller.role !== "admin" && caller.role !== "system") {
			throw new UserError("forbidden", { code: "forbidden" });
		}
		const { elementChatConnParams } = await loadElementChatModule();
		const parsed = elementChatConnParams.safeParse(params);
		if (!parsed.success) {
			// The conversation is a connection property, not an action
			// argument: a connection without it can never be scoped.
			throw new UserError("connect with params: { elementChatId }", {
				code: "invalid_conn_params",
			});
		}
		await fenceConnParams(projectId, parsed.data.elementChatId);
		return { ...caller, elementChatId: parsed.data.elementChatId };
	},
	events: {
		uiMessageChunk: event<{ chunk: UIMessageChunk }>(),
		turnFinished: event<{ ok: true }>(),
		turnFailed: event<{ error: string }>(),
		// WS keepalive while a turn runs — clients never subscribe; the
		// frames only keep the conversation's connections hot during silent
		// stretches (model thinking, slow tool calls) so intermediaries do
		// not drop the idle WebSocket.
		heartbeat: event<{ at: number }>(),
	},
	actions: {
		sendMessage: async (
			c,
			body: {
				message: string;
				model?: string;
			},
		) => {
			const projectId = parseActorKey(c.key);
			// Server-derived conversation: connection params at connect, never
			// the message body.
			const elementChatId = (c.conn.state as ElementChatConnState)
				.elementChatId;
			const {
				ElementChatTurnConflictError,
				elementChatMessageInput,
				elementChatPublicError,
				runElementChatTurnStream,
			} = await loadElementChatModule();

			const parsed = elementChatMessageInput.safeParse(body);
			if (!parsed.success) {
				throw new UserError(parsed.error.issues[0]?.message ?? "invalid body", {
					code: "invalid_input",
				});
			}

			// Cheap re-check of the connect-time fence: the session may have
			// been deleted since the connection opened.
			const row = await getPrisma(env).elementChat.findUnique({
				where: { id: elementChatId },
				select: { projectId: true },
			});
			if (!row || row.projectId !== projectId) {
				throw new UserError("element chat session not found", {
					code: "not_found",
				});
			}

			// Conversation-scoped event routing: one actor hosts ALL of the
			// project's element chats, so events go only to connections whose
			// params put them in THIS conversation (genuinely shared state
			// of that one chat — every participant's stream is the stream).
			const sendToConversation = (name: string, payload: unknown) => {
				for (const conn of c.conns.values()) {
					const state = conn.state as ElementChatConnState | undefined;
					if (!state || state.elementChatId !== elementChatId) continue;
					try {
						(
							conn as unknown as {
								send: (name: string, payload: unknown) => void;
							}
						).send(name, payload);
					} catch {
						// Connection gone — the turn's persistence does not
						// depend on it.
					}
				}
			};
			// Failure/conflict events belong to the requesting connection
			// only: a concurrent send's conflict must never error another
			// participant's live stream.
			const sendToCaller = (name: string, payload: unknown) => {
				try {
					(
						c.conn as unknown as {
							send: (name: string, payload: unknown) => void;
						}
					).send(name, payload);
				} catch {
					// Connection gone — the turn keeps running server-side.
				}
			};

			c.setPreventSleep(true);
			// Keepalive frames to the conversation's connections for the
			// whole turn (see the heartbeat event).
			const heartbeat = setInterval(() => {
				sendToConversation("heartbeat", { at: Date.now() });
			}, 15_000);
			try {
				await runElementChatTurnStream(
					env,
					elementChatId,
					{
						message: parsed.data.message,
						model: parsed.data.model,
						// Deliberately NO abortSignal from the connection: the
						// turn must survive a WebSocket drop (idle connections
						// get killed during long silent stretches). The blocking
						// action keeps this Durable Object alive for the whole
						// turn — per the Cloudflare DO guidance, no waitUntil
						// is needed while the action is handling the request —
						// and the turn's own deadline watchdog is the backstop
						// (same discipline as the design and campaign actors).
					},
					(chunk) => {
						sendToConversation("uiMessageChunk", { chunk });
					},
				);
				sendToConversation("turnFinished", { ok: true });
				return { ok: true as const };
			} catch (error) {
				console.log("[element-chat-actor] turn failed:", error);
				// Public messages (deadline, conflict) pass through so the client
				// shows why; anything else redacts to the generic retryable error.
				const publicError = elementChatPublicError(error);
				if (error instanceof ElementChatTurnConflictError) {
					// A rejected concurrent send concerns only the sender.
					sendToCaller("turnFailed", { error: publicError });
				} else {
					// The conversation's running turn died — every
					// participant's stream must unstick, so this one IS shared.
					sendToConversation("turnFailed", { error: publicError });
				}
				throw new UserError(publicError, {
					code:
						error instanceof ElementChatTurnConflictError
							? "conflict"
							: "llm_error",
				});
			} finally {
				clearInterval(heartbeat);
				c.setPreventSleep(false);
			}
		},
	},
});
