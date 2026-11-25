import { env } from "cloudflare:workers";
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

// Local fixtures — the studio document surface touches every campaign
// document table, so each insert helper is scoped here (shared fixtures.ts
// untouched).

async function insertPlan(
	campaignId: string,
	positions: number[] = [0, 1],
): Promise<{ planId: string; phaseIds: string[] }> {
	const planId = crypto.randomUUID();
	const now = new Date().toISOString();
	await env.DB.prepare(
		`INSERT INTO "CampaignPlan" (id, campaignId, name, status, createdAt, updatedAt)
			VALUES (?, ?, 'Q1 launch plan', 'draft', ?, ?)`,
	)
		.bind(planId, campaignId, now, now)
		.run();
	const phaseIds: string[] = [];
	for (const position of positions) {
		const phaseId = crypto.randomUUID();
		phaseIds.push(phaseId);
		await env.DB.prepare(
			`INSERT INTO "PlanPhase" (id, planId, name, position)
				VALUES (?, ?, ?, ?)`,
		)
			.bind(phaseId, planId, `phase-${position}`, position)
			.run();
	}
	return { planId, phaseIds };
}

async function insertEvent(campaignId: string): Promise<string> {
	const id = crypto.randomUUID();
	const now = new Date().toISOString();
	await env.DB.prepare(
		`INSERT INTO "CalendarEvent"
			(id, campaignId, title, channel, scheduledAt, status, createdAt, updatedAt)
			VALUES (?, ?, 'Launch email', 'email', '2026-03-02T09:00:00.000Z', 'planned', ?, ?)`,
	)
		.bind(id, campaignId, now, now)
		.run();
	return id;
}

async function insertReport(campaignId: string): Promise<string> {
	const id = crypto.randomUUID();
	const now = new Date().toISOString();
	await env.DB.prepare(
		`INSERT INTO "CampaignReport"
			(id, campaignId, title, body, createdAt, updatedAt)
			VALUES (?, ?, 'Week 1 recap', '## Week 1 body', ?, ?)`,
	)
		.bind(id, campaignId, now, now)
		.run();
	return id;
}

function adminClient(session: TestSession): TrpcTestClient {
	return createTrpcTestClient(session.headers);
}

afterEach(() => {
	vi.clearAllMocks();
	vi.restoreAllMocks();
});

