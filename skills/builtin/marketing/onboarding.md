---
slug: onboarding
name: Onboarding
description: Design or fix post-signup activation — first-value milestone, time-to-value, activation emails, and friction diagnosis. Invoke with /onboarding when the user says learners sign up but don't start, activation is low, the first lesson never gets completed, or "help me design onboarding."
category: marketing
---

# Onboarding

Do not paste this document into chat — follow it. Get a newly enrolled learner to their first real value as fast as possible, and diagnose where learners stall when they don't. This is the post-signup activation craft — distinct from the campaign plan skill, which orchestrates pre-signup marketing phases. Use it once someone has already enrolled, registered, or signed up.

## Critical boundary

You design, draft, and plan. **You never send emails or imply you did or can** — copy is delivered copy-paste-ready, and sequences are planned on the campaign calendar via `save_plan` phases and `add_event`, executed by the user. Never invent activation rates, completion numbers, retention data, dates, or offers; use `[INSERT: ...]` placeholders where proof points belong.

## Inputs

Gather before designing. Use `ask_user` for discrete choices, plain questions for open ones. Pull what the brief already answers instead of re-asking:

1. **What the learner signed up for** — course enrollment, live-stream registration, exam-prep access, or the platform itself
2. **Activation definition** — the earliest action that predicts the learner will stick (see below); ask what the user believes, propose candidates if they don't know
3. **What happens today after signup** — welcome email, in-product first-run flow, "start here" message?
4. **Where learners currently drop off** — never start a lesson? Start but don't return? Watch streams but don't enroll?
5. **Cadence constraints** — cohort start dates, stream schedules, exam dates (these shape timing; never guess dates — ask)
6. **Tone** — from the brief's tone field or the user's stated voice; ask only if both are silent

Good `ask_user` uses: drop-off pattern ("Never start a lesson / Start but don't come back / Attend streams but don't enroll / Not sure"), activation milestone ("Complete first lesson / Attend first stream / Both"), scope ("Quick fix / Full redesign"). Never guess audience, budget, channels, timeline, or tone.

## Core principles

1. **Time-to-value is everything.** Remove every step between enrollment and the first moment of real learning value. Design the **minimum path to value**: the fewest steps to "this is going to work for me."
2. **One goal per first session.** One successful outcome — usually completing the first lesson. Save navigation, community, streaks, and advanced features for later.
3. **Do, don't show.** A learner who completes 3 minutes of lesson one is better off than one who watches a 2-minute welcome video about the course.
4. **Progress creates motivation.** Show advancement, celebrate completions, make the path visible — "Lesson 1 of 12 complete" is a reason to return.
5. **Behavior = motivation × ability × prompt, at the same moment.** If a step isn't happening, one of the three is missing: make them want it, make it easier, or prompt it better-timed.

### Psychology worth using (explain briefly when recommending)

- **Endowed progress effect** — pre-started progress drives completion; a get-started checklist that opens with enrollment pre-checked starts at 20%, not 0%
- **Peak-end rule** — engineer a clear early win and end each session pointing at the next step
- **Goldilocks rule** — the first milestone should be achievable but not trivial: "watch 3 minutes, answer one question" beats both "read the syllabus" and "complete module 1"
- **Boosters and blockers** — add boosters (pre-selected first lesson, saved progress); remove blockers (required profile fields before content, dead-end empty pages)

## Defining activation

Judge onboarding by **whether activated learners complete courses and return — not by enrollment volume**.

### The ed-tech activation ladder

```
Enrolled → First lesson started → First lesson completed → First stream attended → Weekly habit → Course completion
```

- **First-value milestone** (the aha moment): usually **first lesson completed** — the learner experienced the teaching quality and finished something. For stream-led products it may be **first stream attended**. Pick one; treat the rest as ladder steps.
- **Time-to-value**: how long enrollment → first completed lesson takes. Aim for *days, not weeks* — the longer the gap, the colder the intent. Ask what the current gap is; never assume a number.
- **Habit formation**: after first value, shift to a repeat rhythm — next lesson within days, next stream on the calendar. Define "stalled" concretely (e.g. no lesson opened in 7 days) so recovery can trigger.

### Activation metrics

- % of enrollments reaching the first-value milestone
- Time from enrollment to first lesson completed
- % returning for lesson 2 / next stream; activation by cohort/source (e.g. lead-magnet vs. direct)

Ask which of these the user can measure; recommend the smallest set that answers "are learners reaching value?"

## Flow design

### The first 5 minutes after enrollment

Whatever the first-run experience is, it must have:

- **One clear next action** — "Start lesson 1", not a dashboard of options
- **No dead ends** — every screen points to the next step; visible progress if multi-step
- **No busywork before value** — profile, preferences, and "take the tour" come after the first lesson

Patterns to recommend (match to the product):

- **Start-the-first-lesson immediately** — the default; avoid only if lesson 1 is genuinely long
- **Pre-selected "first win" lesson** — for long courses, the shortest highest-value lesson; genuinely useful, not gimmicky
- **Stream-countdown orientation** — for stream-led/cohort products; fill the waiting period with a first lesson
- **Light study-plan setup** — for exam prep; under 3 inputs, never a questionnaire

### The get-started checklist (if the product supports one)

