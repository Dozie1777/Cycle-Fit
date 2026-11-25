---
slug: social
name: Social media
description: Create and plan organic social content for LinkedIn, X, Instagram, TikTok and Shorts — hooks, post structure, cadence, repurposing, engagement and platform playbooks. Use when the user mentions a social platform, a post, thread, reel or carousel, or asks what to post. Invoke with /social ...
category: marketing
---

# Social media

Do not paste this document into chat — follow it. Use these frameworks to plan, write, and organize organic social content for the campaign.

## Ground rules

- This is a **strategy + copy playbook, not a publishing pipeline**: there is no scheduler or account connector here. Finished post copy is delivered in chat, wrapped in a fenced code block. Agreed posting slots go on the campaign calendar with `add_event` (channelId from `list_channels`) — the human posts to the real accounts.
- Call `list_channels` before referencing any platform; link by id, never invent names.
- Pull tone, audience, and key message from the campaign brief. Never invent engagement numbers, follower counts, performance claims, or posting dates.
- Storytelling first. Platform tactics and algorithm mechanics amplify a good story; they never replace one. Keep this at the center of every recommendation.

## Before creating content

Confirm the essentials (use `ask_user` for discrete choices, free-text questions for the rest):

1. **Goal** — awareness, engagement, traffic, enrollments, community, or supporting a launch (`/launch`) or campaign plan (`/campaign-plan`)?
2. **Audience** — learners, exam-prep students, professionals upskilling, parents, or the publisher's existing followers? Which platforms are they actually on?
3. **Voice** — from the brief; plus topics to avoid and any style guidelines.
4. **Capacity** — hours per week, existing content to repurpose, ability to shoot video.

## Platform playbooks

| Platform | Best for | Cadence | Key formats |
|----------|----------|---------|-------------|
| LinkedIn | Thought leadership, professional upskilling | 3–5x/week | Text posts, carousels/documents, stories |
| X | Real-time, ed-tech community, commentary | 3–10 posts/day possible; 1–2 solid threads/week | Threads, hot takes, replies |
| Instagram | Visual brand, learner lifestyle | 1–2 posts + stories daily | Reels, carousels, stories |
| TikTok / YouTube Shorts | Reach, younger learners | 1/day, up to 3x once posts clear a view floor | Short-form video |

### LinkedIn
Professional but human. Paragraph breaks for readability; the sweet spot is ~1,300 characters before "see more" folds the rest. Personal stories and lessons from building courses, running cohorts, or watching learners win outperform corporate announcements. Carousels (document posts) work for frameworks: "5 exam-prep mistakes that cost marks", "How to structure a 6-week data course". Post links sparingly — put the link in the first comment when the post must carry one.

### X
Concise and punchy, strong opening words. Threads for longer narratives: a course lesson distilled into 6–8 tweets, a launch story, a data point unpacked. Real-time commentary during live streams and exam seasons earns outsized engagement. Replies to relevant conversations build reach faster than broadcast posts.

### Instagram
Visual-first. Reels carry reach; carousels carry teaching (slide-by-slide value); stories carry community and behind-the-scenes. Captions open with a hook and use line breaks. Hashtags: 3–5 relevant ones, at the end or in the first comment.

### TikTok / YouTube Shorts
Raw beats polished. Show the outcome first ("this is how our learners prep 4 weeks before exams"), teach one specific thing, or share an authentic moment from a live stream. Short-form video structure is below.

## Content pillars

Build 3–5 pillars aligned to the publisher's expertise and the audience's interests. Example mix for a course publisher:

| Pillar | Share | Topics |
|--------|-------|--------|
| Industry insight | 30% | Trends, data, predictions in their subject area |
| Behind-the-scenes | 25% | Building the course, cohort moments, live-stream clips |
| Educational | 25% | How-tos, mini-lessons, frameworks, exam tips |
| Personal | 15% | Stories, values, opinions |
| Promotional | 5% | Course launches, cohort starts, offers |

For each pillar ask: what unique perspective does the publisher have? What do learners ask? What has performed well? What can be produced consistently? Keep promotional content rare — the feed exists to build trust the course converts later.

## Hook formulas

The first line decides whether anyone reads the rest.

- **Curiosity** — "I was wrong about [common belief]." / "[Result] usually comes down to [surprising cause]."
- **Story** — "Last week, [unexpected thing] happened." / "3 years ago, I [past state]. Today, [current state]."
- **Value** — "How to [desirable outcome] without [common pain]:" / "5 [things] that [outcome]:"
- **Contrarian** — "Unpopular opinion: [bold statement]." / "I stopped [common practice] and [result]."

A hook is a starting shape; fill it with a specific fact, number, or story.

### No AI tells

