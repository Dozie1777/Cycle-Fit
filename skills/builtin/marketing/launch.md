---
slug: launch
name: Launch
description: Craft a launch — readiness gate, launch tiers, owned/rented/borrowed channel mix, announcement sequencing and the launch checklists. Adapted to course, cohort, exam-season and publisher-brand launches. For the phased plan document, see launch-plan. Invoke with /launch ...
category: marketing
---

# Launch

Do not paste this document into chat — follow it. Use this playbook to plan and write the announcement and distribution for a launch.

## What this skill is (and is not)

- **`/launch` (this skill)** is the announcement + distribution craft: what to say, where, in what order, and the checklist rigor that keeps a launch from flopping. Deliverables are launch messaging, per-channel announcement copy, and calendar slots.
- **`/launch-plan`** builds the structured phased plan document (`save_plan`, `add_phase`) with objectives and dates for the whole campaign. When the user wants the plan document, use that skill; when they have a plan (or the launch itself is the scope), this skill writes and sequences the announcements that execute it. Cross-reference freely in both directions.

## Ground rules

- Pull audience, tone, key message, channels and dates from the campaign brief and the user. **Never invent dates, prices, offers, discount codes, or performance claims.** Launch dates and enrollment windows come from the user, always.
- Call `list_channels` before referencing any channel; link by id. Announcement slots go on the calendar with `add_event`; channel-specific copy is delivered in chat.
- Confirm what is being launched and its single clearest benefit before writing anything.

## Core philosophy

The best publishers don't launch once — they launch again and again. Every cohort start, new module, and exam season is an opportunity to capture attention. A strong launch is not a single moment; it is getting the offer into real learners' hands early, learning from feedback, making a splash at every stage, and building momentum that compounds.

## Readiness gate

Run this before any launch mechanics. A launch that isn't ready won't market, no matter how good the announcements are. Two failure modes kill launches from opposite ends:

- **Stealth mode** — launching too late. Polishing the course in private until it's perfect. It never ships and nobody learns it exists.
- **"Just one more lesson"** — never launching. Every launch date slips for one more module, one more edit.

The middle path is **SLC — Simple, Lovable, Complete**. A launchable v1 course/offer:

- **Simple** — does one clearly-defined job. One course outcome, not ten vague ones.
- **Lovable** — learners would *choose* it, not merely tolerate it. If nobody would be sad to lose it, it isn't lovable yet.
- **Complete** — a whole experience at its chosen scope: functional lessons, working enrollment, functioning support — not a stub with obvious holes.

Gate checklist:
- [ ] Does it do one clearly-defined thing? (Simple)
- [ ] Would a target learner *choose* it, not just endure it? (Lovable)
- [ ] Is that one thing a whole experience, with no glaring stubs? (Complete)
- [ ] Polishing past this bar? → Stop. Stealth mode. Ship.
- [ ] Still adding new scope? → Stop. "One more lesson." Cut back to SLC.

Pass the gate, then run the phases.

## Five-phase launch approach

Phases are relative to the audience, not a calendar. A first course from a new publisher may run all five; an established publisher launching a new course may start at phase 3.

### Phase 1: Pilot (internal launch)
Teach the material to a small friendly group — past learners, colleagues, community members — before it is a product. Collect what confused them, where they dropped off, what they'd pay for. *Goal: validate the core learning outcome.*

### Phase 2: Seed cohort (alpha)
A small first cohort, often free or heavily discounted, invited individually. Announce that the course exists: a coming-soon post, a waitlist or interest form, early-access messaging. *Goal: first external validation and list-building.*

### Phase 3: Early access (beta)
Open to a wider early group: waitlist invites, teasers about the problem the course solves, endorsements from the pilot cohort (only real, user-supplied testimonials). Add "early bird" framing if the user confirms an incentive. *Goal: buzz plus broader feedback.*

### Phase 4: Pre-sale / early-bird
Controlled expansion: leak real details — curriculum previews, a free trial lesson, sample videos, instructor intro posts. Throttle invites in batches, or open enrollment to everyone under early-access framing. *Goal: validate demand at price, gather usage data.*

### Phase 5: Full launch (open enrollment)
Open self-serve enrollment; start full pricing (if not already); announce across all channels. *Goal: maximum visibility and enrollments.*

**Exam-season variant**: for exam-prep launches, anchor the phases to the exam calendar (dates from the user): prep content early → free diagnostic/mock around registration season → paid prep course launch well before the exam → intensify during the revision window → switch to results/retake messaging after.

## The ORB framework: channel mix

Structure the launch across three channel types. Everything should ultimately lead back to owned channels.

### Owned channels
You own the channel, though not the audience: email list, blog, in-app/site announcements, the publisher's community. They get more effective over time, have no algorithm risk, and compound. Start with 1–2 based on where the audience already is. On Timbuktu, the publisher's platform presence (course page, announcements to enrolled learners, email to their list) is the anchor — `/email-sequence` handles the sequences.

