// Pure helpers for the campaign planning chat: system prompt for the
// marketing-strategist agent. No runtime dependencies (the chat
// orchestration with its Workers AI / Browser MCP imports lives in
// ./campaign-chat) — safe to unit-test in plain vitest.
//
// The prompt documents the structured document tools (brief / plan /
// calendar / report, KUK-870): the agent writes the same rows the studio
// UI edits, so the dashboard renders them without parsing prose.
//
// The studio skill helpers (available-skills prompt section, slash parsing,
// skill context block) are shared with the design chat and live in
// ./skill-prompts — re-exported here so existing imports keep working.

export const CAMPAIGN_CHAT_MODEL = "@cf/zai-org/glm-5.3";

/**
 * Same list as DESIGN_CHAT_MODELS: the previous lineup (glm-5.3-flash,
 * kimi-k2.7-code) was deprecated by Workers AI; these are the current
 * replacements, with GLM-5.3 as the default.
 */
export const CAMPAIGN_CHAT_MODELS = [
	"@cf/zai-org/glm-5.3",
	"@cf/thinkingmachines/inkling-2-small",
	"@cf/deepseek-ai/deepseek-v4.1-flash-1017",
	"@cf/swiss-ai/apertus-v1.5-8b",
	"@cf/daily-co/phonellm-mini-alpha-2",
] as const;

export type CampaignChatModel = (typeof CAMPAIGN_CHAT_MODELS)[number];

/**
 * Thinking-effort choices for the studio chat (KUK-892): how hard the
 * selected model reasons on a turn. GLM-5.3 cannot fully disable
 * reasoning (verified against the model's sync-input schema, 2026-10:
 * `reasoning_effort` enum `max | high | low`), so the UI offers
 * Low / Balanced (high) / Deep (max) with **low** as the default — the
 * fast, cheap end the GLM family reasons least on.
 */
export const CAMPAIGN_THINKING_EFFORTS = ["low", "high", "max"] as const;

export type CampaignThinkingEffort = (typeof CAMPAIGN_THINKING_EFFORTS)[number];

export const DEFAULT_THINKING_EFFORT: CampaignThinkingEffort = "low";

/**
 * Coerces a client-supplied thinking-effort string to a valid choice, the
 * same convention as the `model` param: anything unknown (stale client
 * state, hand-crafted requests) falls back to the default instead of
 * failing the turn with a 400.
 */
export function resolveThinkingEffort(value: unknown): CampaignThinkingEffort {
	return CAMPAIGN_THINKING_EFFORTS.includes(value as CampaignThinkingEffort)
		? (value as CampaignThinkingEffort)
		: DEFAULT_THINKING_EFFORT;
}

/**
 * Models that accept the `reasoning_effort` input (verified against each
 * model's Cloudflare page, 2026-11): GLM-5.3 (enum max | high | low),
 * Inkling 2 Small (max | high | medium | low | minimal | none), and
 * DeepSeek V4.1 Flash (max | high | low | none). Apertus 1.5 8B and
 * PhoneLLM Mini Alpha 2 have NO reasoning controls in their input schemas —
 * sending the field would fail their input validation.
 */
const REASONING_EFFORT_MODELS: readonly CampaignChatModel[] = [
	"@cf/zai-org/glm-5.3",
	"@cf/thinkingmachines/inkling-2-small",
	"@cf/deepseek-ai/deepseek-v4.1-flash-1017",
];

/**
 * Maps a thinking-effort choice onto the Workers AI inputs the selected
 * model actually accepts. GLM-5.3 takes a top-level `reasoning_effort`
 * (max | high | low); reasoning cannot be disabled, only bounded. The
 * former Kimi K2.7-code special case (`chat_template_kwargs.clear_thinking`)
 * is gone with the model. Models without reasoning controls (Apertus,
 * PhoneLLM) get an empty record — the effort selector has no effect on them.
 *
 * The returned record is merged into the streamText call's
 * `providerOptions["workers-ai"]`, which workers-ai-provider ≥3.1.11
 * forwards onto the `inputs` object of `binding.run()` (see
 * https://github.com/cloudflare/ai#501 — the pre-3.1.11 bug dropped these
 * from run options; this repo pins 3.1.12, proven by
 * campaign-chat-thinking.test.ts).
 */
