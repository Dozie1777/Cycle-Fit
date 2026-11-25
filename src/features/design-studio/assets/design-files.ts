// Pure helpers for the design workspace feature: id/path validation, R2 key
// construction, content-type mapping, and the opencode config + brief text
// seeded into each design. No runtime dependencies — safe to unit-test in
// plain vitest. The sandbox orchestration lives in ./design-session.

export const DESIGN_PORT = 4096;
export const DESIGNS_KEY_PREFIX = "designs";

// crypto.randomUUID() output. All-lowercase + hyphens, so the id can double
// as the sandbox instance id (preview routing requires lowercase ids).
const DESIGN_ID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isDesignId(value: string): boolean {
	return DESIGN_ID_RE.test(value);
}

// Project row ids are Prisma cuid()s ("c" + 24 lowercase alphanumerics).
// Early fixtures and tooling minted uuid project ids, so accept either —
// gating the /projects/:projectId/… routes on the DESIGN uuid regex alone
// 400'd every real project (cuid) that hit them.
const PROJECT_ID_RE =
	/^c[0-9a-z]{24}$|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isProjectId(value: string): boolean {
	return PROJECT_ID_RE.test(value);
}

export function newDesignId(): string {
	return crypto.randomUUID();
}

// One path segment of a design file. Must start alphanumerically (dots at the
// start would allow .git-style oddities); traversal segments are rejected by
// parseRelPath before the segment check even matters.
const SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Validates and joins relative path segments for bucket keys. null on any
 * traversal attempt, invalid character, empty, or oversized path (>200 chars).
 */
export function parseRelPath(segments: string[]): string | null {
	if (segments.length === 0) return null;
	const parts: string[] = [];
	for (const segment of segments) {
		if (segment === "." || segment === "..") return null;
		if (!SEGMENT_RE.test(segment)) return null;
		parts.push(segment);
	}
	const joined = parts.join("/");
	if (joined.length > 200) return null;
	return joined;
}

export function designsKey(projectId: string, relPath: string): string {
	return `${DESIGNS_KEY_PREFIX}/${projectId}/${relPath}`;
}

/** Published-version snapshot keys: designs/<id>/versions/<n>/{index.html,preview.png}. */
export const DESIGN_VERSIONS_PREFIX = "versions";

const VERSION_KEY_RE = /^(\d+)\/([^/]+)$/;

/**
 * Parses a key under a project's versions prefix: "versions/3/preview.png"
 * → { n: 3, file: "preview.png" }. null for anything unexpected.
 */
export function parseVersionKey(
	key: string,
	projectId: string,
): { n: number; file: string } | null {
	const prefix = `${DESIGNS_KEY_PREFIX}/${projectId}/${DESIGN_VERSIONS_PREFIX}/`;
	if (!key.startsWith(prefix)) return null;
	const rest = key.slice(prefix.length);
	const match = VERSION_KEY_RE.exec(rest);
	if (!match) return null;
	return { n: Number(match[1]), file: match[2] };
}

/** Next version number for a project given the existing version keys. */
export function nextVersionNumber(keys: string[], projectId: string): number {
	let max = 0;
	for (const key of keys) {
		const parsed = parseVersionKey(key, projectId);
		if (parsed && parsed.n > max) max = parsed.n;
	}
	return max + 1;
}

/** Inverse of designsKey for R2 list keys under a project prefix; null for anything unexpected. */
export function relPathFromKey(key: string, projectId: string): string | null {
	const prefix = `${DESIGNS_KEY_PREFIX}/${projectId}/`;
	if (!key.startsWith(prefix)) return null;
	return parseRelPath(key.slice(prefix.length).split("/"));
}

export type DesignTokens = {
	colors: { name: string; value: string }[];
	other: { name: string; value: string }[];
};