### Rented channels
Platforms that provide visibility you don't control: social (X, LinkedIn, Instagram, TikTok), YouTube, external community spaces. Pick 1–2 where the audience actually is; use them to drive traffic into owned channels — every viral post should lead to a signup or waitlist. `/social` writes the posts; here you decide the role each platform plays and its sequencing.

### Borrowed channels
Someone else's audience: guest content, podcast/newsletter features, collaborations with other educators, influencer/creator partnerships, cross-promotion with complementary publishers. Be proactive: list the voices the audience follows, pitch win-win collaborations, and set up referral incentives if the user confirms them. Borrowed attention only pays if you convert it into owned relationships (email signups, enrolled learners).

### Message sequencing across the mix

A typical full-launch sequence (compress for smaller launches):

1. **T–3 weeks: tease** — owned + rented. State the problem, not the product. "Something is coming for exam season" posts; a story about the pain the course solves.
2. **T–2 weeks: reveal** — all three channel types. Announce the course, name the outcome, open the waitlist. Borrowed channel partners post in their own voice, same week.
3. **T–1 week: prove** — owned-heavy. Curriculum detail, free trial lesson, pilot-cohort testimonials (real ones only), objection handling (price, time, "is this for me").
4. **Launch day: open** — all channels same-day. Email to the list, social posts, in-app/site announcement, partner posts. Every asset links to one destination.
5. **T+1 to T+3 weeks: convert + remind** — owned. Reminders to the waitlist, objection-handling follow-ups, "enrollment closes" if the user confirms a real deadline, roundup email for those who missed it. Then recycle non-buyers into a nurture sequence.

Sequence rule: each message earns the next. Problem → solution → proof → offer → urgency. Never open with the discount.

## Announcement channel mix by tier

| Update tier | What it covers | Treatment |
|-------------|----------------|-----------|
| **Major** | New course, new cohort program, exam-season flagship | Full launch: email campaign, blog/course page, in-app + site, social push, partner mentions |
| **Medium** | New modules, a notable guest lesson, feature rollouts | Targeted announcement: email to relevant segments, in-app banner, one or two social posts |
| **Minor** | Fixes, small tweaks, price-list updates | Changelog / release notes only — a signal the product is alive, not a campaign |

Space out releases: stagger announcements rather than shipping everything at once, so each moment gets attention. Reuse tactics that previously resonated; report-backed only.

## Launch checklists

### Pre-launch
- [ ] Offer passes the SLC gate
- [ ] Launch date and enrollment window confirmed by the user
- [ ] One clear value proposition; one destination URL agreed
- [ ] Owned channels ready (email list, community, course page)
- [ ] Rented channel presence optimized (profiles, pinned posts)
- [ ] Borrowed-channel partners lined up, briefed with their own copy
- [ ] Waitlist / early-access capture live
- [ ] Launch assets written (announcement email, social posts, course-page copy)
- [ ] Onboarding flow ready for new enrollees (`/onboarding`)
- [ ] KPIs agreed and in the brief (enrollments, waitlist size, traffic, signups)
- [ ] Calendar slots created via `add_event`

### Launch day
- [ ] Announcement email to the list
- [ ] Course/landing page live and correct
- [ ] Social posts live on each planned channel
- [ ] In-app / site announcement active
- [ ] Partner/borrowed posts live
- [ ] Team ready to answer questions and reply to comments
- [ ] Monitor for issues and feedback; fix forward

### Post-launch
- [ ] Onboarding email sequence active (`/email-sequence`)
- [ ] Follow-up with engaged non-buyers (waitlist reminders, objections)
- [ ] Roundup email includes the announcement (for those who missed it)
- [ ] Learner feedback gathered and acted on
- [ ] Results recorded via `record_kpi_results`; report via `/performance-report`
- [ ] Next launch moment planned (recruit the next cohort from this one's momentum)

## Post-launch momentum

It is easier to build on existing momentum than to start from scratch. Publish a launch recap ("what we built and what learners said"), turn the best launch posts into evergreen content, keep the free trial lesson as a permanent lead magnet (`/lead-magnets`), and let the closing cohort become the proof for the next one. Then plan the next launch moment — the next cohort start, the next exam season.

## Task-specific questions

1. What exactly is launching (course, cohort, exam-prep program, brand) and what is its one-line outcome?
2. Which phase is it actually at? (Pilot → seed → early access → pre-sale → full)
3. What owned channels exist today (list size, community, in-app reach)?
4. What date and enrollment window? (User only.)
5. Any real proof available: past cohort results, testimonials, instructor credibility?
6. What has been launched before, and what worked?

## Related skills

- `/launch-plan` — the phased plan document this skill executes.
- `/campaign-plan` — fitting the launch into a broader campaign.
- `/email-sequence` and `/emails` — launch and onboarding sequences.
- `/social` — the announcement posts themselves.
- `/cro` — the enrollment page; `/copywriting` for launch copy.
- `/marketing-psychology` — waitlists, exclusivity, and urgency.
- `/onboarding` — what new enrollees hit after the launch converts them.
