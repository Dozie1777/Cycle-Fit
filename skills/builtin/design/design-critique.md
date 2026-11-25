---
slug: design-critique
name: Design critique
description: Structured design feedback on usability, hierarchy, and consistency. Invoke with /design-critique (optionally followed by a focus, e.g. "/design-critique mobile navigation") or when the user asks "review this design", "critique this", or "what do you think of this screen?".
category: design
---

# Design critique

Do not paste this document into chat — follow it. Give the user a structured
critique across multiple dimensions, in chat, then offer to fix what you found.

## When to use

The user may invoke this with `/design-critique` followed by optional focus
(e.g. `/design-critique mobile navigation`, `/design-critique the pricing
section`). If they ask for feedback without a slash command, treat it the same.

## What to review

Determine the target. In order of preference:

1. **The published design** (default) — navigate to the live site URL
   (`…/designs/<id>/site`) with `browser_navigate` and read it via
   `browser_snapshot` + `browser_evaluate` (computed styles, `:root` tokens).
2. **A draft preview URL** — a `preview_section` or `propose_design` preview
   the user points at; open it the same way.
3. **A user-provided URL** — any page on the web; open it with the browser
   tools and judge it from the snapshot's text and computed styles.
4. **A pasted description or attached asset** — if the user pastes a
   description or attaches a reference asset, treat the attachment
   description as ground truth and open its url with the browser tools if
   more detail is needed.

If nothing was given and there is no published design, use `ask_user` to ask
what to review (published site, a preview URL, another URL, or a
description). Judge everything from snapshots' text and computed styles —
never from screenshots, pixels or base64 data.

Also collect context, in the same turn if possible:

- **What is it?** Who is it for, what stage (exploration, refinement, final)?
- **Focus** (optional): "just the navigation", "mobile", "the onboarding flow".

If the stage or audience is genuinely unclear and it would change the
feedback, ask — one short `ask_user` beats a misaimed critique.

## Critique framework

Work through all five lenses. Read the actual HTML structure and computed
styles with the browser tools; cite specific elements and sections
(`data-section` names) rather than vague impressions.

### 1. First impression (2 seconds)

- What draws the eye first, given the typographic scale, weight and color
  you can read from the computed styles? Is that the right element?
- Is the page's purpose immediately clear from the hero or first section?
- Is there an emotional read (tone of the palette, density, energy)?

### 2. Usability

- Can a user accomplish the obvious goal the page sets up?
- Is the navigation intuitive? Are interactive elements obviously
  interactive (affordances visible in computed styles, not just decoration)?
- Are there unnecessary steps, dead ends, or competing CTAs?

### 3. Visual hierarchy

- Is there a clear reading order from the heading levels and size/weight
  steps in the CSS?
- Are the right elements emphasized — and is anything important
  under-emphasized?
- Is whitespace used effectively? Is the spacing scale applied consistently?

### 4. Consistency

- Do sections share one visual language (tokens from the `:root` block vs.
  hardcoded values)?
- Do similar elements behave and look similarly — buttons, cards, links?
- Does anything drift from the brand kit, if the project has one?

### 5. Accessibility

- Color contrast of key text and UI components (read the hex/rgb values with
  `browser_evaluate`).
- Touch target sizes from computed dimensions.
- Heading order, alt text, landmarks — quick pass; if the user wants depth,
  suggest `/accessibility-review`.

## How to give feedback

- **Be specific**: "the hero CTA competes with the nav CTA — same color, same
  size" not "the layout is confusing".
- **Explain why**: connect feedback to design principles or the user's goal.
- **Suggest alternatives**: propose the fix, not just the problem.
- **Acknowledge what works**: lead or close with genuine positives.
- **Match the stage**: early exploration gets directional feedback; final
  polish gets pixel-level nits.

## Output

Deliver the critique as clean markdown in chat (there is no document tool —
the chat message is the deliverable). Use this structure:

```markdown
## Design critique: [design name]

### Overall impression
[1-2 sentence first reaction — what works, biggest opportunity]

### Usability
| Finding | Severity | Recommendation |
|---------|----------|----------------|
| [Issue + section] | 🔴 Critical / 🟡 Moderate / 🟢 Minor | [Fix] |

### Visual hierarchy
- **Draws the eye first**: [element] — [is this correct?]
- **Reading flow**: [how the eye moves through the layout]
- **Emphasis**: [are the right things emphasized?]

### Consistency
| Element | Issue | Recommendation |
|---------|-------|----------------|
| [typography/spacing/color] | [inconsistency] | [fix] |

### Accessibility (quick pass)
- **Color contrast**: [pass/fail for key text]
- **Touch targets**: [adequate?]
- **Heading order / alt text**: [ok or refer to /accessibility-review]

### What works well
- [positive observation 1]
- [positive observation 2]

### Priority recommendations
1. **[Most impactful change]** — [why and how]
2. **[Second priority]** — [why and how]
3. **[Third priority]** — [why and how]
```

## After the critique

- Offer to act: "want me to propose a revised design with fixes 1-3?" If yes,
  iterate via `wireframe` / `preview_section` and then `propose_design` —
  never publish without approval.
- If the user wants a deeper accessibility pass, load the
  `accessibility-review` skill with `load_skill`.
- For copy-related findings (weak headline, vague CTA), load the `ux-copy`
  skill instead of improvising wording.
