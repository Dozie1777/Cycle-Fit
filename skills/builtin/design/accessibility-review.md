---
slug: accessibility-review
name: Accessibility review
description: WCAG 2.1 AA audit of the published design or any URL, run through the browser tools. Invoke with /accessibility-review (optionally a focus, e.g. "/accessibility-review the signup form") or when the user asks "is this accessible?", "check contrast", or wants an a11y pass before publishing.
category: design
---

# Accessibility review

Do not paste this document into chat — follow it. Audit a design for WCAG
2.1 AA compliance using only what the browser tools can see: the snapshot's
text and structure, and computed styles read with `browser_evaluate`. No
screenshots, no base64 image data, no external audit services — the values
in the page's own CSS are your evidence.

## When to use

The user may invoke this with `/accessibility-review` followed by optional
focus (e.g. `/accessibility-review the signup form`). Default target is the
published design (`…/designs/<id>/site`); a draft preview URL, a
user-provided URL, or an attached asset's url works the same way. If
nothing was specified and no design is published, use `ask_user` to ask
what to audit.

## WCAG 2.1 AA quick reference

### Perceivable

- **1.1.1** Non-text content has alt text
- **1.3.1** Info and structure conveyed semantically
- **1.4.3** Contrast ratio >= 4.5:1 (normal text), >= 3:1 (large text)
- **1.4.11** Non-text contrast >= 3:1 (UI components, graphics)

### Operable

- **2.1.1** All functionality available via keyboard
- **2.4.3** Logical focus order
- **2.4.7** Visible focus indicator
- **2.5.5** Touch target >= 44×44 CSS pixels

### Understandable

- **3.2.1** Predictable on focus (no unexpected changes)
- **3.3.1** Error identification (describe the error)
- **3.3.2** Labels or instructions for inputs

### Robust

- **4.1.2** Name, role, value for all UI components

## How to audit with the browser tools

### 1. Structure and semantics — from the snapshot

- `browser_navigate` to the target, then read `browser_snapshot`.
- **Heading order**: no skipped levels (h1 → h3), one sensible h1, headings
  that describe their section.
- **Landmarks**: `header`, `nav`, `main`, `footer` present; exactly one
  `main`.
- **Alt text**: every meaningful `<img>`/SVG has `alt` or `aria-label`;
  decorative images have empty alt, not a missing attribute.
- **Forms**: every input has a programmatic `<label>` or
  `aria-label`/`aria-labelledby` — visible placeholder alone is not a
  label.
- **Name, role, value**: buttons are `<button>` (or have `role="button"` +
  keyboard support); icon-only controls have accessible names; links say
  where they go, not "click here".

### 2. Color contrast — from computed styles

- Read the colors with `browser_evaluate`: `getComputedStyle(el)` for
  `color`, `background-color`, `border-color` on each text element and key
  UI component (or resolve them from the `:root` tokens the page declares).
- Compute the contrast ratio from the hex/rgb values: convert each channel
  to linear (c/255, then linearize: `c/12.92` if `c <= 0.03928`, else
  `((c+0.055)/1.055)^2.4`), luminance `L = 0.2126R + 0.7152G + 0.0722B`,
  ratio `= (Llighter + 0.05) / (Ldarker + 0.05)`.
- Text: 4.5:1 normal, 3:1 large (>= 24px regular or >= 18.66px bold — check
  computed `font-size`/`font-weight`). UI boundaries and icons: 3:1.
- Watch for text over gradients or translucent surfaces — sample the
  effective background behind the text, not just the section background.

### 3. Touch targets — from computed dimensions

- `browser_evaluate` `getBoundingClientRect()` (plus margins/borders) for
  every interactive element: buttons, links, inputs, nav items. Flag
  anything under 44×44 CSS px, and under-spaced clusters of small targets.

### 4. Focus and keyboard — from styles and markup

- Check `:focus-visible` / `:focus` styles in the page's CSS: is there a
  visible indicator, and is it itself 3:1 against adjacent colors? Read
  `outline` / `outline-offset` computed values.
- `outline: none` with no replacement is a finding.
- From markup and scripts, reason about keyboard behavior: tab order
  follows DOM order; no `tabindex` > 0; modals/dialogs trap and restore
  focus; custom controls respond to Enter/Space/arrows. Note what is
  verifiable from the code versus what needs manual testing.
- Zoom: check for viewport-locking (`user-scalable=no`, `maximum-scale=1`)
  and fixed-height containers that would clip at 200% zoom.

## Common issues to hunt first

1. Insufficient color contrast (grey text on tinted surfaces is the classic)
2. Missing form labels
3. `outline: none` with no visible focus replacement
4. Missing alt text on meaningful images
5. Icon-only buttons with no accessible name
6. Skipped heading levels
7. Touch targets under 44×44
8. No `lang` attribute on `<html>`

## Output

Deliver the audit as clean markdown in chat (there is no document tool —
the chat message is the deliverable):

```markdown
## Accessibility audit: [design/page name]
**Standard:** WCAG 2.1 AA

### Summary
**Issues found:** [X] | 🔴 Critical: [X] | 🟡 Moderate: [X] | 🟢 Minor: [X]

### Perceivable
| # | Issue | WCAG criterion | Severity | Recommendation |
|---|-------|---------------|----------|----------------|
| 1 | [issue + element] | 1.4.3 Contrast | 🔴 Critical | [fix] |

### Operable
| # | Issue | WCAG criterion | Severity | Recommendation |
|---|-------|---------------|----------|----------------|
| 1 | [issue] | 2.4.7 Focus visible | 🟡 Moderate | [fix] |

### Understandable
| # | Issue | WCAG criterion | Severity | Recommendation |
|---|-------|---------------|----------|----------------|
| 1 | [issue] | 3.3.2 Labels | 🟡 Moderate | [fix] |

### Robust
| # | Issue | WCAG criterion | Severity | Recommendation |
|---|-------|---------------|----------|----------------|
| 1 | [issue] | 4.1.2 Name, role, value | 🟡 Moderate | [fix] |

### Color contrast check
| Element | Foreground | Background | Ratio | Required | Pass? |
|---------|-----------|------------|-------|----------|-------|
| [body text] | [#hex] | [#hex] | [X]:1 | 4.5:1 | ✅/❌ |

### Priority fixes
1. **[Critical fix]** — blocks [what] for [whom]
2. **[Moderate fix]** — improves [what]
3. **[Minor fix]** — polish
```

Severity guide: 🔴 **Critical** = blocks a user group from completing a
core task (unlabeled form field, invisible focus on the only path forward);
🟡 **Moderate** = significant friction or AA failure without a total
blocker; 🟢 **Minor** = polish.

## After the audit

- **Offer to fix.** "Want me to propose an updated design with the
  critical fixes applied?" If yes, apply fixes via `preview_section` or a
  full `propose_design` — never publish without approval. Re-audit the
  changed sections after revision.
- If the issues are copy-shaped (unclear error text, missing instructions),
  pair with the `ux-copy` skill via `load_skill`.
- **Be honest about limits.** Close with a note that computed-style and
  markup analysis covers most issues but is not a substitute for manual
  testing with a screen reader (VoiceOver/NVDA) and a real keyboard —
  recommend that before final handoff.
