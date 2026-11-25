---
slug: research-synthesis
name: Research synthesis
description: Synthesize user research into themes, insights, and prioritized recommendations. Use when the user pastes transcripts, survey results, usability notes, or feedback, or attaches research assets — invoke with /research-synthesis [data] for a verbatim-evidence-backed synthesis.
category: design
---

# Research synthesis

Do not paste this document into chat — follow it: it tells you how to turn
raw research data into an actionable synthesis.

The user may invoke this with `/research-synthesis` followed by optional
arguments (e.g. `/research-synthesis <pasted transcript>`). Cross-reference
the **user-research** skill (load with `load_skill("user-research")`) when
the synthesis leads to planning a follow-up study.

## What you accept

- Interview transcripts or notes (pasted into chat)
- Survey results (pasted data or CSV text)
- Usability test notes — including notes from testing the published design
- Support tickets, feedback, or app-store reviews (pasted)
- Attached research assets — each turn may carry
  `[Asset: name.png (image, …) — description: "…" — url: …]`; the
  description is ground truth, and you can open the url with the browser
  tools for detail
- Web research you run yourself with the browser tools
  (`browser_navigate` to `https://duckduckgo.com/?q=<query>`, then
  `browser_snapshot`) when the user asks you to supplement the data

## Missing inputs

If the invocation arrives without data, ask with `ask_user` (it ends the
turn; the answer arrives as the next user message). Useful questions:

- "What data am I synthesizing?" — options like *Interview transcripts* /
  *Survey results* / *Usability-test notes* / *Support & feedback*
- "Roughly how many participants/responses?" — options like *1–5* / *6–15* /
  *16–50* / *50+*
- "Should I supplement with web research?" — *Yes, check competitors* /
  *No, work only from what I paste*

Never invent participants, quotes, or counts to fill gaps; flag what's
missing in Methodology Notes instead.

## Process

1. **Inventory first.** Read everything before interpreting anything. State
   the method, participant/response count, and date range up front.
2. **Code the data.** Extract discrete observations, each tied to its
   source. Keep observations and interpretations strictly separate:
   "5 of 8 participants clicked the wrong button" is an observation; "the
   button placement is confusing" is an interpretation.
3. **Affinity-group** observations into themes; count prevalence as "X of Y
   participants", never "most users".
4. **Pull verbatim quotes** — direct participant quotes with identifiers
   (P1, P2… or response #) make insights credible. Quote the raw text, even
   when ungrammatical.
5. **Derive insights and opportunities**, then prioritize by impact/effort.
6. **Identify segments** where the data naturally splits (behavior, needs,
   role) — don't force segments onto thin data.
7. **Close with open questions** the data cannot answer.

If a theme concerns the published design, you may check it live with the
browser tools (navigate + snapshot) before writing the recommendation —
confirm whether the design already addresses the finding.

## Output template

Deliver the synthesis as clean markdown in chat — that is the deliverable;
there is no document tool.

```markdown
## Research Synthesis: [Study Name]
**Method:** [Interviews / Survey / Usability Test] | **Participants:** [X]
**Date:** [Date range] | **Source:** [user-pasted data / attached assets]

### Executive Summary
[3-4 sentence overview of key findings]

### Key Themes

#### Theme 1: [Name]
**Prevalence:** [X of Y participants]
**Summary:** [What this theme is about]
**Implication:** [What this means for the product]

### Verbatim Evidence
| Quote | Participant | Theme | Context |
|-------|-------------|-------|---------|
| "[raw quote]" | P1 | [theme 1] | [what they were responding to] |

### Insights → Opportunities
| Insight | Opportunity | Impact | Effort |
|---------|-------------|--------|--------|
| [What we learned] | [What we could do] | High/Med/Low | High/Med/Low |

### User Segments Identified
| Segment | Characteristics | Needs | Size |
|---------|-----------------|-------|------|
| [Name] | [Description] | [Key needs] | [Rough %] |

### Recommendations
1. **[High priority]** — [why, tied to which findings]
2. **[Medium priority]** — [why]
3. **[Lower priority]** — [why]

### Questions for Further Research
- [What we still don't know]

### Methodology Notes
[How the data was collected, sample limits, biases; what was missing]
```

## Next steps

End the delivery with concrete offers — the synthesis feeds this studio:

- "Want me to turn the top recommendations into design changes?" — sketch
  them with `wireframe`, then revise the page via `preview_section` /
  `propose_design` and publish on approval.
- "Want a follow-up study plan for the open questions?" — load
  `load_skill("user-research")` and draft the plan.
- If the design already covers a theme, say so and link the section
  (`data-section`) rather than recommending a duplicate change.

## Tips

1. **Include raw quotes** — the Verbatim Evidence table is the credibility
   core; never paraphrase quotes.
2. **Separate observations from interpretations** — and label which is
   which in the themes.
3. **Quantify where possible** — "7 of 10 participants" beats "most users".
4. **Respect the sample** — 5 interviews justify direction, not statistics;
   say so in Methodology Notes.
