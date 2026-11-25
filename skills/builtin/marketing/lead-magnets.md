---
slug: lead-magnets
name: Lead magnets
description: Plan, design, or improve a lead magnet — a free resource offered in exchange for an email or signup. Invoke with /lead-magnets when the user mentions lead magnet, freebie, gated content, download, checklist, template, free lesson, practice pack, or "what should I give away to capture emails."
category: marketing
---

# Lead magnets

Do not paste this document into chat — follow it. Help the user plan a lead magnet that captures emails or signups, attracts learners who actually fit their course, and hands them off to a nurture flow — without ever sending anything or inventing numbers.

## Critical boundary

You plan and draft. **You never send emails, publish posts, run ads, or imply you did or can.** All copy and content is delivered copy-paste-ready in chat or seeded into a design-studio asset for the user to use in their own tools.

Never invent: download counts, conversion rates, prices, deadlines, offers, or "downloaded by N learners" proof points. Where a proof point belongs in copy, write a placeholder like `[INSERT: number of past students]` and tell the user what to fill in.

## Inputs

Gather before planning. Use `ask_user` for discrete choices, plain questions for open ones. Pull what the campaign brief already answers instead of re-asking:

1. **What's being promoted** — a specific course, an upcoming live stream or cohort start, an exam-prep program, or the publisher's brand generally
2. **Audience** — who the magnet is for (exam candidates, career switchers, beginners in a subject, past attendees); use the brief's audience field if it fits, confirm if it targets a subset
3. **Goal** — email list growth, enrollment signups, stream registrations, exam-season waitlist, or qualified-lead quality
4. **Audience stage** — discovering the topic, comparing options, or ready to start
5. **Existing assets** — lessons, past stream recordings, notes, syllabi, worksheets that could be repurposed
6. **Effort appetite** — how much time the publisher can spend creating this (drives format choice)
7. **Channels** — call `list_channels` and match promotion plans to real channels; never invent one

Good `ask_user` uses: goal ("Grow email list / Drive stream signups / Fill next cohort / Build exam-season list"), stage ("Just discovering the topic / Comparing courses / Ready to start"), effort ("Quick win, under a day / Medium, a few days / Willing to invest a week+"). Never guess audience, budget, channels, timeline, or tone — ask.

## Principles

1. **Solve one specific problem.** "JAMB Chemistry: the 12 reaction types that appear every year" beats "Chemistry study guide." One pain point, one promised outcome.
2. **Make the promise specific.** The title states exactly what the learner gets and in how long: "a 15-minute diagnostic", "a one-page checklist", "5 practice questions with worked solutions". Vague promises ("free resources") underperform — say what, for whom, and how fast.
3. **Match the buyer stage.**
   - **Discovering** (awareness): checklists, cheat sheets, beginner guides, quizzes that diagnose their level
   - **Comparing** (consideration): syllabus breakdowns, "how to evaluate a course" scorecards, recorded mini-lessons, past-stream highlight packs
   - **Ready to start** (decision): enrollment templates, first-lesson free access, exam-day checklists, cohort-start prep kits
4. **High perceived value, low time cost.** It should look worth paying for and be consumable in under 30 minutes — ideally under 10. Immediate, actionable takeaway.
5. **Natural path to the product.** The magnet solves a problem the course also solves, and demonstrates the publisher's teaching style. A free mini-lesson should feel like the first bite of the course.
6. **One format, easy to consume.** Don't mix an ebook + video + spreadsheet in one magnet. Works on mobile, no special software.

## Magnet types for ed-tech

| Type | Best for | Effort | Notes |
|------|----------|--------|-------|
| Checklist | Exam prep, course-start readiness | Low | "Exam-day checklist", "first-week readiness" — quick wins, very fast to make |
| Cheat sheet / formula sheet | Reference material for a subject | Low | One page, high save-and-share value |
| Syllabus / study-plan template | Structured learners, cohort prep | Low-Med | Week-by-week plan the learner fills in; positions the course as the shortcut |
| Practice-question pack | Exam-prep audiences | Medium | 5-20 questions with worked solutions; proves teaching quality directly |
| Free mini-lesson | Demonstrating the course itself | Medium | One lesson or excerpt; strongest product preview — pair with a "this is lesson 1 of N" frame |
| Diagnostic quiz | Segmentation + engagement | Medium | "How ready are you for the exam?" — results segment leads by level |
| Email mini-course | Education + nurture in one | Medium | Delivered as a drip (pairs directly with `/email-sequence`); builds a habit of opening their emails |
| Live stream / webinar signup | Authority + live engagement | Medium | Registration magnets for Q&A sessions, exam-season kickoffs; the signup itself is the capture |
| Past-stream highlight pack | Publishers with existing streams | Low | Repurpose recorded material; near-zero new creation |
| Guide / ebook | Deep authority building | High | Only when effort appetite allows; long-form and slow to produce |

**Value/effort fit rule:** start low-effort unless the user explicitly wants a flagship asset. A checklist shipped this week beats an ebook planned for next quarter. If the user has rich existing material (recorded streams, course notes), repurposing is almost always the right first move — ask what they already have before proposing net-new creation.

## Delivery format decision

Decide how the magnet reaches the person — this is a separate decision from the content:

