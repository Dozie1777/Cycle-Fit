// Worker tests for the BrandKit → DesignToken migration (KUK-918): the 0021
// backfill (light/dark colors, typography, fonts — with the `dark-<role>`
// convention) and its idempotency, plus the runtime sync that keeps
// DesignToken rows current after brand-kit writes (PUT/DELETE through the
// admin route). Adoption goes through the same saveKitRows → sync path.
import {
	applyD1Migrations,
	type D1Migration,
	env,
	reset,
} from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAdminSession } from "../helpers/auth";
import { createProject } from "../helpers/fixtures";
import { createTrpcTestClient } from "../helpers/trpc";

vi.mock("@cloudflare/playwright", () => ({ launch: vi.fn() }));
vi.mock("@cloudflare/sandbox", async (importOriginal) => ({
	...(await importOriginal<typeof import("@cloudflare/sandbox")>()),
	getSandbox: vi.fn(),
}));

const testEnv = env as typeof env & { TEST_MIGRATIONS: D1Migration[] };

// TEST_MIGRATIONS is sorted lexicographically. Resolve the boundary by name
// so the slice stays correct when other migrations land before 0021.
const KUK918_INDEX = testEnv.TEST_MIGRATIONS.findIndex((m) =>
	m.name.includes("0021_brandkit_to_design_tokens"),
);

async function seedBrandKit(projectId: string) {
	const kitId = `brandkit-${projectId}`;
	const now = new Date().toISOString();
	await env.DB.batch([
		env.DB.prepare(
			'INSERT INTO "BrandKit" (id, projectId, name, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)',
		).bind(kitId, projectId, "Backfill brand", now, now),
		env.DB.prepare(
			'INSERT INTO "BrandPalette" (id, kitId, mode) VALUES (?, ?, ?)',
		).bind(`${kitId}-light`, kitId, "light"),
		env.DB.prepare(
			'INSERT INTO "BrandPalette" (id, kitId, mode) VALUES (?, ?, ?)',
		).bind(`${kitId}-dark`, kitId, "dark"),
		env.DB.prepare(
			'INSERT INTO "BrandColor" (id, paletteId, role, value) VALUES (?, ?, ?, ?)',
		).bind("bc-1", `${kitId}-light`, "background", "#ffffff"),
		env.DB.prepare(
			'INSERT INTO "BrandColor" (id, paletteId, role, value) VALUES (?, ?, ?, ?)',
		).bind("bc-2", `${kitId}-light`, "primary", "#2563eb"),
		env.DB.prepare(
			'INSERT INTO "BrandColor" (id, paletteId, role, value) VALUES (?, ?, ?, ?)',
		).bind("bc-3", `${kitId}-dark`, "background", "#0a0a0a"),
		env.DB.prepare(
			'INSERT INTO "BrandTypography" (id, kitId, role, stack) VALUES (?, ?, ?, ?)',
		).bind("bt-1", kitId, "heading", "Georgia, serif"),
		env.DB.prepare(
			'INSERT INTO "BrandFont" (id, kitId, family, source, url, weights, italic) VALUES (?, ?, ?, ?, ?, ?, ?)',
		).bind("bf-1", kitId, "Inter", "google", null, "400;700", 0),
	]);
}

async function tokenRows() {
	return env.DB.prepare(
		'SELECT category, role, value FROM "DesignToken" ORDER BY category, role',
	).all<{ category: string; role: string; value: string }>();
}

afterEach(() => {
	vi.clearAllMocks();
	vi.restoreAllMocks();
});

