# Builtin studio skills (source of truth)

This directory holds the **editable source** for the builtin skills seeded
into the D1 `Skill` table (see `prisma/migrations/0020_knowledge_skills`).
Migrations are append-only, so content lives here and the migration is
generated from these files:

```bash
node skills/builtin/generate-migration.mjs   # regenerates prisma/migrations/0020_knowledge_skills/migration.sql
node scripts/check-builtin-skills.mjs        # validates slugs, categories, length limits
```

Both run in CI via `src/lib/builtin-skills.test.ts` (the committed migration
must always match the sources).

## File format

Each skill is one markdown file with a small frontmatter block:

```markdown
---
slug: design-critique
name: Design critique
description: One-line trigger description shown in the slash menu and system prompt (<= 300 chars).
category: design
---

# <markdown body the agent loads with load_skill>
```

- `slug` — the `/slug` command; lowercase letters/digits/hyphens, unique
  across all categories. Must match the file name.
- `category` — which studio loads it: `design` (design studio chat),
  `marketing` / `sales` / `campaign` (campaign studio chat).
- `description` — admin-facing one-liner; limit 300 chars (handler limit).
- Body — the full instructions the agent follows; limit 100k chars.
  Style rule shared by all builtin skills: **"Do not paste this document
  into chat — follow it."** goes in the body's first section.

## Provenance

The `design/`, `marketing/` and `sales/` skills are adapted from Anthropic's
open-source [knowledge-work-plugins](https://github.com/anthropics/knowledge-work-plugins)
(tree `2574e29377c7173d0cecffef29a6ecbd7f8ccb5d`), rewritten for this
platform's data models and agent toolsets:

- **Design studio chat** (Workers AI, container-free): tools `wireframe`
  (SVG draft), `preview_section` (HTML draft), `propose_design` (HTML
  draft), `publish_design` (live site + preview PNG + `tokens.json` design
  tokens), `style_options` / `ask_user` (turn-ending pickers), `load_skill`
  (this library), plus Playwright browser tools (`browser_navigate`,
  `browser_snapshot`, `browser_evaluate`, …) over the live site and web
  research. One self-contained HTML page per design; design tokens live in
  a `:root` block; versions are append-only; brand kits can pin palette and
  typography; reference assets attach to turns with model-written
  descriptions.
- **Campaign studio chat**: tools `save_brief` / `update_brief`,
  `save_plan` / `add_phase` / `update_phase`, `add_event` / `update_event`
  / `remove_event`, `save_report` (KPI table + markdown body),
  `create_asset` (seeds a design studio project), `list_channels`,
  `list_assets`, `load_skill`, `ask_user`, plus the same browser tools.
  Campaign documents are brief / plan / calendar / report rows the
  dashboard renders; channels are an admin-managed enumeration.

There is **no Figma, CRM, email, calendar or file-storage connector**: what
a source skill pulled from an integration is gathered from the user
(pasted text, attached assets, answers to `ask_user`) or researched live
with the browser tools. Skills keep the source's structured, step-based
format but every tool reference is rewritten to this platform.

## 0021 marketing craft additions (provenance)

The `cro`, `copywriting`, `copy-editing`, `social`, `ads`, `launch`,
`marketing-psychology`, `customer-research`, `lead-magnets`, `onboarding`
and `ab-testing` skills are adapted from
[coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills)
(MIT), compressed and rewritten for this platform's toolset and the
ed-tech domain. `email-sequence` and `seo-audit` are in-place upgrades
that merged the same source's frameworks into the existing adapted files
(0021 refreshes those two builtin rows' seed-owned fields — name,
description, content — via upsert; admin-controlled state like `enabled`
is preserved, and admins who customized the content should re-apply
their edits via copies).
