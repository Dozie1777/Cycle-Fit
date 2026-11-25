---
slug: design-system
name: Design system
description: Audit, document, or extend the design system of the published page — token naming, hardcoded values, section consistency. Invoke with /design-system (optionally "audit", "document <component>", or "extend <pattern>") or when tokens drift, naming is inconsistent, or a new pattern is needed.
category: design
---

# Design system

Do not paste this document into chat — follow it. In this studio the design
system is the published page's design tokens: the CSS custom properties in
its single `:root { … }` block, plus the `data-section` structure convention.
There are no external design-system files, no Figma, no component library —
audit what exists, document what matters, and propose concrete token CSS.

## Modes

The user may invoke this with `/design-system` followed by an optional mode:

- `/design-system` or `/design-system audit` — audit the published design's
  tokens and structure.
- `/design-system document <component-or-pattern>` — write reference
  documentation for how a component or pattern is built on this page.
- `/design-system extend <pattern>` — design a new component or pattern that
  fits the existing tokens.

If no mode or target was given, use `ask_user` to pick the mode (2-4
options).

## What this page's design system is

### Design tokens

Atomic values declared once in the `:root` block and used everywhere via
`var(…)`: colors (background, surface, primary, text, accents), font
stacks, type scale, spacing scale, radii, shadows, and — if present —
motion durations. If the project has a brand kit, its tokens are the source
of truth; never propose values that would override it.

### Sections

Every top-level section carries `data-section="<name>"`. The names are the
page's structural vocabulary — they must be consistent, lowercase, and
stable, because the canvas and future revisions address sections by name.

### Patterns

Recurring combinations built only from tokens and sections: nav bars, card
grids, forms, footers. Document them by their HTML/CSS recipe, not by
tooling that does not exist here.

## Audit mode

1. **Read the live site.** `browser_navigate` to the published design URL
   (`…/designs/<id>/site`), then pull the full `:root` block and inline
   styles with `browser_evaluate` (e.g. read `getComputedStyle(
   document.documentElement)` for each declared property, and collect all
   `data-section` attribute values). If the page has no `:root` block, that
   is finding #1: collect the actual computed `color` /
   `background-color` / `border-color` / `font-family` values across
   visible elements instead.
2. **Check token coverage.** Count hardcoded values in the stylesheet
   outside `:root`: raw hex/rgb colors, magic px spacing, one-off radii or
   shadows that should be variables.
3. **Check naming consistency.** Token names should follow one scheme (e.g.
   `--color-*`, `--space-*`, `--font-*`), be role-based rather than
   value-based where possible (`--color-surface` not `--color-grey-100`
   for surfaces), and have no near-duplicates.
4. **Check section naming.** All `data-section` values: unique, lowercase,
   descriptive, no mixed conventions (`hero` vs `topHero` vs `section-1`).

Deliver the audit as markdown in chat:

```markdown
## Design system audit: [design name]

### Summary
**Tokens declared:** [X] | **Hardcoded values found:** [X] |
**Sections:** [X] | **Score:** [X/100]

### Naming consistency
| Issue | Tokens/sections | Recommendation |
|-------|-----------------|----------------|
| [inconsistent naming] | [list] | [standard to adopt] |

### Token coverage
| Category | Defined | Hardcoded values found |
|----------|---------|------------------------|
| Colors | [X] | [X instances of raw hex/rgb outside :root] |
| Spacing | [X] | [X arbitrary px values] |
| Typography | [X] | [X one-off sizes/weights] |
| Radii / shadows | [X] | [X one-off values] |

### Section structure
| data-section | OK? | Note |
|--------------|-----|------|
| [name] | ✅ / ⚠️ | [duplicate, unclear, inconsistent…] |

### Priority actions
1. [most impactful improvement]
2. [second priority]
3. [third priority]
```

Then **propose an updated `:root` block** in a fenced ```css code block in
chat: the existing tokens cleaned up, renamed where needed, new tokens for
each hardcoded value found. Offer to apply it — either as chat CSS the user
can approve, or as an updated full-page `propose_design` preview that shows
the tokens in use. Publishing still requires explicit approval of a
proposal.

## Document mode

Write the documentation as markdown in chat (there is no document tool; the
chat message is the deliverable). Read the component's actual markup and
CSS from the live site first — document what is really there, not an ideal.

```markdown
## Component: [name]

### Description
[What it is and when to use it on this page]

### Anatomy
[HTML structure recipe: tags, classes, required token usage]

### Variants
| Variant | Use when |
|---------|----------|
| [primary] | [main actions] |
| [secondary] | [supporting actions] |

### States
| State | Visual | Behavior |
|-------|--------|----------|
| Default | [description] | — |
| Hover | [description] | [interaction] |
| Active | [description] | [interaction] |
| Disabled | [description] | Non-interactive |

### Tokens used
- Colors: [which tokens]
- Spacing: [which tokens]
- Typography: [which tokens]

### Accessibility
- **Role**: [implicit or ARIA role]
- **Keyboard**: [tab, enter, escape behavior]
- **Screen reader**: [announced as…]

### Do's and don'ts
| ✅ Do | ❌ Don't |
|------|---------|
| [best practice] | [anti-pattern] |
```

## Extend mode

Design the new pattern to fit the existing system. Show the thinking before
building: state the problem in a sentence, check whether an existing section
or pattern already covers it (adapt instead of adding a near-duplicate),
then proceed.

```markdown
## New pattern: [name]

### Problem
[What need or gap it addresses]

### Existing patterns
| Related | Similarity | Why it's not enough |
|---------|-----------|---------------------|
| [section] | [what's shared] | [what's missing] |

### Proposed design
- **Tokens used**: [colors / spacing / typography from the :root block —
  extend the block with new tokens only if genuinely needed]
- **Variants**: [if any]
- **States**: [default / hover / active / disabled]
- **Accessibility**: [role, keyboard, announced-as]

### Open questions
- [decision that needs the user's call]
```

After the write-up, demonstrate it: a `wireframe` sketch for layout
agreement, then a `preview_section` with the new pattern built strictly from
tokens, then iterate. Fold it into the full page via `propose_design` when
the user is happy — never publish without approval.

## Tips

- **Start with an audit** — know where the tokens stand before extending.
- **Document as you build** — capture a pattern's recipe while it is fresh
  in the current section work.
- **Prefer extending the `:root` block over hardcoding** — one new token
  beats five magic values.
- **Never override a brand kit** — if one is pinned, proposals may only
  rearrange or alias its tokens, not replace them.
