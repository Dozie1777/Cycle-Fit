---
slug: email-sequence
name: Email sequence
description: Plan and draft a full multi-email sequence — welcome/onboarding, abandoned enrollment, re-engagement, win-back, launch — with subject options, copy, CTA, timing, branching logic, and benchmarks. Invoke with /email-sequence plus the sequence type, or ask for a drip/nurture/onboarding series.
category: marketing
---

# Email Sequence

Do not paste this document into chat — follow it. Design and draft complete email sequences with full copy, timing, branching logic, and performance benchmarks for any lifecycle or campaign use case.

## Critical boundary

**Never send anything, and never imply you did or can.** There is no email-sending tool here. All copy is delivered in chat, copy-paste-ready, for the user to load into their own sending tool. Frame every output as "here is the copy for your email platform" — nothing more.

## Inputs

Gather the following from the user. If not provided, ask before proceeding — use `ask_user` for discrete choices (sequence type, count band, cadence), plain questions for open ones:

1. **Sequence type** — welcome/onboarding, lead nurture, re-engagement, abandoned enrollment, course launch, event follow-up, upgrade/upsell, win-back, educational drip
2. **Goal** — what the sequence should achieve (activate new learners, convert leads into enrollments, reduce churn, drive stream attendance, upsell a course tier)
3. **Audience** — who receives it, what stage they are at, and any segmentation details (lifecycle stage, behavior triggers, exam timeline); use the brief's audience field if it matches, confirm if not
4. **Trigger** — what event enrolls someone into the sequence (signup, enrollment started but not completed, course purchase, cohort start, 30 days inactive). Never guess the trigger; ask if unclear
5. **Number of emails** (optional) — if not specified, recommend a count from the Sequence Type Templates below
6. **Timing/cadence preferences** (optional) — e.g. "every 3 days", "weekly", "aggressive first week then taper off"
7. **Tone** — from the brief's tone field or the user's stated voice; ask only if both are silent
8. **Additional context** (optional) — offers/incentives to include, CTA destinations, content assets available, features to highlight, differentiators

Never invent offers, discounts, dates, or numbers the user has not given.

## Core principles

- **One email, one job.** Each email has one primary purpose and one main CTA. Don't try to do everything.
- **Value before ask.** Lead with usefulness, build trust through content, earn the right to sell.
- **Relevance over volume.** Fewer, better emails win. Segment for relevance; quality > frequency.
- **Clear path forward.** Every email moves the recipient somewhere; make the next step obvious.

## Process

### 1. Sequence Strategy

Before drafting any emails, define the overall sequence architecture:

- **Narrative arc** — what story does this sequence tell across all emails? What is the emotional and logical progression from first email to last?
- **Journey mapping** — map each email to a stage of the learner or buyer journey (awareness, consideration, decision, activation, expansion)
- **Escalation logic** — how does the intensity, urgency, or value of each email build on the previous one?
- **Success definition** — what specific action signals the sequence has done its job and the recipient should exit (enrolled, attended, completed onboarding)?

### 2. Individual Email Design

For each email in the sequence, produce:

#### Subject Line
- Provide 2-3 options per email
- Vary approaches using the patterns below; keep under 50 characters where possible and note mobile preview behavior
- Clear > clever, specific > vague, benefit or curiosity driven; test emoji sparingly (polarizing)
- The subject must hold up if it is the only line the reader sees — no fake "Re:"/"Fwd:", no clickbait

**Patterns that work:** Question ("Still stuck on lesson 3?"), How-to ("How to finish your WAEC prep in 6 weeks"), Number ("3 ways to make your course page convert"), Direct ("Ama, your free lesson is ready"), Story tease ("The mistake I made pricing my first course")

#### Preview Text
- 40-90 characters that complement (not repeat) the subject line — extend the thought or add intrigue
- No em dashes in subject lines or preview text

#### Email Purpose
- One sentence explaining why this email exists and what it moves the recipient toward

