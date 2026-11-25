import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { adminMiddleware } from "../../src/server/middleware";
import { createAdminSession, createUserSession } from "../helpers/auth";
import { startWorkerRequest } from "../helpers/request";

type AdminMiddlewareOptions = Parameters<
	NonNullable<(typeof adminMiddleware)["options"]["server"]>
>[0];

async function runAdminMiddleware(cookie?: string) {
	const request = new Request(
		"https://code-review-bot.test/typed-admin-route",
		{
			headers: cookie ? { cookie } : undefined,
		},
	);
	const executionCtx = createExecutionContext();
	const next = ((options?: {
		context?: { user?: unknown; session?: unknown };
	}) => ({
		request,
		pathname: "/typed-admin-route",
		context: { env, executionCtx, ...options?.context },
		response: Response.json({ ok: true }),
	})) as AdminMiddlewareOptions["next"];
	return adminMiddleware.options.server?.({
		request,
		pathname: "/typed-admin-route",
		context: { env, executionCtx },
		next,
		handlerType: "router",
	});
}

function startAdminRequest(
	path: string,
	session?: { headers: { cookie: string } },
) {
	return startWorkerRequest(path, {
		redirect: "manual",
		headers: session?.headers,
	});
}

function requiresAdmin(path: string) {
	const normalized = path.replace(/\/+$/, "") || "/";
	// KUK-923: published component bundles are public site artifacts — the
	// $file segment (v<n>.js|.css) is served without a session; the handler
	// gates on the version's publish state instead.
	if (normalized === "/projects/$projectId/components/$componentId/$file") {
		return false;
	}
	if (
		normalized.startsWith("/api/admin/") ||
		normalized === "/agents" ||
		normalized.startsWith("/agents/") ||
		normalized === "/admins" ||
		normalized.startsWith("/admins/") ||
		normalized === "/campaigns" ||
		normalized.startsWith("/campaigns/") ||
		normalized === "/channels" ||
		normalized.startsWith("/channels/") ||
		normalized === "/skills" ||
		normalized.startsWith("/skills/") ||
		normalized === "/designs" ||
		normalized === "/projects" ||
		normalized.startsWith("/projects/")
	) {
		return true;
	}
	return [
		"",
		"/versions",
		"/restore",
		"/messages",
		"/chat",
		"/debug-exec",
		// The $assetId route itself is gated inline (its file child must stay
		// public), so only the middleware-backed asset paths count here.
		"/assets",
		"/assets/$assetId/describe",
	].some((suffix) => normalized === `/designs/$projectId${suffix}`);
}

// The tRPC migration moved the admin JSON API to /api/trpc, shrinking the
// Start route set to the plain-HTTP survivors: bearer-token endpoints, the
// public design/site artifacts, the streaming chat routes, the multipart
// asset upload, and the utility routes. (api/trpc/$ is intentionally not
// part of this manifest — it is new, not a migrated module.)
const MIGRATED_START_ROUTES = [
	{
		file: "api/review-attempt.ts",
		path: "/api/review-attempt",
		module: "api/review-attempt",
	},
	{
		file: "api/review-submission.ts",
		path: "/api/review-submission",
		module: "api/review-submission",
	},
	{
		file: "designs.$projectId.ts",
		path: "/designs/$projectId",
		module: "designs.$projectId",
	},
	{
		file: "designs.$projectId.assets.$assetId.file.ts",
		path: "/designs/$projectId/assets/$assetId/file",
		module: "designs.$projectId.assets.$assetId.file",
	},
	{
		file: "designs.$projectId.assets.index.ts",
		path: "/designs/$projectId/assets/",
		module: "designs.$projectId.assets.index",
	},
	{
		file: "designs.$projectId.chat.ts",
		path: "/designs/$projectId/chat",
		module: "designs.$projectId.chat",
	},
	{
		file: "designs.$projectId.file.$.ts",
		path: "/designs/$projectId/file/$",
		module: "designs.$projectId.file.$",
	},
	{
		file: "designs.$projectId.preview.ts",
		path: "/designs/$projectId/preview",
		module: "designs.$projectId.preview",
	},
	{
		file: "designs.$projectId.publication.$version.$.ts",
		path: "/designs/$projectId/publication/$version/$",
		module: "designs.$projectId.publication.$version.$",
	},
	{
		file: "designs.$projectId.site.ts",
		path: "/designs/$projectId/site",
		module: "designs.$projectId.site",
	},
	{
		file: "designs.$projectId.upload-url.ts",
		path: "/designs/$projectId/upload-url",
		module: "designs.$projectId.upload-url",
	},
	{ file: "github-token.ts", path: "/github-token", module: "github-token" },
	{ file: "process-logs.ts", path: "/process-logs", module: "process-logs" },
	{
		file: "projects.$projectId.components.$componentId.$file.ts",
		path: "/projects/$projectId/components/$componentId/$file",
		module: "projects.$projectId.components.$componentId.$file",
	},
	{
		file: "projects.$projectId.ts",
		path: "/projects/$projectId",
		module: "projects.$projectId",
	},
	{ file: "ui.ts", path: "/ui", module: "ui" },
] as const;

function routePath(source: string) {
	return source.match(/createFileRoute\(\s*"([^"]+)"\s*,?\s*\)/)?.[1];
}

