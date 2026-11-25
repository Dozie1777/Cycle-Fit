// Validates the builtin skill source files in skills/builtin/**:
// frontmatter shape, slug == file name, unique slugs, known category,
// description ≤ 300 chars (the API's handler limit), content ≤ 100k.
// Run: node scripts/check-builtin-skills.mjs
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("../skills/builtin", import.meta.url).pathname;
const CATEGORIES = new Set(["campaign", "marketing", "sales", "design"]);
const DESC_MAX = 300;
const CONTENT_MAX = 100_000;

const errors = [];
const seen = new Map();

function walk(dir) {
	for (const entry of readdirSync(dir).sort()) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) {
			walk(path);
			continue;
		}
		if (!entry.endsWith(".md") || entry === "README.md") continue;
		const rel = relative(ROOT, path);
		const raw = readFileSync(path, "utf8");
		const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
		if (!match) {
			errors.push(`${rel}: missing --- frontmatter block`);
			continue;
		}
		const [, fm, content] = match;
		const fields = {};
		for (const line of fm.split("\n")) {
			const kv = /^(\w+):\s*(.*)$/.exec(line.trim());
			if (kv) fields[kv[1]] = kv[2];
		}
		for (const key of ["slug", "name", "description", "category"]) {
			if (!fields[key]) errors.push(`${rel}: missing ${key}`);
		}
		const base = entry.replace(/\.md$/, "");
		if (fields.slug && fields.slug !== base) {
			errors.push(`${rel}: slug "${fields.slug}" != file name "${base}"`);
		}
		if (fields.slug && !/^[a-z0-9][a-z0-9-]*$/.test(fields.slug)) {
			errors.push(`${rel}: invalid slug "${fields.slug}"`);
		}
		if (fields.category && !CATEGORIES.has(fields.category)) {
			errors.push(`${rel}: unknown category "${fields.category}"`);
		}
		if (fields.description && fields.description.length > DESC_MAX) {
			errors.push(
				`${rel}: description ${fields.description.length} chars > ${DESC_MAX}`,
			);
		}
		if (content.length > CONTENT_MAX) {
			errors.push(`${rel}: content ${content.length} chars > ${CONTENT_MAX}`);
		}
		if (fields.slug) {
			if (seen.has(fields.slug)) {
				errors.push(`${rel}: duplicate slug with ${seen.get(fields.slug)}`);
			}
			seen.set(fields.slug, rel);
		}
		if (!/follow it/i.test(content)) {
			errors.push(`${rel}: body missing the "do not paste — follow it" rule`);
		}
	}
}

walk(ROOT);
for (const [slug, file] of seen) {
	void slug;
	void file;
}
console.log(`checked ${seen.size} skill files`);
if (errors.length > 0) {
	for (const error of errors) console.error(`FAIL ${error}`);
	process.exit(1);
}
console.log("all builtin skills valid");
