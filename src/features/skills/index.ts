/**
 * Public API of the skills module.
 *
 * `skill-prompts.ts` holds the shared skill taxonomy/prompt constants used
 * by both chat modules, the client data layer, and the admin UI — it is the
 * module's public surface. `github-import.ts` adds the GitHub skill-import
 * pipeline used by the skills tRPC router. Builtin skill sources live in
 * `skills/builtin/` at the app root and compile into the committed migration.
 *
 * Cross-module imports may only target this barrel.
 */

export {
	deriveSkillImport,
	fetchGithubSkillContent,
	GITHUB_API_BASE,
	GITHUB_RAW_BASE,
	type GithubListResult,
	type GithubSkillCandidate,
	type GithubSource,
	githubImportBody,
	githubImportPreviewInput,
	listGithubSkills,
	parseGithubSkillSource,
} from "./github-import";
export {
	CAMPAIGN_SKILL_CATEGORIES,
	DESIGN_SKILL_CATEGORIES,
	parseSlashCommand,
	SKILL_CATEGORIES,
	SKILL_PROMPT_DESCRIPTION_MAX,
	type SkillCategory,
	type SkillSummary,
	skillContextText,
	skillInCategories,
	skillsPromptSection,
	truncateSkillDescription,
} from "./skill-prompts";
