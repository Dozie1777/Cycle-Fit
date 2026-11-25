import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createAdminSession,
	createUserSession,
	type TestSession,
} from "../helpers/auth";
import { createCampaign, createProject } from "../helpers/fixtures";
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

async function insertReport(
	campaignId: string,
	title: string,
): Promise<{ id: string }> {
	const id = crypto.randomUUID();
	const now = new Date().toISOString();
	await env.DB.prepare(
		`INSERT INTO "CampaignReport" (id, campaignId, title, body, createdAt, updatedAt)
			VALUES (?, ?, ?, ?, ?, ?)`,
	)
		.bind(id, campaignId, title, "report body", now, now)
		.run();
	return { id };
}

function adminClient(session: TestSession): TrpcTestClient {
	return createTrpcTestClient(session.headers);
}

afterEach(() => {
	vi.clearAllMocks();
	vi.restoreAllMocks();
});

describe("Campaign KPI tRPC API", () => {
	it("rejects anonymous and non-admin users on reads and writes", async () => {
		const campaign = await createCampaign();
		const anonymous = createTrpcTestClient();
		const nonAdmin = adminClient(await createUserSession("user"));
		for (const client of [anonymous, nonAdmin]) {
			expect(
				await trpcErrorCode(() =>
					client.campaigns.kpis.list.query({ campaignId: campaign.id }),
				),
			).toBe(client === anonymous ? "UNAUTHORIZED" : "FORBIDDEN");
			expect(
				await trpcErrorCode(() =>
					client.campaigns.kpis.create.mutate({
						campaignId: campaign.id,
						name: "x",
						kind: "number",
					}),
				),
			).toBe(client === anonymous ? "UNAUTHORIZED" : "FORBIDDEN");
		}
	});

	it("rejects invalid campaign id and 404s missing campaign", async () => {
		const session = await createAdminSession();
		const client = adminClient(session);
		const invalid = () =>
			client.campaigns.kpis.list.query({ campaignId: "not-a-uuid" });
		expect(await trpcErrorCode(invalid)).toBe("BAD_REQUEST");
		expect(await trpcErrorMessage(invalid)).toBe("invalid campaign id");
		const missing = () =>
			client.campaigns.kpis.list.query({ campaignId: crypto.randomUUID() });
		expect(await trpcErrorCode(missing)).toBe("NOT_FOUND");
	});

	it("creates and lists KPI targets", async () => {
		const campaign = await createCampaign();
		const client = adminClient(await createAdminSession());
		const created = await client.campaigns.kpis.create.mutate({
			campaignId: campaign.id,
			name: "Sign-ups",
			kind: "number",
			targetNumber: 1000,
			unit: "users",
			color: "#3b82f6",
		});
		const kpi = created as { id: string; name: string };
		expect(kpi.name).toBe("Sign-ups");

		const rows = await client.campaigns.kpis.list.query({
			campaignId: campaign.id,
		});
		expect(rows).toHaveLength(1);
		expect(rows[0]?.id).toBe(kpi.id);
	});

	it("updates and deletes KPI targets", async () => {
		const campaign = await createCampaign();
		const client = adminClient(await createAdminSession());
		const created = await client.campaigns.kpis.create.mutate({
			campaignId: campaign.id,
			name: "Old",
			kind: "number",
			targetNumber: 10,
		});
		const kpi = created as { id: string };
		const updated = (await client.campaigns.kpis.update.mutate({
			campaignId: campaign.id,
			kpiId: kpi.id,
			name: "Updated",
			targetNumber: 20,
		})) as { name: string };
		expect(updated.name).toBe("Updated");

		await client.campaigns.kpis.delete.mutate({
			campaignId: campaign.id,
			kpiId: kpi.id,
		});
		const rows = await client.campaigns.kpis.list.query({
			campaignId: campaign.id,
		});
		expect(rows).toHaveLength(0);
	});

	it("auto-derives numeric result status", async () => {
		const campaign = await createCampaign();
		const client = adminClient(await createAdminSession());
		const created = await client.campaigns.kpis.create.mutate({
			campaignId: campaign.id,
			name: "Sign-ups",
			kind: "number",
			targetNumber: 100,
		});
		const kpiRow = created as { id: string };

		const result = (await client.campaigns.kpiResults.create.mutate({
			campaignId: campaign.id,
			kpiId: kpiRow.id,
			actualNumber: 85,
		})) as { status: string };
		expect(result.status).toBe("partial");
	});

	it("creates, updates, and deletes KPI results", async () => {
		const campaign = await createCampaign();
		const client = adminClient(await createAdminSession());
		const createdKpi = await client.campaigns.kpis.create.mutate({
			campaignId: campaign.id,
			name: "Flag",
			kind: "boolean",
			targetBoolean: true,
		});
		const kpiRow = createdKpi as { id: string };

		const created = (await client.campaigns.kpiResults.create.mutate({
			campaignId: campaign.id,
			kpiId: kpiRow.id,
			actualBoolean: false,
			status: "not_met",
		})) as { id: string; status: string };
		expect(created.status).toBe("not_met");

		const updated = (await client.campaigns.kpiResults.update.mutate({
			campaignId: campaign.id,
			resultId: created.id,
			actualBoolean: true,
			status: "exceeded",
		})) as { status: string };
		expect(updated.status).toBe("exceeded");

		await client.campaigns.kpiResults.delete.mutate({
			campaignId: campaign.id,
			resultId: created.id,
		});
	});

	it("links a result to a report and fences report ids", async () => {
		const campaign = await createCampaign();
		const other = await createCampaign();
		const client = adminClient(await createAdminSession());
		const createdKpi = await client.campaigns.kpis.create.mutate({
			campaignId: campaign.id,
			name: "MRR",
			kind: "number",
			targetNumber: 10_000,
		});
		const kpiRow = createdKpi as { id: string };
		const report = await insertReport(other.id, "Other report");

		const bad = () =>
			client.campaigns.kpiResults.create.mutate({
				campaignId: campaign.id,
				kpiId: kpiRow.id,
				actualNumber: 12_000,
				reportId: report.id,
			});
		expect(await trpcErrorCode(bad)).toBe("BAD_REQUEST");
		expect(await trpcErrorMessage(bad)).toBe(
			`report ${report.id} does not belong to this campaign`,
		);

		const ownReport = await insertReport(campaign.id, "Own report");
		const good = (await client.campaigns.kpiResults.create.mutate({
			campaignId: campaign.id,
			kpiId: kpiRow.id,
			actualNumber: 12_000,
			reportId: ownReport.id,
		})) as { report: { id: string } | null };
		expect(good.report?.id).toBe(ownReport.id);
	});

	it("fences KPI and result ids to the campaign", async () => {
		const campaign = await createCampaign();
		const other = await createCampaign();
		const client = adminClient(await createAdminSession());
		const createdKpi = await client.campaigns.kpis.create.mutate({
			campaignId: other.id,
			name: "Other",
			kind: "boolean",
			targetBoolean: true,
		});
		const kpiRow = createdKpi as { id: string };

		const patch = () =>
			client.campaigns.kpis.update.mutate({
				campaignId: campaign.id,
				kpiId: kpiRow.id,
				name: "Hijack",
			});
		expect(await trpcErrorCode(patch)).toBe("BAD_REQUEST");
		expect(await trpcErrorMessage(patch)).toBe(
			`kpi ${kpiRow.id} does not belong to this campaign`,
		);

		const result = (await client.campaigns.kpiResults.create.mutate({
			campaignId: other.id,
			kpiId: kpiRow.id,
			actualBoolean: false,
			status: "not_met",
		})) as { id: string };
		const del = () =>
			client.campaigns.kpiResults.delete.mutate({
				campaignId: campaign.id,
				resultId: result.id,
			});
		expect(await trpcErrorCode(del)).toBe("BAD_REQUEST");
	});

	it("includes KPIs with latest result in campaign detail", async () => {
		const campaign = await createCampaign();
		const client = adminClient(await createAdminSession());
		const createdKpi = await client.campaigns.kpis.create.mutate({
			campaignId: campaign.id,
			name: "Revenue",
			kind: "number",
			targetNumber: 100,
		});
		const kpiRow = createdKpi as { id: string };
		await client.campaigns.kpiResults.create.mutate({
			campaignId: campaign.id,
			kpiId: kpiRow.id,
			actualNumber: 90,
		});
		await client.campaigns.kpiResults.create.mutate({
			campaignId: campaign.id,
			kpiId: kpiRow.id,
			actualNumber: 95,
		});

		const detail = await client.campaigns.get.query({
			campaignId: campaign.id,
		});
		const kpis = detail.kpis as Array<{
			id: string;
			results: Array<{ actualNumber: number; status: string }>;
		}>;
		expect(kpis).toHaveLength(1);
		expect(kpis[0]?.id).toBe(kpiRow.id);
		expect(kpis[0]?.results).toHaveLength(1);
		expect(kpis[0]?.results[0]?.actualNumber).toBe(95);
	});

	it("patches target end date and exposes it on detail", async () => {
		const campaign = await createCampaign();
		const client = adminClient(await createAdminSession());
		const patched = (await client.campaigns.update.mutate({
			campaignId: campaign.id,
			targetEndDate: "2026-12-31",
		})) as { targetEndDate: string };
		expect(String(patched.targetEndDate)).toMatch(/^2026-12-31/);

		const detail = (await client.campaigns.get.query({
			campaignId: campaign.id,
		})) as { targetEndDate: string };
		expect(String(detail.targetEndDate)).toMatch(/^2026-12-31/);
	});

	it("cascades KPIs and results when the campaign is deleted", async () => {
		const campaign = await createCampaign();
		const client = adminClient(await createAdminSession());
		const createdKpi = await client.campaigns.kpis.create.mutate({
			campaignId: campaign.id,
			name: "Leads",
			kind: "number",
			targetNumber: 50,
		});
		const kpiRow = createdKpi as { id: string };
		await client.campaigns.kpiResults.create.mutate({
			campaignId: campaign.id,
			kpiId: kpiRow.id,
			actualNumber: 40,
		});

		await client.campaigns.delete.mutate({ campaignId: campaign.id });
		expect(
			await env.DB.prepare(
				'SELECT COUNT(*) AS count FROM "CampaignKpi" WHERE "campaignId" = ?',
			)
				.bind(campaign.id)
				.first(),
		).toEqual({ count: 0 });
		expect(
			await env.DB.prepare(
				'SELECT COUNT(*) AS count FROM "CampaignKpiResult" WHERE "kpiId" = ?',
			)
				.bind(kpiRow.id)
				.first(),
		).toEqual({ count: 0 });
	});

	it("cascades KPIs and results when the owning project is deleted", async () => {
		const container = await createProject();
		const campaign = await createCampaign({ projectId: container.id });
		const client = adminClient(await createAdminSession());
		const createdKpi = await client.campaigns.kpis.create.mutate({
			campaignId: campaign.id,
			name: "Leads",
			kind: "number",
			targetNumber: 50,
		});
		const kpiRow = createdKpi as { id: string };
		await client.campaigns.kpiResults.create.mutate({
			campaignId: campaign.id,
			kpiId: kpiRow.id,
			actualNumber: 40,
		});

		await client.projects.delete.mutate({ projectId: container.id });
		expect(
			await env.DB.prepare(
				'SELECT COUNT(*) AS count FROM "CampaignKpi" WHERE "campaignId" = ?',
			)
				.bind(campaign.id)
				.first(),
		).toEqual({ count: 0 });
		expect(
			await env.DB.prepare(
				'SELECT COUNT(*) AS count FROM "CampaignKpiResult" WHERE "kpiId" = ?',
			)
				.bind(kpiRow.id)
				.first(),
		).toEqual({ count: 0 });
	});
});
