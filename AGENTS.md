# code-review-bot — Agent Guide

This repository is the standalone code-review-bot application (extracted from the Kukuana/Timbuktu monorepo, November 2026). It is a **TanStack Start + React 19** app packaged as one **Cloudflare Worker**: GitHub App webhook handling, sandboxed pull-request reviews, a design studio, campaign planning workspaces, and browser/terminal operator tools.

## Technology

- **TanStack Start + React 19** in one Cloudflare Worker package; admin routes live under pathless authenticated layouts (no `/admin` URL prefix); the studio is `/studio/<id>`
- **Prisma 7 + D1** (driver adapter; CLI config in `prisma.config.ts`), **R2**, **Workers AI**, **Browser Rendering**, and **Cloudflare Sandbox** containers/Durable Objects
- **RivetKit** 2.2.1 (patched — see `patches/`) for actor-backed chat (`/rivet` gateway)
- **Better Auth** admin sessions, per-attempt review recovery credentials, fenced internal review submission routes
- **tRPC 11** admin CRUD at `/api/trpc`
- **Biome 2.4.16** for lint/format (`biome.jsonc`), **Vitest 5** (unit + workerd projects), **Wrangler 4.x**

Node **22.12–24.x**, pnpm **10.0.0** (`packageManager` is pinned in `package.json`).

## Commands

```bash
pnpm install --frozen-lockfile
pnpm dev                # Prisma generate + Vite dev
pnpm test               # unit/artifact/workflow-contract tests
pnpm test:workers       # workerd integration tests (slow; not in CI)
pnpm typecheck          # prisma generate + tsc --noEmit
pnpm build              # one Start client + Worker build
pnpm verify:build       # audit the generated production artifact
pnpm cf-typegen         # regenerate worker-configuration.d.ts
pnpm db:migrate-local   # apply D1 migrations locally
pnpm db:migrate-remote  # remote D1 migrations — authorized deploys only
pnpm deploy             # build + wrangler deploy --config dist/server/wrangler.json
pnpm lint / pnpm format
```

Deployment order is build → `verify:build` → remote D1 migrations → deploy the generated `dist/server/wrangler.json`. Roll back with `wrangler rollback` against that generated config; never delete Durable Objects, D1, or R2 data as a rollback shortcut.

## Folder structure (required for new work)

The app is organized as feature modules — follow this shape when adding code; Biome enforces the marked boundaries.

```
src/
├── routes/                  # TanStack Start routes — PHYSICAL FOLDERS, never dot-notation files
│   ├── _authenticated.tsx   # pathless layout: session gate for the console (no /admin prefix)
│   ├── _authenticated/      # console pages: projects/, campaigns/, campaigns_/$id, studio/, agents, admins, chat
│   ├── login.tsx, index.tsx, share/
│   ├── designs/             # public design/asset/publish file routes (URLs are pinned — see below)
│   └── api/                 # /api/* routes (auth, trpc, review, webhook catch-all)
├── features/<domain>/       # feature module: domain logic + UI + COLOCATED tests (*.test.ts next to source)
│   ├── design-studio/       # chat/, assets/, tools/, publish/, tokens/, mcp/, element-chat/, components/, pages/
│   ├── campaigns/           # chat/, assets/, share/, kpis/, components/, pages/
│   ├── projects/            # brand-kit/, components/, pages/
│   ├── review/              # review pipeline (server-only) — public API via index.ts barrel
│   ├── skills/              # skill taxonomy/prompts — public API via index.ts barrel
│   └── console/             # agents/admins pages + the personal chat
├── components/              # only cross-feature shell/UI: ui/ (shadcn), app-shell/, ai-elements/
├── client/                  # browser data layer: trpc.ts, queries.ts, api-types.ts, uploads.ts, auth-client.ts, helpers
├── server/                  # Worker composition layer: data/ (D1 access), trpc/, rivet/, http/, webhooks, middleware
└── lib/                     # ONLY cross-domain infra primitives (auth, db, message-owner, retry, sandbox, shell, terminal-ui)
```

Rules:

- **Routes**: add pages as folder routes (`_authenticated/projects/$id.tsx`), not `projects_.$id.tsx` dot files. The console has **no `/admin` URL prefix** — paths are `/projects`, `/campaigns/:id`, `/studio/:id`, `/agents`, `/admins`, `/chat`, `/login`. Layouts/breadcrumbs live in the route file; page components live in the owning feature's `pages/`.
- **Do not change public file URLs.** Published snapshots pin `/designs/:id/site|file|preview|publication/*` and `/projects/:id/components/:componentId/:file` (bundle paths come from `componentBundlePath()`). Serving for the component-bundle path is a worker intercept in `src/server.ts`, not a route file.
- **Feature modules own related code + tests together**: put a new file in the domain's subfolder with its test beside it. Cross-module imports of `features/review` and `features/skills` must go through their `index.ts` barrel (Biome: `noRestrictedImports`). When a mixed client/server module gets a stable surface, give it a barrel too.
- **Layering**: client components never import `@/lib/*` or `@/server/*` — they use `@/client/*` (tRPC/queries) or feature client code. Server layers (`server/data`, actors, `server/http`) may import feature modules and `lib/` freely.
- **Tests**: unit tests colocate with source inside the feature folder; the `test/workers/` tier is reserved for workerd integration tests.

## Database

- **Prisma 7 + D1**: change `prisma/schema.prisma`, then use Prisma's migration commands. **Never hand-edit `prisma/migrations/*`.** Migrations apply in filename order with Wrangler (`db:migrate-local` / `db:migrate-remote`); keep them additive by default.
- Drizzle is also used for the RivetKit actor state stores (`src/server/rivet/actors/*/drizzle.config.ts`, `db:generate:actors`).

## Security & operations notes

- `.dev.vars` holds local secrets (Better Auth, GitHub App credentials, Kimi, agent-credential encryption, R2 S3 upload signing, `BROWSER_MCP_TOKEN`). Never commit or print it. Production secrets are managed via Wrangler secrets.
- Review attempts carry high-entropy Bearer secrets; only hashes are stored in D1. Never let them appear in logs, tickets, or command output.
- The review model is pinned by the worker (`REVIEW_KIMI_MODEL_NAME`, default `kimi-k3.1-pro-highspeed`), passed through the Kimi CLI's `KIMI_MODEL_*` env family inside the sandbox container (built from `./Dockerfile`).
- `DAILY_REVIEW_REPO` (`wrangler.jsonc`) points the daily cron at `Eden-Kukuana-PLC/kukuana` — the bot reviews whichever repos its GitHub App is installed on; those repos must carry their own `.claude/skills/` for the skills the review invokes.

## CI/CD (GitHub Actions)

- `.github/workflows/ci.yaml` — format/lint (Biome), unit + route tests, typecheck, build, `verify:build`, `cf-typegen`, and a clean-tree check on generated files.
- `.github/workflows/deploy.yaml` — on push to `main`: build → audit → remote D1 migrations → `wrangler deploy --config dist/server/wrangler.json`. Requires repo secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
