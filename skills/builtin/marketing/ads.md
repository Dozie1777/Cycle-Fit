---
slug: ads
name: Paid ads
description: Plan paid campaigns and write ad creative — channel selection (search vs social vs retargeting), structure, audiences, budgets, headline variants and KPIs. Planning + copy only: ads are never launched from here. Use when the user mentions PPC, ROAS, CPA or retargeting. Invoke with /ads ...
category: marketing
---

# Paid ads

Do not paste this document into chat — follow it. Use this playbook to plan campaigns and write ad copy for the campaign's paid channels.

## Ground rules

- This is a **planning + copywriting skill, not an ad-ops pipeline**. There is no ad-account API, pixel, or platform UI here. Ads are never launched, scheduled, or bought from this workspace. Deliverables: a campaign plan saved into the campaign documents, and finished ad copy (headlines, primary text, descriptions, video scripts) delivered in chat.
- **Never invent numbers.** No budgets, prices, targets, conversion rates, or performance claims. Budgets come from the user via `ask_user`. Reported results come from the user, then go into a report with `record_kpi_results`.
- Every recommendation ends with **facts, hypotheses, and missing data**. Label unavailable inputs MISSING; never estimate them.
- Call `list_channels` before referencing any channel; link by id. Confirm the offer (course, cohort, free trial lesson, exam-prep package) and its landing destination from the brief — never guess them.

## Before starting

Gather via `ask_user` (discrete choices) and free-text follow-ups:

1. **Objective** — awareness, traffic, leads/enrollments, sales, re-engagement.
2. **Offer** — what is being promoted, and why it is compelling.
3. **Audience** — who buys; what they search or care about; whether existing learner/customer data exists for lookalike-style audiences.
4. **Budget** — approximate amount or band. If none is given, keep recommendations channel-agnostic and note where budget would change choices.
5. **History** — past ads, what worked, current funnel conversion rate (user-reported only).
6. **Landing destination** — where clicks go (course page, signup, lead magnet).

## Channel selection

Match the channel to intent, not preference:

| Channel type | Best for | Use when |
|--------------|----------|----------|
| **Search ads** | High-intent capture | People actively search for the solution ("JAMB chemistry tutor", "data analytics course online"). Harvests existing demand. |
| **Social ads** | Demand generation | Demand must be created; strong visual/video creative exists; course lifestyle can be shown. |
| **Retargeting** | Conversion lift | Traffic already exists to re-engage; highest ROI usually. |
| **Video-first (TikTok/Shorts/Reels)** | Reach, younger learners | Audience skews 18–34; video capacity exists. |
| **Professional (LinkedIn)** | Upskilling/professional certs | Job-title or industry targeting matters; higher price points justify higher CPCs. |

Selection criteria: where does the audience spend time; buying stage (search converts, social creates); budget (paid needs spend, organic needs time); creative assets available (`list_assets`; `create_asset` seeds designed creative). For the full owned/earned/paid mix, see `/campaign-plan`.

## Audience knowledge → creative first, filters second

Demographics, pain points, exact vocabulary, fears, hopes, past objections — gather every identifier. What changed: platform algorithms are now good at finding the right person, so jamming identifiers into targeting filters underperforms feeding them into the **creative**.

| Platform | Knowledge → creative | Knowledge → filters |
|----------|---------------------|---------------------|
| Meta / TikTok | 70–80% | 20–30% |
| Search | 40% | 60% (keywords still dominate) |
| LinkedIn | 40% | 60% (identity data is precise) |

Applying audience knowledge to creative:

- **Identity triggers** in headlines — "for secondary-school science teachers", "for aspiring product managers". The reader self-selects.
- **Pain points, verbatim** — the audience's own words about the problem in the headline and first line.
- **Hopes** — transformation copy and CTAs ("exam-ready in 4 weeks").
- **Objections** — retargeting copy that answers "why I didn't enroll last time".
- **Segment vocabulary** — never use jargon the audience doesn't.

**Failure mode to avoid**: compensating for weak creative with hyper-precise targeting. That builds a small audience that all sees a bad ad. Instead: 5 creative variants speaking to 5 segments, broad targeting, let the algorithm match creative to segment.

Still true: lookalike-style audiences based on best learners (not all); segment retargeting by funnel stage; exclude existing learners and recent converters.

## Campaign structure

Organize as: **Campaign (objective) → Ad set (audience/placement variation) → Ads (creative variants)** — one campaign per objective-audience-offer combination, 3+ ads per ad set (never one ad). Suggest naming conventions so the human's account stays readable: `[Platform]_[Objective]_[Audience]_[Offer]_[Month]`, e.g. `META_Conv_Working-Adults_FreeTrialLesson_Mar26`.

**Budget framing** (numbers always from the user):

- Testing phase (first 2–4 weeks): ~70% to the safest bet, ~30% to tests — only as a pattern to discuss, not a rule.
- Scaling: consolidate into winners; increase ~20% at a time, never 30%+ in one move (it resets platform learning); 3–5 days between increases.
- Don't fragment across many campaigns; don't set a "nice-sounding" budget — ask.

## Ad copy frameworks

- **PAS** — [Problem] → [Agitate] → [Solution] → [CTA]. "Still cramming for [exam]? Last-minute studying is why marks stall. Our [subject] prep course builds the plan a month out. Start a free lesson."
- **BAB** — [painful now] → [desired after] → [offer as bridge]. "Six months from now you could still be watching tutorials — or working as one of our graduates' employers expect. [Course] gets you there."
- **Social proof lead** — [impressive real stat or testimonial, user-supplied] → [what you do] → [CTA]. Never fabricate proof.
- **Identity trigger** — "[Audience]: [benefit promise]". "For nurses moving into health tech: the course that starts with what you already know."

