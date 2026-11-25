// Generates prisma/migrations/0021_marketing_craft_skills/migration.sql from
// the builtin skill source files in skills/builtin/** (see that directory's
// README). Deterministic: run it after editing any skill .md and commit the
// regenerated migration. scripts/check-builtin-skills.mjs + the unit tests
// assert the committed migration always matches these sources.
//
//   node skills/builtin/generate-migration.mjs        # regenerate the SQL
//   import { renderMigration } from this module       # pure, no writes
import {
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";

const SKILLS_ROOT = new URL("./", import.meta.url).pathname;
const MIGRATION_DIR = new URL(
	"../../prisma/migrations/0021_marketing_craft_skills",
	import.meta.url,
).pathname;

/**
 * Builtin slugs whose content was rewritten in place (adapted from
 * coreyhaines31/marketingskills) — 0021 refreshes their seeded rows with
 * the upgraded content via INSERT … ON CONFLICT(slug) DO UPDATE, guarded
 * to rows that are still builtin AND never edited by an admin
 * (createdAt = updatedAt — Prisma bumps updatedAt on every edit, so any
 * admin customization, including disabling, opts the row out of the
 * refresh). Admin-customized rows keep their content; admins who want
 * the upgrade copy it from skills/builtin/.
 */
const RESEED_SLUGS = ["email-sequence", "seo-audit"];

/**
 * Parsed frontmatter + body of one builtin skill file.
 * @param {string} rel
 * @param {string} slug
 * @param {string} name
 * @param {string} description
 * @param {string} category
 * @param {string} content
 */
function skill(rel, slug, name, description, category, content) {
	return { rel, slug, name, description, category, content };
}

/**
 * Walks a skills source directory and parses every skill .md (README.md
 * excluded). Throws on malformed files so a bad edit can't reach the
 * migration silently.
 * @param {string} [dir]
 * @returns {Array<ReturnType<typeof skill>>}
 */
export function collectSkills(dir = SKILLS_ROOT) {
	const skills = [];
	for (const entry of readdirSync(dir).sort()) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) {
			skills.push(...collectSkills(path));
			continue;
		}
		if (!entry.endsWith(".md") || entry === "README.md") continue;
		const raw = readFileSync(path, "utf8");
		const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
		if (!match) throw new Error(`${path}: missing frontmatter`);
		const [, fm, content] = match;
		const fields = {};
		for (const line of fm.split("\n")) {
			const parsed = /^(\w+):\s*(.*)$/.exec(line.trim());
			if (parsed) fields[parsed[1]] = parsed[2];
		}
		for (const key of ["slug", "name", "description", "category"]) {
			if (!fields[key]) throw new Error(`${path}: missing ${key}`);
		}
		if (fields.slug !== entry.replace(/\.md$/, "")) {
			throw new Error(`${path}: slug != file name`);
		}
		skills.push(
			skill(
				relative(SKILLS_ROOT, path),
				fields.slug,
				fields.name,
				fields.description,
				fields.category,
				content,
			),
		);
	}
	return skills;
}

/** SQL string literal: single quotes doubled, nothing else needs escaping. */
function sqlString(value) {
	return `'${value.replaceAll("'", "''")}'`;
}

/**
 * Renders the 0021 migration body for the given skills (deterministic,
 * sorted by slug). One statement per skill — D1 caps SQL statement length
 * at ~100 KB and the whole library would exceed it as one multi-row
 * statement. Upgraded slugs (RESEED_SLUGS) use INSERT … ON CONFLICT(slug)
 * DO UPDATE scoped to seed-owned fields and builtin rows, so the in-place
 * content refresh never discards admin-controlled state.
 * @param {Array<ReturnType<typeof skill>>} skills
 */
export function renderMigration(skills) {
	const slugs = new Set(skills.map((entry) => entry.slug));
	if (slugs.size !== skills.length) throw new Error("duplicate slugs");
	const inserts = skills
		.map((entry) => {
			const values = [
				`\t${sqlString(`skill-${entry.slug}`)}`,
				`\t${sqlString(entry.slug)}`,
				`\t${sqlString(entry.name)}`,
				`\t${sqlString(entry.description)}`,
				`\t${sqlString(entry.content)}`,
				`\ttrue`,
				`\ttrue`,
				`\t${sqlString(entry.category)}`,
			];
			const insert = `INSERT INTO "Skill" ("id", "slug", "name", "description", "content", "builtin", "enabled", "category") VALUES (${values.join(",\n\t\t")})`;
			if (RESEED_SLUGS.includes(entry.slug)) {
				// In-place content upgrade: refresh only seed-owned fields, and
				// only rows that are still builtin AND never touched by an admin
				// (createdAt = updatedAt; Prisma bumps updatedAt on every edit).
				// Admin-customized rows — including disabled ones — keep their
				// content; admins who want the upgrade re-apply it by copying
				// the seed from skills/builtin/.
				return `${insert}
ON CONFLICT("slug") DO UPDATE SET
\t\t"name" = excluded."name",
\t\t"description" = excluded."description",
\t\t"content" = excluded."content"
WHERE "Skill"."builtin" = true
\t\tAND "Skill"."createdAt" = "Skill"."updatedAt";`;
			}
			return `${insert} ON CONFLICT DO NOTHING;`;
		})
		.join("\n\n");
	return `-- Marketing craft skills (adapted from coreyhaines31/marketingskills,
-- MIT — see skills/builtin/README.md for the source-of-truth files and
-- provenance). Adds the craft layer the campaign agent lacked — CRO,
-- copywriting, channel playbooks, psychology, research, testing — and
-- upgrades email-sequence and seo-audit in place.
--
-- Same design rules as 0018/0020:
-- - Single additive change; no schema changes here.
-- - Deterministic ids with conflict-safe seeding so re-running against an
--   already-seeded database converges instead of duplicating.
-- - Builtin seeds start enabled; admins can disable but never delete them.
-- - The two in-place upgrades refresh seed-owned fields on builtin rows
--   only — admin-controlled state is never overwritten.
--
-- One statement per skill (not one multi-row INSERT): D1 caps SQL statement
-- length at ~100 KB and the whole library would exceed it as one statement.
--
-- Regenerate with: node skills/builtin/generate-migration.mjs

${inserts}
`;
}

const invokedDirectly =
	process.argv[1] &&
	import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (invokedDirectly) {
	const skills = collectSkills();
	mkdirSync(MIGRATION_DIR, { recursive: true });
	const target = join(MIGRATION_DIR, "migration.sql");
	writeFileSync(target, renderMigration(skills));
	console.log(
		`wrote ${relative(process.cwd(), target)} with ${skills.length} skills`,
	);
}
