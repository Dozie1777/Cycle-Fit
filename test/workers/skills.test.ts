// Worker tests for the studio skills (KUK-891): the admin-owned Skill table
// behind the studio chats' slash commands and the load_skill tool. Covers
// the builtin seeds (0018 campaign playbooks + 0020 knowledge-work library)
// and the skills tRPC API (list/create/update/delete, case-insensitive
// duplicate rejection, builtin delete fencing, auth gates).
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createAdminSession,
	createUserSession,
	type TestSession,
} from "../helpers/auth";
import {
	createTrpcTestClient,
	type TrpcTestClient,
	trpcErrorCode,
	trpcErrorMessage,
} from "../helpers/trpc";

vi.mock("@cloudflare/playwright", () => ({ launch: vi.fn() }));
vi.mock("@cloudflare/sandbox", async (importOriginal) => ({
	...(await importOriginal<typeof import("@cloudflare/sandbox")>()),
	getSandbox: vi.fn(),
}));

/** The 0018 campaign playbooks, still seeded with deterministic ids. */
const BASE_SEED_SLUGS = [
	"campaign-basics",
	"content-calendar",
	"draft-a-brief",
	"launch-plan",
] as const;

function adminClient(session: TestSession): TrpcTestClient {
	return createTrpcTestClient(session.headers);
}

afterEach(() => {
	vi.clearAllMocks();
	vi.restoreAllMocks();
});

describe("Builtin skill seed (0018 + 0020 + 0023 + 0026)", () => {
	it("seeds the builtin skills idempotently with deterministic ids", async () => {
		const rows = await env.DB.prepare(
			'SELECT id, slug, name, builtin, enabled, category, length(content) AS contentLength FROM "Skill" WHERE builtin = 1 ORDER BY slug',
		).all<{
			id: string;
			slug: string;
			name: string;
			builtin: number;
			enabled: number;
			category: string;
			contentLength: number;
		}>();
		// 0018: four campaign playbooks; 0020: the adapted knowledge-work
		// library (7 design + 8 marketing + 13 sales); 0023: the design
		// studio onboarding skill; 0026: the tb-components skill — see
		// skills/builtin/README.md.
		expect(rows.results).toHaveLength(34);
		// Real playbook content, not stubs — every builtin row covers its
		// topic with substantial instructions.
		for (const row of rows.results) {
			expect(row.id).toBe(`skill-${row.slug}`);
			expect(row.builtin).toBe(1);
			expect(row.enabled).toBe(1);
			expect(row.contentLength).toBeGreaterThan(1000);
			expect(
				["campaign", "marketing", "sales", "design"].includes(row.category),
			).toBe(true);
		}
		const byCategory = new Map<string, number>();
		for (const row of rows.results) {
			byCategory.set(row.category, (byCategory.get(row.category) ?? 0) + 1);
		}
		expect(Object.fromEntries(byCategory)).toEqual({
			campaign: 4,
			design: 9,
			marketing: 8,
			sales: 13,
		});
		for (const slug of BASE_SEED_SLUGS) {
			expect(rows.results.map((row) => row.slug)).toContain(slug);
		}
		// The knowledge-work library slugs are unique and match their ids
		// (checked above); spot-check the category routing.
		expect(
			rows.results.find((row) => row.slug === "design-critique")?.category,
		).toBe("design");
		expect(
			rows.results.find((row) => row.slug === "campaign-plan")?.category,
		).toBe("marketing");
		expect(
			rows.results.find((row) => row.slug === "account-plan")?.category,
		).toBe("sales");
	});
});

