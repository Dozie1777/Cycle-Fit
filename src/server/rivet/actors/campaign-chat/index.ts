import { env } from "cloudflare:workers";
import type { UIMessageChunk } from "ai";
import { actor, event, UserError } from "rivetkit";
import { getAuth } from "@/lib/auth";

export type CampaignChatConnState = {
	userId: string;
	role: "user" | "admin" | "agent" | "system" | null;
	/**
	 * The origin the connection came in on: the real worker origin for
	 * gateway connections, RivetKit's synthetic `http://actor` for in-worker
	 * inline calls. Derived server-side (never trusted from the client) —
	 * browser-MCP requests carry the BROWSER_MCP_TOKEN, so the base URL must
	 * not be client-controlled.
	 */
	origin: string;
};

// Loaded lazily (see loadCampaignChatModule) so the worker entry does not
// eagerly pull in @/lib/campaign-chat — the AI-provider import it carries
// must stay out of the boot graph or workerd/Vitest mocks never apply
// (same discipline as the design chat actor, see 0da6953bf).
let campaignChatModule:
	| typeof import("@/features/campaigns/chat/campaign-chat")
	| undefined;
async function loadCampaignChatModule() {
	if (!campaignChatModule) {
		campaignChatModule = await import(
			"@/features/campaigns/chat/campaign-chat"
		);
	}
	return campaignChatModule;
}

async function resolveCaller(c: {
	request: Request | undefined;
}): Promise<CampaignChatConnState> {
	if (c.request === undefined) {
		throw new UserError("unauthorized", { code: "unauthorized" });
	}
	// Inline/system callers (createInlineClient inside this worker — the test
	// harness today, future server-side orchestration) dispatch through the
	// ACTOR_DO binding with the framework's synthetic `http://actor` origin
	// and no credentials. The actor DO is only reachable from in-worker code
	// (the /rivet gateway is session-gated in src/server.ts and always
	// forwards the real browser origin), so that origin is a trusted
	// system-caller marker — same shape as booking-session's isServerCall arm.
	if (new URL(c.request.url).origin === "http://actor") {
		return { userId: "system", role: "system", origin: "http://actor" };
	}

	const session = await getAuth(env).api.getSession({
		headers: c.request.headers,
	});
	if (!session) {
		throw new UserError("unauthorized", { code: "unauthorized" });
	}

	return {
		userId: session.user.id,
		role: (session.user.role as CampaignChatConnState["role"]) ?? null,
		origin: new URL(c.request.url).origin,
	};
}

function parseActorKey(key: string[]): string {
	if (key.length !== 2 || key[0] !== "campaign") {
		throw new UserError("invalid campaign actor key", {
			code: "invalid_actor_key",
		});
	}
	return key[1];
}

const MINUTE = 60 * 1000;

export const campaignChat = actor({
	options: {
		// Campaign turns can stream a long tool loop (browser MCP research,
		// document writes) under the 40-minute turn deadline in
		// @/lib/campaign-chat. Give the action a 1-hour wall-clock budget so
		// Rivet does not time out mid-turn (mirrors the design chat actor).
		actionTimeout: 60 * MINUTE,
		sleepTimeout: 10 * MINUTE,
	},
	createConnState: async (c) => {
		const caller = await resolveCaller(c);
		parseActorKey(c.key);
		// Campaign studio chat is admin-only (the studio routes sit under
		// admin/_authenticated); system callers bypass the HTTP gateway by
		// construction. The key is checked only for shape here.
		if (caller.role !== "admin" && caller.role !== "system") {
			throw new UserError("forbidden", { code: "forbidden" });
		}
		return caller;
	},
	events: {
		uiMessageChunk: event<{ chunk: UIMessageChunk }>(),
		turnFinished: event<{ ok: true }>(),
		turnFailed: event<{ error: string }>(),
		// WS keepalive while a turn runs — clients never subscribe; the
		// frames only keep the sending connection hot during silent
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
				thinkingEffort?: string;
			},
		) => {
			const campaignId = parseActorKey(c.key);

			const {
				CampaignChatTurnConflictError,
				campaignChatPublicError,
				campaignChatTurnInput,
				isCampaignId,
				runCampaignChatTurnStream,
			} = await loadCampaignChatModule();

			if (!isCampaignId(campaignId)) {
				throw new UserError("invalid campaign id", {
					code: "invalid_actor_key",
				});
			}

			const parsed = campaignChatTurnInput.safeParse(body);
			if (!parsed.success) {
				throw new UserError(parsed.error.issues[0]?.message ?? "invalid body", {
					code: "invalid_input",
				});
			}

			// The origin rides the connection state — captured server-side from
			// the gateway request at connect time, never from the client body
			// (a client-supplied origin could aim the BROWSER_MCP_TOKEN at an
			// external host). Inline system calls carry the synthetic origin.
			const origin =
				(c.conn.state as CampaignChatConnState | undefined)?.origin ??
				"http://actor";

			// Capture the connection before the await boundary: turn events go
			// to THIS connection only (same discipline as the streams actor's
			// tutor reply) — a room broadcast would deliver a concurrent send's
			// conflict `turnFailed` to the healthy turn's live stream and kill
			// its transport mid-response. Sends are guarded: a client that
			// disconnects mid-turn must not fail the turn (it keeps running and
			// persists server-side).
			const conn = c.conn;
			const send = (event: string, payload: unknown) => {
				try {
					(
						conn as unknown as {
							send: (name: string, payload: unknown) => void;
						}
					).send(event, payload);
				} catch {
					// Connection gone — the turn's persistence does not depend on it.
				}
			};

			c.setPreventSleep(true);
			// Keepalive frames to the requesting connection for the whole
			// turn (see the heartbeat event).
			const heartbeat = setInterval(() => {
				send("heartbeat", { at: Date.now() });
			}, 15_000);
			try {
				await runCampaignChatTurnStream(
					env,
					campaignId,
					{
						message: parsed.data.message,
						model: parsed.data.model,
						thinkingEffort: parsed.data.thinkingEffort,
						origin,
					},
					(chunk) => {
						send("uiMessageChunk", { chunk });
					},
				);
				send("turnFinished", { ok: true });
				return { ok: true as const };
			} catch (error) {
				console.log("[campaign-chat-actor] turn failed:", error);
				// Public messages (deadline, conflict) pass through so the
				// client shows why; anything else redacts to the generic
				// retryable error.
				const publicError = campaignChatPublicError(error);
				send("turnFailed", { error: publicError });
				throw new UserError(publicError, {
					code:
						error instanceof CampaignChatTurnConflictError
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
