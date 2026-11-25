---
slug: design-handoff
name: Design handoff
description: Generate a developer handoff spec from the published design (or a URL the user gives). Use when a design is ready for engineering and needs layout per data-section, the :root token block, typography, states, responsive notes and edge cases — invoke with /design-handoff [what to spec].
category: design
---

# Design handoff

Do not paste this document into chat — follow it: it tells you how to produce
a developer handoff spec for the design in this project.

The user may invoke this with `/design-handoff` followed by optional
arguments (e.g. `/design-handoff hero + pricing only`, or a URL). The default
target is the published design in this project (`/designs/<id>/site`); a URL
the user supplies works the same way. If nothing is published and no URL is
given, ask with `ask_user` (2–5 options, e.g. "Spec the whole published site"
/ "Spec one section" / "I'll paste a URL") or name exactly what is missing and
end the turn. A handoff spec never changes the design: do not call
`propose_design` or `publish_design` as part of producing it.

## Gather the source of truth

Work from the live page and the design's own HTML — never from memory of what
you built, and never from pixels:

1. `browser_navigate` to the site URL, then `browser_snapshot` to read the
   full structure and real content.
2. Enumerate the page's sections from their `data-section="<name>"`
   attributes, in DOM order — this is the skeleton of the spec's Layout
   section.
3. Pull the exact `:root { … }` token block from the design source and paste
   it verbatim into the spec (fenced `css` block). It is the single source
   for colors, font stacks, radii, and the spacing scale.
4. Measure the key elements per section with `browser_evaluate` +
   `getComputedStyle` (return plain JSON only): padding, margins,
   font-size/weight/line-height, border-radius, widths, and z-index where
   relevant. Note the viewport you measured at.
5. Read the responsive behavior from the `@media` blocks in the design's HTML
   source — state each breakpoint and what changes at it.
6. Never take screenshots and never pull base64 or binary image data; judge
   everything from snapshot text and computed styles.

## What the spec must cover

### Visual specifications
- Exact measurements per section (padding, margins, gaps, max-widths)
- Token references for every color, font, radius, and spacing value
- Typography: the full `font-family` stack per role (headings, body, UI),
  sizes, weights, and line-heights
- Component variants and states

### Interaction specifications
- Click/tap behavior per interactive element
- Hover, focus, active, and disabled states
- Transitions and animations (property, duration, easing)
- Gesture support where relevant (swipe, long-press)

### Content specifications
- Character limits and truncation behavior
- Empty, loading, and error states
- Real copy from the page (the spec quotes it, so the developer doesn't
  guess)

### Edge cases
- Minimum/maximum content (1 item vs 100 items)
- International or unusually long strings
- Slow connections and missing data

### Accessibility
- Focus order and visible focus treatment
- ARIA labels and roles
- Keyboard interactions
- Color contrast of text on its backgrounds (from token values)

## Principles

1. **Don't assume** — if it's not specified, the developer will guess.
   Specify everything.
2. **Use tokens, not values** — reference `var(--spacing-md)` in the body,
   while the token table maps each token to its resolved value.
3. **Show all states** — default, hover, focus, active, disabled, loading,
   error, empty.
4. **Describe the why** — "this collapses on mobile because the primary
   action is one-handed" helps developers make good judgment calls.

## Output template

Deliver the full spec as structured markdown in chat — that markdown **is**
the artifact; there is no document tool. Format it so a developer could
rebuild the page without ever seeing the design:

```markdown
## Handoff Spec: [Design name]

**Source:** [published site URL] · **Measured at:** [viewport] · **Date:** [date]

### Overview
[What the page does, who it serves, and the intended user context]

### Layout (by `data-section`)
| Order | Section | Structure | Content |
|-------|---------|-----------|---------|
| 1 | hero | [grid/flex summary, key dimensions] | [what lives here] |

### Design Tokens (`:root` block, verbatim)
```css
[paste the exact :root block]
```

| Token | Resolved value | Usage |
|-------|----------------|-------|
| `--color-primary` | #[hex] | CTAs, links |

### Typography
| Role | Stack | Size / weight / line-height |
|------|-------|------------------------------|
| H1 | [stack] | [px / weight / lh] |

### Components
| Component | Variant | Token usage | Notes |
|-----------|---------|-------------|-------|
| [Button] | primary | [tokens] | [special behavior] |

### States and Interactions
| Element | State | Behavior |
|---------|-------|----------|
| [CTA] | hover | [exact change] |

### Responsive Behavior
| Breakpoint | Changes |
|------------|---------|
| [>1024px] | [default layout] |
| [<768px] | [what changes and why] |

### Edge Cases
- **Empty state**: [what shows with no data]
- **Long text**: [truncation rules]
- **Loading / Error**: [appearance]

### Animation / Motion
| Element | Trigger | Animation | Duration | Easing |
|---------|---------|-----------|----------|--------|

### Accessibility Notes
- [Focus order, ARIA, keyboard, contrast]
```

## Delivering it

- Post the complete spec in one message; keep surrounding chat short.
- Then offer: "Want me to embed this spec as an HTML comment at the top of
  the next `propose_design`, so the spec ships with the source?" — only do
  this if the user wants it.
- If the user asks for spec changes, edit the markdown and repost only the
  changed sections.

## Tips

1. **Point at the design** — `/design-handoff <url>` or just "handoff the
   published site" tells you exactly what to measure.
2. **Mention edge cases** — "what happens with 100 items?" makes you spec
   boundary conditions instead of the happy path only.
3. **Name the implementation stack** — "we rebuild this in React + Tailwind"
   lets you add relevant notes (mapping tokens to CSS variables, semantic
   HTML suggestions).
