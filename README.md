# Cycle-Fit
Git timeline study with simulated commit dates and author attribution.

# code-review-bot

One Cloudflare Worker package containing a TanStack Start admin application, GitHub App webhook handling, sandboxed pull-request reviews, a design studio, campaign planning workspaces, and Browser/terminal operator tools.

## Architecture

- **TanStack Start + React 19** serves the admin UI from physical folder routes in `src/routes/` (no dot-notation files; a pathless `/_authenticated` layout guards the console).
- **A custom Worker entry** (`src/server.ts`) exports the Sandbox, Playwright MCP, and RivetKit `ActorHandler` Durable Objects and dispatches transports that must bypass Start: `POST /api/webhook`, `/designs/mcp`, `/browser-mcp`, the `/terminal` WebSocket, `/rivet` actor manager, and public component bundles under `/projects/:id/components/:componentId/:file`. Everything else goes through Start. Unknown API paths return JSON rather than an HTML 404.
- **tRPC 11** carries the admin JSON CRUD surface at `/api/trpc` (domain routers in `src/server/trpc/routers/`, typed client in `src/client/trpc.ts`, TanStack Query hooks in `src/client/queries.ts`); streams, file serving, multipart uploads, and the sandbox capabilities stay as plain Start routes.
- **Feature modules** (`src/features/<domain>/`) own both their domain logic and UI, with colocated tests; server-side data access lives in `src/server/data/`; the browser data layer lives in `src/client/`; only cross-domain infrastructure primitives remain in `src/lib/`. See the folder-structure conventions in `AGENTS.md`.
- **Prisma 7 + D1** (driver adapter; CLI config in `prisma.config.ts` — `DATABASE_URL` in `.env` is generation-only) stores users, agents, design projects/messages, campaigns and their structured documents, and review-attempt state.
- **R2** stores review workspaces and versioned design output; **Workers AI** runs design chat; **Browser Rendering** renders previews and backs the Playwright MCP server.
- **Cloudflare Sandbox containers** run reviews and interactive shells. The worker is deployed from the generated Start artifact, not from a separate UI build.

The package requires **Node 22.12 through 24.x** and pnpm 10. This is a standalone repository — run all commands from the repository root.

## Review flow

1. `POST /api/webhook` verifies the GitHub signature and creates a Code Review check run for an associated pull request.
2. The worker claims the attempt in D1, clones the PR head into an isolated Sandbox, and runs the `github-pr-check-review` skill with `kimi -p`. The review model is pinned by the worker (`REVIEW_KIMI_MODEL_NAME`, default `kimi-k3.1-pro-highspeed` at low thinking effort) and passed to the Kimi CLI via the `KIMI_MODEL_*` env family.
3. A sandbox `gh` wrapper fences GitHub writes through the worker. The skill submits check-run completion, annotations, and a verdict-only PR review. The check run is the full report surface.
4. The rescue script completes a stranded check run as a failure when review processing dies without submitting. Startup failures before a sandbox review begins are completed by the worker.

### Internal attempt and submission routes

These are sandbox-to-worker capabilities, not admin UI endpoints:

| Route | Operator purpose |
|-------|------------------|
| `POST /api/review-attempt` | Checks that a review attempt credential is valid and whether that attempt is still current. Returns 204 for current, 409 for superseded, and 401 for invalid credentials. |
| `POST /api/review-submission` | After the same credential and current-attempt checks, permits only the fenced check-run/annotation or PR-review submission shapes and forwards the write with the configured installation identity. |

Each attempt receives a high-entropy Bearer secret. Only its hash is stored in D1; attempt IDs, sandbox IDs, and delivery IDs are not credentials. A newer attempt supersedes stale writers. Secrets must not appear in logs, tickets, or command output.

## Admin UI and HTTP surface

- `/login` — Better Auth email/password login; sign-up is disabled in production.
- `/projects/designs` — create and list designs.
- `/studio/<id>` — converse, inspect proposals, publish, and manage design output.
- `/campaigns` — campaigns dashboard home: campaign list with counts and latest report titles.
- `/campaigns/<id>` — campaign control tower: overview plus a switch into the studio workspace (planning chat with brief/plan/calendar/report panels).
- `/campaigns/<id>/present` — present runner for a campaign's presentation assets.
- Project pages (`/projects`, `/projects/<id>`) carry a **Campaigns** tab listing and creating the project's campaigns.
- `/agents` — create agent identities and register, rotate, enable, or disable verified GitHub App credentials.
- `/admins` — create and list administrators.
- `/` — redirect to `/projects/designs`; `/designs` — legacy redirect to `/projects/designs`.
- `/share/<id>` — public-by-id published design view with sandboxed HTML.
- `/share/campaign/<slug>` — public campaign share page reached only through a revocable slug (see API routes below); reports and KPIs are hidden unless the campaign opts in via `includeReports`, and published campaign assets embed live as sandboxed iframes.