const CUSTOM_PROP_RE = /(--[a-zA-Z0-9_-]+)\s*:\s*([^;]+);/g;
const COLOR_VALUE_RE =
	/^(#|rgb|hsl|oklch|oklab|lab\(|lch\(|var\(|color-mix|light-dark|[a-z]+$)/i;

/**
 * Extracts CSS custom properties from a published document's :root block.
 * Colors (hex/rgb/hsl/oklch/named/var/light-dark values) go into `colors`;
 * everything else (fonts, radii, spacing) into `other`. Empty tokens when
 * the document has no :root block.
 */
export function extractDesignTokens(html: string): DesignTokens {
	const rootMatch = /:root\s*\{([\s\S]*?)\}/.exec(html);
	if (!rootMatch) return { colors: [], other: [] };
	const colors: DesignTokens["colors"] = [];
	const other: DesignTokens["other"] = [];
	for (const match of rootMatch[1].matchAll(CUSTOM_PROP_RE)) {
		const name = match[1].trim();
		const value = match[2].trim();
		(COLOR_VALUE_RE.test(value) ? colors : other).push({ name, value });
	}
	return { colors, other };
}

const CONTENT_TYPES: Record<string, string> = {
	html: "text/html; charset=utf-8",
	css: "text/css; charset=utf-8",
	js: "text/javascript; charset=utf-8",
	mjs: "text/javascript; charset=utf-8",
	json: "application/json",
	txt: "text/plain; charset=utf-8",
	md: "text/markdown; charset=utf-8",
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	svg: "image/svg+xml",
	webp: "image/webp",
	ico: "image/x-icon",
	pdf: "application/pdf",
};

export function contentTypeForPath(relPath: string): string {
	const dot = relPath.lastIndexOf(".");
	if (dot === -1) return "application/octet-stream";
	return (
		CONTENT_TYPES[relPath.slice(dot + 1).toLowerCase()] ??
		"application/octet-stream"
	);
}

/**
 * Response headers when serving a design file. HTML is served under a CSP
 * `sandbox` policy: AI-authored markup executes in an opaque origin and can
 * never reach the admin app's cookies, even when opened directly. SVG gets
 * a stricter scriptless sandbox: it renders as a document (wireframes) and
 * in <img> contexts, but <script>, event handlers and same-origin access
 * never execute — model-authored SVG is untrusted too.
 */
export function designResponseHeaders(relPath: string): Record<string, string> {
	const type = contentTypeForPath(relPath);
	const headers: Record<string, string> = {
		"content-type": type,
		"cache-control": "public, max-age=60",
		"x-content-type-options": "nosniff",
	};
	if (type.startsWith("text/html")) {
		headers["content-security-policy"] =
			"sandbox allow-scripts allow-forms allow-popups";
	} else if (type === "image/svg+xml") {
		headers["content-security-policy"] = "sandbox";
	}
	return headers;
}

/**
 * opencode.json written into every design sandbox (via HOME config). Points
 * opencode at the Kimi coding endpoint with the worker's KIMI_API_KEY — the
 * `{env:...}` interpolation is opencode's own, so the key never lands in a
 * file. Also registers remote MCP servers: `design-uploads` (agents call its
 * `get_upload_url` tool instead of hand-rolling presigned-URL requests, the
 * token riding the DESIGN_AGENT_TOKEN env var) and optionally `browser` (the
 * worker's Playwright MCP server over Browser Rendering, so the interactive
 * agent gets the same browser tools as the design chat; its bearer rides
 * BROWSER_MCP_TOKEN). Secrets never land in the file.
 */
export function opencodeConfig(options: {
	modelName?: string;
	baseURL?: string;
	mcp?: { name: string; url: string; tokenEnvVar: string };
	browserMcp?: { url: string; tokenEnvVar: string };
}): string {
	const modelName = options.modelName?.trim() || "kimi-for-coding-highspeed";
	const baseURL = options.baseURL?.trim() || "https://api.kimi.com/coding/v1";
	return JSON.stringify(
		{
			$schema: "https://opencode.ai/config.json",
			// The container ships a pinned binary — no runtime updates inside
			// the sandbox.
			autoupdate: false,
			model: `kimi/${modelName}`,
			provider: {
				kimi: {
					npm: "@ai-sdk/openai-compatible",
					name: "Kimi",
					options: {
						baseURL,
						apiKey: "{env:KIMI_API_KEY}",
					},
					models: {
						[modelName]: {},
					},
				},
			},
			...(options.mcp
				? {
						mcp: {
							[options.mcp.name]: {
								type: "remote",
								url: options.mcp.url,
								enabled: true,
								// API-key auth, not OAuth.
								oauth: false,
								headers: {
									Authorization: `Bearer {env:${options.mcp.tokenEnvVar}}`,
								},
							},
							...(options.browserMcp
								? {
										browser: {
											type: "remote",
											url: options.browserMcp.url,
											enabled: true,
											oauth: false,
											headers: {
												Authorization: `Bearer {env:${options.browserMcp.tokenEnvVar}}`,
											},
										},
									}
								: {}),
						},
					}
				: {}),
		},
		null,
		2,
	);
}

/** AGENTS.md seeded into each design directory — opencode picks it up as the session's instructions. */
export function designBriefMarkdown(prompt: string): string {
	return `# Design brief

${prompt}

## Expectations

- Author the design as a single self-contained \`index.html\` in this
  directory: all CSS/JS inline, no external network assets, system font
  stack. Never touch anything outside this directory.
- When \`index.html\` is done, render a full-page screenshot to
  \`preview.png\` with the headless system chromium (note the \`=\` form — a
  space after \`--screenshot\` is parsed as a second URL target and fails):

      chromium-browser --headless --no-sandbox --disable-gpu --hide-scrollbars \\
        --window-size=1440,900 --screenshot="preview.png" "file://$PWD/index.html"

- \`playwright-cli\` is available for inspecting the rendered page; pass
  \`--config /root/.playwright/cli.config.json\` when the working directory
  is not /root.
- This session also has a \`browser\` MCP server (Cloudflare Browser
  Rendering): call \`browser_navigate\` with $DESIGN_SITE_URL and
  \`browser_snapshot\` to inspect the published page with zero local setup.

## Publishing files (REQUIRED — nothing syncs automatically)

This directory is NOT backed up anywhere. After every meaningful change
(and at the very least before finishing \`index.html\` and \`preview.png\`),
publish each file to the design site.

**Primary — MCP tool.** This session has a \`design-uploads\` MCP server
with a \`get_upload_url\` tool. Call it with your project id
($DESIGN_PROJECT_ID) and the file's path (e.g. \`index.html\`) — it
returns a presigned \`url\` and an \`upload_command\`. Run the upload
command (or \`curl -X PUT --upload-file <path> <url>\`), then call the
tool again for the next file. Request a fresh URL whenever one expired.

**Fallback — curl.** If the MCP tool is unavailable, request URLs over
HTTP (the token comes from this session's environment — never hardcode or
echo it):

    upload() {
      local path="$1"
      local url
      url=$(curl -fsS -X POST "$DESIGN_UPLOAD_URL" \\
        -H 'content-type: application/json' \\
        -d "{\\"token\\":\\"$DESIGN_AGENT_TOKEN\\",\\"path\\":\\"$path\\"}" \\
        | node -e 'process.stdin.on("data", (d) => console.log(JSON.parse(d).url))')
      curl -fsS -X PUT --upload-file "$path" "$url"
      echo "published $path"
    }

    upload index.html
    upload preview.png

Verify afterwards that the site serves your latest \`index.html\`:

    curl -fsS "$DESIGN_SITE_URL" | head
`;
}

export type DesignFileEntry = {
	path: string;
	size: number;
	lastModified: string;
};

/**
 * Lists the files of one design project (bucket-relative paths). R2 list pages
 * at 1000; the loop follows the cursor up to `limit` entries.
 */
export async function listDesignFiles(
	bucket: R2Bucket,
	projectId: string,
	limit = 500,
): Promise<DesignFileEntry[]> {
	const prefix = designsKey(projectId, "");
	const files: DesignFileEntry[] = [];
	let cursor: string | undefined;
	do {
		const page = await bucket.list({
			prefix,
			cursor,
			limit: Math.min(limit - files.length, 1000),
		});
		for (const object of page.objects) {
			const rel = relPathFromKey(object.key, projectId);
			if (!rel) continue;
			files.push({
				path: rel,
				size: object.size,
				lastModified: object.uploaded.toISOString(),
			});
		}
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor && files.length < limit);
	return files;
}
