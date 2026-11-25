import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
	deriveSkillImport,
	fetchGithubSkillContent,
	listGithubSkills,
	parseGithubSkillSource,
	SKILL_CATEGORIES,
	type SkillCategory,
} from "@/features/skills";
import { getPrisma } from "@/lib/db";

// Studio skill handlers (KUK-891). Skills are a global, admin-owned library
// of markdown playbooks the campaign planning agent loads with load_skill —
// the agent picks from the enumeration but only admins create/edit/enable
// through the tRPC procedures (same ownership rule as channels). Slug
// uniqueness is case-insensitive — checked with a lower(slug) lookup before
// insert/update (SQLite UNIQUE is case-sensitive by design) — and a
// duplicate answers CONFLICT. Builtin (seeded) skills cannot be deleted:
// disable them instead.

const SLUG_MAX = 64;
const NAME_MAX = 120;
const DESCRIPTION_MAX = 300;
const CONTENT_MAX = 100_000;

/** Lowercase letters/digits/hyphens after normalization; used verbatim as
 * the /slug command. Mixed-case input is accepted and lowercased so a
 * duplicate collides case-insensitively with CONFLICT instead of a 400. */
const SLUG_RE = /^[a-zA-Z0-9][a-zA-Z0-9-]*$/;

export const createSkillBody = z.object({
	slug: z
		.string()
		.trim()
		.min(1)
		.max(SLUG_MAX)
		.regex(SLUG_RE, "slug must be letters, digits and hyphens")
		.transform((value) => value.toLowerCase()),
	name: z.string().trim().min(1).max(NAME_MAX),
	description: z.string().trim().min(1).max(DESCRIPTION_MAX),
	content: z.string().trim().min(1).max(CONTENT_MAX),
	// Which studio chat surfaces the skill; defaults to the campaign studio
	// (pre-0020 behavior). Category is fixed at creation — updateSkill
	// deliberately doesn't accept it.
	category: z.enum(SKILL_CATEGORIES).default("campaign"),
});

export const updateSkillBody = z
	.object({
		name: z.string().trim().min(1).max(NAME_MAX).optional(),
		description: z.string().trim().min(1).max(DESCRIPTION_MAX).optional(),
		content: z.string().trim().min(1).max(CONTENT_MAX).optional(),
		enabled: z.boolean().optional(),
	})
	.refine(
		(body) =>
			body.name !== undefined ||
			body.description !== undefined ||
			body.content !== undefined ||
			body.enabled !== undefined,
		"name, description, content or enabled is required",
	);

const SKILL_ID_RE = /^[0-9a-zA-Z_-]{1,64}$/;

/** Case-insensitive duplicate slug check → CONFLICT with the colliding slug. */
async function duplicateSlug(env: Env, slug: string) {
	const row = await env.DB.prepare(
		'SELECT id FROM "Skill" WHERE lower("slug") = lower(?) LIMIT 1',
	)
		.bind(slug)
		.first<{ id: string }>();
	if (row) {
		return new TRPCError({
			code: "CONFLICT",
			message: `a skill with slug "${slug}" already exists`,
		});
	}
	return null;
}

export async function listSkills(env: Env) {
	const skills = await getPrisma(env).skill.findMany({
		orderBy: { slug: "asc" },
	});
	// The column only holds validated categories (writes go through the
	// zod enum), so restore the public contract's union on read.
	return skills.map((skill) => ({
		...skill,
		category: skill.category as SkillCategory,
	}));
}

export async function createSkill(input: {
	env: Env;
	body: z.infer<typeof createSkillBody>;
}) {
	const duplicate = await duplicateSlug(input.env, input.body.slug);
	if (duplicate) throw duplicate;
	const skill = await getPrisma(input.env).skill.create({
		data: {
			id: crypto.randomUUID(),
			slug: input.body.slug,
			name: input.body.name,
			description: input.body.description,
			content: input.body.content,
			category: input.body.category,
			// Admin-created skills are never builtin: only migration seeds are.
			builtin: false,
			enabled: true,
		},
	});
	return { ...skill, category: skill.category as SkillCategory };
}

export async function updateSkill(input: {
	env: Env;
	skillId: string;
	body: z.infer<typeof updateSkillBody>;
}) {
	const { env, skillId, body } = input;
	if (!SKILL_ID_RE.test(skillId)) {
		throw new TRPCError({ code: "BAD_REQUEST", message: "invalid skill id" });
	}
	const prisma = getPrisma(env);
	const skill = await prisma.skill.findUnique({ where: { id: skillId } });
	if (!skill) {
		throw new TRPCError({ code: "NOT_FOUND", message: "not found" });
	}
	const data: {
		name?: string;
		description?: string;
		content?: string;
		enabled?: boolean;
	} = {};
	if (body.name !== undefined) data.name = body.name;
	if (body.description !== undefined) data.description = body.description;
	if (body.content !== undefined) data.content = body.content;
	if (body.enabled !== undefined) data.enabled = body.enabled;
	const updated = await prisma.skill.update({
		where: { id: skillId },
		data,
	});
	// Same union restoration as listSkills (category is never updated here,
	// but the row is re-serialized through the same public contract).
	return { ...updated, category: updated.category as SkillCategory };
}