Admin JSON CRUD lives on **tRPC** at `/api/trpc` (batched HTTP, `src/server/trpc/` — routers per domain: `agents`, `admins`, `channels`, `skills`, `designs`, `projects`, `campaigns`, and the public `share`). The typed client lives in `src/client/trpc.ts` and is consumed through the TanStack Query hooks in `src/client/queries.ts`.

| Route | Purpose |
|-------|---------|
| `/api/trpc` | Admin-session tRPC endpoint: agent/admin management, design CRUD + assets + versions + messages, component library, page composer, brand kits, projects, campaigns (documents/KPIs/share/events), channels, skills |
| `/api/auth/*` | Better Auth session endpoints |
| `POST /api/webhook` | Signed GitHub App webhook receiver (handled in the Worker entry) |
| `/designs/:id/chat` | Workers AI design conversation with interactive tools |
| `/designs/:id/upload-url`, `/designs/mcp` | Per-project agent-token upload capability |
| `/designs/:id/site`, `/preview`, `/file/*` | Public-by-id authored files with a CSP sandbox |
| `/designs/:id/assets` | Multipart asset upload (the one admin write outside tRPC) |
| `/rivet` | RivetKit actor manager gateway (`src/server/rivet/`): actor actions, events, and raw WebSocket upgrades through the `ActorHandler` Durable Object (`ACTOR_DO` + `ACTOR_KV` bindings). Requires an authenticated Better Auth session — anonymous requests get 401; in-worker system callers bypass HTTP via `createInlineClient` → `ACTOR_DO` |
| `campaignChat` actor | Campaign planning chat (Workers AI + browser research + document/asset tools), driven over the `/rivet` gateway like the design chat; one shared `Message` model backs design and campaign chat |
| `/share/campaign/:slug` | Public campaign share page resolution (no session; 404s on missing/revoked/rotated slugs) |
| `/browser-mcp` | Bearer-authenticated Playwright MCP endpoint |
| `/ui`, `/terminal` | xterm.js page and its Sandbox WebSocket; named sessions can be created with `?session=<id>&create=1` and reattached with `?session=<id>` |
| `/process-logs` | Sandbox process-log streaming |
| `/github-token` | Shared-secret installation-token refresh used inside sandbox sessions |

The admin session is an httpOnly Better Auth cookie on the same Worker origin. Non-admin sessions cannot use management APIs.

## Design studio

`POST /designs` (tRPC `designs.create`) creates a random project ID and per-project upload token in D1. Opening `/studio/<id>` starts the brief in design chat. Workers AI can ask interactive questions, publish drafts/proposals to R2, use Browser MCP tools, and publish complete self-contained HTML after user approval.

Publishing writes `index.html`, a Browser Rendering screenshot, design tokens, and an append-only `versions/<n>/` snapshot. Tweaks create new versions; restoring an older snapshot also creates a new version rather than rewriting history. Agent uploads use a per-project token and a 15-minute presigned R2 PUT URL, never the account R2 API credentials. Public HTML uses a CSP sandbox so it cannot access the admin origin.

## Campaigns

Campaigns are structured planning containers filed under a project. `campaigns.create` creates one (filed under the given project; the legacy `POST /projects/:id/campaigns` path was the same operation); the control tower at `/campaigns/<id>` hosts a planning chat where Workers AI researches with the Playwright MCP server's browser tools, asks `ask_user` questions, and writes the campaign's structured documents through fenced tools: `save_brief`/`update_brief`, `save_plan`/`add_phase`/`update_phase`, `add_event`/`update_event`/`remove_event` (calendar), `save_report`, plus `list_assets`/`create_asset` and the pick-only `list_channels` enumeration (see Channels below). Document and asset tools fence every id to the campaign — cross-campaign writes return 4xx, and each chat turn is leased so only one turn is active at a time (concurrent starts surface the conflict text through `turnFailed`; recovery via lease expiry). Chat streams through the `campaignChat` RivetKit actor (`src/server/rivet/actors/campaign-chat/`, KUK-874): the client connects via the `/rivet` gateway and receives `uiMessageChunk`/`turnFinished`/`turnFailed` events instead of an SSE response.