3-5 items max, ordered by value (first lesson first, profile/community last), pre-check what's already done (enrollment — start at 20%, not 0%), and dismissable — never trap the learner in it.

### Empty states and dead ends

Every empty screen (no progress yet, no saved lessons, no stream scheduled) is an onboarding surface: explain what the area is for, show what it looks like filled, give one primary action. An empty "My progress" page that says only "nothing here yet" is a churn accelerant.

## Activation email/flow design

Email carries the learner back to the product; it should **reinforce the in-product path, not duplicate it**, and every email has one specific CTA back into a lesson or stream.

### The standard activation sequence

| # | Email | Timing | Purpose | Primary CTA |
|---|-------|--------|---------|-------------|
| 1 | Welcome + first step | Immediately | Deliver access, kill procrastination | "Start lesson 1" |
| 2 | Incomplete nudge | ~24-48h, only if no lesson started | Lower the bar: "it takes X minutes" | Same first lesson |
| 3 | Momentum | After first lesson completed | Celebrate the win, set the rhythm | "Continue with lesson 2" |
| 4 | Stream bridge | Before the next scheduled stream | Convert solo learners into live attendees | "Join the stream" |
| 5 | Stalled recovery | After the stall window | Diagnose + reduce friction | Resume where they left off |

Adjust count and timing to the product's cadence — cohort starts and stream schedules constrain this; ask for real dates and never invent them. For stream-registered (not yet enrolled) audiences the same skeleton applies with the first CTA aimed at enrollment.

For each email provide: 2-3 subject options, preview text, purpose in one sentence, full body copy in a fenced code block, one primary CTA, timing and condition notes (who skips it). This skill supplies the activation content and timing; for the full multi-email build with branching and benchmarks, hand off to `/email-sequence`.

### Branching, exit, and the campaign calendar

- **Exit**: learner completes the activation milestone → leave the nudge path
- **Branch**: started-but-not-completed gets different copy than never-started ("finish what you started" vs. "the first lesson is 6 minutes")
- **Suppression**: don't stack nudges on other active sequences; coordinate with the campaign calendar (`list_channels`, existing events)
- **Calendar**: with dates the user approves, structure the sequence as a `save_plan` phase (e.g. "Activation — first 14 days post-enrollment") and add each email/stream reminder via `add_event` (title, channelId from `list_channels`, scheduledAt, notes = trigger condition) so activation touches stay visible alongside promotional events

## Friction diagnosis

When the user says "learners sign up but don't stick," diagnose before proposing fixes. For each stage ask: **motivation missing, ability blocked, or prompt absent?**

| Symptom | Likely cause | Fix direction |
|---------|--------------|---------------|
| Enrolled, never started | No prompt at peak intent (right after payment) | Immediate "start lesson 1" moment + welcome email with the same CTA |
| Started, never finished | Lesson too long; no visible progress | Shortest high-value lesson as entry; progress indication |
| Finished lesson 1, never returned | No rhythm; next step unclear | Momentum email with a "next lesson" CTA; calendar the next stream |
| Watched streams, never enrolled | Value consumed without a conversion bridge | In-stream CTA to the course + post-stream enrollment email |
| Dropped before an exam date | Deadline invisible | Countdown framing tied to the real exam date (ask — never guess) |

**Diagnosis output format** — per issue: **Finding → Impact → Recommendation → Priority**, ranked by impact on the activation milestone, not ease of fixing. If the user can't provide data, propose the smallest instrumentation set and label recommendations as hypotheses, not facts.

## Measurement

| Metric | What it tells you |
|--------|-------------------|
| Activation rate | % of enrollments reaching the first-value milestone |
| Time to activation | How long enrollment → first completed lesson |
| Step drop-off / return rate | Where in the ladder learners stall; % back for lesson 2 / next stream |
| Recovery rate | % of stalled learners who resume after a nudge |

Funnel framing for the analysis — `Enrolled → Lesson 1 started → Lesson 1 done → Stream attended → Habit` with a % at each step (illustrative structure only; ask for real numbers and never present invented figures as the user's data). The biggest drop between adjacent steps is where to focus first.

## Experiments

Recommend 2-3 tests at a time, only where the user's platform supports measuring them: entry-point choice (default vs. shortest high-value first lesson), nudge timing (24h vs. 72h), subject style (benefit vs. curiosity), checklist presence, stream bridge format. Tie every experiment to the activation milestone; a test that doesn't move first-lesson completion or time-to-value isn't worth running. For broader test design, offer `/ab-testing`.

## Output

Structure the final response as:

1. **Activation definition** — chosen milestone and why; the ladder; what "stalled" means here
2. **Flow design** — first-5-minutes recommendation, checklist items, empty-state fixes
3. **Activation sequence** — the email table filled in: subjects, copy, timing, conditions
4. **Friction findings** (if diagnosing) — Finding → Impact → Recommendation → Priority
5. **Measurement plan** — metrics, funnel to instrument, first experiment

## After the design

Close by asking which the user wants next:

- **Draft the emails** — full activation sequence with branching via `/email-sequence`
- **Put it on the calendar** — `save_plan` phase + `add_event` per email once the user provides dates
- **Fix a specific drop-off** — deep-dive one friction point
- **Log it** — `update_brief` to capture the activation milestone definition so the campaign designs against it

Keep the turn focused: milestone, flow, sequence, diagnosis, next step.
