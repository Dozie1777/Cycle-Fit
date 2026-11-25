---
slug: campaign-plan
name: Campaign plan
description: Plan a full marketing campaign — objective, audience, messaging, channel mix, phased timeline, content calendar and KPIs — and save it as the campaign's brief, plan and calendar documents. Use when the user invokes /campaign-plan or asks to plan, design or build a campaign.
category: marketing
---

# Campaign Plan

Do not paste this document into chat — follow it. This playbook turns a
marketing goal into the campaign's structured documents: the brief
(`save_brief` / `update_brief`), the plan (`save_plan` + `add_phase`),
the calendar (`add_event`) and — once there are numbers — a report
(`save_report`). Use it when the user invokes `/campaign-plan`
(optionally with the objective or product) or asks to plan a campaign.
Write each agreed decision down the moment it is made.

## Inputs

Gather these before proposing anything. Use `ask_user` for discrete
choices (2-5 options each — goal type, budget band, launch window); ask
free-text follow-ups in chat. Never invent these values:

1. **Campaign goal** — the primary objective (drive signups, build
   awareness, launch a product, generate leads, re-engage lapsed users).
2. **Target audience** — who the campaign reaches (roles, industries,
   pain points, buying stage).
3. **Timeline** — duration and any fixed dates (launch, event, seasonal
   deadline).
4. **Budget** — an approximate amount or band. If none is given, keep the
   plan channel-agnostic and note where budget would change choices; do
   not invent a number.
5. Optional context: product, differentiators, past learnings, brand constraints, geographic focus.

Run `list_channels` early: every channel you propose must exist in the
enumeration so brief and calendar can link to it. If a needed channel is
missing, say so and ask the admin to add it, then `list_channels` again.

## Working agreement

- **Brief as you go.** The moment the user confirms objective, audience,
  key message, tone, channel mix, budget or KPIs, save it: `save_brief`
  first, `update_brief` to patch. Send the full `channelIds` array each
  time (it replaces). Never batch writes to the end.
- **Plan once the direction is agreed.** `save_plan` (draft until the
  user approves), then `add_phase` for each phase in order — objective
  plus user-approved dates. `update_phase` to adjust.
- **Calendar slots.** Agreed content becomes `add_event` (title,
  channelId from `list_channels`, scheduledAt, notes); `update_event` /
  `remove_event` to adjust.
- **KPIs in the brief**, not only in chat; measured results later go
  into a `save_report` report.
- **Budget stays in the brief and chat** — a negotiation topic:
  propose, listen, adjust.

## Campaign framework: Objective, Audience, Message, Channel, Measure

Build every campaign on these five parts, in this order.

### Objective

Define what success looks like before anything else. Pick the type:

- **Awareness** — visibility (reach, impressions, share of voice)
- **Consideration** — engagement and education (content engagement,
  email signups, webinar attendance)
- **Conversion** — leads or sales (signups, demos, purchases, pipeline)
- **Retention** — re-engagement (churn reduction, upsell, NPS)
- **Advocacy** — customers promoting (referrals, reviews, UGC)

Make it SMART: specific, measurable, achievable, relevant, time-bound.
Example: "Generate 200 qualified leads from mid-market SaaS companies in
North America within 6 weeks of launch." Get the user to confirm the
goal — and the number — before saving it as the brief objective.

### Audience

Define who you are reaching with enough specificity to guide messaging
and channel choices:

- **Demographics** — role, seniority, company size, industry
- **Psychographics** — motivations, pain points, goals, objections
- **Behavioral** — where they consume content, how they buy
- **Buying stage** — unaware, researching, or ready to buy

Write a short profile (not a full persona): "[Role] at [company type]
struggling with [pain point] and looking for [desired outcome]. They
discover solutions through [channels] and care most about [priorities]."

### Message

- **Core message** — one sentence on what the audience should think,
  feel or do.
- **Supporting messages** — 3-4 points giving evidence, addressing
  objections, elaborating benefits.
- **Proof points** — data, case studies, testimonials, third-party
  validation for each supporting message.
- **Differentiation** — what makes the offering different, including
  from doing nothing.

Message hierarchy: 1) why care? (the pain), 2) what is the solution? 3)
why us? (differentiation), 4) what now? (the CTA). Ground every message
in what the user told you — no generic filler.

### Channel

Select channels based on where the audience is, not where you are most
comfortable; see the guide below, then map picks via `list_channels`.

### Measure

Define how you will know the campaign worked: the success-metrics tables
below, aligned to the objective; primary KPI plus 3-5 secondary KPIs
into the brief once agreed.

## Channel selection guide

### Owned channels

| Channel | Best For | Typical Metrics | Effort |
|---------|----------|----------------|--------|
| Blog/Website | SEO, thought leadership, education | Traffic, time on page, conversions | Medium |
| Email | Nurture, retention, announcements | Open rate, CTR, conversions | Low-Medium |
| Social (organic) | Awareness, community, brand building | Engagement, reach, follower growth | Medium |
| Webinars | Education, lead gen, product demos | Registrations, attendance, pipeline | High |
| Podcast | Thought leadership, brand awareness | Downloads, subscriber growth | High |

### Earned channels

