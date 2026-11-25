import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createAdminSession,
	createUserSession,
	type TestSession,
} from "../helpers/auth";
import {
	createCampaign,
	createDesign,
	createProject,
} from "../helpers/fixtures";
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

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Local fixtures — mirrors test/helpers/fixtures.ts but scoped here so the
// shared file stays untouched by this batch.

async function insertBrief(campaignId: string): Promise<string> {
	const id = crypto.randomUUID();
	const now = new Date().toISOString();
	await env.DB.prepare(
		`INSERT INTO "CampaignBrief"
			(id, campaignId, objective, audience, createdAt, updatedAt)
			VALUES (?, ?, ?, ?, ?, ?)`,
	)
		.bind(id, campaignId, "Launch the thing", "Design engineers", now, now)
		.run();
	return id;
}

async function insertPlan(campaignId: string, index: number): Promise<string> {
	const id = crypto.randomUUID();
	const now = new Date().toISOString();
	await env.DB.prepare(
		`INSERT INTO "CampaignPlan" (id, campaignId, name, status, createdAt, updatedAt)
			VALUES (?, ?, ?, 'final', ?, ?)`,
	)
		.bind(id, campaignId, `plan-${index}`, now, now)
		.run();
	for (const position of [1, 0]) {
		await env.DB.prepare(
			`INSERT INTO "PlanPhase" (id, planId, name, position)
				VALUES (?, ?, ?, ?)`,
			// inserts out of order on purpose: detail must sort by position
		)
			.bind(crypto.randomUUID(), id, `phase-${position}`, position)
			.run();
	}
	return id;
}

async function insertEvent(
	campaignId: string,
	index: number,
	assetId?: string,
): Promise<string> {
	const id = crypto.randomUUID();
	const now = new Date().toISOString();
	await env.DB.prepare(
		`INSERT INTO "CalendarEvent"
			(id, campaignId, title, channel, status, assetId, createdAt, updatedAt)
			VALUES (?, ?, ?, ?, 'planned', ?, ?, ?)`,
	)
		.bind(id, campaignId, `event-${index}`, "email", assetId ?? null, now, now)
		.run();
	return id;
}

async function insertReport(
	campaignId: string,
	title: string,
	createdAt: string,
): Promise<string> {
	const id = crypto.randomUUID();
	const now = new Date().toISOString();
	await env.DB.prepare(
		`INSERT INTO "CampaignReport" (id, campaignId, title, body, createdAt, updatedAt)
			VALUES (?, ?, ?, 'report body', ?, ?)`,
	)
		.bind(id, campaignId, title, createdAt, now)
		.run();
	return id;
}

async function insertMessage(
	campaignId: string,
	index: number,
): Promise<string> {
	const id = crypto.randomUUID();
	const now = new Date().toISOString();
	await env.DB.prepare(
		`INSERT INTO "Message" (id, campaignId, role, content, createdAt)
			VALUES (?, ?, 'user', ?, ?)`,
	)
		.bind(id, campaignId, `message-${index}`, now)
		.run();
	return id;
}

/** Attaches a design row to a campaign as a generated asset (Design.campaignId). */
async function attachDesign(campaignId: string): Promise<string> {
	const container = await createProject();
	const design = await createDesign({ projectId: container.id });
	await env.DB.prepare('UPDATE "Design" SET campaignId = ? WHERE id = ?')
		.bind(campaignId, design.id)
		.run();
	return design.id;
}

function adminClient(session: TestSession): TrpcTestClient {
	return createTrpcTestClient(session.headers);
}

afterEach(() => {
	vi.clearAllMocks();
	vi.restoreAllMocks();
});

