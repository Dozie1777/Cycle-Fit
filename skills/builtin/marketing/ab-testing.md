---
slug: ab-testing
name: A/B testing
description: Design marketing experiments — hypothesis, variants, metrics, sample-size reality checks, and result write-ups. Invoke with /ab-testing when the user says A/B test, split test, experiment, which version is better, or wants to test a headline, CTA, subject line, or landing page change.
category: marketing
---

# A/B Testing

Do not paste this document into chat — follow it. Use this skill to design experiments that produce valid, actionable results.

## Ground rules for this platform

- **There is no experiment platform here.** No built-in traffic splitter, no statistical engine, no analytics connector. Your outputs are: a **test design** (hypothesis, variants, metrics, sample-size plan), the test **scheduled into the campaign**, and a **result write-up** once the user brings back the numbers. The user runs the test in whatever tool they use; you make it rigorous.
- **Never invent results.** Every number in a write-up — sample sizes, conversion rates, lifts, p-values — comes from the user or their tool. Missing data means asking, not estimating.
- **The campaign doc is the experiment log.** Plan the test into the campaign with `save_plan` / `add_event` (launch date, wrap date the user confirms), and record outcomes with `record_kpi_results` once results exist. Write the full test design and learning into a `save_report` or the plan notes so it survives the session.
- The brief is the source of truth for audience, channel, and tone; `list_channels` before referencing any channel.

## Inputs to gather

Before designing anything, establish (ask with `ask_user` for discrete choices, plain questions otherwise):