describe("Migration 0021 — BrandKit backfill into DesignSystem/DesignToken", () => {
	it("backfills every project's brand kit as tokens, idempotently", async () => {
		// Re-run the migrations up to (not including) 0021, seed brand-kit
		// rows, then apply 0021 and assert the backfill — the shared
		// beforeEach already applied everything, so this test re-creates
		// that boundary itself.
		await reset();
		await applyD1Migrations(
			env.DB,
			testEnv.TEST_MIGRATIONS.slice(0, KUK918_INDEX),
		);
		const project = await createProject({ name: "Backfilled project" });
		await seedBrandKit(project.id);

		await applyD1Migrations(
			env.DB,
			testEnv.TEST_MIGRATIONS.slice(KUK918_INDEX),
		);

		// One DesignSystem per kit-bearing project.
		const systems = await env.DB.prepare(
			'SELECT id, projectId FROM "DesignSystem"',
		).all<{ id: string; projectId: string }>();
		expect(systems.results).toEqual([
			{ id: `ds_${project.id}`, projectId: project.id },
		]);

		// The mapped rows: light colors keep their shadcn role, dark colors
		// are prefixed, typography keeps its role with the stack as value,
		// fonts carry the loading info as a JSON TEXT value.
		const rows = (await tokenRows()).results;
		expect(rows).toEqual([
			{ category: "color", role: "background", value: "#ffffff" },
			{ category: "color", role: "dark-background", value: "#0a0a0a" },
			{ category: "color", role: "primary", value: "#2563eb" },
			{
				category: "font",
				role: "Inter",
				value: JSON.stringify({
					source: "google",
					url: null,
					weights: "400;700",
					italic: false,
				}),
			},
			{ category: "typography", role: "heading", value: "Georgia, serif" },
		]);
		// The font value parses as real JSON with a boolean italic.
		const fontToken = rows.find((row) => row.category === "font");
		expect(JSON.parse(fontToken?.value ?? "{}")).toEqual({
			source: "google",
			url: null,
			weights: "400;700",
			italic: false,
		});

		// Idempotent: re-running the migration's statements inserts nothing new.
		// applyD1Migrations records applied ids and would skip — execute the
		// 0021 queries directly to prove the re-run guards hold.
		const migration = testEnv.TEST_MIGRATIONS.find((m) =>
			m.name.includes("0021_brandkit_to_design_tokens"),
		);
		if (!migration) throw new Error("migration 0021 not in TEST_MIGRATIONS");
		await env.DB.batch(migration.queries.map((query) => env.DB.prepare(query)));
		expect((await tokenRows()).results).toEqual(rows);
	});

	it("never touches a project without a brand kit", async () => {
		await createProject({ name: "No kit" });
		expect((await tokenRows()).results).toEqual([]);
	});
});

describe("Brand-kit writes keep DesignToken rows current (KUK-918)", () => {
	it("PUT syncs the saved kit into token rows; DELETE clears them", async () => {
		const session = await createAdminSession();
		const client = createTrpcTestClient(session.headers);
		const project = await createProject({ name: "Synced project" });
		await client.projects.brandKit.upsert.mutate({
			projectId: project.id,
			body: {
				name: "Synced brand",
				palettes: [
					{
						mode: "light",
						colors: [
							{ role: "background", value: "#ffffff" },
							{ role: "foreground", value: "#111111" },
							{ role: "primary", value: "#2563eb" },
						],
					},
				],
				typography: [{ role: "body", stack: "Inter, sans-serif" }],
				fonts: [
					{
						family: "Inter",
						source: "google",
						weights: "400;700",
						italic: false,
					},
				],
			},
		});

		const rows = (await tokenRows()).results;
		expect(rows).toEqual([
			{ category: "color", role: "background", value: "#ffffff" },
			{ category: "color", role: "foreground", value: "#111111" },
			{ category: "color", role: "primary", value: "#2563eb" },
			{
				category: "font",
				role: "Inter",
				value: JSON.stringify({
					source: "google",
					url: null,
					weights: "400;700",
					italic: false,
				}),
			},
			{ category: "typography", role: "body", value: "Inter, sans-serif" },
		]);

		// An edited-away role disappears on the next sync (re-save without it).
		await client.projects.brandKit.upsert.mutate({
			projectId: project.id,
			body: {
				name: "Synced brand",
				palettes: [
					{
						mode: "light",
						colors: [
							{ role: "background", value: "#ffffff" },
							{ role: "foreground", value: "#111111" },
							{ role: "primary", value: "#1d4ed8" },
						],
					},
				],
			},
		});
		const afterUpdate = (await tokenRows()).results;
		expect(
			afterUpdate.find(
				(row) => row.category === "color" && row.role === "primary",
			),
		).toEqual({ category: "color", role: "primary", value: "#1d4ed8" });
		// The dropped typography/font roles and colors are swept.
		expect(afterUpdate.some((row) => row.category !== "color")).toBe(false);

		// Deleting the kit clears the kit-mirrored rows (the old route answered
		// 204 — the void mutation resolves undefined).
		const deleted = await client.projects.brandKit.delete.mutate({
			projectId: project.id,
		});
		expect(deleted).toBeUndefined();
		expect((await tokenRows()).results).toEqual([]);
	});
});
