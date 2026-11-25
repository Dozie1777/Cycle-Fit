/**
 * GitHub skill import (public API via the skills barrel).
 *
 * Lets admins seed the Skill library from any public GitHub repo that
 * follows the agent-skills layout — one folder per skill with a SKILL.md
 * at its root (coreyhaines31/marketingskills, anthropics/knowledge-work-
 * plugins, …). Accepted source forms:
 *
 *   https://github.com/{owner}/{repo}                          → scan the repo
 *   https://github.com/{owner}/{repo}/tree/{ref}[/sub/path]    → scan subtree
 *   https://github.com/{owner}/{repo}/blob/{ref}/{path}/       → folder
 *   https://github.com/{owner}/{repo}/blob/{ref}/path/SKILL.md → single skill
 *   {owner}/{repo}                                             → shorthand of #1
 *
 * Known limitation (documented in the import UI): GitHub tree URLs cannot
 * express refs containing "/" — `/tree/feature/import/skills` parses as
 * ref "feature" + path "import/skills". Resolving the longest ref match
 * would need extra API round-trips, so slash-branches are unsupported;
 * admins should scan from the bare repo URL instead.
 *
 * Preview lists candidates with sizes from the git trees API (one call —
 * no content fetching); import fetches only the selected SKILL.md files
 * from raw.githubusercontent.com and validates each against the Skill
 * handler's limits (github-import limits mirror src/server/data/skills.ts).
 */
import { z } from "zod";

export const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);

/** Matches the Skill handler's createSkillBody shape. */
export const SLUG_MAX = 64;
export const NAME_MAX = 120;
export const DESCRIPTION_MAX = 300;
export const CONTENT_MAX = 100_000;
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

/** api.github.com base (overridable for tests / GitHub Enterprise). */
export const GITHUB_API_BASE = "https://api.github.com";
/** Raw content base for file fetches (not the API — no rate-limit budget). */
export const GITHUB_RAW_BASE = "https://raw.githubusercontent.com";

/** Hard byte cap on a fetched SKILL.md, well above the 100k-char content
 * limit even for multi-byte scripts — bounds Worker memory per fetch. */
const MAX_FETCH_BYTES = 600_000;
/** Per-file download deadline. */
const FETCH_TIMEOUT_MS = 30_000;

export type GithubSource = {
	owner: string;
	repo: string;
	/** Branch/tag/sha; resolved to the repo default branch when omitted. */
	ref?: string;
	/** Subtree to scan (no leading slash); undefined = whole repo. */
	path?: string;
	/** True when the source pinned one SKILL.md file. */
	singleFile?: boolean;
};

/**
 * Parses a GitHub source string into {owner, repo, ref?, path?}. Throws a
 * plain Error with an admin-facing message on anything unsupported — this
 * only ever talks to github.com; no other host is fetched.
 */
export function parseGithubSkillSource(input: string): GithubSource {
	const raw = input.trim().replace(/\/+$/, "");
	if (raw.length === 0 || raw.length > 300) {
		throw new Error("enter a GitHub repo or SKILL.md URL");
	}
	// Bare "owner/repo" shorthand (no scheme, no extra slashes).
	if (!/^https?:\/\//i.test(raw)) {
		const shorthand = /^([\w.-]+)\/([\w.-]+)$/.exec(raw);
		if (shorthand) {
			return {
				owner: shorthand[1],
				repo: shorthand[2].replace(/\.git$/, ""),
			};
		}
		throw new Error(
			'use a github.com repo URL (or "owner/repo"), e.g. https://github.com/coreyhaines31/marketingskills',
		);
	}
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new Error("that is not a valid URL");
	}
	if (!GITHUB_HOSTS.has(url.hostname)) {
		throw new Error("only github.com URLs are supported");
	}
	const segments = url.pathname.split("/").filter(Boolean);
	const [owner, repo, kind, ref, ...rest] = segments;
	if (!owner || !repo) {
		throw new Error(
			"URL must include owner and repo, e.g. github.com/owner/repo",
		);
	}
	const cleanRepo = repo.replace(/\.git$/, "");
	if (!kind) return { owner, repo: cleanRepo };
	if (kind === "tree") {
		if (!ref) throw new Error("tree URL is missing a branch or tag");
		const path = rest.join("/");
		return { owner, repo: cleanRepo, ref, path: path || undefined };
	}
	if (kind === "blob") {
		if (!ref) throw new Error("blob URL is missing a branch or tag");
		const path = rest.join("/");
		if (!path) throw new Error("blob URL is missing a file path");
		return {
			owner,
			repo: cleanRepo,
			ref,
			path,
			...(path.endsWith(".md") ? { singleFile: true } : {}),
		};
	}
	throw new Error(
		"unsupported GitHub URL — use the repo, a /tree/ path, or a SKILL.md /blob/ URL",
	);
}