export async function deleteSkill(input: { env: Env; skillId: string }) {
	const { env, skillId } = input;
	if (!SKILL_ID_RE.test(skillId)) {
		throw new TRPCError({ code: "BAD_REQUEST", message: "invalid skill id" });
	}
	const prisma = getPrisma(env);
	const skill = await prisma.skill.findUnique({ where: { id: skillId } });
	if (!skill) {
		throw new TRPCError({ code: "NOT_FOUND", message: "not found" });
	}
	// Builtin skills are migration-owned: they can be disabled but never
	// deleted, so the seeded library cannot be silently emptied.
	if (skill.builtin) {
		throw new TRPCError({
			code: "CONFLICT",
			message: "builtin skills cannot be deleted — disable them instead",
		});
	}
	await prisma.skill.delete({ where: { id: skillId } });
}

// --- GitHub skill import -------------------------------------------------
//
// Admins can seed the library from any public GitHub repo following the
// agent-skills layout (one folder per skill with a SKILL.md). The pure
// parsing/validation lives in features/skills/github-import.ts (barrel);
// these handlers add the D1 side: conflict detection, creation, overwrite.

/** Preview: list SKILL.md candidates and flag slug conflicts, no writes. */
export async function previewGithubSkills(env: Env, sourceInput: string) {
	const source = parseGithubSkillSource(sourceInput);
	const listing = await listGithubSkills(source, {
		githubToken: env.SKILL_IMPORT_GITHUB_TOKEN,
	});
	// D1 caps bound parameters at 100, so look up deduped slugs in chunks
	// rather than one IN (...) per candidate (big skill repos exceed it).
	const slugs = [
		...new Set(
			listing.candidates
				.map((candidate) => candidate.slug)
				.filter((slug): slug is string => slug !== null),
		),
	];
	const existing = new Set<string>();
	const CHUNK = 50;
	for (let index = 0; index < slugs.length; index += CHUNK) {
		const chunk = slugs.slice(index, index + CHUNK);
		const rows = await env.DB.prepare(
			`SELECT lower("slug") AS slug FROM "Skill" WHERE lower("slug") IN (${chunk.map(() => "?").join(", ")})`,
		)
			.bind(...chunk)
			.all<{ slug: string }>();
		for (const row of rows.results ?? []) existing.add(row.slug.toLowerCase());
	}
	return {
		...listing,
		candidates: listing.candidates.map((candidate) => ({
			...candidate,
			conflict:
				candidate.slug !== null && existing.has(candidate.slug.toLowerCase()),
		})),
	};
}

export type ImportGithubSkillsBody = {
	source: string;
	category: "campaign" | "marketing" | "sales" | "design";
	skills: Array<{ path: string }>;
	conflict: "skip" | "overwrite";
};

/** Import: fetch each selected SKILL.md and upsert it as a non-builtin row. */
export async function importGithubSkills(
	env: Env,
	body: ImportGithubSkillsBody,
) {
	const source = parseGithubSkillSource(body.source);
	const listing = await listGithubSkills(source, {
		githubToken: env.SKILL_IMPORT_GITHUB_TOKEN,
	});
	const byPath = new Map(
		listing.candidates.map((candidate) => [candidate.path, candidate]),
	);

	const imported: Array<{
		slug: string;
		name: string;
		action: "created" | "updated";
		warnings: string[];
	}> = [];
	const skipped: Array<{ slug: string | null; reason: string }> = [];
	const failed: Array<{ path: string; error: string }> = [];

	for (const { path } of body.skills) {
		const candidate = byPath.get(path);
		if (!candidate) {
			failed.push({
				path,
				error: "not found in the repo listing — re-run preview",
			});
			continue;
		}
		let raw: string;
		try {
			raw = await fetchGithubSkillContent(
				{ ...source, ref: listing.ref },
				candidate,
				{
					githubToken: env.SKILL_IMPORT_GITHUB_TOKEN,
				},
			);
		} catch (error) {
			failed.push({
				path,
				error: error instanceof Error ? error.message : String(error),
			});
			continue;
		}
		const derived = deriveSkillImport({
			candidate,
			raw,
			category: body.category,
		});
		if (!derived.ok) {
			failed.push({ path, error: derived.error });
			continue;
		}
		const skill = derived.skill;
		const existing = await duplicateSlug(env, skill.slug);
		if (existing) {
			if (body.conflict === "skip") {
				skipped.push({
					slug: skill.slug,
					reason: `slug "${skill.slug}" already exists`,
				});
				continue;
			}
			// Overwrite keeps the row's category/enabled/builtin state — the
			// admin manages those in the UI, not the import.
			const row = await env.DB.prepare(
				'SELECT id FROM "Skill" WHERE lower("slug") = lower(?) LIMIT 1',
			)
				.bind(skill.slug)
				.first<{ id: string }>();
			if (row) {
				await getPrisma(env).skill.update({
					where: { id: row.id },
					data: {
						name: skill.name,
						description: skill.description,
						content: skill.content,
					},
				});
				imported.push({
					slug: skill.slug,
					name: skill.name,
					action: "updated",
					warnings: skill.warnings,
				});
				continue;
			}
			// Raced away between the duplicate check and the read — fall through
			// and create below.
		}
		await createSkill({
			env,
			body: {
				slug: skill.slug,
				name: skill.name,
				description: skill.description,
				content: skill.content,
				category: body.category,
			},
		});
		imported.push({
			slug: skill.slug,
			name: skill.name,
			action: "created",
			warnings: skill.warnings,
		});
	}

	return { imported, skipped, failed };
}
