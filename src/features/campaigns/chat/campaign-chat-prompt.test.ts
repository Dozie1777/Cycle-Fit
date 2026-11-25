// Unit tests for the campaign chat prompt helpers (KUK-891): the
// "Available skills" system-prompt section, slash-command parsing and the
// skill context block injected into the invoking user turn.
import { describe, expect, it } from "vitest";
import {
	CAMPAIGN_CHAT_MODEL,
	type CampaignChatModel,
	campaignSystemPrompt,
	parseSlashCommand,
	resolveThinkingEffort,
	skillContextText,
	skillsPromptSection,
	thinkingEffortInputs,
} from "./campaign-chat-prompt";

const SKILLS = [
	{
		name: "Campaign basics",
		slug: "campaign-basics",
		description: "A guided tour of the studio.",
	},
	{
		name: "Draft a brief",
		slug: "draft-a-brief",
		description: "Brief negotiation playbook.",
	},
];

describe("skillsPromptSection", () => {
	it("lists every skill with name, /slug and description", () => {
		const section = skillsPromptSection(SKILLS);
		expect(section).toContain("# Available skills");
		expect(section).toContain("load_skill");
		for (const skill of SKILLS) {
			expect(section).toContain(`**${skill.name}**`);
			expect(section).toContain(`/${skill.slug}`);
			expect(section).toContain(skill.description);
		}
	});

	it("returns an empty string with no skills", () => {
		expect(skillsPromptSection([])).toBe("");
	});

	it("truncates over-long descriptions in the model-facing section", () => {
		// The section re-ships every turn — a 300-char (handler-limit)
		// description per skill × 29 skills is recurring token cost. The
		// model only needs enough to decide to load the skill.
		const long =
			"Structured design feedback on usability, hierarchy, and consistency across the published design, previews, or any URL you provide — covering layout, typography, accessibility and copy quality in one pass with prioritized fixes.";
		const section = skillsPromptSection([
			{ name: "Design critique", slug: "design-critique", description: long },
		]);
		expect(section).toContain("/design-critique");
		expect(section).toContain("Structured design feedback");
		expect(section).toContain("…");
		expect(section).not.toContain(long.slice(-40));
	});
});

describe("campaignSystemPrompt with skills", () => {
	it("appends the skills section when skills are provided", () => {
		const prompt = campaignSystemPrompt({
			briefPrompt: "Launch the spring line",
			skills: SKILLS,
		});
		expect(prompt).toContain("Launch the spring line");
		expect(prompt).toContain("# Available skills");
		expect(prompt).toContain("/campaign-basics");
	});

	it("omits the skills section when none are provided or enabled", () => {
		for (const skills of [undefined, []]) {
			const prompt = campaignSystemPrompt({
				briefPrompt: "Launch the spring line",
				skills,
			});
			expect(prompt).not.toContain("# Available skills");
		}
	});
});

describe("parseSlashCommand", () => {
	it("parses a bare /slug and a /slug with the rest of the message", () => {
		expect(parseSlashCommand("/campaign-basics")).toEqual({
			slug: "campaign-basics",
			rest: "",
		});
		expect(parseSlashCommand("/draft-a-brief focus on retention")).toEqual({
			slug: "draft-a-brief",
			rest: "focus on retention",
		});
		// Trimming is view-level only (the persisted row stays as typed).
		expect(parseSlashCommand("  /content-calendar  ")).toEqual({
			slug: "content-calendar",
			rest: "",
		});
	});

	it("returns null for anything that is not a leading slash invocation", () => {
		expect(parseSlashCommand("hello")).toBeNull();
		expect(parseSlashCommand("")).toBeNull();
		expect(parseSlashCommand("/")).toBeNull();
		// Leading-slash + word is a slash invocation even with a rest part —
		// unknown slugs are rejected by the callers, not the parser.
		expect(parseSlashCommand("/has space")).toEqual({
			slug: "has",
			rest: "space",
		});
		expect(parseSlashCommand("see /campaign-basics for the tour")).toBeNull();
		expect(parseSlashCommand("/upper-Case")).toBeNull();
	});
});

describe("skillContextText", () => {
	it("wraps the skill content in a labelled block", () => {
		const block = skillContextText({
			name: "Draft a brief",
			content: "# Draft a brief\nStep 1…",
		});
		expect(block).toBe(
			"[Skill: Draft a brief]\n# Draft a brief\nStep 1…\n[End skill]",
		);
	});
});

describe("resolveThinkingEffort (KUK-892)", () => {
	it("accepts the three wire values", () => {
		expect(resolveThinkingEffort("low")).toBe("low");
		expect(resolveThinkingEffort("high")).toBe("high");
		expect(resolveThinkingEffort("max")).toBe("max");
	});

	it("coerces unknown values to the default instead of failing", () => {
		// Same convention as the model param: stale client state must never
		// hard-fail the turn.
		expect(resolveThinkingEffort("medium")).toBe("low");
		expect(resolveThinkingEffort("")).toBe("low");
		expect(resolveThinkingEffort(undefined)).toBe("low");
		expect(resolveThinkingEffort(null)).toBe("low");
		expect(resolveThinkingEffort(42)).toBe("low");
		expect(resolveThinkingEffort("LOW")).toBe("low");
	});
});

describe("thinkingEffortInputs per-model mapping (KUK-892)", () => {
	it("maps GLM-5.3 to reasoning_effort (max | high | low)", () => {
		const glm = CAMPAIGN_CHAT_MODEL;
		expect(thinkingEffortInputs(glm as CampaignChatModel, "low")).toEqual({
			reasoning_effort: "low",
		});
		expect(thinkingEffortInputs(glm as CampaignChatModel, "high")).toEqual({
			reasoning_effort: "high",
		});
		expect(thinkingEffortInputs(glm as CampaignChatModel, "max")).toEqual({
			reasoning_effort: "max",
		});
	});

	it("sends reasoning_effort only to the models whose schema accepts it", () => {
		// Verified against each model's Cloudflare page (2026-11): GLM-5.3,
		// Inkling 2 Small, and DeepSeek V4.1 Flash accept reasoning_effort;
		// Apertus 1.5 8B and PhoneLLM Mini Alpha 2 have no reasoning controls.
		const withReasoning = [
			"@cf/zai-org/glm-5.3",
			"@cf/thinkingmachines/inkling-2-small",
			"@cf/deepseek-ai/deepseek-v4.1-flash-1017",
		] as const;
		const withoutReasoning = [
			"@cf/swiss-ai/apertus-v1.5-8b",
			"@cf/daily-co/phonellm-mini-alpha-2",
		] as const;

		for (const model of withReasoning) {
			expect(thinkingEffortInputs(model, "high")).toEqual({
				reasoning_effort: "high",
			});
		}
		for (const model of withoutReasoning) {
			expect(thinkingEffortInputs(model, "low")).toEqual({});
			expect(thinkingEffortInputs(model, "high")).toEqual({});
			expect(thinkingEffortInputs(model, "max")).toEqual({});
		}
	});
});
