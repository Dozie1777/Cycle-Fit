/* Studio skills (KUK-891): global Skill table behind the campaign chat's
   slash commands and the load_skill tool.

   Designed to apply cleanly over any existing data:
   - Single additive table; no existing table is touched.
   - Skill ids are DETERMINISTIC — 'skill-' + the slug — so the seed is
     idempotent (INSERT OR IGNORE): re-running against an already-seeded
     database converges instead of duplicating rows.
   - Builtin seeds start enabled; admins can disable them (PATCH) but never
     delete them (the API rejects DELETE for builtin rows). */

-- CreateTable (global skill library; admin-owned via /skills + the
-- manage-skills dialog, load-only for the agent)
CREATE TABLE "Skill" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "builtin" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Skill_slug_key" ON "Skill"("slug");

-- Seed the builtin skills idempotently (INSERT OR IGNORE + deterministic
-- ids). Content is the real onboarding/playbook markdown the agent loads
-- with load_skill or that a "/slug" user message injects.
INSERT OR IGNORE INTO "Skill" ("id", "slug", "name", "description", "content", "builtin", "enabled") VALUES (
	'skill-campaign-basics',
	'campaign-basics',
	'Campaign basics',
	'New here? A guided tour of the studio: what the agent can do and a worked brief-to-deck example.',
	'# Campaign basics — a guided tour

You are new to the campaign studio (or the user asked for the tour). Walk
them through the surfaces and the workflow below, conversationally — do not
paste this document into chat. Use it to answer questions about the product.

## The surfaces

- **Dashboard** (the campaign control tower): KPI strip, brief panel, plan
  timeline, content calendar, reports and the asset gallery — every document
  the agent writes shows up there live.
- **Studio chat** (this panel): the planning conversation. The agent asks
  before assuming, researches with browser tools, and writes the structured
  documents directly.
- **Present runner**: presents the campaign full-screen from the dashboard.
- **Public share**: a revocable share link that renders a read-only snapshot
  of the campaign; reports stay hidden unless the owner opts in.

## What the agent can do

- Write and keep current the **brief** (objective, audience, key message,
  tone, channel mix, budget, KPIs) with save_brief / update_brief.
- Draft **plans** with ordered phases (Teaser, Launch week, Sustain, ...)
  using save_plan and add_phase.
- Fill the **content calendar** with concrete dated slots via add_event,
  adjusting with update_event / remove_event. Slots link channels and can
  attach generated assets.
- Write **reports** (KPI tables plus prose) with save_report.
- Seed **assets** — decks, landing pages, one-pagers — with create_asset;
  each opens in its own design studio.
- Research the market with the browser tools (search, open pages, analyze
  competitors) when the plan needs real references.

## A worked example flow

1. The user says: "I am launching a study-skills bootcamp in March." The
   agent asks clarifying questions (audience, budget band, channels,
   timeline, tone) with clickable ask_user buttons before proposing
   anything.
2. Agreed answers are saved to the brief immediately — the brief panel
   updates live.
3. The agent proposes a three-phase launch plan; after approval it creates
   the plan and its phases with dated objectives.
4. It fills the calendar with real dated slots per phase and channel.
5. It seeds a launch deck with create_asset; the deck opens in the design
   studio and can be attached to a calendar slot.
6. After launch week, it saves a week-one performance report against the
   brief KPIs.

## Tips

- Type "/" in the chat input to pick a skill (like this one) at any time.
- The agent uses ask_user checkpoints with clickable buttons — picking an
  option moves the plan forward faster than typing an answer.
- Ask for changes at any time: budgets, dates, tone. The agent patches the
  documents instead of rewriting history.',
	true,
	true
), (
	'skill-draft-a-brief',
	'draft-a-brief',
	'Draft a brief',
	'Step-by-step playbook for negotiating and saving a complete campaign brief.',
	'# Draft a brief

Run a focused brief negotiation and end with a saved, complete brief. Do
not paste this document into chat — follow it.

## Step 1 — Collect the non-negotiables

Ask about the five things you must never guess, one ask_user checkpoint at
a time where a discrete choice fits:

- **Objective**: what must change because of this campaign (sales, signups,
  awareness, retention). Push for a number or a concrete outcome.
- **Audience**: who this speaks to — segment, context, pain. Sketch ICP
  bullets.
- **Channel mix**: call list_channels first, then propose 2-4 channels that
  fit the audience and budget; confirm before linking.
- **Budget**: total and shape (e.g. 60% paid, 40% content).
- **Tone**: three or four brand-voice adjectives.

## Step 2 — Sharpen the message

Draft 2-3 candidate key messages grounded in what the user actually told
you — specific promise, no marketing filler. Let them pick or merge. Offer
a one-sentence positioning statement if the product category is crowded.

## Step 3 — Set the KPIs

Propose KPIs that are measurable within the campaign window (e.g. "500
waitlist signups by launch day", "CAC under $20 in month one"). Never
invent targets the user has not agreed to.

## Step 4 — Save it

Write everything with save_brief as it is agreed — do not batch to the end.
Each later change is an update_brief patch. Pass the channel mix as
channelIds (from list_channels) — it replaces the campaign channel set.

## Quality bar

A complete brief has: objective, audience bullets, key message, tone,
channel mix linked by id, budget, KPIs with targets, and a short context
paragraph in body. If any are missing, say which and ask.',
	true,
	true
), (
	'skill-launch-plan',
	'launch-plan',
	'Launch plan',
	'Build a phased launch plan with dated objectives and a realistic beat structure.',
	'# Launch plan

Turn an agreed brief into a phased, dated launch plan. Do not paste this
document into chat — follow it.

## Step 1 — Fix the anchors

Confirm from the brief (or ask): launch date or window, budget, and the 2-3
moments that matter (announcement, open for sale / early access, general
availability). If there is no date, ask before structuring anything.

## Step 2 — Structure the phases

A classic shape that adapts to most launches:

- **Teaser** (2-3 weeks out): problem-space content, waitlist, founder
  story. No selling yet.
- **Launch week**: announcement, launch email, social push, press or
  partner posts, live event or webinar.
- **Sustain** (2-6 weeks after): social proof, use cases, retargeting,
  feature spotlights, referral prompts.

Adjust the shape to the budget: a small budget collapses to Teaser + Launch
week with one sustain email. Say so plainly instead of padding phases.

## Step 3 — Make it concrete

For each phase: a one-line objective, real start and end dates, and the
channel emphasis (link channel ids from list_channels when you write the
calendar slots next). Save with save_plan, then append phases in order with
add_phase — one call per phase, dates on every phase.

## Step 4 — Hand off to the calendar

Once the plan is approved (flip status to final), offer to fill the content
calendar with dated slots per phase — that is where the day-by-day detail
belongs.

## Quality bar

Every phase has: name, objective, concrete dates, and body notes on the
main beats. The plan reads as something a team could execute week one.',
	true,
	true
), (
	'skill-content-calendar',
	'content-calendar',
	'Content calendar',
	'Fill the calendar with concrete dated, channel-linked slots the team can execute.',
	'# Content calendar

Fill the campaign calendar with real, dated, channel-linked slots. Do not
paste this document into chat — follow it.

## Step 1 — Read what exists

Check the plan phases and existing calendar events first — this skill
extends them, it does not replace them. Confirm the planning window (start
date and cadence) if it is not already agreed.

## Step 2 — Pick the cadence

Propose a posting rhythm per channel that the budget and team size support:

- Launch weeks: near-daily across the priority channels.
- Sustain weeks: 2-4 touches per week, mixed channels.
- Email: anchor moments plus a regular digest; never more than the list
  tolerance the user describes.

Say the rhythm out loud and get a yes before generating the slots.

## Step 3 — Write the slots

For each slot: a concrete title (the actual asset, e.g. "Launch email —
doors open"), the channel id from list_channels, a real date and time,
status planned, and one-line notes (copy angle, CTA, dependency). Use
add_event for each. Spread slots across phases and channels so no single
day drowns.

Mark anchor moments (announcement, doors open, webinar) clearly in the
title or notes so the dashboard week view shows them.

## Step 4 — Keep it honest

When dates move, update_event — never orphan a slot from the plan. Remove
obsolete slots with remove_event instead of letting them rot. When an asset
(deck, landing page) is ready, offer to attach it to its slot.

## Quality bar

The calendar shows: at least one slot per channel in the mix per active
week, dates that respect the plan phases, and notes that make each slot
executable without another meeting.',
	true,
	true
);