**Target audiences** are per-campaign structured segmentation rows (`TargetAudience`: name, demographics, psychographics, buying stage, freeform notes; a campaign can hold several). The agent manages them through fenced tools — `list_audiences` / `create_audience` / `update_audience` / `remove_audience` — and the studio brief panel embeds an audiences editor (same pattern as the KPI editor). The legacy free-text `CampaignBrief.audience` markdown column is deprecated: no surface writes it, there is no backfill (existing markdown is left untouched), and the admin studio keeps rendering it as a gray legacy block while the share page and asset-seeding context prefer the structured rows and fall back to the legacy markdown when none exist.

`create_asset` seeds a Design in the campaign's project with distilled campaign context, and `list_assets` lists them. A presentation-flavored seed (`deck`/`slides`/`presentation`/`one-pager`/`pitch`) additionally carries a one-file-HTML-deck presentation contract so the seeded asset publishes as a deck. Seeded assets can attach to calendar events; deleting the campaign detaches them (SetNull) rather than deleting the designs.

Sharing is slug-based and revocable, unlike the design share's public-by-uuid link: POST generates a base58 slug (idempotent), PATCH rotates it (old links 404 immediately) and/or toggles `includeReports`, and DELETE revokes it. The public page at `/share/campaign/<slug>` renders the campaign snapshot without a session and hides report titles, summaries, metrics, and bodies unless `includeReports` is opted in; published campaign assets embed as sandboxed live iframes.

### Channels (KUK-890)

Channels are a global, admin-owned enumeration (`Channel`) that links campaigns (`CampaignChannel` M:N — the brief's channel mix) and calendar events (`CalendarEvent.channelId`). Agents pick from it with the cheap `list_channels` tool and link by id through `add_event`/`update_event` (`channelId`, unknown ids get a recoverable error listing the available names) and `save_brief`/`update_brief` (`channelIds` — atomically replaces the campaign's channel set in one D1 batch); they can never create, rename, or delete channels. Admins own the data: the `channels` tRPC router (`channels.create` — name + optional color, case-insensitive unique → CONFLICT on duplicate; `channels.update` — rename/recolor, same uniqueness rule), surfaced in the studio as a compact manage-channels dialog reachable from the calendar/brief channel selects. Migration `0017_channel_links` seeds the standard channels idempotently (Email, X, LinkedIn, Instagram, TikTok, YouTube, Blog/SEO, Paid ads, PR/Outreach, Events, Webinar, Podcast, Landing page, Community) with deterministic `chan-<slug>` ids and backfills every distinct legacy `CalendarEvent.channel` string into a linked channel while keeping the legacy text. The legacy free-text `CalendarEvent.channel` and `CampaignBrief.channels` columns are deprecated and no longer written by any surface; unmigrated rows render gray as legacy fallbacks in the calendar, brief, and dashboard swimlanes (grouped by linked channel name, falling back to legacy text).

### Skills (KUK-891)

Skills are a global, admin-owned library (`Skill`) of markdown playbooks the campaign planning agent can load. The chat system prompt carries every enabled skill's name, `/slug` and one-line description each turn; the full content is returned only when the agent calls `load_skill` (unknown or disabled slugs get a recoverable error). Users invoke skills by typing `/` in the studio prompt — a suggestion menu lists the enabled skills and inserts the `/slug ` invocation, which the pipeline resolves server-side and injects into that turn's model context while the persisted message keeps exactly what was typed. Admins own the data: the `skills` tRPC router (`skills.list/create/update/delete`; case-insensitive slug uniqueness → CONFLICT; builtin skills cannot be deleted, only disabled), surfaced in a compact manage-skills dialog reachable from the studio chat footer. Migration `0018_studio_skills` seeds four builtin playbooks idempotently with deterministic `skill-<slug>` ids: `campaign-basics` (a studio tour + worked brief→plan→calendar→deck example), `draft-a-brief`, `launch-plan`, and `content-calendar`.

### Known limitations

- If the agent rewrites the brief mid-chat while an admin has unsaved edits in the brief panel, the panel remounts and those unsaved edits are discarded.
- A report hand-editing hook exists on the backend but has no panel affordance in the studio UI.
- `test:workers` runs locally but is not wired into CI (CI runs the unit/contract project and E2E only).

## Local development

1. Install with the frozen workspace lockfile:

   ```bash
   pnpm install --frozen-lockfile
   ```

2. Create local secrets and fill every value required by the flows you will run:

   ```bash
   cp .dev.vars.example .dev.vars
   ```

   `.dev.vars` is gitignored. Never commit it or print its contents. Production values are managed with Wrangler secrets. See the example file for Kimi, GitHub App, Better Auth, credential-encryption, R2 S3, and Browser MCP settings.

3. Apply local migrations and start the one-package Start dev server:

   ```bash
   pnpm db:migrate-local
   pnpm dev
   ```

   `dev` runs Prisma generation and Vite; a separate UI server or build is not used. Docker is required for real local Sandbox containers. Browser Rendering is remote in local development, and Workers AI always uses the remote service.