| Method | Pros | Cons |
|--------|------|------|
| Instant download | Immediate gratification | No verified email, weaker relationship start |
| Email delivery | Verifies the address, starts the relationship | Small delay |
| Thank-you page + email copy | Instant access AND the email touchpoint | Slightly more setup for the user |
| Drip delivery (mini-course) | Builds habit over multiple touchpoints | Only fits course/series formats |

Recommend thank-you-page-plus-email as the default when the user controls their pages; drip for mini-courses. Draft the **delivery email copy** too — the short "here's your download" email is part of the magnet and the first email of the nurture relationship (hand off to `/email-sequence` for what follows).

### What to ask for at capture

- **Email only** — highest conversion, lowest friction; the default
- **Email + first name** — enables personalization, slight friction
- **Email + exam/goal** (e.g. "Which exam are you preparing for?") — better segmentation for ed-tech, more friction; worth it for quizzes and exam-prep magnets
- **Multi-field forms** — only for high-value offers like live-stream registrations with limited seats

Rule of thumb: ask for the minimum needed; every extra field costs conversions.

### How to frame the exchange

- Make the value obvious in the CTA: "Get the exam checklist free"
- Show a preview: first page, table of contents, a sample question
- Reduce risk: "No spam. Unsubscribe anytime." (only when true)
- Never fabricate social proof — leave a placeholder for the user to fill with real numbers or omit

## Capture → nurture handoff

A lead magnet without a follow-up plan is a leaky bucket. For every magnet, define:

1. **The trigger event** — form submitted, stream registered, mini-lesson started
2. **The first email** — delivery email (immediate): deliver the promised value, set expectations for what comes next, one soft CTA toward the course/stream
3. **The nurture arc** — what the next 2-4 touchpoints do: build on the magnet's topic, address the likely next question, then invite the relevant conversion (enroll, register for the cohort, attend the next stream)
4. **The exit condition** — the action that ends the nurture path (enrollment, stream attendance)

Do not design the full sequence here — outline the arc (first email + 2-4 follow-up beats + exit), then offer to build the complete sequence with `/email-sequence`.

## Long-form magnets as design assets

For magnets with a designed format — a deck, a one-pager, a branded checklist PDF, a workbook — do not build the visual in chat. Draft the content (headline, sections, bullet copy, any practice questions), then offer `create_asset` (type deck or one-pager, seeded with the drafted content) so it opens in the design studio at `/studio/<id>`. Tell the user the asset is a starting draft they can refine in the studio.

Short-form text magnets (checklists, email mini-courses, quiz copy, thank-you pages) stay in chat as copy-paste-ready markdown.

## Promotion planning

Where the magnet gets promoted — cross-check every channel against `list_channels` and reference channels by id:

- **Email to existing list** — announce the magnet to current subscribers; often the cheapest first win
- **Social** — teaser snippets pulled from the magnet's content (a sample checklist item, one practice question); offer `/social` for post planning and `/draft-content` for the posts
- **Content upgrades** — a magnet matched to a specific blog post or lesson page ("bonus checklist for this post") converts far better than a generic sidebar offer
- **Stream CTAs** — promote the magnet during live streams as the "take this home" companion
- **Paid** — if the user asks about amplifying with ads, offer `/ads`; never propose budgets or spend

Never schedule or place anything — promotion plans are recommendations the user executes.

## Measurement plan

Record KPIs with `list_kpis` / `record_kpi_results` where the campaign supports it. Suggest the user track:

- **Capture conversion rate** — page visitors → form submissions (offer attractiveness)
- **Delivery engagement** — open and click rates on the delivery email (relevance)
- **Lead quality** — what share of magnet leads later enroll, register, or attend (the metric that matters most; a magnet that captures "freebie collectors" who never convert attracted the wrong audience)
- **Source comparison** — which promotion channel produces converting leads, not just raw leads

Frame all benchmarks as industry reference ranges, never predictions for this specific campaign.

## A/B test ideas

Offer 2-3, only where the user's tools support testing:

- Headline: specific-outcome vs. curiosity framing
- Format: checklist vs. mini-lesson on the same topic
- Form fields: email-only vs. email + exam/goal question
- CTA copy: "Download the checklist" vs. "Get exam-ready in 15 minutes"
- Delivery: instant download vs. email delivery

## Output

Structure the final response as:

### 1. Recommendation
Format and topic, target audience stage, why this format fits this audience and goal, estimated creation effort.

### 2. Content outline
Sections/components, scope and length, the specific promise (exact suggested title), what makes it worth the exchange.

### 3. Capture plan
Gating level, form fields, landing-page structure (headline → preview → what's inside → form → FAQ), thank-you page next step, delivery method.

### 4. Promotion plan
Channels (matched to `list_channels`, referenced by id), content-upgrade opportunities, stream CTA ideas.

### 5. Handoff & measurement
The nurture arc outline (first email + follow-up beats + exit condition), KPIs to track, first A/B test to run.

## After the plan

Close by asking which the user wants next:

- **Draft the content** — full text of the magnet in chat (offer `/draft-content` for the landing page or promo copy)
- **Seed the designed asset** — `create_asset` for decks, one-pagers, branded PDFs
- **Build the follow-up sequence** — `/email-sequence` from the handoff outline
- **Log it** — `update_brief` to record the magnet as a campaign asset/offer, or `add_event` to put a promotion date on the campaign calendar once the user provides one

Keep the turn tight: recommendation, outline, capture plan, handoff, closing offers. The user should leave with a buildable magnet, not a research report.
