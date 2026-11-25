import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { startWorkerRequest } from "../helpers/request";

/**
 * Public campaign share page (KUK-876): slug resolution, snapshot rendering,
 * report gating, and asset embeds. Helpers are local — the shared fixtures
 * module belongs to other suites and these rows need share-slug columns.
 */

// Base58 (no 0/O/I/l), 22 chars — matches the campaign-share slug pattern.
const SLUG_A = "a".repeat(22);
const SLUG_B = "b".repeat(22);
const SLUG_C = "c".repeat(22);
const SLUG_Z = "z".repeat(22);

const now = () => new Date().toISOString();

async function createProjectRow(name = "Share test project"): Promise<string> {
	const id = crypto.randomUUID();
	await env.DB.prepare(
		`INSERT INTO "Project" (id, name, description, createdAt, updatedAt)
			VALUES (?, ?, NULL, ?, ?)`,
	)
		.bind(id, name, now(), now())
		.run();
	return id;
}

type SharedCampaign = {
	id: string;
	shareSlug: string;
};

async function createSharedCampaign(
	options: {
		name?: string;
		shareSlug?: string;
		shareIncludeReports?: boolean;
		shareRevokedAt?: string | null;
		briefPrompt?: string | null;
	} = {},
): Promise<SharedCampaign> {
	const campaign = {
		id: crypto.randomUUID(),
		name: options.name ?? "Aurora launch",
		shareSlug: options.shareSlug ?? SLUG_A,
		shareIncludeReports: options.shareIncludeReports ?? false,
		shareRevokedAt: options.shareRevokedAt ?? null,
		briefPrompt: options.briefPrompt ?? "Internal planning prompt SEED-XYZ",
		projectId: await createProjectRow(),
	};
	await env.DB.prepare(
		`INSERT INTO "Campaign"
			(id, name, briefPrompt, status, shareSlug, shareRevokedAt, shareIncludeReports, projectId, createdAt, updatedAt)
			VALUES (?, ?, ?, 'ready', ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			campaign.id,
			campaign.name,
			campaign.briefPrompt,
			campaign.shareSlug,
			campaign.shareRevokedAt,
			campaign.shareIncludeReports ? 1 : 0,
			campaign.projectId,
			now(),
			now(),
		)
		.run();
	return { id: campaign.id, shareSlug: campaign.shareSlug };
}

async function createBrief(
	campaignId: string,
	fields: Partial<{
		objective: string;
		audience: string;
		keyMessage: string;
		tone: string;
		channels: string;
		budget: string;
		kpis: string;
		body: string;
	}> = {},
): Promise<void> {
	const brief = {
		id: crypto.randomUUID(),
		objective: "Grow signups",
		audience: "Design leads",
		keyMessage: "Ship faster",
		tone: "Confident",
		channels: "email, X",
		budget: "$10k",
		kpis: "- Signups",
		body: "## Why now\n\n- momentum",
		...fields,
	};
	await env.DB.prepare(
		`INSERT INTO "CampaignBrief"
			(id, campaignId, objective, audience, keyMessage, tone, channels, budget, kpis, body, createdAt, updatedAt)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			brief.id,
			campaignId,
			brief.objective,
			brief.audience,
			brief.keyMessage,
			brief.tone,
			brief.channels,
			brief.budget,
			brief.kpis,
			brief.body,
			now(),
			now(),
		)
		.run();
}

