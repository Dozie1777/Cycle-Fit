// Worker tests for the channel enumeration (KUK-890): the admin-owned
// Channel table behind the calendar swimlanes, the brief channel mix and the
// agent's list_channels tool. Covers migration 0017 (idempotent standard
// seeding + data-preserving legacy backfill) and the channels tRPC API
// (list/create/update, case-insensitive duplicate rejection, auth gates).
import {
	applyD1Migrations,
	type D1Migration,
	env,
	reset,
} from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createAdminSession,
	createUserSession,
	type TestSession,
} from "../helpers/auth";
import { createCampaign } from "../helpers/fixtures";
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

const testEnv = env as typeof env & { TEST_MIGRATIONS: D1Migration[] };

function adminClient(session: TestSession): TrpcTestClient {
	return createTrpcTestClient(session.headers);
}

afterEach(() => {
	vi.clearAllMocks();
	vi.restoreAllMocks();
});

describe("Migration 0017 — channel seed + legacy backfill", () => {
	it("seeds the standard channels idempotently and links legacy event channels", async () => {
		// Re-run the migrations up to (not including) 0017, seed legacy
		// CalendarEvent rows with free-text channels, then apply 0017 and
		// assert the data-preserving backfill — the shared beforeEach already
		// applied everything, so this test re-creates that boundary itself.
		await reset();
		await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS.slice(0, 16));
		const project = await createCampaign();
		const now = new Date().toISOString();
		for (const [id, channel] of [
			["ev-legacy-1", "email newsletter"],
			["ev-legacy-2", "Email"],
			["ev-legacy-3", "  X  "],
			["ev-legacy-4", null],
		] as const) {
			await env.DB.prepare(
				`INSERT INTO "CalendarEvent"
					(id, campaignId, title, channel, status, createdAt, updatedAt)
					VALUES (?, ?, 'Legacy slot', ?, 'planned', ?, ?)`,
			)
				.bind(id, project.id, channel, now, now)
				.run();
		}

		await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS.slice(16));

		// Standard channels are seeded (14 of them, with colors); the
		// backfilled legacy string is appended (trimmed, original casing).
		const seeded = await env.DB.prepare(
			'SELECT id, name, color FROM "Channel" ORDER BY id',
		).all<{ id: string; name: string; color: string | null }>();
		const names = seeded.results.map((row) => row.name);
		expect(names.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))).toEqual([
			"Blog/SEO",
			"Community",
			"Email",
			"Events",
			"Instagram",
			"Landing page",
			"LinkedIn",
			// Binary collation: "PR/Outreach" sorts before "Paid ads"/"Podcast".
			"PR/Outreach",
			"Paid ads",
			"Podcast",
			"TikTok",
			"Webinar",
			"X",
			"YouTube",
			"email newsletter",
		]);
		// Seeded rows carry colors; the backfilled one does not.
		const colors = new Map(seeded.results.map((row) => [row.name, row.color]));
		expect(colors.get("Email")).toMatch(/^#[0-9a-f]{6}$/);
		expect(colors.get("email newsletter")).toBeNull();

		// Events are linked by name lookup; the legacy text column is kept.
		const events = await env.DB.prepare(
			`SELECT id, channel, channelId FROM "CalendarEvent" ORDER BY id`,
		).all<{ id: string; channel: string | null; channelId: string | null }>();
		expect(events.results).toEqual([
			{
				id: "ev-legacy-1",
				channel: "email newsletter",
				channelId: "chan-email-newsletter",
			},
			{ id: "ev-legacy-2", channel: "Email", channelId: "chan-email" },
			{ id: "ev-legacy-3", channel: "  X  ", channelId: "chan-x" },
			{ id: "ev-legacy-4", channel: null, channelId: null },
		]);
	});
});