/**
 * Derives the import slug from a SKILL.md path: the parent folder name,
 * lowercased and slug-shaped. Returns null for roots like "skills" so
 * repos that nest skills don't all collide on one slug.
 */
export function slugFromSkillPath(path: string): string | null {
	const parts = path.split("/").filter(Boolean);
	const parent = parts[parts.length - 2];
	if (!parent) return null;
	const slug = parent
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, "-")
		.replace(/^-+|-+$/g, "");
	if (!SLUG_RE.test(slug)) return null;
	return slug.length <= SLUG_MAX ? slug : slug.slice(0, SLUG_MAX);
}

export type GithubSkillCandidate = {
	/** Repo path of the SKILL.md file. */
	path: string;
	slug: string | null;
	/** Blob size in bytes from the trees API (approx content length). */
	size: number;
};

export type GithubListResult = {
	owner: string;
	repo: string;
	ref: string;
	/** Resolved subtree actually scanned (whole repo when unset). */
	path?: string;
	candidates: GithubSkillCandidate[];
	/** True when the trees API truncated its listing (big repos). */
	truncated: boolean;
};

/** True when the blob path is a SKILL.md the scan should surface. */
function isSkillFile(
	path: string,
	scope: string | undefined,
	singleFile?: boolean,
) {
	if (singleFile) return path === scope;
	if (scope && !path.startsWith(`${scope}/`)) return false;
	const parts = path.split("/");
	return parts[parts.length - 1] === "SKILL.md" && parts.length >= 2;
}

/**
 * Lists SKILL.md candidates via the git trees API (recursive). One API call;
 * content is fetched per selected file only at import time.
 */