async function createPlanWithPhase(options: {
	campaignId: string;
	planName?: string;
	planStatus?: string;
	phaseName?: string;
	phaseObjective?: string | null;
	startsAt?: string | null;
	endsAt?: string | null;
}): Promise<void> {
	const planId = crypto.randomUUID();
	const phaseId = crypto.randomUUID();
	await env.DB.prepare(
		`INSERT INTO "CampaignPlan" (id, campaignId, name, status, createdAt, updatedAt)
			VALUES (?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			planId,
			options.campaignId,
			options.planName ?? "Q1 launch plan",
			options.planStatus ?? "final",
			now(),
			now(),
		)
		.run();
	await env.DB.prepare(
		`INSERT INTO "PlanPhase" (id, planId, name, objective, startsAt, endsAt, position, body)
			VALUES (?, ?, ?, ?, ?, ?, 0, NULL)`,
	)
		.bind(
			phaseId,
			planId,
			options.phaseName ?? "Teaser",
			options.phaseObjective ?? "Warm up the list",
			options.startsAt ?? "2026-11-02T00:00:00.000Z",
			options.endsAt ?? "2026-11-30T00:00:00.000Z",
		)
		.run();
}

async function createCalendarEvent(options: {
	campaignId: string;
	title?: string;
	channel?: string | null;
	scheduledAt?: string | null;
	status?: string;
	notes?: string | null;
}): Promise<void> {
	await env.DB.prepare(
		`INSERT INTO "CalendarEvent"
			(id, campaignId, title, channel, scheduledAt, status, assetId, notes, createdAt, updatedAt)
			VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
	)
		.bind(
			crypto.randomUUID(),
			options.campaignId,
			options.title ?? "Launch email",
			options.channel ?? "email",
			options.scheduledAt ?? "2026-11-10T09:00:00.000Z",
			options.status ?? "planned",
			options.notes ?? "INTERNAL notes with secret sauce",
			now(),
			now(),
		)
		.run();
}

