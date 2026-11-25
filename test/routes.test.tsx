import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeRedirectPath } from "@/client/redirect-target";
import {
	AdminRoleRequired,
	Route as AuthenticatedRoute,
} from "../src/routes/_authenticated";
import { Route as IndexRoute } from "../src/routes/index";
import { Route as LoginRoute } from "../src/routes/login";
import { getAdminSession } from "../src/server/admin-session";

vi.mock("../src/server/admin-session", () => ({ getAdminSession: vi.fn() }));

const session = {
	user: { email: "admin@example.com", role: "admin" },
	session: { userId: "admin-123" },
} as unknown as NonNullable<Awaited<ReturnType<typeof getAdminSession>>>;

function beforeLoad(route: {
	options: { beforeLoad?: unknown };
}): (ctx?: { location?: { href: string } }) => Promise<unknown> {
	expect(route.options.beforeLoad).toBeTypeOf("function");
	return route.options.beforeLoad as () => Promise<unknown>;
}

beforeEach(() => {
	vi.mocked(getAdminSession).mockReset();
});

describe("console route guards", () => {
	it.each([
		"/projects/designs",
		"/agents",
		"/admins",
		"/studio/design-123",
	])("redirects unauthenticated %s deep links to login", async (path) => {
		vi.mocked(getAdminSession).mockResolvedValue(null);
		await expect(
			beforeLoad(AuthenticatedRoute)({ location: { href: path } }),
		).rejects.toMatchObject({
			options: { to: "/login", search: { redirect: path } },
		});
	});

	it("returns the authenticated session to guarded route context", async () => {
		vi.mocked(getAdminSession).mockResolvedValue(session);
		await expect(
			beforeLoad(AuthenticatedRoute)({
				location: { href: "/projects/designs" },
			}),
		).resolves.toEqual({
			session,
		});
	});

	it("redirects the root index to login when signed out", async () => {
		vi.mocked(getAdminSession).mockResolvedValue(null);
		await expect(beforeLoad(IndexRoute)()).rejects.toMatchObject({
			options: { to: "/login" },
		});
	});

	it("redirects the root index to designs when signed in", async () => {
		vi.mocked(getAdminSession).mockResolvedValue(session);
		await expect(beforeLoad(IndexRoute)()).rejects.toMatchObject({
			options: { to: "/projects/designs" },
		});
	});

	it("keeps login outside the guard", () => {
		expect(LoginRoute.options.beforeLoad).toBeUndefined();
	});

	it("renders the existing role-required message and sign-out action", () => {
		const document = renderToStaticMarkup(
			<AdminRoleRequired
				user={{ email: "user@example.com", role: "user" }}
				onSignOut={() => {}}
			/>,
		);
		expect(document).toContain("admin role required");
		expect(document).toContain("Sign out");
		expect(document).toContain("user@example.com");
		expect(document).toContain('data-slot="button"');
		expect(document).toContain("bg-secondary");
	});
});

describe("legacy hash routes", () => {
	it.each([
		["#/", "/projects/designs"],
		["#/designs", "/projects/designs"],
		["#/agents", "/agents"],
		["#/admins", "/admins"],
		["#/studio/design-123", "/studio/design-123"],
	])("maps %s to %s", async (hash, pathname) => {
		const modulePath = "../src/client/legacy-routes";
		const legacyRoutes = await import(modulePath).catch(() => null);
		expect(legacyRoutes).not.toBeNull();
		expect(legacyRoutes.mapLegacyAdminHash(hash)).toBe(pathname);
	});

	it("ignores unrelated hashes", async () => {
		const modulePath = "../src/client/legacy-routes";
		const legacyRoutes = await import(modulePath).catch(() => null);
		expect(legacyRoutes).not.toBeNull();
		expect(legacyRoutes.mapLegacyAdminHash("#/api/agents")).toBeNull();
		expect(legacyRoutes.mapLegacyAdminHash("")).toBeNull();
	});
});

describe("safeRedirectPath", () => {
	it("allows same-origin absolute paths, including nested ones", () => {
		expect(safeRedirectPath("/projects/designs")).toBe("/projects/designs");
		expect(safeRedirectPath("/studio/design-123")).toBe("/studio/design-123");
		expect(safeRedirectPath("/designs?filter=open")).toBe(
			"/designs?filter=open",
		);
	});

	it.each([
		"https://evil.com/phish",
		"http://evil.com",
		"//evil.com",
		"/\\evil.com",
		"javascript:alert(1)",
		"/designs\n//evil.com",
		"/\t//evil.com",
		"",
		"designs",
		42,
		null,
		undefined,
		{ redirect: "/projects/designs" },
	])("rejects %s", (input) => {
		expect(safeRedirectPath(input)).toBeNull();
	});
});
