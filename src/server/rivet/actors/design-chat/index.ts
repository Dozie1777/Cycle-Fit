import { env } from "cloudflare:workers";
import type { UIMessageChunk } from "ai";
import { actor, event, UserError } from "rivetkit";
import { isDesignId } from "@/features/design-studio/assets/design-files";
import { getAuth } from "@/lib/auth";
import { resolveChatAssets } from "@/server/data/design-assets";

export type DesignChatConnState = {
	userId: string;
	role: "user" | "admin" | "agent" | null;
};

// Loaded lazily so the worker entry does not eagerly pull in @/lib/design-chat
// before workerd/Vitest mocks (e.g. workers-ai-provider) are installed. The
// actor DO will resolve this once per activation when sendMessage runs.
let designChatModule:
	| typeof import("@/features/design-studio/chat/design-chat")
	| undefined;
async function loadDesignChatModule() {
	if (!designChatModule) {
		designChatModule = await import(
			"@/features/design-studio/chat/design-chat"
		);
	}
	return designChatModule;
}

async function resolveCaller(c: {
	request: Request | undefined;
}): Promise<DesignChatConnState> {
	if (!c.request) {
		throw new UserError("unauthorized", { code: "unauthorized" });
	}

	const session = await getAuth(env).api.getSession({
		headers: c.request.headers,
	});
	if (!session) {
		throw new UserError("unauthorized", { code: "unauthorized" });
	}

	return {
		userId: session.user.id,
		role: (session.user.role as DesignChatConnState["role"]) ?? null,
	};
}

function parseActorKey(key: string[]): string {
	if (key.length !== 2 || key[0] !== "design") {
		throw new UserError("invalid design actor key", {
			code: "invalid_actor_key",
		});
	}
	return key[1];
}

const MINUTE = 60 * 1000;

export const designChat = actor({
	options: {
		// Every turn is bounded by the 40-minute hard deadline in
		// runDesignChatTurnStream (abort + watchdog release the lease), so the
		// action only needs headroom past that for persistence and MCP
		// teardown — not an unbounded budget, or a hung model stream or tool
		// could wedge the actor indefinitely.
		actionTimeout: 50 * MINUTE,
		sleepTimeout: 10 * MINUTE,
	},
	createConnState: async (c) => {
		const caller = await resolveCaller(c);
		parseActorKey(c.key);
		// Design studio chat is admin-only until a project membership model is
		// introduced. The key is checked only for shape here.
		if (caller.role !== "admin") {
			throw new UserError("forbidden", { code: "forbidden" });
		}
		return caller;
	},
	events: {
		uiMessageChunk: event<{ chunk: UIMessageChunk }>(),
		turnFinished: event<{ ok: true }>(),
		turnFailed: event<{ error: string }>(),
		// WS keepalive, broadcast on an interval while a turn runs: during
		// long silent stretches (model thinking, a slow browser tool call)
		// no chunks flow, and an idle WebSocket gets dropped by
		// intermediaries — which used to abort the whole turn via
		// c.abortSignal. Clients never subscribe to this event; the frames
		// only exist to keep the connection hot.
		heartbeat: event<{ at: number }>(),
	},
	actions: {
		sendMessage: async (
			c,
			body: {
				message: string;
				section?: string;
				model?: string;
				assets?: string[];
				origin?: string;
			},
		) => {
			const projectId = parseActorKey(c.key);
			if (!isDesignId(projectId)) {
				throw new UserError("invalid design project id", {
					code: "invalid_actor_key",
				});
			}

			const origin = body.origin ?? "http://localhost";

			let assets: import("@/features/design-studio/assets/design-assets").AssetRef[] =
				[];
			if (body.assets && body.assets.length > 0) {
				const resolved = await resolveChatAssets(
					env,
					projectId,
					body.assets,
					origin,
					(c.state as DesignChatConnState).userId,
				);
				if (!resolved.ok) {
					throw new UserError(resolved.error, { code: "invalid_assets" });
				}
				assets = resolved.assets;
			}

			const { runDesignChatTurnStream, designChatPublicError } =
				await loadDesignChatModule();

			c.setPreventSleep(true);
			// Keepalive frames for the whole turn (see the heartbeat event).
			const heartbeat = setInterval(() => {
				try {
					c.broadcast("heartbeat", { at: Date.now() });
				} catch {
					// No live connections — the turn must keep running
					// server-side regardless.
				}
			}, 15_000);
			try {
				await runDesignChatTurnStream(
					env,
					projectId,
					{
						message: body.message,
						section: body.section,
						model: body.model,
						assets,
						origin,
						// Deliberately NO abortSignal from the connection: the
						// turn must survive a WebSocket drop (idle connections
						// get killed during long silent stretches). The blocking
						// action keeps this Durable Object alive for the whole
						// turn — per the Cloudflare DO guidance, no waitUntil is
						// needed while the action is handling the request — and
						// the 40-minute deadline watchdog inside
						// runDesignChatTurnStream is the backstop. A disconnected
						// client recovers through the studio's live status poll.
					},
					(chunk) => {
						c.broadcast("uiMessageChunk", { chunk });
					},
				);
				c.broadcast("turnFinished", { ok: true });
				return { ok: true as const };
			} catch (error) {
				console.log("[design-chat-actor] turn failed:", error);
				// Public messages (deadline, conflict) pass through so the client
				// shows why; anything else redacts to the generic retryable error.
				const publicError = designChatPublicError(error);
				c.broadcast("turnFailed", { error: publicError });
				throw new UserError(publicError, {
					code: "llm_error",
				});
			} finally {
				clearInterval(heartbeat);
				c.setPreventSleep(false);
			}
		},
	},
});
