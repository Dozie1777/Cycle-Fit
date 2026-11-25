// Secrets/vars not declared in wrangler.jsonc are absent from the generated
// worker-configuration.d.ts, so augment the global Env interface here.
interface Env {
	/** Kimi Code API key — set via `wrangler secret put KIMI_API_KEY` (prod) or `.dev.vars` (local). Used by design sessions, interactive terminal sessions, and sandboxed PR review runs (as KIMI_MODEL_API_KEY). */
	KIMI_API_KEY?: string;
	/** Optional overrides; must match the platform the key was issued on — see .dev.vars.example. */
	KIMI_MODEL_NAME?: string;
	KIMI_MODEL_PROVIDER_TYPE?: string;
	KIMI_MODEL_BASE_URL?: string;
	/** Review-model overrides — sandboxed PR review checks only (lib/review.ts). Defaults live in wrangler.jsonc. */
	REVIEW_KIMI_MODEL_NAME?: string;
	REVIEW_KIMI_THINKING_EFFORT?: string;
	/** GitHub App installation ID — used to mint installation tokens for the sandbox. */
	INSTALLATION_ID?: string;
	/** Shared secret guarding the /github-token mint endpoint (injected into sandbox env). */
	TOKEN_REFRESH_SECRET?: string;
	/** JSON map of key version -> base64-encoded 32-byte AES-256 master key: {"1":"...","2":"..."}. */
	AGENT_CRED_MASTER_KEYS?: string;
	/** Integer (as string) — key version used for new writes; must exist in AGENT_CRED_MASTER_KEYS. */
	AGENT_CRED_MASTER_KEY_CURRENT?: string;
	/** Optional GitHub API endpoint for GitHub Enterprise or local integration tests. */
	GITHUB_API_BASE_URL?: string;
	/** Better Auth base URL — overrides dynamic host detection. */
	BETTER_AUTH_URL?: string;
	/** Better Auth secret for signing sessions. */
	BETTER_AUTH_SECRET?: string;
	/** R2 API token (Object Read & Write, scoped to the designs bucket) — signs presigned design upload URLs; the agent never sees these. */
	S3_ACCESS_KEY_ID?: string;
	S3_SECRET_ACCESS_KEY?: string;
	/** Name of the R2 bucket the S3 token is scoped to — the presigned-PUT target for design uploads. Must match the bucket the `DESIGNS` binding serves from. */
	S3_BUCKET?: string;
	/** Cloudflare account id (semi-public; also in CI) — derives the R2 S3 endpoint for presigned URLs. */
	CLOUDFLARE_ACCOUNT_ID?: string;
	/** Shared bearer token guarding the /browser-mcp endpoint (Playwright MCP server). The design chat route (same worker) passes it on its self-call; sandbox opencode configs carry it too. Set via `wrangler secret put BROWSER_MCP_TOKEN`. */
	BROWSER_MCP_TOKEN?: string;
	/** Integer ms — hard deadline for a design chat turn (default 2400000 = 40 min). Test override; see lib/design-chat.ts. */
	DESIGN_CHAT_TURN_TIMEOUT_MS?: string;
	/** Integer ms — browser-MCP connect deadline for design chat turns (default 30000). Test override; see lib/design-chat.ts. */
	DESIGN_CHAT_MCP_CONNECT_TIMEOUT_MS?: string;
	/** Integer ms — hard deadline for a campaign chat turn (default 2400000 = 40 min). Test override; see lib/campaign-chat.ts. */
	CAMPAIGN_CHAT_TURN_TIMEOUT_MS?: string;
	/** Integer ms — hard deadline for an element chat turn (default 2400000 = 40 min). Test override; see lib/element-chat.ts. */
	ELEMENT_CHAT_TURN_TIMEOUT_MS?: string;
	/** Integer ms — browser-MCP connect deadline for campaign chat turns (default 30000). Test override; see lib/campaign-chat.ts. */
	CAMPAIGN_CHAT_MCP_CONNECT_TIMEOUT_MS?: string;
	/** Optional GitHub personal access token for the skills GitHub import (raises api.github.com's 60/hr unauthenticated limit). Set via `wrangler secret put SKILL_IMPORT_GITHUB_TOKEN` or `.dev.vars`. Only public repos are read. */
	SKILL_IMPORT_GITHUB_TOKEN?: string;
}

// `import { env } from "cloudflare:workers"` is typed as Cloudflare.Env, a
// separate interface from the global Env above. worker-configuration.d.ts
// already covers the wrangler vars/.dev.vars.example entries; only augment
// what that file cannot know about, or optional duplicates would weaken the
// required types (e.g. BROWSER_MCP_TOKEN: string -> string | undefined).
declare namespace Cloudflare {
	interface Env {
		/** Optional GitHub API endpoint for GitHub Enterprise or local integration tests. */
		GITHUB_API_BASE_URL?: string;
		/** Better Auth base URL — overrides dynamic host detection. */
		BETTER_AUTH_URL?: string;
		/** Integer ms — hard deadline for a design chat turn (default 2400000 = 40 min). Test override; see lib/design-chat.ts. */
		DESIGN_CHAT_TURN_TIMEOUT_MS?: string;
		/** Integer ms — browser-MCP connect deadline for design chat turns (default 30000). Test override; see lib/design-chat.ts. */
		DESIGN_CHAT_MCP_CONNECT_TIMEOUT_MS?: string;
		/** Integer ms — hard deadline for a campaign chat turn (default 2400000 = 40 min). Test override; see lib/campaign-chat.ts. */
		CAMPAIGN_CHAT_TURN_TIMEOUT_MS?: string;
		/** Integer ms — browser-MCP connect deadline for campaign chat turns (default 30000). Test override; see lib/campaign-chat.ts. */
		CAMPAIGN_CHAT_MCP_CONNECT_TIMEOUT_MS?: string;
		/** Integer ms — hard deadline for an element chat turn (default 2400000 = 40 min). Test override; see lib/element-chat.ts. */
		ELEMENT_CHAT_TURN_TIMEOUT_MS?: string;
	}
}
