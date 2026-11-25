---
slug: ux-copy
name: UX copy
description: Write or review real UX copy for the design — headings, body, CTAs, buttons, error and empty states, tooltips, onboarding. Invoke with /ux-copy followed by the slot or context (e.g. "/ux-copy hero headline") or whenever a design section needs actual words, never placeholder text.
category: design
---

# UX copy

Do not paste this document into chat — follow it. Write real, usable copy
for the design being built. This studio builds pages with real words:
never lorem ipsum, never "Your heading here", never placeholder text. If
final copy does not exist yet, producing it is your job.

## When to use

The user may invoke this with `/ux-copy` followed by optional context (e.g.
`/ux-copy the pricing CTA`, `/ux-copy error message for a failed payment`).
It also applies silently whenever a section under construction needs copy:
before styling a section, its words should be settled.

## What you need

- **Context**: which section or slot — hero headline, nav label, CTA, form
  error, empty state, footer note?
- **User state**: what is the user trying to do, and how do they feel right
  now (eager, blocked, confused, mid-task)?
- **Tone**: formal, friendly, playful, reassuring — or derived from the
  brief and any brand kit.
- **Constraints**: character limits from the layout, platform conventions,
  terminology already used on the page.

If the context is vague, narrow it with one short `ask_user` (2-4 options
for the most likely interpretations) rather than guessing.

## Principles

1. **Clear** — say exactly what you mean. No jargon, no ambiguity.
2. **Concise** — the fewest words that carry the full meaning.
3. **Consistent** — same terms for the same things everywhere on the page;
   reuse words already in the design's copy and `data-section` structure.
4. **Useful** — every word helps the user accomplish their goal; cut the
   rest.
5. **Human** — write like a helpful person, not a robot or a marketer on
   autopilot.

## Copy patterns

### CTAs and buttons

- Start with a verb: "Start free trial", "Save changes", "Download report".
- Be specific: "Create account" not "Submit".
- Match the label to the outcome the click produces.

### Headings and section titles

- Lead with the value, not the mechanism: "Learn faster with weekly
  reviews" not "Our review feature".
- Pair a punchy headline with a one-sentence subheading that says what it
  actually is.

### Error messages

Structure: what happened + why + how to fix.
- "Payment declined. Your bank rejected the charge. Try a different card or
  contact your bank."
- Never blame the user; never say "error 500" alone.

### Empty states

Structure: what this is + why it's empty + how to start.
- "No projects yet. Create your first project to start collaborating with
  your team."

### Confirmation dialogs

- Make the action clear: "Delete 3 files?" not "Are you sure?".
- Describe consequences: "This can't be undone".
- Label buttons with the action: "Delete files" / "Keep files", not
  "OK" / "Cancel".

### Tooltips

- Concise, helpful, never obvious. If it restates the visible label, delete
  it.

### Loading states

- Set expectations and reduce anxiety: say what is happening, roughly how
  long, or what to do while waiting.

### Onboarding

- Progressive disclosure, one concept at a time. First-run copy teaches one
  thing, then gets out of the way.

## Voice and tone

Adapt tone to the user's state:

- **Success**: celebratory but not over the top.
- **Error**: empathetic and helpful — the fix is in the message.
- **Warning**: clear and actionable.
- **Neutral**: informative and concise.

If a brand kit or the brief fixes a voice ("professional but warm"), match
it everywhere; if the user describes a voice in conversation, reflect it
back in every option you propose.

## Working method

- Propose **2-5 concrete copy options per slot** — never a single take,
  never abstract direction ("something friendlier"). Options should differ
  in substance, not just punctuation.
- For discrete choices, put them in front of the user with `ask_user`
  (2-5 clickable options, each label a real candidate, with a short
  rationale in the question text). Remember `ask_user` ends the turn.
- For richer sets (a full section's copy), deliver as markdown in chat — a
  table of options per slot — and let the user pick or tweak.
- Once copy is chosen, it is design input: update the affected section via
  `preview_section` or fold it into the page with `propose_design` — never
  publish without approval.

## Output

```markdown
## UX copy: [context]

### Recommended copy
**[Element]**: "[copy]"

### Alternatives
| Option | Copy | Tone | Best for |
|--------|------|------|----------|
| A | [copy] | [tone] | [when to use] |
| B | [copy] | [tone] | [when to use] |
| C | [copy] | [tone] | [when to use] |

### Rationale
[Why the recommendation works — user context, clarity, action-orientation]

### Notes
[Constraints respected — character limits, terminology, brand voice —
and anything worth flagging for translation or length]
```

When delivering via `ask_user`, compress this: the options are the buttons,
the rationale is one line in the question.

## Reviewing existing copy

If the user asks to review copy that is already on the page (published
site, a preview URL, or pasted text), read it in place with the browser
tools — in its real layout and context, not in isolation. Judge against the
principles above, flag the weakest lines first, and always propose
replacement copy, not just criticism.

## Tips

- **Be specific about context** — "error message when payment fails" beats
  "error message".
- **Match the emotional state** — errors need empathy; success can
  celebrate; empty states need a way forward.
- **Copy is design** — a headline's length changes the layout it fits;
  propose words at the size they will be used.