Never write:
- **Contrast reveals** — "It's not X, it's Y." State Y directly, with the reason.
- **Negation lists** — "No X, no Y, no Z." Say what does happen; one plain absence ("No prior experience needed") is fine.
- **Trailing pile-ons** — a claim, then a comma and restating clauses. End the sentence at the claim.
- **Self-answered questions / colon reveals** — "The result? 3x faster." FAQ-style questions are fine.
- **Stock phrases** — "Say goodbye to", "reimagined", "Unlock the power of", "Here's the thing".
- **Em dashes in posts** — use a period or a line break.
- **Broetry** — one short sentence per line for the whole post. Write paragraphs; break lines where a person would pause.
- **Engagement bait** — "Agree?", "Let that sink in." End on the point, or a real question you want answered.
- **Emoji as bullets** leading every line.

Keep fragments and lists-of-three to one per post. For deeper craft, see `/copywriting`; `/copy-editing` catches the tells before delivery.

## Short-form video (TikTok, Reels, Shorts)

The 3-second rule: `[visual hook] + [verbal hook] + [text overlay]` all hit in the first second.

- **Problem–solution (15–30s)**: hook with the problem → why it matters → your method or lesson → CTA.
- **List (30–60s)**: "X things that [outcome]" → one item every 5–8 seconds → CTA.
- **Tutorial (30–60s)**: show the end result first → "here's how" → quick steps → result + CTA.

Write video as scripts the human can shoot: on-screen text lines plus spoken lines. Most social video is watched without sound, so specify subtitle text — max 2 lines on screen, 3–5 words per line, key words highlighted. Ed-tech ideas: feature/lesson demos (outcome first), "watch me solve this in 60 seconds", myth-busting the subject, day-in-the-life of exam season, learner transformation stories (only real, user-supplied ones — never invent learners or results).

Common mistakes: slow hooks, no text overlay, too long, no CTA, ignoring comments in the first hour.

## Repurposing system

The best social content is extracted, not invented. One pillar piece → many posts.

**From a course lesson, webinar, or live stream** — extract "content atoms":

| Atom | What to look for | Best fit |
|------|-----------------|----------|
| Quotable moment | Bold claim or memorable line (15–60s) | X, LinkedIn, TikTok |
| Story arc | Complete mini-story with resolution (60–90s) | Reels, TikTok, Shorts |
| Tactical tip | One clear how-to (30–60s) | LinkedIn, Shorts |
| Data callout | A surprising number (user-supplied only) | LinkedIn carousel, X |
| Q&A highlight | A question learners actually asked | X thread, LinkedIn |

**From a blog post**: LinkedIn post of the key insight, a thread of takeaways, a carousel of the main framework.

Workflow: create/identify pillar content → extract 5–10 atoms → adapt per platform (format, length, tone) → write standalone captions (each post must work without context) → spread across the week via `add_event` — never dump everything at once. Evergreen posts can repeat every 3–6 months; note the reuse in the event notes.

## Weekly rhythm

| Day | LinkedIn | X | Instagram |
|-----|----------|---|-----------|
| Mon | Industry insight | Thread | Carousel |
| Tue | Behind-the-scenes | Replies/engagement | Story |
| Wed | Educational | Tip post | Reel |
| Thu | Story post | Thread | Educational |
| Fri | Hot take | Engagement | Story |

Scale the template to the publisher's capacity — a 2-post/week version beats a plan nobody executes. Batch production: one session writes the week's posts, one session records. Schedule core content through `add_event`; leave gaps for real-time commentary, which is posted live, not scheduled.

## Engagement strategy

A daily 30-minute routine the publisher (not the agent) runs:

1. Reply to all comments on own posts (5 min).
2. Comment substantively on 5–10 posts from target accounts — add insight or a related experience, never "Great post!" (15 min).
3. Repost with added perspective (5 min).
4. Continue 2–3 real conversations (5 min).

Identify 20–50 accounts in the space (educators, exam bodies, upskilling voices), engage consistently, share their content with credit, and collaborate when trust exists. Engagement is a human activity — write comment replies only when asked; never automate or post them.

## Analytics and optimization

**Metrics that matter** — awareness: reach, impressions, follower growth; engagement: engagement rate, comments (worth more than likes), shares, saves; conversion: link clicks, profile visits, signups/enrollments attributed.

When the user reports actual numbers, record them with `record_kpi_results` and feed the read into next week's plan.

**Weekly review questions**: top 3 posts (why did they work?), bottom 3 (what to learn?), follower and engagement-rate trends, best posting times from data.

**If engagement is low**: test new hooks, different times, different formats; engage more with others. **If reach is declining**: avoid external links in the post body, raise frequency, lean into video and comments. One change at a time so the readout means something.

## Delivering the work

Deliver each post (or thread, or video script) as copy-paste-ready markdown in a fenced code block, labeled by platform. After delivery, offer — do not do unasked: calendar slots (`add_event`, asking for the date), platform adaptations, variants, or a batch for the week. If the session settled new voice or messaging decisions, suggest an `update_brief` patch.

## Related skills

- `/content-creation` — longer-form pieces that feed social.
- `/draft-content` — channel-specific drafting when the brief is already fixed.
- `/copywriting` and `/copy-editing` — craft and the full AI-tells blacklist.
- `/launch` — coordinating social with a launch.
- `/campaign-plan` — fitting social into the full campaign mix.
- `/marketing-psychology` — what drives engagement and sharing.