describe("Start campaign document tRPC API (KUK-874)", () => {
	it("rejects anonymous and non-admin users on every documents verb", async () => {
		const campaignId = crypto.randomUUID();
		const anonymous = createTrpcTestClient();
		const nonAdmin = adminClient(await createUserSession("user"));
		for (const client of [anonymous, nonAdmin]) {
			const expected = client === anonymous ? "UNAUTHORIZED" : "FORBIDDEN";
			// GET /campaigns/:id/documents?reportId= → documents.getReport
			expect(
				await trpcErrorCode(() =>
					client.campaigns.documents.getReport.query({
						campaignId,
						reportId: "r",
					}),
				),
			).toBe(expected);
			// PATCH kind=brief → documents.saveBrief
			expect(
				await trpcErrorCode(() =>
					client.campaigns.documents.saveBrief.mutate({
						campaignId,
						fields: { objective: "x" },
					}),
				),
			).toBe(expected);
			// POST kind=plan → documents.createPlan
			expect(
				await trpcErrorCode(() =>
					client.campaigns.documents.createPlan.mutate({
						campaignId,
						name: "x",
					}),
				),
			).toBe(expected);
			// DELETE kind=event → documents.delete
			expect(
				await trpcErrorCode(() =>
					client.campaigns.documents.delete.mutate({
						campaignId,
						kind: "event",
						id: "x",
					}),
				),
			).toBe(expected);
		}
	});

	it("rejects invalid campaign ids and 404s unknown campaigns on every verb", async () => {
		const session = await createAdminSession();
		const client = adminClient(session);
		const missing = crypto.randomUUID();
		const verbs = {
			// GET ?reportId= → documents.getReport
			get: () =>
				client.campaigns.documents.getReport.query({
					campaignId: "not-a-uuid",
					reportId: "r",
				}),
			// PATCH kind=brief → documents.saveBrief
			patch: () =>
				client.campaigns.documents.saveBrief.mutate({
					campaignId: "not-a-uuid",
					fields: { objective: "x" },
				}),
			// POST kind=plan → documents.createPlan
			post: () =>
				client.campaigns.documents.createPlan.mutate({
					campaignId: "not-a-uuid",
					name: "x",
				}),
			// DELETE kind=event → documents.delete
			delete: () =>
				client.campaigns.documents.delete.mutate({
					campaignId: "not-a-uuid",
					kind: "event",
					id: "x",
				}),
		};
		for (const call of Object.values(verbs)) {
			expect(await trpcErrorCode(call)).toBe("BAD_REQUEST");
			expect(await trpcErrorMessage(call)).toBe("invalid campaign id");
		}
		const missingVerbs = {
			get: () =>
				client.campaigns.documents.getReport.query({
					campaignId: missing,
					reportId: "r",
				}),
			patch: () =>
				client.campaigns.documents.saveBrief.mutate({
					campaignId: missing,
					fields: { objective: "x" },
				}),
			post: () =>
				client.campaigns.documents.createPlan.mutate({
					campaignId: missing,
					name: "x",
				}),
			delete: () =>
				client.campaigns.documents.delete.mutate({
					campaignId: missing,
					kind: "event",
					id: "x",
				}),
		};
		for (const call of Object.values(missingVerbs)) {
			expect(await trpcErrorCode(call)).toBe("NOT_FOUND");
			expect(await trpcErrorMessage(call)).toBe("not found");
		}
	});

	it("upserts the brief: first save creates, later save merges, null clears", async () => {
		const campaign = await createCampaign();
		const client = adminClient(await createAdminSession());

		// No brief row yet — first save creates it.
		const created = (await client.campaigns.documents.saveBrief.mutate({
			campaignId: campaign.id,
			fields: { objective: "Win January", budget: "$15k" },
		})) as {
			objective: string | null;
			budget: string | null;
			audience: string | null;
		};
		expect(created.objective).toBe("Win January");
		expect(created.budget).toBe("$15k");
		// Untouched fields stay null — this was a create.
		expect(created.audience).toBeNull();

		// Second save merges only the provided fields.
		const merged = (await client.campaigns.documents.saveBrief.mutate({
			campaignId: campaign.id,
			fields: { audience: "Design engineers", objective: null },
		})) as {
			audience: string | null;
			budget: string | null;
			objective: string | null;
		};
		expect(merged.audience).toBe("Design engineers");
		expect(merged.budget).toBe("$15k");
		// Explicit null clears a field.
		expect(merged.objective).toBeNull();

		expect(
			await trpcErrorCode(() =>
				client.campaigns.documents.saveBrief.mutate({
					campaignId: campaign.id,
					fields: {},
				}),
			),
		).toBe("BAD_REQUEST");
	});

	it("creates plans, phases (appended by position), events and reports; validates bodies", async () => {
		const campaign = await createCampaign();
		const client = adminClient(await createAdminSession());

		const planRow = (await client.campaigns.documents.createPlan.mutate({
			campaignId: campaign.id,
			name: "  Q1 launch plan  ",
		})) as { id: string; name: string };
		expect(planRow.name).toBe("Q1 launch plan");

		// First phase lands at position 0, second appends at 1.
		const phaseARow = (await client.campaigns.documents.addPhase.mutate({
			campaignId: campaign.id,
			planId: planRow.id,
			name: "Teaser week",
		})) as { id: string; position: number };
		expect(phaseARow.position).toBe(0);
		const phaseBRow = (await client.campaigns.documents.addPhase.mutate({
			campaignId: campaign.id,
			planId: planRow.id,
			name: "Launch week",
			startsAt: "2026-03-02",
		})) as { id: string; position: number };
		expect(phaseBRow.position).toBe(1);
		// The date round-trips as a stored datetime.
		const storedPhase = await env.DB.prepare(
			'SELECT startsAt FROM "PlanPhase" WHERE id = ?',
		)
			.bind(phaseBRow.id)
			.first<{ startsAt: string }>();
		expect(storedPhase?.startsAt).toContain("2026-03-02");

		const eventRow = (await client.campaigns.documents.createEvent.mutate({
			campaignId: campaign.id,
			title: "Launch email",
			status: "scheduled",
		})) as { status: string; channel: string | null };
		expect(eventRow.status).toBe("scheduled");
		expect(eventRow.channel).toBeNull();

		const reportRow = (await client.campaigns.documents.createReport.mutate({
			campaignId: campaign.id,
			title: "Week 1 recap",
			body: "## Recap",
			periodStart: "2026-03-02",
			periodEnd: "2026-03-08",
		})) as { body: string };
		expect(reportRow.body).toBe("## Recap");

		// Invalid bodies: missing required fields, bad dates, unknown statuses.
		// (The old route's unknown-kind case — POST { kind: "spreadsheet" } —
		// is not expressible on the semantic tRPC surface.)
		const invalidBodies: Array<[string, () => Promise<unknown>]> = [
			[
				"plan without a name",
				() =>
					client.campaigns.documents.createPlan.mutate({
						campaignId: campaign.id,
					} as never),
			],
			[
				"phase without a name",
				() =>
					client.campaigns.documents.addPhase.mutate({
						campaignId: campaign.id,
						planId: planRow.id,
					} as never),
			],
			[
				"event with an empty title",
				() =>
					client.campaigns.documents.createEvent.mutate({
						campaignId: campaign.id,
						title: "",
					} as never),
			],
			[
				"report without a body",
				() =>
					client.campaigns.documents.createReport.mutate({
						campaignId: campaign.id,
						title: "x",
					} as never),
			],
			[
				"event with a bad date",
				() =>
					client.campaigns.documents.createEvent.mutate({
						campaignId: campaign.id,
						title: "x",
						scheduledAt: "not-a-date",
					} as never),
			],
			[
				"plan with an unknown status",
				() =>
					client.campaigns.documents.createPlan.mutate({
						campaignId: campaign.id,
						name: "x",
						status: "archived",
					} as never),
			],
			[
				"event with an unknown status",
				() =>
					client.campaigns.documents.createEvent.mutate({
						campaignId: campaign.id,
						title: "x",
						status: "archived",
					} as never),
			],
		];
		for (const [label, call] of invalidBodies) {
			expect(await trpcErrorCode(call), label).toBe("BAD_REQUEST");
		}
		// Patch counterparts: a plan patch with no fields, an event patch
		// without an event id.
		expect(
			await trpcErrorCode(() =>
				client.campaigns.documents.updatePlan.mutate({
					campaignId: campaign.id,
					planId: planRow.id,
				} as never),
			),
		).toBe("BAD_REQUEST");
		expect(
			await trpcErrorCode(() =>
				client.campaigns.documents.updateEvent.mutate({
					campaignId: campaign.id,
				} as never),
			),
		).toBe("BAD_REQUEST");
	});

	it("patches phases and renumbers the plan around a position move", async () => {
		const campaign = await createCampaign();
		const { planId, phaseIds } = await insertPlan(campaign.id, [0, 1, 2]);
		const client = adminClient(await createAdminSession());

		// Position-only move (what the plan panel's ↑/↓ buttons send — no
		// field patch alongside) must not trip an empty Prisma update.
		await client.campaigns.documents.updatePhase.mutate({
			campaignId: campaign.id,
			phaseId: phaseIds[2],
			position: 0,
		});
		let rows = await env.DB.prepare(
			'SELECT id, position FROM "PlanPhase" WHERE "planId" = ? ORDER BY position ASC',
		)
			.bind(planId)
			.all<{ id: string; position: number }>();
		expect(rows.results.map((row) => row.id)).toEqual([
			phaseIds[2],
			phaseIds[0],
			phaseIds[1],
		]);
		expect(rows.results.map((row) => row.position)).toEqual([0, 1, 2]);

		await client.campaigns.documents.updatePhase.mutate({
			campaignId: campaign.id,
			phaseId: phaseIds[0],
			position: 2,
			name: "Renamed phase",
		});
		rows = await env.DB.prepare(
			'SELECT id, position FROM "PlanPhase" WHERE "planId" = ? ORDER BY position ASC',
		)
			.bind(planId)
			.all<{ id: string; position: number }>();
		// After the first move the plan is [2, 0, 1]; moving phase 0 to the
		// end yields [2, 1, 0], renumbered 0..2.
		expect(rows.results.map((row) => row.id)).toEqual([
			phaseIds[2],
			phaseIds[1],
			phaseIds[0],
		]);
		expect(rows.results.map((row) => row.position)).toEqual([0, 1, 2]);
		const renamed = rows.results.find((row) => row.id === phaseIds[0]);
		const nameRow = await env.DB.prepare(
			'SELECT name FROM "PlanPhase" WHERE id = ?',
		)
			.bind(phaseIds[0])
			.first<{ name: string }>();
		expect(nameRow?.name).toBe("Renamed phase");
		expect(renamed).toBeDefined();
	});

	it("fences plan, phase, event and report ids to the campaign with BAD_REQUESTs", async () => {
		const campaign = await createCampaign();
		const other = await createCampaign();
		const { planId, phaseIds } = await insertPlan(other.id);
		const eventId = await insertEvent(other.id);
		const reportId = await insertReport(other.id);
		const client = adminClient(await createAdminSession());

		const crossPlan = () =>
			client.campaigns.documents.updatePlan.mutate({
				campaignId: campaign.id,
				planId,
				name: "hijack",
			});
		expect(await trpcErrorCode(crossPlan)).toBe("BAD_REQUEST");
		expect(await trpcErrorMessage(crossPlan)).toBe(
			`plan ${planId} does not belong to this campaign`,
		);

		const crossPhaseCreate = () =>
			client.campaigns.documents.addPhase.mutate({
				campaignId: campaign.id,
				planId,
				name: "smuggled phase",
			});
		expect(await trpcErrorCode(crossPhaseCreate)).toBe("BAD_REQUEST");

		const crossPhasePatch = () =>
			client.campaigns.documents.updatePhase.mutate({
				campaignId: campaign.id,
				phaseId: phaseIds[0],
				name: "hijack",
			});
		expect(await trpcErrorCode(crossPhasePatch)).toBe("BAD_REQUEST");

		const unknownPhase = () =>
			client.campaigns.documents.updatePhase.mutate({
				campaignId: campaign.id,
				phaseId: crypto.randomUUID(),
				name: "ghost",
			});
		expect(await trpcErrorCode(unknownPhase)).toBe("BAD_REQUEST");

		const crossEvent = () =>
			client.campaigns.documents.updateEvent.mutate({
				campaignId: campaign.id,
				eventId,
				title: "hijack",
			});
		expect(await trpcErrorCode(crossEvent)).toBe("BAD_REQUEST");

		const crossReport = () =>
			client.campaigns.documents.updateReport.mutate({
				campaignId: campaign.id,
				reportId,
				title: "hijack",
			});
		expect(await trpcErrorCode(crossReport)).toBe("BAD_REQUEST");

		const crossReportGet = () =>
			client.campaigns.documents.getReport.query({
				campaignId: campaign.id,
				reportId,
			});
		expect(await trpcErrorCode(crossReportGet)).toBe("BAD_REQUEST");

		const crossDelete = () =>
			client.campaigns.documents.delete.mutate({
				campaignId: campaign.id,
				kind: "event",
				id: eventId,
			});
		expect(await trpcErrorCode(crossDelete)).toBe("BAD_REQUEST");

		// Nothing was written into the other campaign's rows.
		const untouched = await env.DB.prepare(
			'SELECT title FROM "CalendarEvent" WHERE id = ?',
		)
			.bind(eventId)
			.first<{ title: string }>();
		expect(untouched?.title).toBe("Launch email");
	});

	it("patches plans and events with field-level clears", async () => {
		const campaign = await createCampaign();
		const { planId } = await insertPlan(campaign.id);
		const eventId = await insertEvent(campaign.id);
		const client = adminClient(await createAdminSession());

		const plan = (await client.campaigns.documents.updatePlan.mutate({
			campaignId: campaign.id,
			planId,
			status: "final",
		})) as { status: string };
		expect(plan.status).toBe("final");

		const event = (await client.campaigns.documents.updateEvent.mutate({
			campaignId: campaign.id,
			eventId,
			status: "published",
			channelId: null,
			scheduledAt: null,
		})) as {
			status: string;
			channel: string | null;
			channelId: string | null;
			scheduledAt: string | null;
		};
		expect(event.status).toBe("published");
		// channelId clears, but the legacy free-text column is kept — it is
		// deprecated and no longer written by any surface (KUK-890).
		expect(event.channel).toBe("email");
		expect(event.channelId).toBeNull();
		expect(event.scheduledAt).toBeNull();
	});

	it("serves a full report through getReport and deletes fenced rows", async () => {
		const campaign = await createCampaign();
		const reportId = await insertReport(campaign.id);
		const { phaseIds } = await insertPlan(campaign.id);
		const eventId = await insertEvent(campaign.id);
		const client = adminClient(await createAdminSession());

		const report = await client.campaigns.documents.getReport.query({
			campaignId: campaign.id,
			reportId,
		});
		expect(report).toMatchObject({
			title: "Week 1 recap",
			body: "## Week 1 body",
			metrics: null,
		});

		// The old GET without ?reportId= → 400; the procedure requires the id.
		expect(
			await trpcErrorCode(() =>
				client.campaigns.documents.getReport.query({
					campaignId: campaign.id,
					reportId: "",
				}),
			),
		).toBe("BAD_REQUEST");

		await client.campaigns.documents.delete.mutate({
			campaignId: campaign.id,
			kind: "event",
			id: eventId,
		});
		await client.campaigns.documents.delete.mutate({
			campaignId: campaign.id,
			kind: "phase",
			id: phaseIds[0],
		});
		await client.campaigns.documents.delete.mutate({
			campaignId: campaign.id,
			kind: "report",
			id: reportId,
		});

		const eventCount = await env.DB.prepare(
			'SELECT COUNT(*) AS count FROM "CalendarEvent" WHERE "campaignId" = ?',
		)
			.bind(campaign.id)
			.first<{ count: number }>();
		expect(eventCount?.count).toBe(0);
		const phaseCount = await env.DB.prepare(
			'SELECT COUNT(*) AS count FROM "PlanPhase" WHERE id = ?',
		)
			.bind(phaseIds[0])
			.first<{ count: number }>();
		expect(phaseCount?.count).toBe(0);
		const reportCount = await env.DB.prepare(
			'SELECT COUNT(*) AS count FROM "CampaignReport" WHERE id = ?',
		)
			.bind(reportId)
			.first<{ count: number }>();
		expect(reportCount?.count).toBe(0);
	});

	it("deleting a plan removes its phases", async () => {
		const campaign = await createCampaign();
		const { planId } = await insertPlan(campaign.id);
		const client = adminClient(await createAdminSession());
		await client.campaigns.documents.delete.mutate({
			campaignId: campaign.id,
			kind: "plan",
			id: planId,
		});
		const phases = await env.DB.prepare(
			'SELECT COUNT(*) AS count FROM "PlanPhase" WHERE "planId" = ?',
		)
			.bind(planId)
			.first<{ count: number }>();
		expect(phases?.count).toBe(0);
		const plans = await env.DB.prepare(
			'SELECT COUNT(*) AS count FROM "CampaignPlan" WHERE id = ?',
		)
			.bind(planId)
			.first<{ count: number }>();
		expect(plans?.count).toBe(0);
	});

	it("rejects delete bodies without a known kind or id", async () => {
		const campaign = await createCampaign();
		const client = adminClient(await createAdminSession());
		for (const body of [
			{ campaignId: campaign.id, kind: "brief", id: crypto.randomUUID() },
			{ campaignId: campaign.id, kind: "event" },
		]) {
			expect(
				await trpcErrorCode(() =>
					client.campaigns.documents.delete.mutate(body as never),
				),
			).toBe("BAD_REQUEST");
		}
	});
});
