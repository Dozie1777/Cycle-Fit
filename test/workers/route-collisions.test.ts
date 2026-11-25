import { describe, expect, it } from "vitest";
import { createAdminSession, startAdminRequest } from "../helpers/auth";
import { createPublishedDesign } from "../helpers/fixtures";
import { startWorkerRequest } from "../helpers/request";
import { createTrpcTestClient } from "../helpers/trpc";

type RouteAccess =
	| "public"
	| "admin"
	| "bearer"
	| "agent-token"
	| "webhook-signature";

type RouteDefinition = {
	method: string;
	path: string;
	access: RouteAccess;
};

const ROUTE_MANIFEST = [
	{ method: "ALL", path: "/api/auth/*", access: "public" },
	// The tRPC batch endpoint: the admin JSON CRUD surface (all routers
	// except `share` are adminProcedure-gated; `share` is the public one).
	{ method: "ALL", path: "/api/trpc", access: "admin" },
	{ method: "POST", path: "/api/webhook", access: "webhook-signature" },
	{ method: "POST", path: "/api/review-attempt", access: "bearer" },
	{ method: "POST", path: "/api/review-submission", access: "bearer" },
	{ method: "POST", path: "/campaigns/:id/chat", access: "admin" },
	{ method: "GET", path: "/designs/:projectId/site", access: "public" },
	{ method: "GET", path: "/designs/:projectId/preview", access: "public" },
	{ method: "GET", path: "/designs/:projectId/file/*", access: "public" },
	{
		method: "GET",
		path: "/designs/:projectId/publication/:version/*",
		access: "public",
	},
	{
		method: "POST",
		path: "/designs/:projectId/upload-url",
		access: "agent-token",
	},
	{
		// Multipart upload — the one admin write outside tRPC.
		method: "POST",
		path: "/designs/:projectId/assets",
		access: "admin",
	},
	{
		method: "GET",
		path: "/designs/:projectId/assets/:assetId/file",
		access: "public",
	},
	{ method: "GET", path: "/designs/mcp", access: "public" },
	{ method: "DELETE", path: "/designs/mcp", access: "public" },
	{ method: "POST", path: "/designs/mcp", access: "agent-token" },
	{
		method: "GET",
		path: "/projects/:projectId/components/:componentId/:file",
		access: "public",
	},
	{ method: "GET", path: "/github-token", access: "bearer" },
	{ method: "GET", path: "/process-logs", access: "public" },
	{ method: "DELETE", path: "/process-logs", access: "public" },
	{ method: "GET", path: "/ui", access: "admin" },
	{ method: "ALL", path: "/browser-mcp", access: "bearer" },
	{ method: "GET", path: "/terminal", access: "admin" },
	// Public share surfaces (Start pages + the anonymous tRPC `share` router).
	{ method: "GET", path: "/share/:projectId", access: "public" },
	{ method: "GET", path: "/share/campaign/:slug", access: "public" },
] as const satisfies readonly RouteDefinition[];

function countRouteOccurrences(routes: string[]) {
	const counts = new Map<string, number>();
	for (const route of routes) {
		counts.set(route, (counts.get(route) ?? 0) + 1);
	}
	return counts;
}

function unexpectedRouteOccurrences(counts: ReadonlyMap<string, number>) {
	return [...counts].flatMap(([route, count]) => (count === 1 ? [] : [route]));
}

