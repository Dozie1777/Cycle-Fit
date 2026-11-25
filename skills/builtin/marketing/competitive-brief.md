---
slug: competitive-brief
name: Competitive brief
description: Research competitors live with the browser tools and produce a positioning and messaging comparison — competitor profiles, content gaps, opportunities and threats — then fold the differentiation into the campaign's key message. Use for /competitive-brief or competitor research asks.
category: marketing
---

# Competitive Brief

Do not paste this document into chat — follow it. This playbook researches
competitors live with the browser tools and produces a structured
competitive brief in chat. Analysis only: never copy competitor copy,
claims or assets — summarize everything in your own words.

## Trigger

The user invokes `/competitive-brief` (optionally with competitor names
or a market segment) or asks for a competitive analysis, competitor
research, or market comparison.

## Inputs

- **Competitor name(s)** — required, one or more.
- **Your context** (recommended): what the product is and who it serves,
  positioning or value proposition, differentiators to highlight. Check
  the campaign brief first — objective, audience and key message may
  already be saved there.
- **Focus areas** (optional; cover all if unspecified): messaging and
  positioning, product comparison, content strategy, recent news, pricing
  if publicly available, market presence.

If competitor names are missing, use `ask_user` with 2-5 candidates
inferred from the category and the brief's audience, and let the user
type their own instead.

## Research process

For each competitor, using the browser tools (`browser_navigate` to
`https://duckduckgo.com/?q=<url-encoded query>`, then `browser_snapshot`
to read results; open the promising ones):

1. **Website** — homepage messaging, product pages, pricing, about page.
2. **Recent news** — launches, funding, partnerships (last 6 months).
3. **Content strategy** — blog topics, resource types, social presence.
4. **Reviews and comparisons** — third-party comparison pages and
   review-site themes (G2, Capterra, Product Hunt, if reachable).

Note the research date in the brief so the user knows how fresh it is.

Source authority, in order: the competitor's own site and newsroom, then
review sites and news coverage, then social profiles and community
discussions. Everything comes from the live web — there is no analytics
or CRM connector, so never state internal numbers about a competitor you
cannot see, and label any estimate as an estimate.

## Brief structure

### 1. Executive summary

2-3 sentences on the competitive landscape, plus the key takeaway: the
biggest opportunity and the biggest threat.

### 2. Competitor profiles

For each competitor:

- **Overview** — one-sentence positioning, target audience, size/stage
  signals, key recent developments.
- **Messaging** — primary tagline, core value proposition, 3-5 messaging
  themes, tone, how they describe the problem they solve.
- **Product positioning** — how they categorize the product, emphasized
  features, claimed differentiators, pricing approach if public.
- **Content strategy** — blog frequency and topics, formats produced,
  social approach, apparent SEO targets.
- **Strengths** — what they do well, where their messaging resonates.
- **Weaknesses** — gaps in messaging or positioning, vulnerabilities,
  complaint themes from reviews.

### 3. Messaging comparison matrix

| Dimension | Your Company | Competitor A | Competitor B |
|-----------|-------------|--------------|--------------|
| Primary tagline | ... | ... | ... |
| Target buyer | ... | ... | ... |
| Key differentiator | ... | ... | ... |
| Tone/voice | ... | ... | ... |
| Core value prop | ... | ... | ... |

Include "Your Company" only if the user provided positioning context.

### 4. Messaging analysis frameworks

**Value proposition** — for each competitor: **Promise** (what they claim
the customer achieves), **Evidence** (how they prove it), **Mechanism**
(how the product delivers), **Uniqueness** (what they claim only they do).

**Narrative** — each competitor's story arc: **Villain** (the enemy —
status quo, legacy tools, complexity), **Hero** (customer, product, or
team), **Transformation** (the before/after promised), **Stakes** (what
happens without acting). This reveals positioning strategy and emotional
appeals.

**Messaging strengths and vulnerabilities** — clarity (can a first-time
visitor tell what they do in 5 seconds?), differentiation (distinct or
generic?), proof (claims backed by evidence?), consistency (across
channels?), resonance (real customer pain addressed?).

### 5. Content gap analysis

| Topic/Theme | Your Content | Competitor A | Competitor B | Gap? |
|-------------|-------------|--------------|--------------|------|
| [Topic 1] | Blog post, ebook | Blog series, webinar | Nothing | Opportunity |
| [Topic 2] | Nothing | Whitepaper | Blog post, video | Gap for you |
| [Topic 3] | Case study | Nothing | Case study | Parity |

Fill the "Your Content" column from the campaign's seeded assets
(`list_assets`) and anything the user reports; mark rows you could not
verify. Opportunities to name: topics they cover that you don't; topics
you cover that they don't (amplify these); formats they use that could
reach new audiences; segments they underserve.

### 6. Opportunities

Positioning gaps to exploit, messaging angles competitors have not
claimed, underserved audience segments, content or channel opportunities.

### 7. Threats

Where competitors are strong and the campaign's product is vulnerable;
trends favoring their positioning; recent moves that could shift the
market.

### 8. Recommended actions

3-5 specific, actionable recommendations: quick wins for this week, and
strategic moves for longer-term positioning or content investment.

### 9. Positioning frameworks (use as needed)

**Positioning statement** — reverse-engineer each competitor's:
"For [target audience], [product] is the [category] that
[differentiator] because [reason to believe]."

**Positioning map** — a 2x2 on the two dimensions that matter most in
the market: price vs capability, ease of use vs power, SMB vs enterprise
focus, point solution vs platform, innovative vs established. Name the
underserved quadrant.

**Category strategy** — create a new category (high risk, high reward),
reframe the existing one, win it on execution, or niche within it.
Pitfalls to avoid: positioning against a competitor rather than for a
customer need; claiming too many differentiators (pick 1-2); category
jargon the customer does not use; features over outcomes.

### 10. Battlecard (on request)

A one-page reference for sales and marketing — best delivered as an
asset: propose it, and once the user wants it, `create_asset`
(one-pager). Contents:

- **Their pitch** — how they describe themselves, tagline, top 3 claimed
  differentiators.
- **Strengths (be honest)** — where they genuinely compete well; what
  customers like about them (from reviews).
- **Weaknesses** — consistent customer complaints, technical limits,
  offering gaps.
- **Our differentiators** — 3-5, each with why it matters to the
  customer and proof.
- **Objection handling** — "if the prospect says… / respond with…"
  pairs ("[Competitor] is cheaper" → what the price difference gets
  you).
- **Landmines** — questions to raise early that highlight your
  advantages ("How do you currently handle [their weak area]?"), and the
  ones competitors set that you must defuse.

## Folding it into the campaign

A competitive brief only matters if it changes the campaign. Close with
one short message offering to:

- Fold the strongest differentiation into the campaign's key message —
  propose the exact wording, then `update_brief` the key-message field
  only on agreement.
- Seed a positioning deck or battlecard one-pager with `create_asset`.
- Go deeper on one specific competitor.
- Re-run the scan later: a full pass quarterly, a light monitoring pass
  monthly.

## Boundaries

- Research and analysis only. Never copy competitor copy, claims,
  imagery or assets; write everything in your own words.
- Only state facts you actually saw on a page, with the research date.
  If a site blocks the browser or pricing is not public, say so rather
  than guessing.