describe("Channel tRPC API (KUK-890)", () => {
	it("list and create reject anonymous and non-admin users", async () => {
		const anonymous = createTrpcTestClient();
		const nonAdmin = adminClient(await createUserSession("user"));

		// channels.list (GET /channels)
		expect(await trpcErrorCode(() => anonymous.channels.list.query())).toBe(
			"UNAUTHORIZED",
		);
		expect(await trpcErrorCode(() => nonAdmin.channels.list.query())).toBe(
			"FORBIDDEN",
		);

		// channels.create (POST /channels)
		for (const client of [anonymous, nonAdmin]) {
			expect(
				await trpcErrorCode(() =>
					client.channels.create.mutate({ name: "Email" }),
				),
			).toBe(client === anonymous ? "UNAUTHORIZED" : "FORBIDDEN");
		}
	});

	it("update rejects anonymous and non-admin users", async () => {
		const anonymous = createTrpcTestClient();
		const nonAdmin = adminClient(await createUserSession("user"));

		// channels.update (PATCH /channels/:id)
		for (const client of [anonymous, nonAdmin]) {
			expect(
				await trpcErrorCode(() =>
					client.channels.update.mutate({ id: "x", name: "Email" }),
				),
			).toBe(client === anonymous ? "UNAUTHORIZED" : "FORBIDDEN");
		}
	});

	it("lists channels ordered by name", async () => {
		const session = await createAdminSession();
		const rows = await adminClient(session).channels.list.query();
		// The migration seeded the standard enumeration.
		expect(rows.length).toBeGreaterThanOrEqual(14);
		// Prisma passes through SQLite's BINARY name ordering — compare with
		// plain lexicographic order, not localeCompare.
		const sorted = [...rows].sort((a, b) =>
			a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
		);
		expect(rows).toEqual(sorted);
	});

	it("creates a channel with a name and optional color", async () => {
		const session = await createAdminSession();
		const row = await adminClient(session).channels.create.mutate({
			name: "  Newsletter  ",
			color: "#3b82f6",
		});
		expect(row.name).toBe("Newsletter");
		expect(row.color).toBe("#3b82f6");
		expect(row.id).toMatch(/^[0-9a-f-]{36}$/);

		// Invalid bodies: missing name, empty name, oversized values.
		for (const body of [{}, { name: "" }, { name: "x".repeat(101) }]) {
			expect(
				await trpcErrorCode(() =>
					adminClient(session).channels.create.mutate(body as { name: string }),
				),
			).toBe("BAD_REQUEST");
		}
	});

	it("rejects case-insensitive duplicate names with CONFLICT", async () => {
		const session = await createAdminSession();
		// "Email" is seeded by the migration.
		const code = await trpcErrorCode(() =>
			adminClient(session).channels.create.mutate({ name: "email" }),
		);
		expect(code).toBe("CONFLICT");
		expect(
			await trpcErrorMessage(() =>
				adminClient(session).channels.create.mutate({ name: "email" }),
			),
		).toBe('a channel named "email" already exists');
	});

	it("renames and recolors an existing channel; rename keeps uniqueness", async () => {
		const session = await createAdminSession();
		const row = await adminClient(session).channels.create.mutate({
			name: "Popup events",
		});

		const updated = await adminClient(session).channels.update.mutate({
			id: row.id,
			name: "Pop-ups",
			color: "#f97316",
		});
		expect(updated.name).toBe("Pop-ups");
		expect(updated.color).toBe("#f97316");

		// Renaming onto an existing name (case-insensitive) is a CONFLICT.
		expect(
			await trpcErrorCode(() =>
				adminClient(session).channels.update.mutate({
					id: row.id,
					name: "EMAIL",
				}),
			),
		).toBe("CONFLICT");

		// color: null clears it.
		const cleared = await adminClient(session).channels.update.mutate({
			id: row.id,
			color: null,
		});
		expect(cleared.color).toBeNull();

		// Unknown channel id → NOT_FOUND; invalid body → BAD_REQUEST.
		expect(
			await trpcErrorCode(() =>
				adminClient(session).channels.update.mutate({
					id: crypto.randomUUID(),
					name: "Ghost",
				}),
			),
		).toBe("NOT_FOUND");
		expect(
			await trpcErrorCode(() =>
				adminClient(session).channels.update.mutate({ id: row.id }),
			),
		).toBe("BAD_REQUEST");
	});
});
