import { describe, expect, it } from "vitest";
import {
	contentTypeForPath,
	designBriefMarkdown,
	designResponseHeaders,
	designsKey,
	extractDesignTokens,
	isDesignId,
	newDesignId,
	nextVersionNumber,
	opencodeConfig,
	parseRelPath,
	parseVersionKey,
	relPathFromKey,
} from "./design-files";

describe("extractDesignTokens", () => {
	it("splits :root custom properties into colors and other", () => {
		const html = `<style>:root {
			--paper: #F6EDDD;
			--ink: oklch(0.3 0.02 60);
			--accent: light-dark(#b04e2a, #e86a3f);
			--font-display: Georgia, serif;
			--radius-pill: 999px;
		}</style>`;
		const tokens = extractDesignTokens(html);
		expect(tokens.colors.map((c) => c.name)).toEqual([
			"--paper",
			"--ink",
			"--accent",
		]);
		expect(tokens.other.map((o) => o.name)).toEqual([
			"--font-display",
			"--radius-pill",
		]);
	});

	it("returns empty tokens when there is no :root block", () => {
		expect(extractDesignTokens("<html><body>hi</body></html>")).toEqual({
			colors: [],
			other: [],
		});
	});
});

describe("version keys", () => {
	it("parses version snapshot keys", () => {
		const id = newDesignId();
		expect(parseVersionKey(`designs/${id}/versions/3/preview.png`, id)).toEqual(
			{ n: 3, file: "preview.png" },
		);
		expect(parseVersionKey(`designs/${id}/index.html`, id)).toBeNull();
		expect(
			parseVersionKey(`designs/${id}/versions/x/index.html`, id),
		).toBeNull();
		expect(parseVersionKey(`designs/${id}/versions/1/a/b.html`, id)).toBeNull();
	});

	it("computes the next version number from existing keys", () => {
		const id = newDesignId();
		expect(nextVersionNumber([], id)).toBe(1);
		expect(
			nextVersionNumber(
				[
					`designs/${id}/versions/1/index.html`,
					`designs/${id}/versions/1/preview.png`,
					`designs/${id}/versions/3/index.html`,
					`designs/${id}/index.html`,
				],
				id,
			),
		).toBe(4);
	});
});

