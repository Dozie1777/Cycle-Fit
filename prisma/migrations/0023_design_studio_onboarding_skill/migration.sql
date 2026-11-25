-- Design studio onboarding skill: seed the new builtin skill into
-- databases that already applied 0020_knowledge_skills. Same deterministic
-- id + INSERT OR IGNORE convergence rules as 0020; the source of truth is
-- skills/builtin/design/design-studio-onboarding.md (0020 is regenerated from all sources;
-- this migration only adds the one new row).
INSERT OR IGNORE INTO "Skill" ("id", "slug", "name", "description", "content", "builtin", "enabled", "category") VALUES (
	'skill-design-studio-onboarding',
	'design-studio-onboarding',
	'Design studio onboarding',
	'Interactive tour of the design studio for first-time users: components and version pinning, pages, dummy-data collections, templates, flows, publishing. Use with /design-studio-onboarding, or when a user asks how the studio works or wants a walkthrough before their first design.',
	'
# Design studio onboarding

Do not paste this document into chat — follow it. Take the user on a short,
hands-on tour of the design studio''s building-block system. Teach by doing:
every step ends with something real they can see (a component, a page, a
live site), not a wall of explanation.

## When to use

The user may invoke this with `/design-studio-onboarding` (optionally with a
focus, e.g. `/design-studio-onboarding just components`). Treat these the
same even without the slash command:

- "How does this studio work?", "What are building blocks?", "Give me a tour"
- A first-time user who hasn''t built anything yet and asks where to start
- Someone returning after a break who asks what changed

If the user is mid-task with concrete work in flight, don''t hijack it —
offer the relevant section of the tour only, then get back to their task.

## Ground rules

- **Teach by doing.** Offer to build a tiny example site together (3 steps
  minimum, 10 minutes). Abstract explanation only when they ask "why".
- **One concept per beat.** After each step, show the result — a preview
  URL, the studio panel it appears in — before moving on.
- **Use `ask_user` to set the pace.** Open with one question: guided tour
  (you drive, they watch) or hands-on (they decide, you execute). A user
  who says "just explain it" gets the mental model below plus pointers to
  the studio panels — not the full build.
- **Never invent tools or panels.** Use only the tools listed here and the
  studio UI described here. If you''re unsure what a project has, call
  `list_components` / `list_pages` first.
- **Dummy data by default.** Build with `seed_data` collections so the
  demo doesn''t stall on real content. Swap in real content later.

## The mental model (keep this to four sentences when spoken)

1. **Components** are reusable `tb-*` web components in the project
   library. Every change is a new **append-only version** — draft, then
   published, then retired. A component has **exactly one published
   version** at a time.
2. **Pages** are ordered **blocks**, and each block **pins one exact
   component version**. Pins never move on their own: publishing a new
   component version never changes existing pages. Moving a pin is always
   a deliberate act (re-send the blocks, or use the studio''s re-pin
   button).
3. **Data collections** are named lists of JSON records (dummy data is
   fine). Blocks bind to a collection by name; records flow into the
   component at render time.
4. **Publishing** snapshots the composed pages into an immutable
   publication — the live site. Legacy single-HTML designs keep working
   exactly as before; converting them is an admin action, not a user one.

## The tour (adaptive — skip sections the user already knows)

Start from what the project already has. Call `list_components` and
`list_pages` first and narrate what exists ("you already have a Hero with
a published v1 and a draft v2 — let''s start there"). An empty project gets
the full build.

### 1. The library (components & versions)

- Show the library with `list_components` — names, `tb-*` tags, and which
  version is published vs draft.
- Point them at the studio''s **Components tab**: each component opens a
  version timeline (draft / published / retired, who changed what), with
  Publish, Restore, and Retire actions, and how many blocks pin each
  version.
- If the library is empty, build a small Hero live with `save_component`
  (a section-level `tb-hero`). Explain: every save is a new draft version;
  the draft preview URL renders it immediately; nothing user-facing
  changes until a version is published.
- Key line: *"Publishing a new version never rewrites your pages — that''s
  on purpose. You decide when each page moves."*

### 2. Pages compose the library

- Compose (or narrate) a page with `compose_page`: an ordered block list
  where each block pins a component version, a template, or one-off
  inline HTML. Show the returned draft preview URL.
- Point at the **Pages tab** in the studio: create/rename/delete pages,
  reorder or remove blocks, add a block pinned to a specific version.
  The studio shows each block''s pin (`Hero v1 — published`).
- If a data collection exists (or after step 3), add a block with
  `dataBindings` so records render into it — that''s `seed_data` +
  `compose_page`/`bind_data` working together.

### 3. Dummy data (`seed_data`)

- Fill a named collection with 3–5 plain JSON records (e.g. `plans` with
  tier/price rows) and bind it to a block. Records are dummy data — make
  that explicit so nobody mistakes them for real content.
- Point at the **Data tab**: collections and their records, editable
  without chat.
- Note the guardrail: a collection that a block binds to can''t be renamed
  or deleted from the studio until the binding is removed.

### 4. Templates & flows

- `define_template` — a named, ordered slot list over the library
  (e.g. `LandingHero`). Use it as a block to repeat a slot sequence
  across pages. Show the **Templates tab**.
- `define_flow` — a named journey across composed pages: ordered steps
  with entry/exit transitions described in words (`click .cta`), not
  code. Show the **Flows tab**. The preview player walks the steps.

### 5. Publish

- Ask before publishing. Then: `compose_page` with `publish:true` for the
  page(s) to publish, followed by `publish_design` — that snapshots the
  composed pages into an immutable **publication** and serves the live
  site. Drafts stay preview-only.
- Explain what publish does automatically (component drafts authored this
  turn get published so pages pin real versions) and what it never does
  (move existing pins).
- Point at the **History section** in the studio: each publication is a
  snapshot with a version; they can time-travel to any of them.

### 6. Preview & selection (quick win)

- In the studio''s preview, clicking a rendered block selects it in the
  inspector, and selecting a block in the inspector scrolls the preview
  to it and outlines it. Show this — it''s the fastest way for a new user
  to feel the block model.

## Closing

End with a one-line recap of the mental model, then ask what they want to
build first. Offer to keep the demo project as their sandbox or wipe it
and start fresh on their real content.

## FAQ (answer in one or two sentences each)

- **"I published a new component version — did my pages update?"** No, by
  design. Pages keep pinning the old version until you re-send their
  blocks or hit re-pin in the studio. The Components tab shows exactly
  which blocks pin stale versions.
- **"Can I edit a published component?"** Not in place — saves always
  create a new draft version. Publish the draft when you''re ready; then
  decide per page whether to move its pins.
- **"What''s a retired version?"** The previous published version, kept so
  publications and pins stay intact. Restore copies it to a fresh draft —
  it never silently re-publishes.
- **"How does data get into a component?"** Through `dataBindings` on a
  block: name a seeded collection, and its records render into the
  component at render time. Edit the records in the Data tab anytime.
- **"Where did my old design go?"** Nowhere — legacy single-HTML designs
  keep serving exactly as before. Turning one into blocks is an
  admin-run conversion; ask an admin if you want it.
- **"Can two pages use the same component?"** Yes — that''s the point.
  Each page pins whichever version it should show, independently.
',
	1,
	1,
	'design'
);