function migratedModules(sources: Record<string, string>) {
	return Object.entries(sources).flatMap(([file, source]) => {
		const basename = file.split("/").pop() ?? "";
		const name = file.includes("/api/") ? `api/${basename}` : basename;
		const path = routePath(source);
		return /^(?:api\/review-(?:attempt|submission)|agents|admins|campaigns|channels|designs|projects|github-token|process-logs|skills|ui)(?:\/|\.|$)/.test(
			name,
		) && path
			? [{ file: name, path }]
			: [];
	});
}

describe("Start admin API middleware", () => {
	it("returns 401 when the protected route has no session", async () => {
		const result = await runAdminMiddleware();
		expect(result).toBeInstanceOf(Response);
		const response = result as Response;
		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ error: "unauthorized" });
	});

	it("returns 403 when the authenticated user is not an admin", async () => {
		const session = await createUserSession("user");
		const result = await runAdminMiddleware(session.cookie);
		expect(result).toBeInstanceOf(Response);
		const response = result as Response;
		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({
			error: "forbidden — admin role required",
		});
	});

	it("adds the authenticated user and session to the route context", async () => {
		const session = await createAdminSession();
		const result = await runAdminMiddleware(session.cookie);
		expect(result).toMatchObject({
			context: {
				user: expect.objectContaining({ id: session.userId, role: "admin" }),
				session: expect.objectContaining({ userId: session.userId }),
			},
		});
	});

	it("protects a designs index route with a trailing slash", () => {
		expect(requiresAdmin("/designs/")).toBe(true);
	});

	// KUK-876: the public campaign share page lives under /share/campaign/<slug>
	// (route file share.campaign.$slug.tsx), NOT under /campaigns/* — it must
	// classify as public even though the prefix rule marks /campaigns/* admin.
	it("classifies the public campaign share page as public", () => {
		expect(requiresAdmin("/share/campaign/$slug")).toBe(false);
	});

	it("recognizes multiline createFileRoute declarations", () => {
		expect(routePath('createFileRoute(\n  "/agents/",\n)({')).toBe("/agents/");
	});

	it("requires admin middleware on every admin API and nowhere public", () => {
		const sources = import.meta.glob("../../src/routes/**/*.{ts,tsx}", {
			eager: true,
			query: "?raw",
			import: "default",
		}) as Record<string, string>;
		const serverRoutes = Object.entries(sources).flatMap(([file, source]) => {
			const path = routePath(source);
			return path && source.includes("server:") ? [{ file, path, source }] : [];
		});
		expect(serverRoutes.length).toBeGreaterThan(0);
		expect(serverRoutes.map(({ path }) => path)).not.toContain(
			"/api/admin/session",
		);
		for (const { file, path, source } of serverRoutes) {
			if (requiresAdmin(path)) {
				expect(source, file).toMatch(/middleware:\s*\[adminMiddleware\]/);
			} else {
				expect(source, file).not.toContain("adminMiddleware");
			}
		}
	});

	it("matches the migrated route module manifest without duplicates", () => {
		const sources = import.meta.glob("../../src/routes/**/*.{ts,tsx}", {
			eager: true,
			query: "?raw",
			import: "default",
		}) as Record<string, string>;
		const actual = migratedModules(sources);
		const expected = MIGRATED_START_ROUTES.map(({ file, path }) => ({
			file,
			path,
		}));
		expect(actual.sort((a, b) => a.file.localeCompare(b.file))).toEqual(
			expected.sort((a, b) => a.file.localeCompare(b.file)),
		);
		expect(new Set(actual.map(({ path }) => path)).size).toBe(actual.length);
	});

	it("matches generated imports to the migrated route module manifest", () => {
		const generated = import.meta.glob("../../src/routeTree.gen.ts", {
			eager: true,
			query: "?raw",
			import: "default",
		})["../../src/routeTree.gen.ts"] as string;
		const actual = [
			...generated.matchAll(
				/from '\.\/routes\/((?:api\/review-(?:attempt|submission)|agents|admins|campaigns|channels|designs|projects|github-token|process-logs|skills|ui)[^']*)'/g,
			),
		].map((match) => match[1]);
		const expected = MIGRATED_START_ROUTES.map(({ module }) => module);
		expect(actual.sort()).toEqual(expected.sort());
		expect(new Set(actual).size).toBe(actual.length);
	});

	it("keeps removed Hono modules out of the Start route tree", () => {
		const sources = import.meta.glob("../../src/routes/**/*.ts", {
			eager: true,
			query: "?raw",
			import: "default",
		}) as Record<string, string>;
		expect(sources["../../src/routes/admins.ts"]).toBeUndefined();
		expect(sources["../../src/routes/designs.ts"]).toBeUndefined();
		expect(sources["../../src/routes/share.ts"]).toBeUndefined();
		expect(sources["../../src/routes/terminal.ts"]).toBeUndefined();
	});
});

describe("Start admin documents", () => {
	it("serves login outside the guard without a redirect", async () => {
		const response = await startAdminRequest("/login");
		expect(response.status).toBe(200);
		expect(response.headers.get("location")).toBeNull();
		expect(await response.text()).toContain("Admin access only");
	});
});
