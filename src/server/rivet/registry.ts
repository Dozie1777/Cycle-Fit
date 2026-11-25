import { setup } from "rivetkit";
import { campaignChat } from "./actors/campaign-chat/index";
import { chat, projectChat } from "./actors/chat/index";
import { designChat } from "./actors/design-chat/index";
import { elementChat } from "./actors/element-chat/index";
import { ping } from "./actors/ping";

// RivetKit actor registry for the code-review-bot worker. On Cloudflare
// Workers every actor is fronted by the `ActorHandler` Durable Object that
// `createHandler(registry, …)` in src/server.ts returns and the worker entry
// exports (bound as ACTOR_DO in wrangler.jsonc, alongside the ACTOR_KV
// namespace rivetkit uses for global actor metadata).
export const registry = setup({
	use: {
		ping,
		chat,
		projectChat,
		designChat,
		campaignChat,
		elementChat,
	},
});

export type Registry = typeof registry;