export async function listGithubSkills(
	source: GithubSource,
	options: {
		fetchImpl?: typeof fetch;
		apiBase?: string;
		githubToken?: string;
	} = {},
): Promise<GithubListResult> {
	const fetchImpl = options.fetchImpl ?? fetch;
	const apiBase = (options.apiBase ?? GITHUB_API_BASE).replace(/\/+$/, "");
	const headers: Record<string, string> = {
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
	};
	if (options.githubToken)
		headers.Authorization = `Bearer ${options.githubToken}`;

	const repoResponse = await fetchImpl(
		`${apiBase}/repos/${source.owner}/${source.repo}`,
		{ headers },
	);
	if (repoResponse.status === 404) {
		throw new Error(
			`repo ${source.owner}/${source.repo} not found (or is private)`,
		);
	}
	if (!repoResponse.ok) {
		throw new Error(
			`GitHub API error ${repoResponse.status} — try again shortly`,
		);
	}
	const repoData = (await repoResponse.json()) as { default_branch?: string };
	const ref = source.ref ?? repoData.default_branch ?? "main";

	const treeResponse = await fetchImpl(
		`${apiBase}/repos/${source.owner}/${source.repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
		{ headers },
	);
	if (treeResponse.status === 404) {
		throw new Error(
			`branch or tag "${ref}" not found in ${source.owner}/${source.repo}`,
		);
	}
	if (!treeResponse.ok) {
		throw new Error(
			`GitHub API error ${treeResponse.status} — try again shortly`,
		);
	}
	const treeData = (await treeResponse.json()) as {
		truncated?: boolean;
		tree?: Array<{ path: string; type: string; size?: number }>;
	};
	const blobs = (treeData.tree ?? []).filter((entry) => entry.type === "blob");
	const candidates = blobs
		.filter((entry) => isSkillFile(entry.path, source.path, source.singleFile))
		.map((entry) => ({
			path: entry.path,
			slug: slugFromSkillPath(entry.path),
			size: entry.size ?? 0,
		}))
		.sort((a, b) => a.path.localeCompare(b.path));
	return {
		owner: source.owner,
		repo: source.repo,
		ref,
		path: source.path,
		candidates,
		truncated: treeData.truncated === true,
	};
}

/**
 * Fetches one SKILL.md's raw content from raw.githubusercontent.com.
 * `source.ref` must be the listing's resolved ref (default branch when the
 * source didn't pin one) — raw URLs need an explicit ref or they resolve
 * the default branch, which would silently diverge from the preview when
 * a branch/tag was pinned. The response is streamed with a hard byte cap
 * and timeout so a huge or stalled file can't pin Worker memory or the
 * request; files the trees API already reported as oversized are rejected
 * before fetching.
 */
export async function fetchGithubSkillContent(
	source: GithubSource & { ref: string },
	candidate: GithubSkillCandidate,
	options: {
		fetchImpl?: typeof fetch;
		rawBase?: string;
		githubToken?: string;
	} = {},
): Promise<string> {
	if (candidate.size > MAX_FETCH_BYTES) {
		throw new Error(
			`${candidate.path} is too large to import (${(candidate.size / 1000).toFixed(0)}k bytes)`,
		);
	}
	const fetchImpl = options.fetchImpl ?? fetch;
	const rawBase = (options.rawBase ?? GITHUB_RAW_BASE).replace(/\/+$/, "");
	const url = `${rawBase}/${source.owner}/${source.repo}/${source.ref}/${candidate.path}`;
	const headers: Record<string, string> = {};
	if (options.githubToken)
		headers.Authorization = `Bearer ${options.githubToken}`;
	const response = await fetchImpl(url, {
		headers,
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
	});
	if (!response.ok) {
		throw new Error(`failed to fetch ${candidate.path} (${response.status})`);
	}
	if (!response.body) {
		return response.text();
	}
	// Stream with a hard cap: never buffer more than MAX_FETCH_BYTES.
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let bytes = 0;
	let text = "";
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		bytes += value.byteLength;
		if (bytes > MAX_FETCH_BYTES) {
			await reader.cancel();
			throw new Error(
				`${candidate.path} exceeds the ${(MAX_FETCH_BYTES / 1000).toFixed(0)}k download cap`,
			);
		}
		text += decoder.decode(value, { stream: true });
	}
	return text + decoder.decode();
}

/**
 * Minimal frontmatter parser — same line format as the builtin skill
 * sources (key: value lines inside a leading --- block).
 */
export function parseSkillFrontmatter(raw: string): {
	name?: string;
	description?: string;
	body: string;
} {
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
	if (!match) return { body: raw };
	const [, frontmatter, body] = match;
	const fields: Record<string, string> = {};
	for (const line of frontmatter.split("\n")) {
		const parsed = /^(\w+):\s*(.*)$/.exec(line.trim());
		if (parsed) fields[parsed[1]] = parsed[2];
	}
	return { name: fields.name, description: fields.description, body };
}

export type DerivedSkillImport = {
	slug: string;
	name: string;
	description: string;
	content: string;
	category: "campaign" | "marketing" | "sales" | "design";
	/** Non-fatal adjustments the admin should see (e.g. truncated description). */
	warnings: string[];
};

/**
 * Validates one fetched SKILL.md against the Skill handler's limits and
 * derives the import record. Returns { error } when the candidate cannot
 * be imported (unknown slug, content over the cap) so the caller can
 * report it without aborting the batch.
 */
export function deriveSkillImport(input: {
	candidate: GithubSkillCandidate;
	raw: string;
	category: "campaign" | "marketing" | "sales" | "design";
}): { ok: true; skill: DerivedSkillImport } | { ok: false; error: string } {
	const { candidate, raw, category } = input;
	const slug = candidate.slug ?? slugFromSkillPath(candidate.path);
	if (!slug) {
		return {
			ok: false,
			error: `${candidate.path}: could not derive a slug (SKILL.md needs a folder name)`,
		};
	}
	const warnings: string[] = [];
	const parsed = parseSkillFrontmatter(raw);
	const content = parsed.body.trim();
	if (content.length === 0) {
		return { ok: false, error: `${candidate.path}: file is empty` };
	}
	if (content.length > CONTENT_MAX) {
		return {
			ok: false,
			error: `${candidate.path}: ${(content.length / 1000).toFixed(0)}k chars exceeds the ${CONTENT_MAX / 1000}k skill limit`,
		};
	}
	let name = (parsed.name ?? slug).trim();
	if (name.length > NAME_MAX) {
		name = `${name.slice(0, NAME_MAX - 1)}…`;
		warnings.push(`${slug}: name truncated to ${NAME_MAX} chars`);
	}
	let description = (parsed.description ?? "").trim();
	if (description.length === 0) {
		// Fall back to the first non-heading paragraph of the body.
		const firstParagraph = content
			.split(/\n{2,}/)
			.map((part) => part.replace(/^#+\s.*$/, "").trim())
			.find((part) => part.length > 0);
		description = (firstParagraph ?? slug).split("\n")[0].trim();
		warnings.push(
			`${slug}: description missing in frontmatter — used the body's first line`,
		);
	}
	if (description.length > DESCRIPTION_MAX) {
		description = `${description.slice(0, DESCRIPTION_MAX - 1)}…`;
		warnings.push(`${slug}: description truncated to ${DESCRIPTION_MAX} chars`);
	}
	return {
		ok: true,
		skill: { slug, name, description, content, category, warnings },
	};
}

/** tRPC wire schemas for the import procedures. */
export const githubImportPreviewInput = z.object({
	source: z.string().min(1).max(300),
});

export const githubImportSkillInput = z.object({
	/** SKILL.md repo path, verbatim from the preview. */
	path: z.string().min(1).max(400),
});

export const githubImportBody = z.object({
	source: z.string().min(1).max(300),
	category: z
		.enum(["campaign", "marketing", "sales", "design"])
		.default("marketing"),
	skills: z.array(githubImportSkillInput).min(1).max(50),
	/** What to do when an imported slug already exists in the library. */
	conflict: z.enum(["skip", "overwrite"]).default("skip"),
});