1. **What to improve** — the page, email, ad, or flow, and the specific element under consideration
2. **The change being considered** — and why the user believes it will help
3. **Baseline** — current conversion rate or metric level (must come from the user's data)
4. **Traffic/volume** — how many people reach this element per week
5. **Constraints** — timeline, tooling, what's technically feasible

If baseline and volume are unknown, the first deliverable is a **reality check** (below), not a test design.

## Hypothesis first

Every test starts with a written hypothesis. Weak tests are "let's see what happens."

```
Because [observation/data],
we believe [specific change]
will cause [specific outcome] for [audience].
We'll know this is true when [metric moves by X].
```

**Weak:** "Making the enroll button green might get more clicks."

**Strong:** "Because several prospective learners said they didn't realize enrollment included the mock-exam bundle, we believe adding 'Includes 5 graded mock exams' to the enroll section of the course page will increase enrollments by 10%+ for exam-season visitors. We'll measure enrollment starts per page view."

The "because" should come from data, research (`/customer-research`), or a psychological principle (`/marketing-psychology`) — not from a whim. If the user can't articulate a "because," that's the gap to fill first.

## Prioritizing what to test

When the user has multiple candidate ideas, score them with **ICE** (1-10 each, average):

- **Impact** — if it works, how much does it move the primary metric?
- **Confidence** — how strong is the evidence behind the "because"? (Data > research > intuition.)
- **Ease** — how fast and cheap to ship and measure?

Run the highest scores first; re-score as results land. Encourage the user to keep a running backlog of hypotheses — losers and inconclusive tests feed new hypotheses.

Also weigh: **is this test worth running at all?** A change too small to detect, or a page with too little traffic, fails the reality check below — better to make the bolder version of the change, or ship it outright and measure before/after directionally.

## Metrics selection

- **Primary metric** — the single metric the test will be called on, tied directly to the hypothesis (e.g., enrollment starts per course-page view, email click rate, free-lesson-to-enrolled rate).
- **Secondary metrics** — explain *why* the primary moved (page scroll depth, time on page, plan/track mix).
- **Guardrail metrics** — things that must not get worse (refund rate, unsubscribe rate, support questions, trial-to-paid rate). Stop the test if a guardrail degrades badly.

Ed-tech example — testing a new course-page hero:

- Primary: enrollment start rate
- Secondary: scroll-to-pricing rate, which cohort date gets picked
- Guardrail: bounce rate, refund rate

One primary metric only. If everything is a metric, nothing is.

## Sample size and traffic reality check

This is where enthusiasm meets arithmetic. Rough per-variant sample sizes for 95% confidence and 80% power:

| Baseline rate | Detect +10% relative | Detect +20% relative | Detect +50% relative |
|---------------|----------------------|----------------------|----------------------|
| 1%            | ~150,000             | ~40,000              | ~7,500               |
| 3%            | ~53,000              | ~14,000              | ~2,500               |
| 5%            | ~31,000              | ~8,500               | ~1,600               |
| 10%           | ~15,000              | ~4,000               | ~700                 |

(Lift is relative: 3% → 3.6% is a 20% lift. The user's testing tool's sample-size calculator is authoritative; these numbers are for the reality check.)

**Reality-check questions, asked in this order:**

1. How many people hit this element per week?
2. What's the baseline rate?
3. What's the smallest lift that would matter to the business?
4. Divide: does the traffic deliver the needed sample in a reasonable window (2-6 weeks typical)?

**If the answer is no — and for most early-stage campaigns it is — say so plainly and offer the honest alternatives:**

- **Test the bolder change.** Big swings (a different headline angle, a different offer structure) need smaller samples to detect than button-color nudges.
- **Move the test upstream or downstream.** Test on the email list (you control volume and timing) instead of a low-traffic page; test on a cohort-launch sequence rather than an evergreen page.
- **Ship and measure directionally.** If one version is clearly better by reasoning and the traffic can't support a controlled test, ship it and compare before/after — labeled as directional, never as proof.
- **Lengthen honestly.** Doubling the run window is legitimate; "running until it's significant" is not (see peeking).

Never design a test the traffic can't support without flagging it. A test that "wins" at n=200 is noise.

## Designing the variants

- **One variable per test.** Headline *or* hero image *or* CTA copy — not all three. If two things change and it wins, you don't know what worked and the learning doesn't transfer.
- **Bold enough to matter.** If the change is a 5% wording tweak on a 2% baseline, the required sample is absurd. Variants should be genuinely different expressions of the hypothesis.
- **True to the hypothesis.** Variant B must actually implement the "because." Testing a rewritten headline when the hypothesis was about social proof tests nothing.
- **Control stays untouched.** The current version is the baseline; changing it mid-test invalidates everything.

For email, the natural test unit is subject line (2-3 options is a lightweight A/B the user's ESP can run); for pages, the hero + CTA zone; for ads, the hook line.

## Running the test

**Pre-launch checklist:**

- [ ] Hypothesis written and logged (plan notes)
- [ ] Primary metric and guardrails defined
- [ ] Sample size and end date computed from real traffic
- [ ] Variants implemented and QA'd by the user
- [ ] Tracking verified on both arms
- [ ] Test scheduled in the campaign: `add_event` for launch and the wrap date

**During the test — the user's rules, which you should hand them verbatim:**

- Don't peek and stop early. Checking for technical breakage is fine; calling the winner before sample size is not — it produces false positives at an alarming rate.
- Don't edit variants mid-test.
- Don't add traffic from a new source mid-test (new audiences change the baseline).
- Do document external factors (an exam date, a holiday, a price change) that hit one arm unequally.

## Analyzing and writing up results

When the user brings back numbers, structure the analysis:

1. **Sample reached?** If below plan, label everything preliminary.
2. **Significant?** Read the tool's p-value or confidence interval as the tool defines it. A p-value is the probability of data at least this extreme *assuming no real effect* — it is not "the chance the result is real" and not a guarantee the winner wins again. Report the interval and effect size alongside it.
3. **Effect size meaningful?** A significant +0.3% lift may not be worth the change. Compare against the "smallest lift that matters" from the reality check.
4. **Guardrails clean?** Any degradation?
5. **Consistent segments?** If mobile wins and desktop loses, say so — but treat unplanned segment findings as exploratory until confirmed in a new test.

**Result write-up template** (deliver in chat; persist via `save_report` and `record_kpi_results` for the headline numbers):

```
## [Test name] — [dates run]
Hypothesis: [the "because/believe/when" statement]
Variants: A (control) — [desc]; B — [desc]
Sample: [n per variant, source]
Result: [winner / loser / inconclusive]
  Primary metric: [baseline → variant, change %, tool-reported significance]
  Guardrails: [any movement]
  Segments: [notable, if planned]
Decision: [ship B / keep A / iterate]
Why it worked/failed: [2-3 sentences]
Reusable pattern: [one line — e.g. "mock-exam proof points near the enroll CTA lift enrollment"]
Apply next to: [other courses/emails/flows]
```

Even a loser is a learning: "This audience ignored urgency framing" redirects the next three tests.

## Common mistakes to design against

- Testing trivial changes on tiny traffic (undetectable by construction)
- Multiple variables per test (unattributable)
- No written hypothesis (unlearnable)
- Stopping at significance instead of at sample size
- Cherry-picking the segment where the variant won
- Declaring a winner on a directional before/after comparison
- Re-testing the same hypothesis expecting a different answer

## Handoffs

- **Test ideas from page/friction diagnosis:** `/cro`
- **Hypotheses grounded in audience beliefs and language:** `/customer-research`
- **Psychology-backed "becauses":** `/marketing-psychology`
- **Variant copy for the tested element:** `/copywriting` or `/draft-content`
- **Rolling results into the campaign story:** `/performance-report`

Close each design session by asking: schedule the launch and wrap dates into the campaign (`add_event`), write the design into a `save_report`, or both — using dates the user confirms, never invented ones.
