---
slug: copy-editing
name: Copy editing
description: Edit, polish, or de-slop existing marketing copy — pasted into chat or on a live page. Use for "edit this copy," "proofread," "polish this," "tighten this up," "too wordy," "make it sound human." Invoke with /copy-editing plus the copy or a URL; delivers before/after edits with rationale.
category: marketing
---

# Copy editing

Do not paste this document into chat — follow it. Use it to systematically improve copy the user already has — pasted into chat or read off a live page with the browser tools — while preserving the core message. For writing new copy from scratch, use `/copywriting`.

## Core philosophy

- Don't change the core message; enhance it.
- Multiple focused passes beat one unfocused review.
- Every edit has a clear reason, delivered as a before/after pair with rationale.
- Preserve the author's voice while improving clarity.
- Nothing is published or sent from here: edits come back as paste-ready markdown the user applies wherever the copy lives.

## Pick the mode before editing

Diagnose the input first and state the diagnosis in one line with evidence:

- **A. Blank or slop** — generic company-speak with no point of view → rebuild from the facts the user gives you.
- **B. Real voice** — an angle, opinion, or recognizable voice, even if rough → restore it: keep their argument and vocabulary, fix the buried lead, vague lines, AI tells, and structure.
- **C. Point edit** — "fix this line", "tighten this paragraph" → change only what was asked plus the minimum around it to make it fit; return just the changed lines with a reason; skip the sweeps.

Run the full sweeps for A and B.

## The seven sweeps

Edit through seven sequential passes. After each, loop back to confirm earlier sweeps aren't compromised.

### Sweep 1: Clarity

