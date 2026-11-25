// Type declarations for the migration generator (plain .mjs executed by
// node directly; imported by tests to assert the committed migration matches
// the skill sources).
export type BuiltinSkill = {
	rel: string;
	slug: string;
	name: string;
	description: string;
	category: string;
	content: string;
};

/** Parses every skill .md under the builtin skills directory. */
export function collectSkills(dir?: string): BuiltinSkill[];

/** Renders the 0020 migration SQL body for the given skills (deterministic). */
export function renderMigration(skills: BuiltinSkill[]): string;
