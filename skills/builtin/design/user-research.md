---
slug: user-research
name: User research
description: Plan, conduct, and synthesize user research. Use for "user research plan", "interview guide", "usability test", "survey design", or "research questions" — invoke with /user-research [topic] to choose a method, draft discussion guides, define participants, run sessions, and synthesize findings.
category: design
---

# User research

Do not paste this document into chat — follow it: it tells you how to plan,
run, and synthesize a research study from inside the design studio.

The user may invoke this with `/user-research` followed by optional arguments
(e.g. `/user-research why trial users drop off at pricing`). If the topic,
goal, or stage is unclear, ask with `ask_user` (2–5 options — it ends the
turn): e.g. "What should this study figure out?" with options distilled from
the brief, or "Which method fits?" (see the table below). Never start a study
without a stated research question.

## Step 1 — Choose the method

| Method | Best For | Sample Size | Time |
|--------|----------|-------------|------|
| User interviews | Deep understanding of needs and motivations | 5-8 | 2-4 weeks |
| Usability testing | Evaluating a specific design or flow | 5-8 | 1-2 weeks |
| Surveys | Quantifying attitudes and preferences | 100+ | 1-2 weeks |
| Card sorting | Information architecture decisions | 15-30 | 1 week |
| Diary studies | Understanding behavior over time | 10-15 | 2-8 weeks |
| A/B testing | Comparing specific design choices | Statistical significance | 1-4 weeks |

In this studio the two most common are:

- **Usability testing of the published design** (`/designs/<id>/site`) — the
  design is live in a browser, so tasks are immediately runnable.
- **Interviews** with the admin (or their colleagues/customers) as the
  participant source.

Recommend one method with a one-line rationale and let the user confirm via
`ask_user` before drafting anything longer.

## Step 2 — Write the research plan

Deliver the plan as markdown in chat (there is no document tool):

```markdown
## Research Plan: [Study name]
**Research questions:** [1-3 questions the study must answer]
**Method:** [method + why it fits]
**Participants:** [who, how many, how recruited]
**Sessions:** [duration, format, schedule]
**Deliverables:** [guide, notes template, synthesis report]
```

Keep research questions open ("how do small publishers set course prices?",
not "do users like feature X?").

## Step 3 — Define participants and recruiting

- Write 3-5 **screening criteria** (must-haves and exclusions), e.g. role,
  frequency of the behavior, familiarity with the product.
- State the sample size and why: 5 interviews surface most major themes in a
  well-defined population; surveys need far more for percentages.
- Draft the screening questions the user can send candidates — short,
  behavioral ("how often do you…?"), never hypothetical.
- Recruit for behavior, not opinion: people who actually do the thing, not
  people who say they would.

## Step 4 — Draft the discussion guide

Structure:

1. **Warm-up** (5 min): build rapport, explain the session, consent to notes
2. **Context** (10 min): understand their current workflow
3. **Deep dive** (20 min): explore the specific topic
4. **Reaction** (10 min): show concepts or the live design
5. **Wrap-up** (5 min): "anything we missed?", thank them

Question rules:

| Do | Don't |
|----|-------|
| Open questions: "walk me through the last time you…" | Leading: "don't you find X annoying?" |
| Past behavior: "what did you do?" | Hypotheticals: "would you use…?" |
| One idea per question | Double-barreled: "how do you create and price courses?" |
| Probes: "what happened next?", "why was that frustrating?" | Why-questions that demand justification |
| Real names for things the participant uses | Jargon the participant didn't say first |

For usability tests, add a **task list**: 3-5 concrete tasks ("sign up for
the Illustrator basics course") with a success definition each, ordered easy
→ hard, and a note to let participants fail without help.

## Step 5 — Run the study

- **Real sessions are run by the user.** You cannot attend. Prepare the
  moderator package: the guide, the task list, and a simple note-taking
  template (task / what they did / quotes / confusion moments). Ask the user
  to paste back raw notes or a transcript afterwards.
- **Pilot with the admin, conversationally.** You can conduct a mock
  interview right in this chat: confirm the format, step into the moderator
  role, ask one question at a time, keep notes, and step out of role when
  done ("switching back to designer"). Use this to test the guide before
  real sessions.
- **Expert walkthrough as a lightweight substitute.** When no participants
  are available, review the published design yourself with the browser tools
  (`browser_navigate` + `browser_snapshot` + `browser_evaluate`): attempt
  each task, and log friction from structure and content — no screenshots,
  no base64. Label it clearly as an expert review, not user evidence.
- Never fabricate participant data. If nothing real exists, the deliverable
  is the plan and guide, not findings.

## Step 6 — Synthesize

- Group observations into themes (affinity mapping), then prioritize with an
  impact/effort matrix.
- Use frameworks when they fit the question: journey mapping (experience
  over time), jobs-to-be-done (what users hire the product to do).
- Load `load_skill("research-synthesis")` and follow it to produce the full
  synthesis report — themes, verbatim evidence, prioritized recommendations.
- Close the loop: offer to turn the top recommendations into design changes
  (`wireframe` → `propose_design` → `publish_design` on approval).

## Deliverables

- Research plan (objectives, questions, method, participants) — chat markdown
- Discussion guide and/or usability task list — chat markdown
- Moderator note-taking template — chat markdown
- Synthesis report (themes, insights, recommendations) — via the
  **research-synthesis** skill
- Highlight quotes — a short list of the strongest verbatims for sharing

## Tips

1. **One study, one question** — a study that tries to answer everything
   answers nothing well.
2. **Pilot the guide** — one mock session with the admin exposes broken
   questions cheaply.
3. **Capture words, not summaries** — exact quotes are the raw material the
   synthesis step needs.