| Channel | Best For | Typical Metrics | Effort |
|---------|----------|----------------|--------|
| PR/Media | Awareness, credibility, launches | Coverage, share of voice, referral traffic | High |
| Guest content | Audience expansion, SEO, credibility | Referral traffic, backlinks | Medium |
| Influencer/Partner | Audience expansion, trust | Reach, engagement, referral conversions | Medium-High |
| Community | Awareness, trust, feedback | Mentions, engagement, referral traffic | Medium |
| Reviews/Ratings | Credibility, SEO, consideration | Review volume, rating, conversion lift | Low-Medium |

### Paid channels

| Channel | Best For | Typical Metrics | Effort |
|---------|----------|----------------|--------|
| Search ads | High-intent lead capture | CPC, CTR, conversion rate, CPA | Medium |
| Social ads | Awareness, retargeting, lead gen | CPM, CPC, CTR, CPA, ROAS | Medium |
| Display/Programmatic | Awareness, retargeting | Impressions, CPM, view-through conversions | Low-Medium |
| Sponsored content | Thought leadership, lead gen | Engagement, leads, cost per lead | Medium |
| Events/Sponsorships | Relationship building, brand | Leads, meetings, pipeline influenced | High |

### Selection criteria

- Where does the target audience spend time?
- Which buying stage is targeted (awareness vs conversion channels)?
- What is the budget? (paid needs spend; owned/earned need time)
- What assets exist or can be produced? (`list_assets`; `create_asset`
  seeds new ones)
- What has worked before? (only what the user reports)

For each chosen channel, record in the brief why it fits, its content format, effort level, and budget allocation if agreed.

## Calendar planning

1. **Start with milestones** — launch, events, releases, seasonal
   moments.
2. **Work backward** — what must be live when; production lead times.
3. **Map content to funnel stages** — awareness, consideration,
   conversion.
4. **Batch by theme** — weekly or bi-weekly themes.
5. **Balance channels** — no over-indexing on one channel.
6. **Build in flexibility** — ~20% of slots left open for reactive
   content.

### Content cadence guidelines

- **Blog**: 1-4 posts/week depending on team size and goals
- **Email newsletter**: weekly or bi-weekly for most audiences
- **Social**: 3-7 posts/week per platform
- **Paid**: continuous through the window, creative refresh every 2-4 weeks
- **Webinars**: monthly or quarterly depending on resources

### Production timeline benchmarks

Blog post 3-5 business days; email campaign 2-3; social posts 1-2;
landing page 5-7; video and ebook/whitepaper 2-4 weeks.

## Success metrics by campaign type

### Awareness

| Metric | What It Measures |
|--------|-----------------|
| Reach/Impressions | How many people saw the campaign |
| Brand mention volume | Increase in brand conversations |
| Share of voice | Your mentions vs competitors |
| Direct traffic | People coming to the site unprompted |
| Social follower growth | Audience building |

### Lead generation

| Metric | What It Measures |
|--------|-----------------|
| Total leads | Volume of new contacts |
| Marketing qualified leads | Leads meeting the quality threshold |
| Cost per lead | Efficiency of spend |
| Lead-to-MQL conversion rate | Quality of leads generated |
| Pipeline influenced | Revenue opportunity created |

### Product launch

| Metric | What It Measures |
|--------|-----------------|
| Signups or trials | Adoption of the new product |
| Activation rate | Users completing the key first action |
| Media coverage | Earned media hits |
| Social buzz | Mentions, shares, engagement spike |
| Feature adoption | Usage of launched features |

### Retention/engagement

| Metric | What It Measures |
|--------|-----------------|
| Churn rate change | Retention improvement |
| Engagement rate | Interactions with campaign content |
| NPS or CSAT change | Satisfaction improvement |
| Upsell/cross-sell revenue | Expansion revenue |
| Feature adoption | Usage of promoted features |

### Event/webinar

| Metric | What It Measures |
|--------|-----------------|
| Registrations | Interest generated |
| Attendance rate | Conversion from registration |
| Engagement during event | Questions, polls, chat activity |
| Post-event conversions | Leads or pipeline from attendees |
| Content repurposing reach | Downstream audience from recordings |

Targets come from the user only. Without historical data, anchor targets
to what the user says is realistic and flag them as untested.

## Budget allocation

Only with a budget the user has given or confirmed:

| Category | Share of Budget | Examples |
|----------|----------------|----------|
| Paid acquisition | 30-40% | Search ads, social ads, display |
| Content production | 20-30% | Blog, video, design, ebooks |
| Events and sponsorships | 10-20% | Conferences, webinars, meetups |
| Testing and experimentation | 5-10% | New channels, A/B tests, pilots |

Principles: 60-70% of paid budget on the highest-confidence channel;
15-20% reserved for testing; shift monthly based on results; 10-15%
contingency. Adjust to the goal and the user's history.

## Risks

List 2-3 risks (timeline slip, audience mismatch, underperforming
channels) with a mitigation each; add them to the brief body once agreed.

## After the plan

Close with one short message offering to: dive deeper into any section;
draft content pieces or seed calendar assets with `create_asset` (deck,
landing page or one-pager, attachable to calendar slots); run a
competitive analysis (`/competitive-brief`); or adjust the plan for a
different budget or timeline.