4. Bootstrap the first local admin through `/api/auth/sign-up/email`, then promote that test account in local D1:

   ```bash
   pnpm exec wrangler d1 execute DB --local \
     --command "UPDATE user SET role = 'admin' WHERE email = 'you@example.com'"
   ```

   Additional admins can be created from `/admins`. Agent credential registration verifies the private key, installation, repository access, and declared permission envelope against GitHub; plaintext keys are never returned.

## Verification

Unit and workerd integration tests run without Chromium or live service credentials. The unit project includes React route/router tests plus build-artifact and deployment-workflow contract tests; the workers project exercises the Worker in workerd with local D1 migrations and test bindings.

```bash
pnpm test
pnpm exec vitest run --project unit test/router.test.ts test/routes.test.tsx
pnpm test:workers
pnpm typecheck
pnpm build
pnpm verify:build
pnpm cf-typegen
pnpm exec wrangler deploy --dry-run --config dist/server/wrangler.json
```

`test` covers component behavior, routes, build-artifact safety, and CI/deployment contracts. `test:workers` covers API, authentication, review, MCP, terminal, and Durable Object behavior in the Worker runtime. Build verification audits the actual generated client and Worker artifacts for forbidden modules, leaked secrets, asset integrity, and size limits.

## D1 migrations

Apply migrations in filename order with Wrangler; do not hand-edit applied migrations:

```bash
pnpm db:migrate-local
# Only during an authorized deployment:
pnpm db:migrate-remote
```

Recent migrations are additive:

- `0006_review_claims` — repository/head and delivery claim ownership.
- `0007_review_claim_leases` — recovery leases and delivery-claim state.
- `0008_review_launch_states` — creating/launch process state for recovery.
- `0009_review_attempt_secrets` — hashes for per-attempt Bearer credentials; plaintext attempt secrets are not stored.
- `0010_design_chat_turn_lease` — per-project chat turn leases (one active turn; 409/recovery).
- `0011_design_live_turn_pointer` — live turn pointer for streaming state.
- `0012_design_remix_fork_marker` — remix/fork provenance marker.
- `0013_design_project_hierarchy` — DesignProject renamed to Design; project hierarchy groundwork.
- `0014_design_assets` — project asset library with per-design asset links; `Message` gains an attachments column.
- `0015_message_unify` — DesignMessage renamed to a shared `Message` with `designId`/`campaignId` ownership; one message table backs design and campaign chat.
- `0016_campaign_documents` — `Campaign` container plus structured documents (brief, plans/phases, calendar events, reports); `Message` is rebuilt with a CHECK constraint enforcing exactly-one design-or-campaign ownership; project delete cascades campaigns, campaign delete detaches attached designs (SetNull) and cascades documents.
- `0017_channel_links` — global `Channel` enumeration + `CampaignChannel` join (brief channel mix) + `CalendarEvent.channelId` (SetNull); idempotent standard-channel seed and data-preserving legacy backfill (deterministic `chan-<slug>` ids); legacy channel text columns kept, deprecated.
- `0024_target_audiences` — per-campaign `TargetAudience` segmentation rows; the deprecated `CampaignBrief.audience` markdown is deliberately NOT backfilled (kept for legacy display only).
- `0025_element_chats` — `ElementChat` session row (per-element design chats: lease + context prompt, unique per project+element) and `Message.elementId` third ownership arm; the exactly-one CHECK widens from {designId, campaignId} to {designId, campaignId, elementId} via the 0016 table-copy pattern, rows copied unchanged.

The deployment workflow builds once, audits that artifact, applies remote migrations, then deploys the same generated artifact. Keep that order: code that requires a new column must not serve before its additive migration succeeds.

## Deploy, dry-run, and rollback

```bash
pnpm deploy
# Equivalent validation without deploying:
pnpm exec wrangler deploy --dry-run --config dist/server/wrangler.json
```

`deploy` runs the single Start build and deploys `dist/server/wrangler.json`. Do not deploy `src/server.ts` with a separate hand-maintained UI artifact.

Rollback switches the Worker version only; it does not require or permit deleting Durable Objects, D1, or R2 data:

```bash
pnpm exec wrangler versions list --config dist/server/wrangler.json
pnpm exec wrangler rollback <VERSION_ID> --config dist/server/wrangler.json
```

Before rolling back across a schema change, confirm the old Worker is compatible with the additive schema. Roll forward with a new additive migration/code version when it is not. Never delete Durable Object classes, namespaces, databases, buckets, or review data as a rollback shortcut.
