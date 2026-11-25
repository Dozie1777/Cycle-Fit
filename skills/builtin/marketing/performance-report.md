---
slug: performance-report
name: Performance report
description: Build a campaign performance report from numbers the user provides — KPI table against brief targets, wins and misses, learnings, next-period recommendations — and save it with save_report. Use when the user invokes /performance-report or asks for campaign results or a metrics summary.
category: marketing
---

# Performance Report

Do not paste this document into chat — follow it. This playbook turns
numbers the user provides into a saved performance report (`save_report`):
a KPI table against targets, a one-paragraph summary, and a full markdown
body with wins, misses, learnings and next-period recommendations.

## Trigger

The user invokes `/performance-report` (optionally followed by the period
or campaign) or asks for a marketing report, campaign results,
performance analysis, or metrics summary.

## Data source

There is no analytics connector. Every number comes from the user —
pasted metrics, CSV-style lines, a described dashboard, or stated
highlights. Never invent, estimate or backfill a metric. If the user
invokes the skill with no data, ask for it in chat: "Paste or share your
performance data — spreadsheets, key numbers, or a description of the
dashboard all work."

## Inputs

- **Scope** — a campaign report, a channel report (email, social, paid,
  organic), content performance, or a cross-channel summary. If unclear,
  ask with `ask_user` (2-5 options).
- **Period** — the reporting window (last week, last month, last
  quarter, custom range). Confirm the exact dates; never guess them.
- **Targets** — read the KPIs from the campaign brief first. If the
  brief has no KPIs or no targets, ask the user for targets before
  writing anything; without agreed targets the report can only describe,
  not evaluate — say which mode you are in.
- **Comparison** (optional) — prior-period values for trend context.
- **Audience** (optional) — executive summary style vs detailed analyst
  view.

## Collecting the numbers

Work with the user until, for each metric, you have: name, actual value
for the period, target (from the brief or the user), and prior-period
value if they want trend context. Ask for the brief's KPIs one by one
rather than dumping a form. Metrics the user cannot provide stay out of
the table — note them as "not tracked" in the body if relevant.

## Report structure

### 1. Executive summary

2-3 sentences: the headline metric with its direction vs target, one key
win, one area of concern. Suitable for forwarding to leadership.

### 2. KPI table

| Metric | This Period | Prior Period | Change | Target | Status |
|--------|------------|--------------|--------|--------|--------|

Status: on track (meets or exceeds target), at risk (below target but
within an acceptable range), off track (significantly below). Derive
change and status only from the user's numbers.

### 3. What worked

Top 3-5 wins with specific data; the hypothesis for why they performed;
how to replicate or scale each.

### 4. What needs improvement

Bottom performers with specific data; hypotheses for underperformance;
recommended fixes.

### 5. Insights and observations

Patterns not obvious from the metrics alone; audience behavior; creative
or content themes that resonated; external factors the user mentions
(seasonality, news, competitive moves).

### 6. Recommendations

For each: what to do, why (tied to a specific insight), expected impact
(high/medium/low), effort (high/medium/low), and priority (immediate /
next sprint / next quarter). Prioritize in a 2x2:

| | Low Effort | High Effort |
|---|---|---|
| **High Impact** | Do first | Plan for next sprint |
| **Low Impact** | Do if time allows | Deprioritize |

### 7. Next-period focus

Top 3 priorities, tests or experiments to run, and targets — agreed with
the user only, never invented.

## Metric reference

Use these to interpret and sanity-check the user's numbers — not to fill
the table with metrics nobody tracked.

### Email

| Metric | Benchmark Range | What It Tells You |
|--------|----------------|-------------------|
| Open rate | 15-30% | Subject line and sender effectiveness |
| Click-through rate | 2-5% | Content relevance and CTA effectiveness |
| Click-to-open rate | 10-20% | Email content quality |
| Unsubscribe rate | <0.5% | Content-audience fit and frequency |
| Bounce rate | <2% | List quality and hygiene |
| Conversion rate | 1-5% | End-to-end email effectiveness |

### Social

| Metric | What It Tells You |
|--------|-------------------|
| Impressions / reach | Distribution and audience breadth |
| Engagement rate | Content resonance |
| Click-through rate | Traffic-driving effectiveness |
| Follower growth | Audience building |
| Share rate | Virality and advocacy |

### Paid

| Metric | What It Tells You |
|--------|-------------------|
| CTR | Creative and targeting relevance |
| CPC / CPM | Traffic and awareness cost efficiency |
| Conversion rate | Landing page and offer effectiveness |
| CPA | Full-funnel cost efficiency |
| ROAS | Revenue generation efficiency |

### Content and organic

| Metric | What It Tells You |
|--------|-------------------|
| Pageviews / unique visitors | Reach and audience size |
| Time on page / bounce rate | Engagement and content fit |
| Organic sessions | SEO effectiveness |
| Keyword ranking movement | Search visibility |
| Conversions attributed to content | Content conversion effectiveness |

### Overall

| Metric | What It Tells You |
|--------|-------------------|
| Leads / MQLs | Top-of-funnel effectiveness |
| MQL→SQL conversion | Lead quality |
| Pipeline generated | Revenue opportunity created |
| CAC | Acquisition efficiency |
| Marketing-sourced revenue | Direct marketing contribution |

### Attribution caution

Buyers touch multiple channels before converting, so single-touch
numbers overstate some channels: last-touch flatters conversion channels
and hides awareness work; first-touch does the reverse. Use attribution
directionally, never as absolute truth, and do not optimize one channel
in isolation on single-touch data.

## Trend analysis

With 4+ periods of user-provided data: look for direction, inflection
points (and what changed then), seasonality, anomalies, and leading
indicators. Overlay events the user mentions (launches, product changes,
market events). With fewer than 4 periods, describe the period against
target and prior period only — do not fabricate a trend.

## Saving the report

Save only once the user has confirmed the numbers. `save_report` with:

- **title** — e.g. "Launch phase performance — weeks 1-4".
- **period** — the exact window the user confirmed.
- **summary** — the one-paragraph executive summary.
- **metrics** — the KPI table rows.
- **body** — the full markdown report (sections 1-7).

The dashboard renders the saved report; do not paste the whole body into
chat as well — a one-line confirmation plus the headline takeaway is
enough.

## Optimization levers

When diagnosing misses, map the problem signal to the funnel stage:

| Funnel Stage | Problem Signal | Levers |
|-------------|---------------|--------|
| Awareness | Low impressions/reach | Budget, targeting, channel mix, format |
| Interest | Low CTR/engagement | Creative, headlines, hooks, targeting |
| Consideration | High bounce, low time on page | Landing content, relevance, UX |
| Conversion | Low conversion rate | Offer, CTA, form length, trust signals |
| Retention | High churn, low repeat engagement | Onboarding, nurture, product experience |

Testing discipline: one variable at a time, define the success metric
before starting, run a full business cycle minimum, and document results
either way — a test that confirms the status quo still builds confidence.

## After the report

Close with one short message offering to:

- Create a slide-ready summary of the results (seed a deck with
  `create_asset`).
- Update the brief's KPIs for the next period with `update_brief` once
  the user agrees to new targets.
- Dive deeper into a metric or channel — from data the user provides.
- Set up the KPI list in the brief now, so the next report has targets
  to measure against.