Deliver headline variants (5–10) across at least 3 angles: pain, outcome, identity. Mark the angle on each so results teach something. Search ad copy (e.g. RSAs): state the headline/description character limits in effect and respect them; pair each ad with the keywords it serves.

## Creative best practices

- **Image/static**: real product or lesson screenshots, before/after contrasts, real human faces (never stock), one bold stat as focal point when the user supplies one. Native feel outperforms polished.
- **Video (15–30s)**: hook (0–3s pattern interrupt) → relatable problem (3–8s) → show the benefit (8–20s) → CTA (20–30s). Captions always; vertical for Stories/Reels, square for feed.
- **Testing hierarchy** (test in this order, one tier at a time): 1) concept/angle (biggest impact), 2) hook/headline, 3) visual style, 4) body copy, 5) CTA.

## Retargeting

**Funnel-based**: top (content viewers — educational + proof), middle (course/pricing page visitors — case studies, curriculum detail), bottom (cart abandoners, trial users — urgency if genuine, objection handling).

**Windows**: hot (1–7 days, higher frequency OK), warm (7–30 days, a few impressions/week), cold (30–90 days, low frequency). Exclusions: existing learners, recent converters (7–14 days), bounced visitors, irrelevant pages.

**Retarget with different offers, not the same one.** The top reason someone didn't enroll is that the offer wasn't right for them — re-showing it harder doesn't help. Clicked the advanced course but didn't buy → retarget the beginner course or a free diagnostic quiz. Downloaded a syllabus but didn't enroll → a different lead magnet (`/lead-magnets`). Viewed pricing → a free trial lesson instead.

**Four-part retargeting layer** (run together against the same audience):
1. **Objection-handling ad** — headline built from the verbatim reasons past learners give for not enrolling (interview/survey them; see `/customer-research`).
2. **Proof carousel** — real testimonials and evidence supporting the original ad's claim.
3. **Other-offers ad** — best-performing ads for other courses, to the same audience.
4. **Value-first free lesson/assessment** — something useful regardless of whether they enroll.

## Landing page alignment

Ad-to-page congruence is the most underrated lever: most effort goes to the ad and almost none to the page the click lands on. Flip that ratio.

- Mirror the ad's promise in the page headline — same words, same offer, no bait-and-switch.
- An ad's CTR screens headline *candidates*, not proof: high-CTR headlines can attract non-buyers. Treat winners as hypotheses for the landing page, and prove them with a proper page test against the unchanged page (see `/ab-testing` for design and stopping rules; `/cro` for the page itself).
- Standing discipline: at least 3 split tests running somewhere in the funnel at any time (creative, page, offer, or post-signup flow). Fewer than 3 means the improvement curve is capped.

## Measurement

**KPIs by objective** — awareness: CPM, reach, video view rate; consideration: CTR, CPC, time on page; conversion: CPA/CPL, ROAS/ROI, conversion rate. Agree the primary KPI plus 3–5 secondaries, put them in the brief, and record user-reported actuals with `record_kpi_results`.

**Brand vs non-brand**: wherever people can search the publisher's name, split brand queries from non-brand *before* evaluating anything. A branded search is demand that already exists — its cheap conversions are a readout of awareness, not media skill. Report blended numbers as top-line health, but set targets against **non-brand** performance. Never report a low brand CPA as a win.

**Attribution honesty**: platform-reported conversions are inflated; attribution windows differ by platform and must never be summed. Prefer one consistent tracking convention the user confirms, and judge scaling on blended business-level results, not per-ad-set ROAS. Find the break-even CPA/ROAS from real unit economics the user supplies, and scale toward that ceiling — not away from an arbitrary ROAS preference. Net cash beats ROAS percentage.

**Optimization levers** — CPA too high: check the landing page first (post-click problem?), then audience, then new angles, then bids. CTR low: creative not resonating or audience mismatch — test hooks/angles. CPM high: audience too narrow, high competition, or weak creative fit.

**Check discipline**: when reviewing reported numbers, check in a fixed order — spend → traffic → conversions → creative → landing page → tracking. End each review in exactly one call: **HOLD** (normal variance, small sample), **FIX** (named problem, known fix), **TEST** (a hypothesis worth money, with metric and stopping rule), or **INVESTIGATE** (data can't be trusted yet — this overrides the others). Small numbers prove little; a CPA spike is a question, not a verdict.

## Common mistakes

- Launching without a confirmed conversion definition or destination.
- Fragmenting budget across too many campaigns; stopping campaigns mid-learning.
- One ad per ad set; never refreshing creative (fatigue); ad/page message mismatch.
- Audiences too narrow or too broad; not excluding existing learners; overlapping audiences competing against each other.
- Optimizing to the wrong metric; inventing benchmarks because real ones are MISSING.

## Related skills

- `/copywriting` — page copy that converts ad traffic; `/copy-editing` — tightening ad copy.
- `/cro` and `/ab-testing` — post-click conversion and test design.
- `/customer-research` — voice-of-customer that feeds angles and objections.
- `/lead-magnets` — offers for the retargeting layer.
- `/campaign-plan` — where paid fits in the full channel mix; `/performance-report` — reporting results.
- `/marketing-psychology` — why angles convert.
