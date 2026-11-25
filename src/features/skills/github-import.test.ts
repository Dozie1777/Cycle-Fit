import { describe, expect, it, vi } from "vitest";
import {
	deriveSkillImport,
	fetchGithubSkillContent,
	GITHUB_API_BASE,
	type GithubSource,
	listGithubSkills,
	parseGithubSkillSource,
	parseSkillFrontmatter,
	slugFromSkillPath,
} from "./github-import";

describe("parseGithubSkillSource", () => {
	it("parses a repo URL", () => {
		expect(
			parseGithubSkillSource(
				"https://github.com/coreyhaines31/marketingskills",
			),
		).toEqual({
			owner: "coreyhaines31",
			repo: "marketingskills",
		});
	});

	it("parses the owner/repo shorthand and strips .git", () => {
		expect(parseGithubSkillSource("coreyhaines31/marketingskills.git")).toEqual(
			{
				owner: "coreyhaines31",
				repo: "marketingskills",
			},
		);
	});

	it("parses a tree URL with branch and subpath", () => {
		expect(
			parseGithubSkillSource(
				"https://github.com/owner/repo/tree/main/skills/cro/",
			),
		).toEqual({
			owner: "owner",
			repo: "repo",
			ref: "main",
			path: "skills/cro",
		});
	});

	it("marks a blob URL ending in .md as a single file", () => {
		expect(
			parseGithubSkillSource(
				"https://github.com/owner/repo/blob/v2/skills/cro/SKILL.md",
			),
		).toEqual({
			owner: "owner",
			repo: "repo",
			ref: "v2",
			path: "skills/cro/SKILL.md",
			singleFile: true,
		});
	});

	it("treats a blob folder URL as a scoped subtree", () => {
		expect(
			parseGithubSkillSource(
				"https://github.com/owner/repo/blob/main/skills/cro",
			),
		).toEqual({
			owner: "owner",
			repo: "repo",
			ref: "main",
			path: "skills/cro",
		});
	});

	it("rejects non-github hosts, junk, and ref-less blob URLs", () => {
		expect(() =>
			parseGithubSkillSource("https://gitlab.com/owner/repo"),
		).toThrow(/only github.com/);
		expect(() => parseGithubSkillSource("not a url")).toThrow(
			/github.com repo URL/,
		);
		expect(() =>
			parseGithubSkillSource("https://github.com/owner/repo/blob/main/"),
		).toThrow(/missing a file path/);
		expect(() => parseGithubSkillSource("https://github.com/owner")).toThrow(
			/owner and repo/,
		);
	});
});

describe("slugFromSkillPath", () => {
	it("uses the SKILL.md parent folder", () => {
		expect(slugFromSkillPath("skills/cro/SKILL.md")).toBe("cro");
		expect(slugFromSkillPath("skills/Paid_Ads!/SKILL.md")).toBe("paid-ads");
	});

	it("returns null for root-level or unusable parents", () => {
		expect(slugFromSkillPath("SKILL.md")).toBeNull();
		expect(slugFromSkillPath("!!/SKILL.md")).toBeNull();
	});
});

describe("parseSkillFrontmatter", () => {
	it("extracts name/description and body", () => {
		const parsed = parseSkillFrontmatter(
			"---\nname: CRO\ndescription: hi\n---\n\n# Body",
		);
		expect(parsed.name).toBe("CRO");
		expect(parsed.description).toBe("hi");
		expect(parsed.body).toBe("\n# Body");
	});

	it("passes through files without frontmatter", () => {
		expect(parseSkillFrontmatter("# Just a body").body).toBe("# Just a body");
	});
});

describe("deriveSkillImport", () => {
	const base = { path: "skills/cro/SKILL.md", slug: "cro", size: 100 };

	it("derives a valid import record", () => {
		const result = deriveSkillImport({
			candidate: base,
			raw: "---\nname: CRO\ndescription: Convert pages\n---\n\n# CRO\n\nbody",
			category: "marketing",
		});
		if (!result.ok) throw new Error("expected ok");
		expect(result.skill).toMatchObject({
			slug: "cro",
			name: "CRO",
			description: "Convert pages",
			category: "marketing",
		});
		expect(result.skill.warnings).toHaveLength(0);
	});

	it("falls back to the first body line when description is missing", () => {
		const result = deriveSkillImport({
			candidate: base,
			raw: "---\nname: CRO\n---\n\n# CRO\n\nFirst paragraph here.",
			category: "marketing",
		});
		if (!result.ok) throw new Error("expected ok");
		expect(result.skill.description).toBe("First paragraph here.");
		expect(result.skill.warnings[0]).toContain("description missing");
	});

	it("rejects content over the 100k cap without truncating", () => {
		const result = deriveSkillImport({
			candidate: { ...base, slug: "big" },
			raw: `---\nname: Big\n---\n\n${"x".repeat(100_001)}`,
			category: "marketing",
		});
		expect(result).toMatchObject({ ok: false });
	});

	it("rejects candidates without a derivable slug", () => {
		const result = deriveSkillImport({
			candidate: { path: "SKILL.md", slug: null, size: 10 },
			raw: "---\nname: X\n---\n\nbody",
			category: "marketing",
		});
		expect(result).toMatchObject({ ok: false });
	});
});