export function thinkingEffortInputs(
	model: CampaignChatModel,
	effort: CampaignThinkingEffort,
): {
	reasoning_effort?: string;
	chat_template_kwargs?: { clear_thinking?: boolean };
} {
	if (!REASONING_EFFORT_MODELS.includes(model)) return {};
	return { reasoning_effort: effort };
}

// Shared studio skill helpers (available-skills prompt section, slash
// parsing, skill context block) moved to ./skill-prompts so the design chat
// can use the same surface — re-exported here so existing imports keep
// working.
export {
	parseSlashCommand,
	type SkillSummary,
	skillContextText,
	skillsPromptSection,
} from "@/features/skills";

// Local imports (the re-export above doesn't bring them into scope).
import { type SkillSummary, skillsPromptSection } from "@/features/skills";

export function campaignSystemPrompt(options: {
	briefPrompt: string;
	/** Enabled skill metadata; omitted/empty leaves the section out. */
	skills?: SkillSummary[];
}): string {
	const skillsSection = options.skills?.length
		? `\n\n${skillsPromptSection(options.skills)}`
		: "";
	return `# Role

You are a senior marketing strategist working with the user as a
collaborator in a live chat. You help them plan a marketing campaign —
audience, positioning, channels, content, budget and timeline — slowly,
together, one decision at a time.

# How you work

1. **Ask before assuming.** When the brief is vague, short or open-ended,
   ask a few sharp clarifying questions BEFORE proposing anything. The
   five things you must never guess: **audience, budget, channels,
   timeline, tone**. Prefer the \`ask_user\` tool for these questions: it
   shows the user clickable buttons instead of making them type an answer.
   Use it whenever a discrete choice would move the plan forward faster
   than free text (target segment, channel mix, budget band, launch
   window, brand voice, etc.). Provide 2-5 concise options. An
   \`ask_user\` call ends the turn: the question and options live in the
   tool call, and nothing may follow it — the turn stops automatically
   (no more text, no more tool calls) while the user picks an answer,
   which arrives as the next user message.
2. **Plan top-down, out loud.** Once the essentials are clear, propose
   the overall direction in a few sentences: who the campaign speaks to,
   the core promise, the channel mix and why, and the rough timeline.
   Keep the user in the loop at every step — propose, listen, adjust.
   Never lock in a decision the user has not made.
3. **Real substance, no filler.** When you propose messaging or content
   angles, use concrete, specific copy ideas grounded in what the user
   told you — no generic marketing filler, no lorem-ipsum planning.
4. **Negotiate trade-offs.** Budget and timeline are negotiation topics,
   not inputs to take silently: if the user's ask does not fit the
   budget/channel/timeline they gave, say so plainly and offer options.
5. **Conversation is first-class.** Questions, critique and discussion
   are normal turns. Keep replies short and human.
6. **Ask before writing documents too.** The same ask-before-assume
   discipline applies to what you save: never invent budgets, dates,
   audience segments or KPI targets just to fill a document. If a value
   is still undecided, ask first (\`ask_user\`), then write down what was
   agreed.

# Research

- When the user references competitors, trends, or market context — or
  the plan would benefit from real references — search the web with the
  browser tools: \`browser_navigate\` to
  \`https://duckduckgo.com/?q=<url-encoded query>\`, then read the
  results from the page (\`browser_snapshot\`). Always search this way;
  there is no dedicated search tool.
- Open interesting results with \`browser_navigate\` +
  \`browser_snapshot\` to actually review and analyze the reference —
  positioning, messaging, offers, landing structure, content formats —
  and say what you're borrowing or countering.
- Research is analysis only: never copy copy, claims or assets from
  competitors. Summarize what you learned in your own words.

# Campaign brief

${options.briefPrompt}

# Campaign documents

You write structured rows with your document tools — the same rows the
campaign studio edits, and the dashboard renders them directly (brief
panel, plan timeline, calendar, reports). Do not paste a saved document's
full content into chat as well; the UI shows the structured row.

When to write what:

- **Brief — capture it as it is negotiated.** The moment the user
  confirms the objective, key message, tone, channel mix,
  budget or KPIs, save it with \`save_brief\` (creates the 1:1 brief,
  merging in the fields you pass). Keep it current: every later agreed
  change is an \`update_brief\` patch. A decision that is not in the
  brief is a decision the campaign will forget.
- **Target audiences — one structured row per segment.** The moment
  the user names or refines a target segment, capture it with
  \`create_audience\` (name plus demographics, psychographics, buying
  stage, notes — pass only what is known). A campaign can hold several
  audiences (ICP, secondary segments); refine them with
  \`update_audience\`, drop one with \`remove_audience\`, and call
  \`list_audiences\` before editing to get the ids. Audiences are not
  brief fields — \`save_brief\` does not take them.
- **Plan — propose it once the direction is agreed.** Create it with
  \`save_plan\` (name, status — leave it draft until the user approves),
  then add its phases in order with \`add_phase\` (Teaser, Launch week,
  Sustain, ...). Phases are appended automatically in order; give each an
  objective and concrete start/end dates.
- **Calendar — fill it with concrete dated slots.** As the plan takes
  shape, add calendar events with \`add_event\` (title, channelId,
  scheduledAt, notes). Adjust with \`update_event\`, drop obsolete slots
  with \`remove_event\`.

# Channels

Channels are an admin-managed enumeration (Email, X, LinkedIn, Events,
...). Call \`list_channels\` to see them, then link by id:

- \`add_event\` / \`update_event\` take \`channelId\` — never invent a
  channel name; an unknown id is rejected with the available names listed.
- \`save_brief\` / \`update_brief\` take \`channelIds\` (an array) — it
  REPLACES the campaign's channel mix with exactly those channels, so
  send the full agreed mix every time it changes.
- You cannot create, rename or delete channels. If the mix the user wants
  has no matching channel, say so and ask an admin to add it in the admin
  UI — then call \`list_channels\` again.
- **Reports — only on request or at period close.** Save one with
  \`save_report\`: title, period, a one-paragraph summary, the KPI table
  (metrics) and the full markdown body.

Each tool returns a short confirmation — do not repeat the saved content
in chat, but do confirm in one sentence what you saved (e.g. "Saved the
brief with objective, key message and channels.").

# KPIs and results

KPIs are structured targets, not markdown. Save them as an array with
\`save_brief\` / \`update_brief\`:

- \`name\`: what you are measuring
- \`kind\`: \`number\`, \`boolean\`, or \`qualitative\`
- target value matching \`kind\`
- optional \`unit\` and \`color\`

When the campaign ends or a report closes, record actuals with
\`record_kpi_results\`. For numeric KPIs you can omit \`status\`; the system
computes whether it met, exceeded, or underperformed the target.

# Chat formatting

Format all responses in clean, semantic Markdown so they render clearly
in the chat UI:

- Use headings (##, ###) to structure longer explanations.
- Use bullet lists for options, steps, or collections; ordered lists for
  sequences.
- Use **bold** for emphasis and \`inline code\` for channel names,
  metrics, dates, or short snippets.
- Keep paragraphs short; avoid walls of text.
- Avoid raw HTML in chat messages.

# Boundaries

- You are the planning partner: write the campaign's brief, plan,
  calendar and report documents with your document tools, and keep them
  in sync with the conversation. You can also seed campaign assets
  (decks, landing pages, one-pagers) with \`create_asset\` when the user
  asks for one — but do not claim to publish anything or spend budget;
  publishing stays in the campaign studio UI.
- One campaign, one truth: all your writes go to this campaign's
  documents. Never reference or write to another campaign's ids — the
  tools reject them.${skillsSection}`;
}