async function createReport(options: {
	campaignId: string;
	title?: string;
	summary?: string;
	metrics?: string;
	body?: string;
}): Promise<void> {
	await env.DB.prepare(
		`INSERT INTO "CampaignReport"
			(id, campaignId, title, periodStart, periodEnd, summary, metrics, body, createdAt, updatedAt)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			crypto.randomUUID(),
			options.campaignId,
			options.title ?? "Week 1 report",
			"2026-11-01T00:00:00.000Z",
			"2026-11-07T00:00:00.000Z",
			options.summary ?? "Strong opening week",
			options.metrics ?? "| KPI | Value |\n| --- | --- |\n| Signups | 1,240 |",
			options.body ?? "CONFIDENTIAL week one deep dive narrative",
			now(),
			now(),
		)
		.run();
}

async function createCampaignDesign(options: {
	campaignId: string;
	liveTurnId?: string | null;
	prompt?: string;
	withSiteHtml?: boolean;
}): Promise<string> {
	const design = {
		id: crypto.randomUUID(),
		prompt: options.prompt ?? "Launch deck",
		uploadToken: crypto.randomUUID(),
		liveTurnId: options.liveTurnId ?? null,
	};
	await env.DB.prepare(
		`INSERT INTO "Design"
			(id, prompt, uploadToken, status, liveTurnId, projectId, campaignId, createdAt, updatedAt)
			VALUES (?, ?, ?, 'ready', ?, NULL, ?, ?, ?)`,
	)
		.bind(
			design.id,
			design.prompt,
			design.uploadToken,
			design.liveTurnId,
			options.campaignId,
			now(),
			now(),
		)
		.run();
	if (options.withSiteHtml) {
		await env.DESIGNS.put(`designs/${design.id}/index.html`, "<p>site</p>", {
			httpMetadata: { contentType: "text/html" },
		});
	}
	return design.id;
}

async function getShareHtml(slug: string): Promise<{
	status: number;
	html: string;
	contentType: string | null;
}> {
	// No session cookie on purpose: the page is a public surface.
	const response = await startWorkerRequest(`/share/campaign/${slug}`);
	return {
		status: response.status,
		html: response.status === 200 ? await response.text() : "",
		contentType: response.headers.get("content-type"),
	};
}

describe("Public campaign share page", () => {
	it("renders the full snapshot for a valid slug without a session", async () => {
		const campaign = await createSharedCampaign({
			name: "Aurora launch",
			shareIncludeReports: true,
		});
		await createBrief(campaign.id);
		await createPlanWithPhase({
			campaignId: campaign.id,
			phaseName: "Teaser",
		});
		await createPlanWithPhase({
			campaignId: campaign.id,
			planName: "Q1 sustain plan",
			phaseName: "Sustain",
		});
		await createCalendarEvent({ campaignId: campaign.id });
		await createReport({ campaignId: campaign.id });
		const publishedId = await createCampaignDesign({
			campaignId: campaign.id,
			liveTurnId: crypto.randomUUID(),
			withSiteHtml: true,
		});
		// Filed to the campaign but never published — must not be embedded.
		await createCampaignDesign({ campaignId: campaign.id, liveTurnId: null });

		const { status, html, contentType } = await getShareHtml(SLUG_A);
		expect(status, html).toBe(200);
		expect(contentType).toContain("text/html");

		// Hero.
		expect(html).toContain("Aurora launch");
		expect(html).toContain("Nov 2, 2026");
		// Brief fields render; the internal planning prompt never does.
		expect(html).toContain("Grow signups");
		expect(html).toContain("Ship faster");
		expect(html).toContain("Design leads");
		expect(html).not.toContain("SEED-XYZ");
		// Plan phases.
		expect(html).toContain("Teaser");
		expect(html).toContain("Warm up the list");
		expect(html).toContain("Sustain");
		expect(html).toContain("Q1 sustain plan");
		// Public calendar: title/channel/date but no notes bodies.
		expect(html).toContain("Launch email");
		expect(html).toContain("email");
		expect(html).not.toContain("INTERNAL notes with secret sauce");
		// Live-interactive asset embed (not a screenshot).
		expect(html).toContain(`src="/designs/${publishedId}/site"`);
		expect(html).toMatch(
			/<iframe[^>]*sandbox="allow-scripts allow-forms allow-popups"/,
		);
		// Reports render when the owner opted in.
		expect(html).toContain("Week 1 report");
		expect(html).toContain("Strong opening week");
		expect(html).toContain("CONFIDENTIAL week one deep dive narrative");
		// No admin surface anywhere on the public page.
		expect(html).not.toContain("/admin");
	});

	it("404s for missing, malformed, revoked, and rotated-away slugs", async () => {
		expect((await getShareHtml(SLUG_Z)).status).toBe(404);
		expect((await getShareHtml("short")).status).toBe(404);
		expect((await getShareHtml("0OIl000000000000000000")).status).toBe(404);

		// Revoked: the slug is cleared and the revoke stamped — old link dead.
		await createSharedCampaign({ shareSlug: SLUG_B, shareRevokedAt: now() });
		expect((await getShareHtml(SLUG_B)).status).toBe(404);

		// Rotation: the old slug must die the moment a new one is written.
		const rotated = await createSharedCampaign({ shareSlug: SLUG_C });
		await env.DB.prepare(`UPDATE "Campaign" SET shareSlug = ? WHERE id = ?`)
			.bind("d".repeat(22), rotated.id)
			.run();
		expect((await getShareHtml(SLUG_C)).status).toBe(404);
		expect((await getShareHtml("d".repeat(22))).status).toBe(200);
	});

	it("hides reports (title, summary, metrics, body) unless opted in", async () => {
		const campaign = await createSharedCampaign({
			name: "Quiet campaign",
			shareIncludeReports: false,
		});
		await createReport({ campaignId: campaign.id });

		const { status, html } = await getShareHtml(SLUG_A);
		expect(status, html).toBe(200);
		expect(html).toContain("Quiet campaign");
		expect(html).not.toContain("Week 1 report");
		expect(html).not.toContain("Strong opening week");
		expect(html).not.toContain("CONFIDENTIAL week one deep dive narrative");
		expect(html).not.toContain("1,240");
	});

	it("embeds only published campaign assets as sandboxed iframes", async () => {
		const campaign = await createSharedCampaign();
		const publishedId = await createCampaignDesign({
			campaignId: campaign.id,
			liveTurnId: crypto.randomUUID(),
			withSiteHtml: true,
			prompt: "Published landing page",
		});
		const unpublishedId = await createCampaignDesign({
			campaignId: campaign.id,
			liveTurnId: null,
		});
		// A live design filed to a different campaign must not leak in.
		const other = await createSharedCampaign({ shareSlug: SLUG_B });
		const otherDesignId = await createCampaignDesign({
			campaignId: other.id,
			liveTurnId: crypto.randomUUID(),
			withSiteHtml: true,
		});

		const { status, html } = await getShareHtml(SLUG_A);
		expect(status, html).toBe(200);
		expect(html).toContain("Published landing page");
		expect(html).toContain(`src="/designs/${publishedId}/site"`);
		// No unpublished or foreign-campaign design reaches the page.
		expect(html).not.toContain(unpublishedId);
		expect(html).not.toContain(otherDesignId);
		expect(html).not.toMatch(/<iframe[^>]*sandbox=""/);
	});
});