describe("design ids", () => {
	it("generates v4 uuids that pass validation", () => {
		const id = newDesignId();
		expect(isDesignId(id)).toBe(true);
		expect(isDesignId(id.toUpperCase())).toBe(false); // lowercase only
	});

	it("rejects garbage, traversal and empty strings", () => {
		expect(isDesignId("")).toBe(false);
		expect(isDesignId("../../etc/passwd")).toBe(false);
		expect(isDesignId("not-a-uuid")).toBe(false);
		expect(isDesignId("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe(false);
	});
});

describe("parseRelPath", () => {
	it("joins clean segments", () => {
		expect(parseRelPath(["index.html"])).toBe("index.html");
		expect(parseRelPath(["assets", "hero.png"])).toBe("assets/hero.png");
		expect(parseRelPath(["styles.main.css"])).toBe("styles.main.css");
	});

	it("rejects traversal and empty segments", () => {
		expect(parseRelPath([".."])).toBe(null);
		expect(parseRelPath(["assets", "..", "secret"])).toBe(null);
		expect(parseRelPath([""])).toBe(null);
		expect(parseRelPath([])).toBe(null);
	});

	it("rejects vocabulary-style traversal inside a single segment", () => {
		// real URLs split on "/" before validation, so segments never carry
		// slashes — a malformed one must be rejected wholesale
		expect(parseRelPath(["etc/passwd"])).toBe(null);
		expect(parseRelPath(["%2Fetc%2Fpasswd"])).toBe(null);
	});

	it("rejects segments starting with a dot or invalid characters", () => {
		expect(parseRelPath([".hidden"])).toBe(null);
		expect(parseRelPath(["a b"])).toBe(null);
		expect(parseRelPath(["a$b"])).toBe(null);
	});

	it("rejects oversized paths", () => {
		expect(parseRelPath(["x".repeat(201)])).toBe(null);
		expect(parseRelPath(["x".repeat(199)])).toBe("x".repeat(199));
	});
});

describe("key roundtrip", () => {
	it("designsKey ↔ relPathFromKey", () => {
		const id = newDesignId();
		const key = designsKey(id, "assets/hero.png");
		expect(key).toBe(`designs/${id}/assets/hero.png`);
		expect(relPathFromKey(key, id)).toBe("assets/hero.png");
	});

	it("relPathFromKey rejects foreign prefixes", () => {
		const id = newDesignId();
		expect(relPathFromKey("designs/other-id/index.html", id)).toBe(null);
		expect(relPathFromKey("working-dir/foo", id)).toBe(null);
	});
});

describe("contentTypeForPath", () => {
	it("maps common extensions", () => {
		expect(contentTypeForPath("index.html")).toMatch(/^text\/html/);
		expect(contentTypeForPath("preview.png")).toBe("image/png");
		expect(contentTypeForPath("data.json")).toBe("application/json");
		expect(contentTypeForPath("styles.css")).toMatch(/^text\/css/);
	});

	it("defaults unknown extensions", () => {
		expect(contentTypeForPath("archive.tar.gz")).toBe(
			"application/octet-stream",
		);
		expect(contentTypeForPath("noext")).toBe("application/octet-stream");
	});
});

describe("designResponseHeaders", () => {
	it("sandboxes html so authored markup can never reach the admin origin", () => {
		const headers = designResponseHeaders("index.html");
		expect(headers["content-security-policy"]).toContain("sandbox");
		expect(headers["x-content-type-options"]).toBe("nosniff");
	});

	it("does not sandbox non-html files", () => {
		expect(
			designResponseHeaders("preview.png")["content-security-policy"],
		).toBeUndefined();
	});

	it("sandboxes svg scriptlessly — model-authored SVG is untrusted too", () => {
		const policy =
			designResponseHeaders("drafts/hero.svg")["content-security-policy"];
		expect(policy).toBe("sandbox");
		// No scripts, in any embedding context.
		expect(policy).not.toContain("allow-scripts");
	});
});

describe("designBriefMarkdown", () => {
	it("carries the prompt and the publishing recipe (MCP tool first)", () => {
		const brief = designBriefMarkdown("A landing page for Timbuktu.");
		expect(brief).toContain("A landing page for Timbuktu.");
		expect(brief).toContain("get_upload_url");
		expect(brief).toContain("MCP");
		expect(brief).toContain("DESIGN_AGENT_TOKEN");
		expect(brief).toContain("--upload-file");
		// The brief itself is uploaded to the public bucket — it must teach
		// env-var expansion, never embed a literal token or signed URL.
		expect(brief).not.toMatch(/[0-9a-f]{64}/);
	});
});

describe("opencodeConfig", () => {
	it("points at the kimi coding endpoint with env-resolved key", () => {
		const config = JSON.parse(
			opencodeConfig({
				modelName: "kimi-for-coding",
				baseURL: "https://api.kimi.com/coding/v1",
			}),
		) as {
			model: string;
			autoupdate: boolean;
			provider: { kimi: { options: { baseURL: string; apiKey: string } } };
		};
		expect(config.model).toBe("kimi/kimi-for-coding");
		expect(config.autoupdate).toBe(false);
		expect(config.provider.kimi.options.baseURL).toBe(
			"https://api.kimi.com/coding/v1",
		);
		expect(config.provider.kimi.options.apiKey).toBe("{env:KIMI_API_KEY}");
	});

	it("falls back to defaults when env vars are unset", () => {
		const config = JSON.parse(opencodeConfig({})) as { model: string };
		expect(config.model).toBe("kimi/kimi-for-coding-highspeed");
	});

	it("registers the design-uploads MCP server with an env-interpolated bearer token", () => {
		const config = JSON.parse(
			opencodeConfig({
				mcp: {
					name: "design-uploads",
					url: "https://worker.example.com/designs/abc/mcp",
					tokenEnvVar: "DESIGN_AGENT_TOKEN",
				},
			}),
		) as {
			mcp: {
				"design-uploads": {
					type: string;
					url: string;
					oauth: boolean;
					headers: { Authorization: string };
				};
			};
		};
		const server = config.mcp["design-uploads"];
		expect(server.type).toBe("remote");
		expect(server.url).toBe("https://worker.example.com/designs/abc/mcp");
		expect(server.oauth).toBe(false);
		// The token must resolve from the session env at runtime — never a
		// literal in the config file.
		expect(server.headers.Authorization).toBe(
			"Bearer {env:DESIGN_AGENT_TOKEN}",
		);
	});

	it("registers the browser MCP server alongside design-uploads when provided", () => {
		const config = JSON.parse(
			opencodeConfig({
				mcp: {
					name: "design-uploads",
					url: "https://worker.example.com/designs/abc/mcp",
					tokenEnvVar: "DESIGN_AGENT_TOKEN",
				},
				browserMcp: {
					url: "https://worker.example.com/browser-mcp",
					tokenEnvVar: "BROWSER_MCP_TOKEN",
				},
			}),
		) as {
			mcp: Record<string, { headers: { Authorization: string } }>;
		};
		expect(config.mcp["design-uploads"].headers.Authorization).toBe(
			"Bearer {env:DESIGN_AGENT_TOKEN}",
		);
		expect(config.mcp.browser.headers.Authorization).toBe(
			"Bearer {env:BROWSER_MCP_TOKEN}",
		);
	});
});