describe("Skills tRPC API (KUK-891)", () => {
	it("rejects anonymous and non-admin users on every procedure", async () => {
		const session = await createAdminSession();
		const created = await adminClient(session).skills.create.mutate({
			slug: "probe",
			name: "Probe",
			description: "Probe skill",
			content: "# Probe",
		});
		const probe = created as { id: string };
		const anonymous = createTrpcTestClient();
		const nonAdmin = adminClient(await createUserSession("user"));

		// skills.list (GET /skills)
		expect(await trpcErrorCode(() => anonymous.skills.list.query())).toBe(
			"UNAUTHORIZED",
		);
		expect(await trpcErrorCode(() => nonAdmin.skills.list.query())).toBe(
			"FORBIDDEN",
		);

		// skills.create (POST /skills)
		for (const client of [anonymous, nonAdmin]) {
			expect(
				await trpcErrorCode(() =>
					client.skills.create.mutate({
						slug: "x",
						name: "x",
						description: "x",
						content: "x",
					}),
				),
			).toBe(client === anonymous ? "UNAUTHORIZED" : "FORBIDDEN");
		}

		// skills.update (PATCH /skills/:id)
		for (const client of [anonymous, nonAdmin]) {
			expect(
				await trpcErrorCode(() =>
					client.skills.update.mutate({ id: probe.id, name: "Renamed" }),
				),
			).toBe(client === anonymous ? "UNAUTHORIZED" : "FORBIDDEN");
		}

		// skills.delete (DELETE /skills/:id)
		for (const client of [anonymous, nonAdmin]) {
			expect(
				await trpcErrorCode(() =>
					client.skills.delete.mutate({ id: probe.id }),
				),
			).toBe(client === anonymous ? "UNAUTHORIZED" : "FORBIDDEN");
		}
	});

	it("lists the seeded skills ordered by slug", async () => {
		const session = await createAdminSession();
		const rows = await adminClient(session).skills.list.query();
		// Sorted by slug; includes the 0018 playbooks and the 0020 library.
		const slugs = rows.map((row) => row.slug);
		expect(slugs).toEqual([...slugs].sort());
		for (const slug of BASE_SEED_SLUGS) {
			expect(slugs).toContain(slug);
		}
		expect(slugs).toContain("design-critique");
	});

	it("creates a skill and rejects invalid bodies", async () => {
		const session = await createAdminSession();
		const row = await adminClient(session).skills.create.mutate({
			slug: "holiday-push",
			name: "  Holiday push  ",
			description: "December promo playbook.",
			content: "# Holiday push\nSteps…",
		});
		expect(row.slug).toBe("holiday-push");
		expect(row.name).toBe("Holiday push");
		// Admin-created rows are never builtin.
		expect(row.builtin).toBe(false);
		expect(row.enabled).toBe(true);
		expect(row.id).toMatch(/^[0-9a-f-]{36}$/);

		for (const body of [
			{},
			{ slug: "x" },
			{ slug: "x", name: "x", description: "x" },
			{ slug: "", name: "x", description: "x", content: "x" },
			{ slug: "has space", name: "x", description: "x", content: "x" },
			{ slug: "-leading", name: "x", description: "x", content: "x" },
			{
				slug: "x".repeat(65),
				name: "x",
				description: "x",
				content: "x",
			},
		]) {
			expect(
				await trpcErrorCode(() =>
					adminClient(session).skills.create.mutate(
						body as {
							slug: string;
							name: string;
							description: string;
							content: string;
						},
					),
				),
			).toBe("BAD_REQUEST");
		}
	});

	it("rejects case-insensitive duplicate slugs with CONFLICT", async () => {
		const session = await createAdminSession();
		// "campaign-basics" is seeded by the migration; mixed-case input is
		// normalized to lowercase and then collides with the seeded row.
		const code = await trpcErrorCode(() =>
			adminClient(session).skills.create.mutate({
				slug: "Campaign-Basics",
				name: "Dup",
				description: "dup",
				content: "dup",
			}),
		);
		expect(code).toBe("CONFLICT");
		expect(
			await trpcErrorMessage(() =>
				adminClient(session).skills.create.mutate({
					slug: "Campaign-Basics",
					name: "Dup",
					description: "dup",
					content: "dup",
				}),
			),
		).toBe('a skill with slug "campaign-basics" already exists');

		// Same normalization applies between admin-created rows.
		await adminClient(session).skills.create.mutate({
			slug: "holiday-push",
			name: "Holiday",
			description: "first",
			content: "first",
		});
		expect(
			await trpcErrorCode(() =>
				adminClient(session).skills.create.mutate({
					slug: "HOLIDAY-PUSH",
					name: "Holiday again",
					description: "second",
					content: "second",
				}),
			),
		).toBe("CONFLICT");
	});

	it("patches name, description, content and enabled; disables a builtin", async () => {
		const session = await createAdminSession();
		const row = await adminClient(session).skills.create.mutate({
			slug: "patch-me",
			name: "Patch me",
			description: "before",
			content: "# before",
		});

		const updated = await adminClient(session).skills.update.mutate({
			id: row.id,
			name: "Renamed",
			description: "after",
			content: "# after",
			enabled: false,
		});
		// The response is the full row; check the patched fields.
		expect(updated).toMatchObject({
			name: "Renamed",
			description: "after",
			content: "# after",
			enabled: false,
		});

		// Builtin skills are disabled, never deleted.
		const seeded = await env.DB.prepare(
			"SELECT id FROM \"Skill\" WHERE slug = 'draft-a-brief'",
		).first<{ id: string }>();
		const disabled = await adminClient(session).skills.update.mutate({
			id: seeded?.id as string,
			enabled: false,
		});
		expect(disabled.enabled).toBe(false);

		// Unknown id → NOT_FOUND; invalid body → BAD_REQUEST.
		expect(
			await trpcErrorCode(() =>
				adminClient(session).skills.update.mutate({
					id: crypto.randomUUID(),
					name: "Ghost",
				}),
			),
		).toBe("NOT_FOUND");
		expect(
			await trpcErrorCode(() =>
				adminClient(session).skills.update.mutate({ id: row.id }),
			),
		).toBe("BAD_REQUEST");
	});

	it("deletes plain skills but fences builtin ones with CONFLICT", async () => {
		const session = await createAdminSession();
		const row = await adminClient(session).skills.create.mutate({
			slug: "temporary",
			name: "Temporary",
			description: "temp",
			content: "temp",
		});

		// DELETE 204 → the void mutation resolves without a value.
		expect(
			await adminClient(session).skills.delete.mutate({ id: row.id }),
		).toBeUndefined();
		const gone = await env.DB.prepare('SELECT id FROM "Skill" WHERE id = ?')
			.bind(row.id)
			.first();
		expect(gone).toBeNull();

		const seeded = await env.DB.prepare(
			"SELECT id FROM \"Skill\" WHERE slug = 'campaign-basics'",
		).first<{ id: string }>();
		const code = await trpcErrorCode(() =>
			adminClient(session).skills.delete.mutate({ id: seeded?.id as string }),
		);
		expect(code).toBe("CONFLICT");
		expect(
			await trpcErrorMessage(() =>
				adminClient(session).skills.delete.mutate({ id: seeded?.id as string }),
			),
		).toBe("builtin skills cannot be deleted — disable them instead");

		// Unknown id → NOT_FOUND.
		expect(
			await trpcErrorCode(() =>
				adminClient(session).skills.delete.mutate({
					id: crypto.randomUUID(),
				}),
			),
		).toBe("NOT_FOUND");
	});
});
