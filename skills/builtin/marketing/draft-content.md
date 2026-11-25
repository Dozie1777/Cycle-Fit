---
slug: draft-content
name: Draft content
description: Fast single-piece drafting — one email, social post, blog post, landing page, ad, or press release. Invoke with /draft-content plus the topic, or just ask to draft a piece; delivers 1-2 ready-to-paste variants with hook/body/CTA annotations.
category: marketing
---

# Draft Content

Do not paste this document into chat — follow it. This is the fast path for drafting **one** marketing piece end-to-end in a single turn-cycle. For full channel playbooks and multi-piece work, load `/content-creation`; for multi-email flows, load `/email-sequence`.

## Inputs

Gather what you need before drafting. If the user's message and the campaign brief leave gaps, ask — use `ask_user` for discrete choices, plain questions for open ones:

1. **Content type** — blog post, social post, email newsletter, landing page copy, press release, case study, ad creative
2. **Topic** — the subject or theme of the piece
3. **Audience** — pull from the brief's audience field if it fits; confirm if the piece targets a subset
4. **Channel** — call `list_channels` and match to an actual channel; never invent one
5. **Key message / CTA** — the 1-3 points the piece must land, and what the reader should do next
6. **Tone** — from the brief's tone field or the user's stated voice; ask only if both are silent (offer a default: clear, conversational professional)
7. **Length** — word count or format constraint (e.g. "280 characters", "5 paragraphs"); ask if it matters for the format

Good `ask_user` uses: content type ("Blog post / Social post / Email / Landing page"), channel ("LinkedIn / X / Email"), angle ("Practical how-to / Contrarian take / Customer story"), CTA ("Book a demo / Free trial / Read the guide"). Never invent a channel, audience detail, offer, or deadline. If a value is undecided, ask first — and never guess the five things you must never guess: audience, budget, channels, timeline, tone.

## Process

### 1. Frame the piece (briefly)

In one or two sentences, state the angle: who it speaks to, the single job of the piece, and the CTA. This is a gut-check the user can correct before you write — skip it only when the ask is trivially small (e.g. one social post).

### 2. Draft 1-2 variants

Always offer **variants, not one take** — two is usually right, more on request. Each variant:

- Delivered as copy-paste-ready markdown in a fenced code block
- Follows the structure of its content type (see Structure Map below)
- Applies the brief's tone and audience consistently
- Uses concrete, specific copy grounded in what the user told you — no generic marketing filler, no lorem ipsum
- Never fabricates stats, quotes, customer names, or performance numbers; where a proof point belongs, write a clear placeholder like `[INSERT: customer stat]` and tell the user what to fill in

Make the variants genuinely different — not the same draft twice:

- **Vary the angle** (e.g. practical how-to vs. contrarian take vs. customer story) or the **hook formula**, not just the wording
- Say in one line what distinguishes each variant so the user can choose between them, not just approve one
- If the channel format is tight (a social post, a subject line), keep each variant within the constraint; count characters for hard limits

### 3. Annotate the structure

After each variant, add a short annotation list labeling the working parts — hook (which formula and why), body logic, CTA (the action and destination), and for email the subject/preview logic, for web content the keyword targeting. Keep annotations outside the draft block so the draft stays clean. Example:

- **Hook** — question formula; targets the reader's current workaround
- **Body** — problem → cost of inaction → the better path, one idea per paragraph
- **CTA** — "Book a 15-minute demo"; placed after the value proof, not in the opening

## Structure Map

- **Blog post** — headline, hook intro, 3-5 subheaded sections, conclusion with CTA; meta description suggestion
- **Social post** — hook first line, 2-4 points or short narrative, CTA/engagement prompt, 3-5 hashtags; platform-appropriate length
- **Email** — subject line (2-3 options), preview text, greeting, scannable body blocks, one primary CTA, sign-off
- **Landing page copy** — headline (under 10 words), subheadline, hero, 3-4 value propositions, social-proof placement, objection handling, final CTA; meta title + description suggestions
- **Press release** — headline, dateline, lead paragraph (who/what/when/where/why), supporting detail with quote placeholders, boilerplate placeholder, media contact placeholder
- **Case study** — result-first title, snapshot, challenge, solution, results (prompt for real metrics), quote placeholder, CTA
- **Ad creative** — headline (short, benefit-led), 1-2 line body, CTA; note it is a visual deliverable — the copy goes to the designer agent via `create_asset`, not built as an image here

Per-type quality notes:

- **Blog**: short paragraphs, subheading every 200-300 words, active voice, one example or proof point per section
- **Social**: match the platform — LinkedIn professional with paragraph breaks (~1,300 chars before "see more"), X concise and punchy, Instagram visual-first with a hashtag block
- **Email**: one primary CTA, mobile-first scannability, preview text that complements rather than repeats the subject

### Headline and hook quick formulas

- How to [achieve result] [without common obstacle]
- [Number] [adjective] ways to [achieve result]
- Why [common belief] is wrong (and what to do instead)
- [Do this], not [that]
- Hooks: surprising statistic, contrarian statement, pointed question, scenario, bold claim, story opening

### CTA quick rules

- Action verbs ("Get", "Start", "Join", "Try"), specific about what happens next
- One primary CTA per piece; reduce risk ("no credit card required") when genuine
- After value is established — not the first sentence

## SEO for web-facing drafts

For blog posts and landing page copy: suggest one primary keyword, place it in headline, first paragraph, and meta description; note 2-3 secondary keywords for subheadings; suggest internal/external link opportunities. If keyword direction is unclear, research with the browser tools (`browser_navigate` to `https://duckduckgo.com/?q=<query>` then `browser_snapshot`) and base suggestions on observed results.

## Revisions

Expect iteration; treat the first draft as a proposal:

- When the user asks for changes, re-deliver the **full revised variant** in a fresh fenced code block — never describe the edit and make the user apply it
- Keep tone notes from the conversation; if the user corrects the voice ("too formal"), fold that into the rest of the campaign's copy and offer to capture it in the brief
- If the user picks variant A but likes one line from variant B, splice it in rather than re-litigating the variants

## Output

After the variants and annotations, close with:

- One line on the tone/voice applied and why
- Next-step offers — ask which the user wants:
  - **Revise**: adjust tone, length, or a specific section
  - **Schedule it**: with a date the user gives, `add_event` (title, channelId, scheduledAt, notes) puts the piece on the campaign calendar; adjust later with `update_event`
  - **Seed a designed version**: for visual deliverables (ad creative, landing page, one-pager) offer `create_asset` to open a design-studio project at `/studio/<id>` — do not build the visual in chat
  - **Log messaging back**: if the session settled tone or key-message decisions, offer an `update_brief` patch

Keep the whole turn tight: framing (1-2 sentences), the variant blocks, annotations, and the closing offers. The user should be able to copy a finished piece straight out of the chat and paste it into their sending tool or CMS of choice.
