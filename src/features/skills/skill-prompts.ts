// Pure helpers for the studio skill library (KUK-891, extended in
// 0020_knowledge_skills): the "Available skills" system-prompt section,
// slash-command parsing, and the skill context block injected into the
// invoking user turn. Shared by the campaign and design studio chats —
// no runtime dependencies, safe to unit-test in plain vitest.
//
// Skills are categorized by studio: the campaign chat loads the campaign /
// marketing / sales categories, the design chat loads design.

export const SKILL_CATEGORIES = [
	"campaign",
	"marketing",
	"sales",
	"design",
] as const;

export type SkillCategory = (typeof SKILL_CATEGORIES)[number];

/** Categories the campaign studio chat surfaces. */
export const CAMPAIGN_SKILL_CATEGORIES: readonly SkillCategory[] = [
	"campaign",
	"marketing",
	"sales",
];

/** Categories the design studio chat surfaces. */
export const DESIGN_SKILL_CATEGORIES: readonly SkillCategory[] = ["design"];

/** True when a skill row may surface in the given studio's chat. */
export function skillInCategories(
	category: string,
	allowed: readonly string[],
): boolean {
	return allowed.includes(category);
}

/** The skill metadata the system prompt carries (never the full content). */
export type SkillSummary = {
	name: string;
	slug: string;
	description: string;
};

/**
 * Model-facing description cap. The "Available skills" section re-ships
 * every turn, so 29 skills × a 300-char (handler-limit) description is
 * ~1.5k recurring tokens for metadata the model only needs to decide
 * whether to load a skill. The slash menu keeps the full text — this
 * truncation is prompt-only.
 */
export const SKILL_PROMPT_DESCRIPTION_MAX = 120;

export function truncateSkillDescription(description: string): string {
	const clean = description.trim();
	if (clean.length <= SKILL_PROMPT_DESCRIPTION_MAX) return clean;
	const cut = clean.slice(0, SKILL_PROMPT_DESCRIPTION_MAX);
	const lastSpace = cut.lastIndexOf(" ");
	const stem = lastSpace > 60 ? cut.slice(0, lastSpace) : cut;
	return `${stem.replace(/[\s,;:./-]+$/, "")}…`;
}

/**
 * "Available skills" section appended to the system prompt when the studio
 * has enabled skills (KUK-891). Metadata only — the full markdown content is
 * loaded with the load_skill tool, never pre-injected.
 */
export function skillsPromptSection(skills: SkillSummary[]): string {
	if (skills.length === 0) return "";
	const lines = skills
		.map(
			(skill) =>
				`- **${skill.name}** — \`/${skill.slug}\` — ${truncateSkillDescription(skill.description)}`,
		)
		.join("\n");
	return `# Available skills

The platform has a skill library of reusable instruction playbooks for the
topics below. When the user invokes a skill by typing its /slug in the
message, or asks for one of these topics (e.g. "run the brief playbook"),
call the \`load_skill\` tool with the slug and follow the returned
instructions for the rest of the turn.

${lines}`;
}

/**
 * Parses a slash invocation at the start of a user message (KUK-891):
 * `/<slug>` optionally followed by the rest of the message. Returns null for
 * anything that does not start with a slash — and callers treat a slug that
 * matches no enabled skill as plain text.
 */
export function parseSlashCommand(
	text: string,
): { slug: string; rest: string } | null {
	const match = /^\/([a-z0-9][a-z0-9-]*)(?:\s+([\s\S]*))?$/.exec(text.trim());
	if (!match) return null;
	return { slug: match[1], rest: (match[2] ?? "").trim() };
}

/**
 * The context block a resolved skill injects into the invoking user turn's
 * model-facing text (same pattern as the design chat's attachment block):
 * the message as typed stays in D1; only this model context carries it.
 */
export function skillContextText(skill: {
	name: string;
	content: string;
}): string {
	return `[Skill: ${skill.name}]\n${skill.content}\n[End skill]`;
}
