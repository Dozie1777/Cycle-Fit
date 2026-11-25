---
slug: brand-review
name: Brand review
description: Audit a brand — positioning, voice, visual identity and consistency — from pasted guidelines, website pages reviewed with browser tools, the project's brand kit, or the campaign's brief and assets. Use when the user invokes /brand-review or asks to review or audit their brand or copy.
category: marketing
---

# Brand Review

Do not paste this document into chat — follow it. This playbook audits a
brand — positioning, voice, visual identity, consistency — and delivers a
structured review in chat with findings, severity and specific fixes.
Adapt it to the review the user actually wants: the whole brand, one
piece of copy, or the campaign's brief and assets.

## Trigger

The user invokes `/brand-review` (optionally followed by what to review)
or asks to review, check or audit their brand, voice or copy against
guidelines.

## Sources

Brand material comes from the user or the project — there is no
connector. Work with whatever exists:

- **Pasted guidelines** — style guides, voice docs, messaging pillars.
- **Websites** — review live pages with the browser tools
  (`browser_navigate` + `browser_snapshot`): homepage, about, product
  pages, recent campaign pages.
- **The project's brand kit** — palette, typography and voice, if one
  exists on the project; design assets seeded with `create_asset` follow
  it.
- **The campaign's documents** — the brief (objective, audience, key
  message, tone) and seeded assets via `list_assets`.
- **Copy to check** — pasted directly into the conversation.

If nothing is provided, use `ask_user` to pick the scope: paste
guidelines, give URLs to review, review the campaign's brief and assets,
or a general clarity/consistency review with no guidelines.

## Review process

### With brand guidelines

Evaluate against each dimension:

#### Positioning and messaging
- Does the material align with the stated positioning and value props?
- Are claims consistent with approved messaging — reinforcing it or
  contradicting it?

#### Voice and tone
- Does the material match the defined voice attributes?
- Is the tone right for the content type and audience?
- Flag specific sentences or phrases that deviate, with why.

#### Terminology
- Are preferred brand terms used correctly, and any "avoid" terms
  present?
- Are product, feature and branded names correctly capitalized and
  formatted?
- Is the jargon level right for the audience?

#### Visual identity (when reviewing sites or assets)
- Palette and typography consistent with the brand kit?
- Logo usage, imagery style, layout conventions consistent across pages
  and assets?

#### Style mechanics
- Grammar, punctuation, casing per the guide; formatting conventions;
  number and date formats; acronyms defined on first use.

### Without guidelines (generic review)

- **Clarity** — is the main message clear in the first paragraph?
  Sentences concise? Structure logical? Any ambiguous statements?
- **Consistency** — tone consistent throughout? Terms consistent (no
  switching synonyms for the same concept)? Formatting consistent?
- **Professionalism** — free of typos and awkward phrasing? Tone right
  for the audience? Claims substantiated?

### Legal and compliance flags (always check)

Flag regardless of guidelines:

- **Unsubstantiated claims** — superlatives ("best", "fastest", "only")
  without evidence or qualification.
- **Missing disclaimers** — financial, health or guarantee claims that
  may need them.
- **Comparative claims** — competitor comparisons that could be
  challenged.
- **Regulatory language** — content needing compliance review (financial
  services, healthcare, etc.).
- **Testimonial issues** — quotes or endorsements without attribution or
  disclosure.
- **Copyright concerns** — content closely paraphrased from other
  sources.

## Brand voice reference

Use these frameworks to evaluate against brand standards — or to help
the user document a voice they do not have yet.

### Voice attribute spectrums

| Spectrum | One End | Other End |
|----------|---------|-----------|
| Formality | Formal, institutional | Casual, conversational |
| Authority | Expert, authoritative | Peer-level, collaborative |
| Emotion | Warm, empathetic | Direct, matter-of-fact |
| Complexity | Technical, precise | Simple, accessible |
| Energy | Bold, energetic | Calm, measured |
| Humor | Playful, witty | Serious, earnest |
| Innovation | Cutting-edge, forward-looking | Established, proven |

For each chosen attribute, document it in this format:

**[Attribute]**
- **We are**: what it means in practice
- **We are not**: the common misinterpretation to avoid
- **This sounds like**: an example sentence demonstrating it
- **This does NOT sound like**: an example that violates it

### A complete voice document covers

1. **Brand personality** — the brand as a person ("a knowledgeable
   colleague who explains complex things simply and never talks down to
   you").
2. **Voice attributes** — 3-5, each in the format above.
3. **Audience awareness** — who the brand speaks to, what they care
   about, how they expect to be addressed.
4. **Core messaging pillars** — 3-5 themes, their hierarchy, how each
   connects to audience needs.
5. **Tone spectrum** — how the voice adapts across contexts.
6. **Style rules** — grammar, formatting, language.
7. **Terminology** — preferred and avoided terms.

### Tone adapts by context — the voice does not

Tone dials attributes up or down while staying recognizably the same
brand: if the brand is "bold and warm", a launch dials up boldness; bad
news dials up warmth; neither attribute disappears.

| Channel | Tone Adaptation |
|---------|----------------|
| Blog | Informative, conversational, educational |
| LinkedIn | Professional, thought-provoking, concise |
| X | Punchy, direct, sometimes witty |
| Email marketing | Personal, helpful, action-oriented |
| Sales collateral | Confident, benefit-driven, specific |
| Help docs | Clear, patient, step-by-step |
| Press release | Formal, factual, newsworthy |

| Situation | Tone Adaptation |
|-----------|----------------|
| Product launch | Excited, confident, forward-looking |
| Incident or outage | Transparent, empathetic, accountable |
| Customer story | Celebratory, specific, crediting the customer |
| Thought leadership | Authoritative, nuanced, evidence-based |
| Bad news | Honest, respectful, solution-oriented |
| Competitive comparison | Confident but fair, fact-based |

## Output format

Deliver the review in chat as structured markdown:

### Summary

- Overall assessment of alignment with brand standards (or general
  quality).
- 1-2 sentences on the biggest strengths.
- 1-2 sentences on the most important improvements.

### Detailed findings

| Issue | Location | Severity | Suggestion |
|-------|----------|----------|------------|

Severity: **High** — contradicts voice, carries compliance risk, or
significantly undermines messaging; **Medium** — inconsistent with
guidelines but not damaging; **Low** — minor style or preference issue.

### Revised sections

For the top 3-5 highest-severity issues, show before/after: the original
text and a suggested revision.

### Legal/compliance flags

List any legal or compliance concerns separately with recommended
actions.

## After the review

Close with one short message offering to:

- Patch the campaign brief with the corrected direction — propose the
  exact tone/key-message wording first, then `update_brief` only on
  agreement.
- Seed assets reflecting the fixed direction with `create_asset` (deck,
  landing page, one-pager following the project's brand kit).
- Review additional content against the same guidelines.
- Document the brand voice using the frameworks above, so future reviews
  — and the brand kit — have something concrete to enforce.