#### Body Copy
- Full draft ready to paste into an email platform
- Structure: **hook** (first line grabs attention and states why you're writing) → **context** (why this matters to them) → **value** (the useful content) → **CTA** → **human sign-off**
- Short paragraphs (2-3 sentences max); scannable formatting; bold for emphasis sparingly; mobile-first — most email is read on a phone
- Personalization tokens where relevant (first name, course name, next lesson)
- Length bands: 50-125 words transactional, 150-300 educational, 300-500 story-driven
- Never fabricate stats, quotes, student names, or results; use a clear `[INSERT: ...]` placeholder instead

#### Primary CTA
- Button text (action + outcome) and destination; buttons for primary actions, links for secondary
- One primary CTA per email

#### Timing
- Days after the trigger event or after the previous email
- Note if timing should adjust based on engagement (e.g., "send sooner if they opened but did not click")

#### Segment/Condition Notes
- Who receives this email vs. who skips it, with behavioral or attribute conditions (e.g., "only send to learners who have not completed their first lesson")

### 3. Sequence Logic

Define the flow control for the sequence:

- **Branching conditions** — alternate paths based on engagement. For example:
  - "If opened email 2 but did not click CTA, send email 2b (softer re-ask) instead of email 3"
  - "If clicked CTA in email 1, skip email 2 and go directly to email 3"
- **Exit conditions** — when a recipient converts (completes the desired action), remove them from the sequence. Define what "conversion" means for this sequence.
- **Re-entry rules** — can someone re-enter the sequence? Under what conditions?
- **Suppression rules** — do not send if the recipient is already in another active sequence, has unsubscribed from marketing, or contacted support in the last 48 hours

### 4. Performance Benchmarks

Provide expected benchmarks based on the sequence type so the user can set targets:

| Metric | Onboarding | Lead Nurture | Re-engagement | Win-back |
|--------|-----------|--------------|---------------|----------|
| Open rate | 50-70% | 20-30% | 15-25% | 15-20% |
| Click-through rate | 10-20% | 3-7% | 2-5% | 2-4% |
| Conversion rate | 15-30% | 2-5% | 3-8% | 1-3% |
| Unsubscribe rate | <0.5% | <0.5% | 1-2% | 1-3% |

Present these as **industry reference ranges**, not predictions. Adjust based on industry and audience if the user has provided that context.

## Timing and cadence defaults

If the user has no preference, start from these and confirm:

- Welcome/trigger email: **immediate**
- Early sequence: 1-2 days apart
- Nurture emails: 2-4 days apart
- Long-term drip: weekly or bi-weekly
- Re-engagement: 3-5 days apart; win-back: spaced over 2-4 weeks

Considerations: avoid weekends for professional audiences, test weekends for consumer audiences; send in the recipient's local time zone where the platform supports it; taper frequency as the sequence progresses.

## Sequence Type Templates

Use these as starting frameworks. Adapt length and content based on the user's goal and audience.

- **Welcome/Onboarding (5-7 emails over 12-14 days):** Welcome + deliver promised value (immediate) → Quick win in the first lesson (day 1-2) → Story/why the course exists (day 3-4) → Social proof from past learners (day 5-6) → Overcome the main objection (day 7-8) → Core feature or curriculum highlight (day 9-11) → Conversion: enroll in the full course or cohort (day 12-14). Coordinate with in-app onboarding — email supports it, doesn't duplicate it.
- **Lead Nurture (6-8 emails over 2-3 weeks):** Deliver lead magnet + intro (immediate) → Expand on topic (day 2-3) → Problem deep-dive (day 4-5) → Solution framework (day 6-8) → Case study (day 9-11) → Differentiation (day 12-14) → Objection handler (day 15-18) → Direct offer (day 19-21)
- **Abandoned Enrollment (3-5 emails over 7-10 days):** Reminder the enrollment is one step away (day 0-1) → Answer the top objection or question (day 2-3) → Social proof from enrolled learners (day 4-5) → Incentive if the user provides one (day 6-7) → Last call with clear deadline (day 8-10). Exit immediately if they complete enrollment.
- **Re-engagement (3-4 emails over 2 weeks; trigger: 30-60 days inactive):** Genuine check-in ("you haven't logged in lately") → Value reminder — what's new since they left (new lessons, new cohort, new features) → Incentive or special offer → Last chance: stay or unsubscribe gracefully
- **Win-back (3-5 emails over 30 days; trigger: cancelled or expired):** Friendly check-in asking what went wrong → What is new since they left → Special offer or incentive to return → Feedback request (even if they do not come back) → Final goodbye with the door open
- **Course Launch (4-6 emails over 2-3 weeks):** Teaser/pre-announcement → Launch announcement with full details → Curriculum or use-case spotlight → Social proof and early results → Limited-time offer or bonus if provided → Last chance or reminder
- **Event Follow-up (3-4 emails over 7-10 days):** Thank you with key takeaways or recording → Resource roundup from the stream → Related offer or next step (next stream, related course) → Feedback survey
- **Upgrade/Upsell (3-5 emails over 2-3 weeks):** Usage or progress milestone celebration → Feature gap or limitation they are hitting → Upgrade benefits with proof → Limited-time incentive → Direct comparison of tiers
- **Educational Drip (5-8 emails over 4-6 weeks):** Introduction and what they will learn → Lesson 1: foundational concept → Lesson 2: intermediate concept → Lesson 3: advanced concept → Practical application or exercise → Resource roundup → Graduation and next steps

If the user's ask doesn't fit a template, build the sequence from the core principles instead — never force a mismatched template.

## Writing rules — no AI tells

Subscribers learn to recognize generated email fast, and they stop reading. Write from the specific thing you want them to know or do.

Never write:

- **Contrast reveals**: "It's not X, it's Y." "Not because X. Because Y." State Y directly, with the reason.
- **Negation lists**: "No X, no Y, no Z." Say what does happen. One plain absence ("No card required") is fine.
- **Trailing pile-ons**: a full claim, then a comma and more restating clauses. End the sentence at the claim.
- **Self-answered questions and colon reveals**: "The result? 3x faster." "The best part: it learns." FAQ questions and a question in the reader's own voice are fine.
- **Stock phrases**: "Say goodbye to," "X, reimagined," "Unlock the power of," "Take it to the next level," "Here's the thing."
- **Em dashes** in subject lines and preview text; at most one or two in a long email.
- **Subject-line bait**: fake "Re:" or "Fwd:", "You won't believe...", "🔥 Big news."
- **Stock openers**: "I hope this email finds you well," "Just checking in," "Great news!" Open with the reason you're writing.
- **Sign-off filler**: "Feel free to reach out if you have any questions." Ask for one specific action, or end.

Read the draft out loud — if it does not sound like a person, rewrite it.

## Output

Present the complete sequence with the following sections:

### Sequence Overview Table

| # | Subject Line | Purpose | Timing | Primary CTA | Condition |
|---|-------------|---------|--------|-------------|-----------|

### Full Email Drafts

Each email with subject line options, preview text, purpose, body copy, CTA, timing, and segment notes — every body in a fenced code block, copy-paste-ready.

### Sequence Flow Diagram

A text-based diagram showing the email flow, branching paths, and exit points:

```
[Trigger] --> Email 1 (Day 0)
                |
          Opened? --Yes--> Email 2 (Day 3)
                |              |
                No        Clicked CTA? --Yes--> [EXIT: Converted]
                |              |
                v              No
          Email 1b (Day 2)     |
                |              v
                +--------> Email 3 (Day 7)
                               |
                               v
                          Email 4 (Day 10)
                               |
                          [EXIT: Sequence complete]
```

### Branching Logic Notes

Summary of all conditions, exits, and suppressions in a reference list.

### Setup Checklist (for the user's own email platform)

1. Create the automation or flow
2. Set the enrollment trigger
3. Add each email with the specified delays
4. Configure branching and exit conditions
5. Set up tracking for the recommended metrics

### A/B Test Suggestions

- 2-3 recommended A/B tests (subject lines, CTA text, send time, email length)
- What to test, how to split, and how to measure the winner

### Metrics to Track

- Primary conversion metric for the sequence
- Per-email metrics: open rate, CTR, unsubscribe rate
- Sequence-level metrics: overall conversion rate, time to conversion, drop-off points
- Recommended review cadence (e.g., "Review performance weekly for the first month, then monthly")

## After the Sequence

Offer follow-ups — ask which the user wants:

- Revise the copy or tone for any specific email
- Add a branching path for a specific scenario
- Create a variation of this sequence for a different audience segment
- Draft the A/B test variants for the subject lines
- **Put the send schedule on the campaign calendar**: with dates the user approves, add one `add_event` per email (title = subject, channelId = the campaign's Email channel from `list_channels`, scheduledAt = the send date, notes = audience/branch notes); adjust with `update_event`
- Build a companion sequence (e.g., a post-enrollment follow-up after this lead nurture converts)
