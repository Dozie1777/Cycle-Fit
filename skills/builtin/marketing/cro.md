---
slug: cro
name: CRO
description: Diagnose and fix conversion on marketing pages — landing pages, course pages, pricing, enrollment flows, forms. Use when a page "isn't converting" or a URL is shared for review. Invoke with /cro plus a URL or pasted copy; delivers quick wins, high-impact changes, and test ideas.
category: marketing
---

# CRO

Do not paste this document into chat — follow it. Use it to analyze a marketing page and return prioritized, actionable conversion recommendations. For a full copy rewrite rather than a diagnosis, hand off to `/copywriting`; to polish copy the audit didn't rewrite, use `/copy-editing`.

## Ground rules

- There are no analytics, publishing, or test-running tools here: findings are delivered in chat, report-style findings can be persisted with `save_report`, and page copy you recommend is delivered as paste-ready markdown or seeded with `create_asset`. You never launch a test or change a live page.
- Never invent conversion rates, traffic numbers, revenue, prices, dates, or offers. If a metric or fact is needed and not provided, ask — or mark it explicitly as an assumption to verify.
- Never guess audience, traffic source, budget, or tone — ask. Use `ask_user` for discrete choices (page type, primary conversion goal, traffic source) and plain questions for open ones.
- Audit only what is actually there: a live page via the browser tools (`browser_navigate` then `browser_snapshot`), or the copy the user pastes. Do not critique sections you cannot see — list them as "needs checking" instead.

## Initial assessment

Before recommending anything, pin down three things. If the user's message doesn't answer them, ask with `ask_user`:

1. **Page type** — homepage, course landing page, pricing/plans, enrollment or signup flow, free-lesson registration, live-stream page, other
2. **Primary conversion goal** — enroll in a course, register for a free lesson, join a cohort, register for a live stream, start exam prep, buy credits, contact the publisher
3. **Traffic context** — where visitors come from (paid ads, social, email, organic search, in-app), because message match depends on it

Also ask for, when available: current conversion rate and target, what happens after the page (the next step in the funnel), any user research or session recordings, and what has already been tried.

## The seven-dimension analysis

Analyze in this order — it runs from highest impact to lowest:

### 1. Value proposition clarity

- Can a visitor say what this is and why they should care within 5 seconds?
- Is the primary benefit clear, specific, and differentiated — or feature-focused company language?
- Is it trying to say everything instead of the most important thing?

Failure mode, ed-tech edition: "Learn anything, anywhere, anytime" says nothing; "Pass WAEC maths with 20-minute daily lessons" says everything.

### 2. Headline effectiveness

- Does it communicate the core value proposition, specific enough to be meaningful?
- Does it match the traffic source's message (the ad's promise should be the headline's promise)?
- Strong patterns: outcome without pain ("Pass your exam without the all-nighters"), specificity (numbers, timeframes, concrete details), social proof ("Join 12,000+ learners…").

### 3. CTA placement, copy, and hierarchy

- One clear primary action? Visible without scrolling?
- Button copy communicates value, not just action. Weak: "Submit", "Sign Up", "Learn More". Strong: "Start My Free Lesson", "Enroll Now", "Reserve My Seat", "See Plans".
- Is there a logical primary vs. secondary CTA structure? Are CTAs repeated at key decision points (after benefits, after proof, at page end)?

### 4. Visual hierarchy and scannability

- Does someone scanning get the main message?
- Are the most important elements visually prominent?
- Enough white space? Do images and video support or distract?

### 5. Trust signals and social proof

Types to look for: learner testimonials (specific and attributed), instructor/publisher credentials, learner or enrollment counts, pass-rate or completion stats where they actually exist, review scores, recognized certification or exam-board alignment, secure-payment indicators near checkout.

Placement: near CTAs and after benefit claims.

### 6. Objection handling

Common ed-tech objections: "Will this cover my syllabus or exam board?", "Is the instructor credible?", "What if the schedule doesn't fit me?", "Is it worth the credits?", "What if it doesn't work for me?"

Address through: FAQ sections, syllabus/curriculum transparency, preview lessons, refund or guarantee language (only if it actually exists), process transparency (what happens right after signup).

### 7. Friction points

- Too many form fields; required information that shouldn't be required
- Unclear next steps; forced account creation before any value
- Confusing navigation, mobile experience issues, slow load times
- Pricing stated in credits without making the real cost obvious

## Page-type frameworks

**Homepage** — clear positioning for cold visitors; quick path to the most common conversion (usually course enrollment or free-lesson signup); serve both "ready to enroll" and "still browsing" (e.g. dual path: "Start a free lesson" vs. "Browse the catalog").

**Course landing page** — message match with the traffic source; single primary CTA; complete argument on one page: what's taught, who it's for, the outcome, instructor credibility, format and schedule, price in credits, and how enrollment works.

**Pricing / plans** — clear plan comparison; make the recommended plan obvious; address "which plan is right for me?" anxiety; state exactly what credits buy.

**Enrollment / signup flow** — the page's only job is completing the form: minimal fields, clear value for each field, trust signals near the button, progress indication if multi-step, no surprises about what comes next.

**Free lesson / trial page** — sell the next step, not the whole catalog: zero-risk framing, what the lesson covers, and what happens after (and how full enrollment happens then).

**Live-stream / event page** — date and time in the visitor's terms, what happens during the session, one-step registration, and what the confirmation flow looks like.

## Output format

Structure recommendations exactly as:

### Quick wins (implement now)
Easy changes with likely immediate impact — CTA copy, trust-signal placement, form-field trims, headline swaps.

### High-impact changes (prioritize)
Bigger structural changes — repositioning the value proposition, restructuring the page, reworking the flow after the click.

### Test ideas
Hypotheses worth A/B testing rather than assuming (hero variations, proof placement, pricing presentation, form length). For test design and measurement, hand off to `/ab-testing`.

### Copy alternatives
For key elements (headlines, CTAs), 2–3 alternatives with rationale each, delivered as paste-ready markdown. If the user wants the page rebuilt around the winning copy, offer `create_asset` to seed a design-studio project — do not mock the page visually in chat.

## Finding and saving the work

- **Live pages**: `browser_navigate` to the URL, then `browser_snapshot` to read structure and copy. Assess what the snapshot actually shows and flag what needs a real session recording or user research to confirm.
- **Pasting copy**: if the user pastes the page text instead, audit it the same way and note that layout, load, and mobile findings can't be assessed from text alone.
- **Persisting**: if the user wants the audit kept with the campaign, offer `save_report` with the four output sections as its structure.
- **Audience context**: if recommendations depend on who the page targets, check `list_audiences` and link by id rather than assuming a segment.

## Task-specific questions

1. What's the current conversion rate and the goal?
2. Where is traffic coming from?
3. What does the flow look like after this page?
4. Do you have user research, heatmaps, or session recordings?
5. What have you already tried?

## Related skills

- **copywriting** — if the page needs a complete copy rewrite, not just a diagnosis
- **copy-editing** — to polish copy the audit didn't rewrite
- **ab-testing** — to design and measure tests for the recommendations
- **onboarding** — if the drop-off is after enrollment, not on the page
- **customer-research** — to source voice-of-customer language for rewrites
- **marketing-psychology** — for the reasoning behind objections and risk framing