describe("listGithubSkills", () => {
	function treeFetch(
		entries: Array<{ path: string; type: string; size?: number }>,
		options: {
			truncated?: boolean;
			repoStatus?: number;
			treeStatuses?: Record<string, number>;
		} = {},
	) {
		return vi.fn(async (url: string | URL) => {
			const text = String(url);
			if (text === `${GITHUB_API_BASE}/repos/owner/repo`) {
				return new Response(JSON.stringify({ default_branch: "develop" }), {
					status: options.repoStatus ?? 200,
				});
			}
			const treeMatch = /\/git\/trees\/([^?]+)/.exec(text);
			if (treeMatch) {
				const status = options.treeStatuses?.[treeMatch[1]] ?? 200;
				if (status !== 200) return new Response("nope", { status });
				return new Response(
					JSON.stringify({
						truncated: options.truncated ?? false,
						tree: entries,
					}),
					{ status: 200 },
				);
			}
			return new Response("not found", { status: 404 });
		}) as unknown as typeof fetch;
	}

	const source: GithubSource = { owner: "owner", repo: "repo" };

	it("resolves the default branch and filters to SKILL.md blobs", async () => {
		const result = await listGithubSkills(source, {
			fetchImpl: treeFetch([
				{ path: "skills/cro/SKILL.md", type: "blob", size: 7000 },
				{ path: "skills/cro/references/form.md", type: "blob", size: 5000 },
				{ path: "README.md", type: "blob", size: 1000 },
				{ path: "skills/cro", type: "tree" },
			]),
		});
		expect(result.ref).toBe("develop");
		expect(result.candidates).toEqual([
			{ path: "skills/cro/SKILL.md", slug: "cro", size: 7000 },
		]);
		expect(result.truncated).toBe(false);
	});

	it("surfaces truncation from the trees API", async () => {
		const result = await listGithubSkills(
			{ ...source, ref: "main", path: "skills" },
			{
				fetchImpl: treeFetch(
					[
						{ path: "skills/cro/SKILL.md", type: "blob", size: 7000 },
						{ path: "docs/SKILL.md", type: "blob", size: 10 },
					],
					{ truncated: true },
				),
			},
		);
		expect(result.candidates).toEqual([
			{ path: "skills/cro/SKILL.md", slug: "cro", size: 7000 },
		]);
		expect(result.truncated).toBe(true);
	});

	it("reports missing repos and refs clearly", async () => {
		await expect(
			listGithubSkills(
				{ owner: "owner", repo: "missing" },
				{
					fetchImpl: treeFetch([], { repoStatus: 404 }),
				},
			),
		).rejects.toThrow(/not found/);
		await expect(
			listGithubSkills(
				{ ...source, ref: "ghost" },
				{
					fetchImpl: treeFetch([], { treeStatuses: { ghost: 404 } }),
				},
			),
		).rejects.toThrow(/branch or tag "ghost"/);
	});
});

describe("fetchGithubSkillContent", () => {
	it("hits raw.githubusercontent with the resolved ref and candidate path", async () => {
		const fetchImpl = vi.fn(
			async () => new Response("---\nname: X\n---\nbody", { status: 200 }),
		);
		const content = await fetchGithubSkillContent(
			{ owner: "owner", repo: "repo", ref: "develop" },
			{ path: "skills/cro/SKILL.md", slug: "cro", size: 10 },
			{ fetchImpl },
		);
		expect(content).toContain("body");
		expect(fetchImpl).toHaveBeenCalledWith(
			"https://raw.githubusercontent.com/owner/repo/develop/skills/cro/SKILL.md",
			expect.anything(),
		);
	});

	it("rejects oversized files before fetching", async () => {
		const fetchImpl = vi.fn(async () => new Response("x", { status: 200 }));
		await expect(
			fetchGithubSkillContent(
				{ owner: "owner", repo: "repo", ref: "main" },
				{ path: "skills/huge/SKILL.md", slug: "huge", size: 700_000 },
				{ fetchImpl },
			),
		).rejects.toThrow(/too large/);
		expect(fetchImpl).not.toHaveBeenCalled();
	});
});