Can the reader understand it? Read through quickly and mark (don't fix yet): confusing sentence structures, unclear pronoun references, jargon or insider language, ambiguous statements, points buried in qualifications. Then recommend specific edits and verify they keep the original intent. Confirm one main idea per section and that the copy speaks to the reader ("you").

### Sweep 2: Voice and tone

Is it consistent in how it sounds? Watch shifts between formal and casual, mixed "we" / "the platform" references, unintentional mood changes, and word choices that don't match the brand. Read aloud to hear the inconsistencies.

### Sweep 3: So what

Does every claim answer "why should I care?" Ask "so what?" of each statement; if the copy doesn't answer with a deeper benefit, add the bridge.

❌ "Our platform uses AI-powered grading."
✅ "AI-graded practice tests surface your weak topics the same day, so revision time goes where it pays."

Then re-check voice, then clarity.

### Sweep 4: Prove it

Is every claim supported? Flag "trusted by thousands" (which thousands?), "industry-leading" (according to whom?), and results claims without specifics. If proof exists in the brief or what the user gave you, place it near the claim; if not, soften the claim or mark `[NEED: proof]`. Never invent a testimonial, stat, or learner count.

### Sweep 5: Specificity

Is it concrete enough to compel? Vague → specific: "save time" → "save 4 hours a week"; "great support" → "replies within 2 hours"; "many learners" → the real number the user gave you. Remove content that can't be made specific — it's probably filler. Then re-check prove-it, so-what, voice, and clarity.

### Sweep 6: Heightened emotion

Does it make the reader feel something? Look for flat, informational language, pain named but not felt, aspiration stated but not evoked. Techniques: paint the before-state vividly, use sensory language, tell micro-stories, reference shared experiences ("you know the 11pm panic before a mocks paper"). Keep emotion authentic and serving the message — not manipulation.

### Sweep 7: Zero risk

Have we removed every barrier to action? Focus near CTAs: unanswered objections, missing trust signals, unclear next steps, hidden costs or surprises. Risk reducers must be real: guarantees, free first lesson, "no card required", social proof near the CTA, clear expectations of what happens next. Then one final loop through all previous sweeps.

## Expert panel scoring (high-stakes copy)

After the sweeps, for launch pages, enrollment pages, and high-traffic landing pages:

1. Assemble 3–5 expert personas relevant to the copy type — e.g. for a course landing page: a conversion copywriter, a UX writer, a skeptical prospective learner, and the publisher's brand voice.
2. Each persona scores the copy 1–10 on their expertise, with specific critiques (not just scores).
3. Revise the lowest-scoring areas first; re-score until all personas are 7+ with an average of 8+.

Rubric: 9–10 publish-ready; 7–8 minor tweaks; 5–6 clear gaps, another pass; 3–4 major revision; 1–2 rethink the approach. Skip for quick updates and low-stakes content.

## Quick-pass checks

For faster reviews when the full sweep process isn't needed:

**Word-level:** cut very, really, just, actually, basically; "in order to" → "to"; unneeded "that"; things/stuff. Replace utilize→use, leverage→use, facilitate→help. Replace vague placeholders with the fact they stand for: innovative → what it does that alternatives don't; seamless → the real step count; robust → what it handles.

**Sentence-level:** one idea per sentence; vary length; front-load the important information; usually ≤25 words.

**Paragraph-level:** one topic each; 2–4 sentences for web; strong openers; white space for scannability.

**AI-tell check (run on every edit):**

| Pattern | Fix |
|---|---|
| Contrast reveal ("It's not X, it's Y") | State Y directly, with the reason |
| Negation list ("No X, no Y, no Z") | Say what does happen; keep one real absence ("No card required") at most |
| Trailing pile-on ("…, ensuring nothing slips") | End the sentence at the claim |
| Self-answered question ("The result? 3x faster") | Delete the question, keep the answer |
| Colon reveal ("The best part: …") | Write a normal sentence |
| Stock phrases ("Say goodbye to", "Unlock the power of") | Cut; open with the reader's problem or the fact |
| Em dashes in headlines, subheads, ads, social posts, subject lines | Period, comma, or colon |

Cap: one fragment and one list of three per section. Fix from the underlying facts (the mechanism, number, customer, or step), not synonyms — synonym swaps create new tells. Leave alone: FAQ questions, a genuine three-item list, a clause that adds a new fact. Keep the brand's register.

## Common problems and fixes

- **Wall of features** — add "which means…" after each to bridge to benefits.
- **Corporate speak** — ask how a human would say it, and use those words.
- **Weak opening** (company history, vague statement) — lead with the reader's problem or desired outcome.
- **Buried CTA** — make the ask obvious, early, and repeated.
- **No proof** — add real specifics or soften the claim; never invent.
- **Generic claims** — specify who, how, and by how much.
- **Mixed audiences** — pick one audience and write directly to them.
- **Feature overload** — focus on the 3–5 benefits that matter most to this audience.

## Working with live pages

If the user points at a live page instead of pasting copy: `browser_navigate` to the URL, `browser_snapshot` to read it, then edit section by section. Deliver each edited section as paste-ready markdown and flag anything the snapshot can't show — form validation behavior, mobile layout, load performance — as "needs checking", not findings.

## Output conventions

- **Before/after pairs, always**: the original line, the edited line, and a one-line rationale per change.
- **Point edits (mode C)**: only the changed lines, nothing else.
- **Full sweeps (modes A and B)**: deliver the edited copy as paste-ready markdown in a fenced code block, followed by a short change log grouped by sweep.
- Offer follow-ups without doing them unasked: hand off to `/cro` if the problem is structural rather than copy, `/ab-testing` to test a contested rewrite, or `update_brief` to log settled voice decisions.

## Task-specific questions

1. What's the goal of this copy — awareness, conversion, retention?
2. What action should readers take?
3. Any known concerns or specific issues?
4. What proof is available?
5. Is this new copy or a refresh of existing content?

## Related skills

- **copywriting** — write new copy from scratch; use this skill after the draft exists
- **cro** — broader page optimization beyond copy
- **marketing-psychology** — for why certain edits improve conversion
- **ab-testing** — to test contested rewrites
- **emails** — when the copy under edit is email copy
