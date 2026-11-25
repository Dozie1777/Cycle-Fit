---
slug: copywriting
name: Copywriting
description: Write or rewrite marketing copy — landing pages, course pages, emails, ads, social captions. Use when the user says "write copy for," "headline help," "CTA copy," "value proposition," or "this copy is weak." Invoke with /copywriting plus the audience; delivers finished copy with headline options.
category: marketing
---

# Copywriting

Do not paste this document into chat — follow it. Use it to write conversion copy that is clear, specific, and grounded only in facts the user actually gave you.

## Ground rules

- Finished copy is delivered in chat as paste-ready markdown in fenced code blocks. Long-form page deliverables (landing pages, course pages) can be seeded with `create_asset` for the design studio — do not build the visual in chat.
- Never fabricate statistics, testimonials, learner counts, prices, dates, or results. Where a proof point belongs, write a placeholder like `[INSERT: pass-rate stat]` and say what to fill in.
- Claims must be supportable. If a requested claim isn't supported by what the user gave you, don't write it and don't silently drop it: name the claim, say why it falls short, offer the closest supportable alternative, and state what evidence would unlock the original (a review export, a written refund policy, a citable result).
- Never guess audience, tone, offer, or price — pull from the campaign brief when one exists, otherwise ask with `ask_user` for discrete choices and plain questions for the rest.
- Call `list_channels` before writing copy destined for a specific channel; link by id, never invent one.

## Before writing

Gather context; ask only for what's missing:

1. **Page purpose** — landing page, course page, pricing/plans page, email, ad, social caption — and the ONE primary action: enroll, register for a free lesson, join a cohort waitlist, register for a stream, start exam prep.
2. **Audience** — who they are (exam candidate, working professional upskilling, parent, a publisher's existing learners), the problem they're solving, their hesitations, and the words they use for it.
3. **Offer** — the course, stream, or cohort; what makes it different; the key transformation; real proof points.
4. **Context** — where traffic comes from (ad, email, social, organic) and what visitors already know when they arrive.

## Diagnose the situation first

Most bad copy comes from imposing taste on a marketer who already made good choices. Decide which situation you're in and state it in one line with evidence before writing:

| Situation | Given | Job |
|---|---|---|
| **A. Blank or slop** | A one-line ask, or generic company-speak with no point of view | Build the argument from the brief and the offer. Latitude on angle, never on facts |
| **B. Real voice present** | A draft with an angle, opinion, or recognizable voice, even if rough | Restore it. Keep their argument and vocabulary; fix the buried lead, vague lines, AI tells, and structure |
| **C. Point edit** | "Fix this headline," "tighten this paragraph" | Change only what was asked plus the minimum around it to make it fit. Return the rest untouched — for pure edits, prefer `/copy-editing` |

Read taste out of the input (B and C): their vocabulary is a voice choice ("learners" not "students" if that's their word); where they spent words is a priority choice; what they left out is a scope choice; their angle is the positioning — deepen it, don't replace it. If they include a writing sample, match its average sentence length, punctuation habits, and a few words they use that you wouldn't. A sample beats the default voice when the two conflict.

## Drafting protocol

**Decompose and lock.** Don't write the page in one pass. Break it into named units (headline, subhead, CTA, each section heading and body, proof lines). For each unit, draft two or three candidates, keep the best, fix its worst flaw, and lock it. Assemble and read the whole page once for flow. In situation B, lines that already work are locked from the start.

**The three-question gate.** Run every line you write or keep through:

1. Can the reader picture it? A specific scene or object beats an abstraction.
2. Can it be proven true or false? A falsifiable claim is a claim; "best-in-class" is decoration.
3. Could a competitor write this exact sentence? If yes, it fails the swap test.

Three passes, keep it. Two, sharpen the weak one. One or none, rewrite it from the facts or flag what's missing with `[NEED: ...]`.

**Ration the punch.** Most lines should be plain, specific, and declarative. A page gets one or two punchy moments — usually the headline and one section. When every line tries to land, none do.

**The leave-it-alone test.** Before delivering, check each change: measurably better, or just different? Revert changes you can't give a reason for. This matters most in situations B and C.

## Copywriting principles

- **Clarity over cleverness.** If you must choose, choose clear — clarity also converts. A reader who has to decode your line is gone.
- **Benefits over features.** Feature: what it does. Benefit: what that means for the learner. Bridge with "which means…".
- **Specificity over vagueness.** "Save time on studying" → "Cut your revision to 30 focused minutes a day".
- **Customer language over company language.** Mirror how learners and publishers actually describe the problem — from reviews, replies, and support conversations, not internal jargon.
- **One idea per section.** Each section advances one argument, building a logical flow down the page.
- **Honesty.** Fabricated statistics or testimonials erode trust and create liability. Never.

## No AI tells

A reader who spots a tell tends to doubt the claims around it. Write like a senior copywriter: specific, uneven in rhythm, built from facts.

**Never write:**

1. **Contrast reveals.** "It's not X, it's Y." "Not just X, but Y." State Y directly, with the reason.
2. **Negation lists.** "No fluff, no filler, no busywork." Say what does happen; keep at most one real absence near the CTA ("No card required").
3. **Trailing pile-ons.** A full claim followed by a comma and more clauses. End the sentence at the claim.
4. **Self-answered questions and colon reveals.** "The result? 3x faster." "The best part: it adapts." Just say it. A reader's own question ("Want to preview a lesson first?") is fine.
5. **Stock openers.** "In today's fast-paced world," "Whether you're X or Y," "Say goodbye to," "Unlock the power of," "X, reimagined."
6. **Em dashes in short copy.** Headlines, subheads, ads, social posts, and subject lines use none.

**Keep rare:** at most one fragment and one list of three per section; replace seamless/robust/powerful/unlock with the fact they stand for.

**Check before delivering:** search for the banned patterns, read every sentence over 20 words, read it aloud. Fix from the facts — synonym swaps create new tells — and flag missing proof as `[NEED: ...]` rather than inventing it.

## Page structure framework

### Above the fold

- **Headline** — the single most important message. Formulas:
  - "{Achieve outcome} without {pain point}" — "Pass your exam without the all-nighters"
  - "The {category} for {audience}" — "The exam-prep platform for working nurses"
  - "Never {unpleasant event} again" — "Never cram a whole syllabus the night before again"
  - "{Question highlighting the pain}" — "Still stuck at 60% on your mocks?"
- **Subheadline** — expands on the headline, adds specificity, 1–2 sentences max.
- **Primary CTA** — action text that states what they get: "Start My Free Lesson", not "Sign Up".

### Core sections

| Section | Purpose |
|---|---|
| Social proof | Credibility: learner counts, attributed testimonials, instructor credentials |
| Problem/pain | Show you understand their situation |
| Solution/benefits | 3–5 key benefits connected to outcomes |
| How it works | Reduce perceived complexity (3–4 steps: enroll → learn → practice and get graded) |
| Objection handling | FAQ, syllabus transparency, guarantees that actually exist |
| Final CTA | Recap value, repeat the CTA, risk reversal |

## CTA copy guidelines

Weak (avoid): Submit, Sign Up, Learn More, Click Here, Get Started.

Strong: Start My Free Lesson, Enroll in the Cohort, Reserve My Seat, Get the Syllabus, See Plans, Watch Last Week's Stream.

Formula: [action verb] + [what they get] + [qualifier if needed]. One primary CTA per page. Reduce risk only with true facts ("First lesson free", "Cancel before the cohort starts").

## Page-type guidance

- **Landing page / course page** — single message, single CTA; match the headline to the traffic source; complete the argument on one page.
- **Email copy** — see `/email-sequence` for multi-email flows and `/emails` for templates; subject lines that create curiosity or state clear value, one CTA, scannable body.
- **Ad copy** — short benefit-led headline, 1–2 line body, CTA. The visual is a designer deliverable: hand the copy over via `create_asset`, don't build the creative in chat.
- **Social captions** — hook in the first line, platform-appropriate length and tone; see `/social` for channel rules.

## Voice and tone

Establish before writing (from the brief's tone field or the user's stated voice): formality (casual, professional-but-friendly, formal) and personality (playful or serious, bold or understated). Keep it consistent, but adjust intensity: headlines can be bolder, body copy clearer, CTAs action-oriented.

## Output format

For a point edit (situation C), return only the changed lines with a one-line reason each — skip the rest below.

Otherwise deliver:

1. **Page copy** — organized by section (headline, subheadline, CTA, section headers and bodies, secondary CTAs), in a fenced code block, paste-ready.
2. **Annotations** — for key elements, the choice made and the principle it applies (kept outside the draft block so the draft stays clean).
3. **Alternatives** — 2–3 headline and CTA options, each with rationale.
4. **Meta content** — page title and meta description suggestions for web pages.

Close with next-step offers, asking which the user wants: revise, seed the designed page via `create_asset`, hand off to `/copy-editing` for polish, or log settled tone/messaging decisions back with `update_brief`.

## Related skills

- **copy-editing** — polish the draft after it exists
- **cro** — when the problem is page structure or strategy, not just copy
- **email-sequence** and **emails** — for email flows and email copy
- **social** and **ads** — channel-specific rules for those formats
- **draft-content** — fast single-piece drafting when a full page isn't needed
- **ab-testing** — to test copy variations