describe("Campaign management tRPC API", () => {
	it.each([
		{},
		{ projectId: crypto.randomUUID() },
		{ projectId: "not-a-uuid" },
		{ name: "", projectId: crypto.randomUUID() },
		{ name: "   ", projectId: crypto.randomUUID() },
		{ name: "x".repeat(201), projectId: crypto.randomUUID() },
	])("rejects invalid create bodies — projectId is required", async (body) => {
		const session = await createAdminSession();
		const code = await trpcErrorCode(() =>
			adminClient(session).campaigns.create.mutate(body as never),
		);
		expect(code).toBe("BAD_REQUEST");
	});

	it("creates a filed campaign for a cuid-format project id (Prisma default)", async () => {
		// handlers/projects.ts lets Prisma generate project ids via
		// @default(cuid()) — 25-char lowercase cuids, not UUIDs. Regression
		// guard: the create/list/update guards must accept both shapes.
		const cuid = "c0123456789abcdefghijklmnopqrstuv".slice(0, 25);
		expect(cuid).toMatch(/^c[0-9a-z]{24}$/);
		const container = await createProject({ id: cuid, name: "Cuid project" });
		const session = await createAdminSession();
		const created = await adminClient(session).campaigns.create.mutate({
			projectId: container.id,
			name: "Cuid campaign",
		});
		expect(created.campaignId).toMatch(UUID_RE);
		const stored = await env.DB.prepare(
			`SELECT projectId FROM "Campaign" WHERE id = ?`,
		)
			.bind(created.campaignId)
			.first<{ projectId: string }>();
		expect(stored?.projectId).toBe(cuid);
	});

	it("creates a filed campaign with trimmed name and optional brief prompt", async () => {
		const container = await createProject({ name: "Campaign target" });
		const session = await createAdminSession();
		const created = await adminClient(session).campaigns.create.mutate({
			projectId: container.id,
			name: "  Q1 launch  ",
			briefPrompt: "  Go big  ",
		});
		expect(created.campaignId).toMatch(UUID_RE);
		const row = await env.DB.prepare(
			'SELECT name, briefPrompt, status, projectId FROM "Campaign" WHERE id = ?',
		)
			.bind(created.campaignId)
			.first();
		expect(row).toEqual({
			name: "Q1 launch",
			briefPrompt: "Go big",
			status: "ready",
			projectId: container.id,
		});
	});

	it("rejects creation into an unknown project with NOT_FOUND", async () => {
		const session = await createAdminSession();
		const call = () =>
			adminClient(session).campaigns.create.mutate({
				projectId: crypto.randomUUID(),
				name: "orphan campaign",
			});
		expect(await trpcErrorCode(call)).toBe("NOT_FOUND");
		expect(await trpcErrorMessage(call)).toBe("project not found");
	});

	it("lists campaigns with projectId filter, counts, and latest report title", async () => {
		const containerA = await createProject({ name: "Container A" });
		const containerB = await createProject({ name: "Container B" });
		const withCounts = await createCampaign({
			projectId: containerA.id,
			name: "Counted",
		});
		const plain = await createCampaign({
			projectId: containerB.id,
			name: "Plain",
		});
		// The list is ordered by createdAt desc; two fixtures can land in the
		// same millisecond and flip the tie. Backdate one so the order is
		// deterministic.
		await env.DB.prepare('UPDATE "Campaign" SET createdAt = ? WHERE id = ?')
			.bind(new Date(Date.now() - 60_000).toISOString(), withCounts.id)
			.run();
		await attachDesign(withCounts.id);
		await attachDesign(withCounts.id);
		await insertEvent(withCounts.id, 0);
		await insertReport(withCounts.id, "older report", "2026-01-01T00:00:00Z");
		await insertReport(withCounts.id, "latest report", "2026-02-01T00:00:00Z");
		const session = await createAdminSession();
		const client = adminClient(session);

		const allRows = await client.campaigns.list.query();
		expect(allRows.map((row) => row.id)).toEqual([plain.id, withCounts.id]);
		const counted = allRows.find((row) => row.id === withCounts.id);
		expect(counted).toMatchObject({
			assetCount: 2,
			eventCount: 1,
			latestReportTitle: "latest report",
		});
		const plainRow = allRows.find((row) => row.id === plain.id);
		expect(plainRow).toMatchObject({
			assetCount: 0,
			eventCount: 0,
			latestReportTitle: null,
		});

		const filteredRows = await client.campaigns.list.query({
			projectId: containerA.id,
		});
		expect(filteredRows.map((row) => row.id)).toEqual([withCounts.id]);

		const invalidFilter = () =>
			client.campaigns.list.query({ projectId: "not-a-uuid" });
		expect(await trpcErrorCode(invalidFilter)).toBe("BAD_REQUEST");
		expect(await trpcErrorMessage(invalidFilter)).toBe("invalid project id");
	});

	it("lists campaigns filtered to a project and returns nothing for unknown projects", async () => {
		const container = await createProject({ name: "List target" });
		const campaign = await createCampaign({ projectId: container.id });
		await createCampaign();
		const session = await createAdminSession();
		const rows = await adminClient(session).campaigns.list.query({
			projectId: container.id,
		});
		expect(rows.map((row) => row.id)).toEqual([campaign.id]);
		// The old project-scoped route 404'd unknown projects; the unified
		// projectId filter is a pure filter — an unknown id yields no rows.
		const unknown = await adminClient(session).campaigns.list.query({
			projectId: crypto.randomUUID(),
		});
		expect(unknown).toEqual([]);
	});

	it("returns campaign detail with brief, ordered plans/phases, events, and report summaries", async () => {
		const campaign = await createCampaign({ name: "Detail fixture" });
		await insertBrief(campaign.id);
		await insertPlan(campaign.id, 0);
		await insertEvent(campaign.id, 0);
		await insertReport(campaign.id, "Q1 recap", "2026-03-01T00:00:00Z");
		const session = await createAdminSession();
		const detail = await adminClient(session).campaigns.get.query({
			campaignId: campaign.id,
		});
		expect(detail).toMatchObject({
			id: campaign.id,
			name: "Detail fixture",
			brief: { objective: "Launch the thing" },
			plans: [
				{ name: "plan-0", phases: [{ name: "phase-0" }, { name: "phase-1" }] },
			],
			events: [{ title: "event-0" }],
		});
		expect(detail.plans[0]?.phases.map((phase) => phase.position)).toEqual([
			0, 1,
		]);
		// Report summaries: titles present, full bodies excluded.
		expect(detail.reports).toEqual([
			{
				id: expect.any(String),
				title: "Q1 recap",
				periodStart: null,
				periodEnd: null,
				createdAt: expect.any(String),
			},
		]);
	});

	it("rejects an invalid campaign id and 404s a missing campaign", async () => {
		const session = await createAdminSession();
		const client = adminClient(session);
		const invalid = () =>
			client.campaigns.get.query({ campaignId: "not-a-uuid" });
		expect(await trpcErrorCode(invalid)).toBe("BAD_REQUEST");
		expect(await trpcErrorMessage(invalid)).toBe("invalid campaign id");
		const missing = () =>
			client.campaigns.get.query({ campaignId: crypto.randomUUID() });
		expect(await trpcErrorCode(missing)).toBe("NOT_FOUND");
		expect(await trpcErrorMessage(missing)).toBe("not found");
	});

	it("renames and moves campaigns, and refuses to unfile them", async () => {
		const container = await createProject({ name: "Move target" });
		const other = await createProject({ name: "Second container" });
		const campaign = await createCampaign();
		const client = adminClient(await createAdminSession());

		const renamed = await client.campaigns.update.mutate({
			campaignId: campaign.id,
			name: "  Renamed  ",
		});
		expect(renamed.name).toBe("Renamed");

		const moved = await client.campaigns.update.mutate({
			campaignId: campaign.id,
			projectId: container.id,
		});
		expect(moved.projectId).toBe(container.id);

		const both = await client.campaigns.update.mutate({
			campaignId: campaign.id,
			name: "Moved twice",
			projectId: other.id,
		});
		expect(both).toMatchObject({ name: "Moved twice", projectId: other.id });

		// Every campaign is always part of a project — unfile is not a thing.
		expect(
			await trpcErrorCode(() =>
				client.campaigns.update.mutate({
					campaignId: campaign.id,
					projectId: null,
				} as never),
			),
		).toBe("BAD_REQUEST");
		// An update with no fields at all is also rejected.
		expect(
			await trpcErrorCode(() =>
				client.campaigns.update.mutate({ campaignId: campaign.id }),
			),
		).toBe("BAD_REQUEST");
	});

	it("rejects updates with BAD_REQUEST invalid id, NOT_FOUND unknown campaign, and NOT_FOUND unknown project", async () => {
		const session = await createAdminSession();
		const client = adminClient(session);
		const campaign = await createCampaign();

		const invalid = () =>
			client.campaigns.update.mutate({ campaignId: "not-a-uuid", name: "x" });
		expect(await trpcErrorCode(invalid)).toBe("BAD_REQUEST");

		const missingCampaign = () =>
			client.campaigns.update.mutate({
				campaignId: crypto.randomUUID(),
				name: "x",
			});
		expect(await trpcErrorCode(missingCampaign)).toBe("NOT_FOUND");
		expect(await trpcErrorMessage(missingCampaign)).toBe("not found");

		const missingProject = () =>
			client.campaigns.update.mutate({
				campaignId: campaign.id,
				projectId: crypto.randomUUID(),
			});
		expect(await trpcErrorCode(missingProject)).toBe("NOT_FOUND");
		expect(await trpcErrorMessage(missingProject)).toBe("project not found");
	});

	it("deletes a campaign, cascades its documents, and detaches design assets, then 404s", async () => {
		const campaign = await createCampaign();
		await insertBrief(campaign.id);
		const planId = await insertPlan(campaign.id, 0);
		await insertEvent(campaign.id, 0, await attachDesign(campaign.id));
		await insertReport(campaign.id, "recap", "2026-01-01T00:00:00Z");
		await insertMessage(campaign.id, 0);
		await insertMessage(campaign.id, 1);
		const session = await createAdminSession();
		const client = adminClient(session);
		await client.campaigns.delete.mutate({ campaignId: campaign.id });
		for (const table of [
			"CampaignBrief",
			"CampaignPlan",
			"PlanPhase",
			"CalendarEvent",
			"CampaignReport",
			"Message",
		]) {
			const column = table === "PlanPhase" ? "planId" : "campaignId";
			expect(
				await env.DB.prepare(
					`SELECT COUNT(*) AS count FROM "${table}" WHERE "${column}" = ?`,
				)
					.bind(table === "PlanPhase" ? planId : campaign.id)
					.first(),
			).toEqual({ count: 0 });
		}
		// The attached design asset stays filed in its project, detached.
		const attached = await env.DB.prepare(
			'SELECT campaignId, projectId FROM "Design" WHERE campaignId IS NULL',
		).all();
		expect(attached.results.length).toBeGreaterThan(0);
		expect(attached.results.every((row) => row.projectId != null)).toBe(true);
		const second = () =>
			client.campaigns.delete.mutate({ campaignId: campaign.id });
		expect(await trpcErrorCode(second)).toBe("NOT_FOUND");
		expect(await trpcErrorMessage(second)).toBe("not found");
	});

	it("cascades campaign deletion when the owning project is deleted", async () => {
		const container = await createProject({ name: "Doomed container" });
		const campaign = await createCampaign({ projectId: container.id });
		await insertBrief(campaign.id);
		await insertMessage(campaign.id, 0);
		const session = await createAdminSession();
		await adminClient(session).projects.delete.mutate({
			projectId: container.id,
		});
		expect(
			await env.DB.prepare(
				'SELECT COUNT(*) AS count FROM "Campaign" WHERE id = ?',
			)
				.bind(campaign.id)
				.first(),
		).toEqual({ count: 0 });
		expect(
			await env.DB.prepare(
				'SELECT COUNT(*) AS count FROM "CampaignBrief" WHERE campaignId = ?',
			)
				.bind(campaign.id)
				.first(),
		).toEqual({ count: 0 });
		expect(
			await env.DB.prepare(
				'SELECT COUNT(*) AS count FROM "Message" WHERE campaignId = ?',
			)
				.bind(campaign.id)
				.first(),
		).toEqual({ count: 0 });
	});

	it("rejects anonymous and non-admin users before allowing an admin", async () => {
		const anonymous = createTrpcTestClient();
		const nonAdmin = adminClient(await createUserSession("user"));
		const admin = adminClient(await createAdminSession());
		const missing = crypto.randomUUID();

		// GET /campaigns
		expect(await trpcErrorCode(() => anonymous.campaigns.list.query())).toBe(
			"UNAUTHORIZED",
		);
		expect(await trpcErrorCode(() => nonAdmin.campaigns.list.query())).toBe(
			"FORBIDDEN",
		);
		expect(await trpcErrorCode(() => admin.campaigns.list.query())).toBeNull();

		// POST /campaigns (invalid body → BAD_REQUEST once auth passes)
		for (const client of [anonymous, nonAdmin]) {
			expect(
				await trpcErrorCode(() => client.campaigns.create.mutate({} as never)),
			).toBe(client === anonymous ? "UNAUTHORIZED" : "FORBIDDEN");
		}
		expect(
			await trpcErrorCode(() => admin.campaigns.create.mutate({} as never)),
		).toBe("BAD_REQUEST");

		// POST /campaigns (valid body, unknown project → NOT_FOUND)
		for (const client of [anonymous, nonAdmin]) {
			expect(
				await trpcErrorCode(() =>
					client.campaigns.create.mutate({
						projectId: missing,
						name: "x",
					}),
				),
			).toBe(client === anonymous ? "UNAUTHORIZED" : "FORBIDDEN");
		}
		expect(
			await trpcErrorCode(() =>
				admin.campaigns.create.mutate({ projectId: missing, name: "x" }),
			),
		).toBe("NOT_FOUND");

		// GET/PATCH/DELETE /campaigns/:id (unknown campaign → NOT_FOUND)
		for (const client of [anonymous, nonAdmin]) {
			expect(
				await trpcErrorCode(() =>
					client.campaigns.get.query({ campaignId: missing }),
				),
			).toBe(client === anonymous ? "UNAUTHORIZED" : "FORBIDDEN");
			expect(
				await trpcErrorCode(() =>
					client.campaigns.update.mutate({
						campaignId: missing,
						name: "x",
					}),
				),
			).toBe(client === anonymous ? "UNAUTHORIZED" : "FORBIDDEN");
			expect(
				await trpcErrorCode(() =>
					client.campaigns.delete.mutate({ campaignId: missing }),
				),
			).toBe(client === anonymous ? "UNAUTHORIZED" : "FORBIDDEN");
		}
		expect(
			await trpcErrorCode(() =>
				admin.campaigns.get.query({ campaignId: missing }),
			),
		).toBe("NOT_FOUND");
		expect(
			await trpcErrorCode(() =>
				admin.campaigns.update.mutate({ campaignId: missing, name: "x" }),
			),
		).toBe("NOT_FOUND");
		expect(
			await trpcErrorCode(() =>
				admin.campaigns.delete.mutate({ campaignId: missing }),
			),
		).toBe("NOT_FOUND");
	});
});