describe("Start route baseline", () => {
	it("enumerates every current method/path without route collisions", () => {
		const keys = ROUTE_MANIFEST.map(({ method, path }) => `${method} ${path}`);
		expect(keys).toHaveLength(25);
		expect(new Set(keys).size).toBe(keys.length);
	});

	it("classifies the public and protected surfaces", () => {
		expect(
			ROUTE_MANIFEST.filter(({ access }) => access === "admin"),
		).toHaveLength(5);
		expect(
			ROUTE_MANIFEST.filter(({ access }) => access === "public"),
		).toHaveLength(13);
		expect(
			ROUTE_MANIFEST.filter(({ access }) => access === "agent-token"),
		).toHaveLength(2);
		expect(
			ROUTE_MANIFEST.filter(({ access }) => access === "bearer"),
		).toHaveLength(4);
	});

	it("rejects duplicate route registrations", () => {
		const counts = countRouteOccurrences([
			"GET /designs",
			"GET /designs",
			"ALL /browser-mcp",
			"ALL /browser-mcp",
			"ALL /browser-mcp",
		]);
		expect(unexpectedRouteOccurrences(counts)).toEqual([
			"GET /designs",
			"ALL /browser-mcp",
		]);
	});

	// The admin JSON API moved to the tRPC batch endpoint under /api/trpc —
	// anonymous calls to protected procedures answer with tRPC JSON errors,
	// never admin HTML. (The old hand-routed /agents, /admins, /channels and
	// /skills namespaces are gone.)
	it.each([
		"/api/trpc/agents.list",
		"/api/trpc/admins.list",
		"/api/trpc/designs.list",
		"/api/trpc/projects.list",
		"/api/trpc/campaigns.list",
		"/api/trpc/channels.list",
		"/api/trpc/skills.list",
	])("answers an anonymous %s call with a tRPC JSON error, not admin HTML", async (path) => {
		const response = await startWorkerRequest(path);
		expect(response.status).toBe(401);
		expect(response.headers.get("content-type")).toContain("application/json");
		const body = (await response.json()) as {
			error: { message: string; data: { code: string } };
		};
		expect(body.error.message).toBe("unauthorized");
		expect(body.error.data.code).toBe("UNAUTHORIZED");
	});

	it.each([
		"/api/trpc/agents.doesNotExist",
		"/api/trpc/garbage",
	])("answers unknown tRPC path %s with a tRPC JSON NOT_FOUND error, not admin HTML", async (path) => {
		const response = await startWorkerRequest(path);
		expect(response.status).toBe(404);
		expect(response.headers.get("content-type")).toContain("application/json");
		const body = (await response.json()) as {
			error: { message: string; data: { code: string } };
		};
		expect(body.error.message).toContain("No procedure found on path");
		expect(body.error.data.code).toBe("NOT_FOUND");
	});

	it("does not return SPA HTML for an unknown campaign path with an admin session", async () => {
		const session = await createAdminSession();
		const response = await startAdminRequest(
			"/campaigns/not-a-route/unknown",
			session,
		);
		expect(response.status).toBe(404);
		expect(response.headers.get("content-type")).not.toContain("text/html");
		expect(await response.text()).toBe(
			"Try /api/trpc, /ui, /api/auth, or /process-logs",
		);
	});

	it.each([
		"/api/not-a-route",
		"/designs/not-a-route/unknown",
		"/projects/not-a-route/unknown",
		"/github-token/not-a-route",
		"/process-logs/not-a-route",
		"/browser-mcp/not-a-route",
		"/terminal/not-a-route",
	])("does not return SPA HTML for unknown API path %s", async (path) => {
		const response = await startWorkerRequest(path);
		expect(response.status).toBe(404);
		expect(response.headers.get("content-type")).not.toContain("text/html");
		expect(await response.text()).toBe(
			"Try /api/trpc, /ui, /api/auth, or /process-logs",
		);
	});

	it("serves site, preview, and arbitrary design files without a session", async () => {
		const { project, html, previewBytes, fileText } =
			await createPublishedDesign();

		const site = await startWorkerRequest(`/designs/${project.id}/site`);
		expect(site.status).toBe(200);
		expect(site.headers.get("content-type")).toBe("text/html; charset=utf-8");
		expect(await site.text()).toBe(html);
		expect(site.headers.get("content-security-policy")).toContain("sandbox");

		const preview = await startWorkerRequest(`/designs/${project.id}/preview`);
		expect(preview.status).toBe(200);
		expect(preview.headers.get("content-type")).toBe("image/png");
		expect(new Uint8Array(await preview.arrayBuffer())).toEqual(previewBytes);

		const file = await startWorkerRequest(
			`/designs/${project.id}/file/files/note.txt`,
		);
		expect(file.status).toBe(200);
		expect(file.headers.get("content-type")).toBe("text/plain; charset=utf-8");
		expect(await file.text()).toBe(fileText);
	});

	it("accepts a real Start admin session backed by migrated D1 state", async () => {
		const session = await createAdminSession();
		const client = createTrpcTestClient(session.headers);
		expect(await client.agents.list.query()).toEqual([]);
	});
});
