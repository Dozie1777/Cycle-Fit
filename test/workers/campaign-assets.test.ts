// Worker tests for campaign asset creation & calendar linking (KUK-871):
// the campaigns.createAsset/listAssets tRPC procedures, the
// campaigns.updateEventSlot attach/detach procedure (the old PATCH
// /campaigns/:id/events/:eventId route), and the campaign chat's
// create_asset/list_assets tools. Covers seeding (distilled context,
// never raw transcripts), the campaign fence (cross-campaign ids →
// BAD_REQUEST/tool error, never silent) and the campaign-delete SetNull
// detach.
//
// Harness mirrors test/workers/campaigns.test.ts (typed tRPC client over
// the real worker); the chat-tool harness mirrors
// test/workers/campaign-document-tools.test.ts (one mock model tool call
// through the real `campaignChat` RivetKit actor). All extra fixtures are
// defined locally instead of extending test/helpers/fixtures.ts.
import { env } from "cloudflare:workers";
import { createMCPClient } from "@ai-sdk/mcp";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { MockLanguageModelV3 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkersAI } from "workers-ai-provider";
import {
	createAdminSession,
	createUserSession,
	type TestSession,
} from "../helpers/auth";
import { runCampaignActorTurn } from "../helpers/campaign-actor-turn";
import { createCampaign, createDesign } from "../helpers/fixtures";
import {
	createTrpcTestClient,
	type TrpcTestClient,
	trpcErrorCode,
	trpcErrorMessage,
} from "../helpers/trpc";

vi.mock("@ai-sdk/mcp", () => ({ createMCPClient: vi.fn() }));
vi.mock("workers-ai-provider", () => ({ createWorkersAI: vi.fn() }));

const usage = {
	inputTokens: {
		total: 0,
		noCache: 0,
		cacheRead: 0,
		cacheWrite: 0,
	},
	outputTokens: { total: 0, text: 0, reasoning: 0 },
};

// Local fixtures.

async function insertBrief(
	campaignId: string,
	fields: { objective?: string; body?: string } = {},
): Promise<void> {
	const now = new Date().toISOString();
	await env.DB.prepare(
		`INSERT INTO "CampaignBrief" (id, campaignId, objective, body, createdAt, updatedAt)
			VALUES (?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			crypto.randomUUID(),
			campaignId,
			fields.objective ?? null,
			fields.body ?? null,
			now,
			now,
		)
		.run();
}

async function insertPlan(
	campaignId: string,
	phases: string[],
): Promise<string> {
	const planId = crypto.randomUUID();
	const now = new Date().toISOString();
	await env.DB.prepare(
		`INSERT INTO "CampaignPlan" (id, campaignId, name, status, createdAt, updatedAt)
			VALUES (?, ?, ?, 'draft', ?, ?)`,
	)
		.bind(planId, campaignId, "Q1 launch plan", now, now)
		.run();
	for (const [position, name] of phases.entries()) {
		await env.DB.prepare(
			`INSERT INTO "PlanPhase" (id, planId, name, position) VALUES (?, ?, ?, ?)`,
		)
			.bind(crypto.randomUUID(), planId, name, position)
			.run();
	}
	return planId;
}

async function insertEvent(
	campaignId: string,
	assetId?: string,
): Promise<string> {
	const id = crypto.randomUUID();
	const now = new Date().toISOString();
	await env.DB.prepare(
		`INSERT INTO "CalendarEvent"
			(id, campaignId, title, channel, status, assetId, createdAt, updatedAt)
			VALUES (?, ?, ?, 'email', 'planned', ?, ?, ?)`,
	)
		.bind(id, campaignId, "Launch email", assetId ?? null, now, now)
		.run();
	return id;
}

/** Attaches a design row to a campaign as a generated asset. */
async function attachDesign(
	campaignId: string,
	options: { liveTurnId?: string } = {},
): Promise<string> {
	const campaign = await env.DB.prepare(
		'SELECT projectId FROM "Campaign" WHERE id = ?',
	)
		.bind(campaignId)
		.first<{ projectId: string }>();
	const design = await createDesign({ projectId: campaign?.projectId });
	await env.DB.prepare(
		`UPDATE "Design" SET campaignId = ?, liveTurnId = COALESCE(?, liveTurnId) WHERE id = ?`,
	)
		.bind(campaignId, options.liveTurnId ?? null, design.id)
		.run();
	return design.id;
}

function adminClient(session: TestSession): TrpcTestClient {
	return createTrpcTestClient(session.headers);
}

// Chat-tool harness (mirrors campaign-document-tools.test.ts).

function immediateTextStream(
	text: string,
): ReadableStream<LanguageModelV3StreamPart> {
	return new ReadableStream({
		start(controller) {
			const chunks: LanguageModelV3StreamPart[] = [
				{ type: "stream-start", warnings: [] },
				{
					type: "response-metadata",
					id: "response-id",
					modelId: "test-model",
					timestamp: new Date(0),
				},
				{ type: "text-start", id: "text-id" },
				{ type: "text-delta", id: "text-id", delta: text },
				{ type: "text-end", id: "text-id" },
				{
					type: "finish",
					finishReason: { unified: "stop", raw: undefined },
					usage,
				},
			];
			for (const chunk of chunks) {
				controller.enqueue(chunk);
			}
			controller.close();
		},
	});
}

/** Mock model: step 1 emits one tool call, step 2 finishes with text. */
function toolCallModel(toolName: string, input: unknown) {
	let step = 0;
	return new MockLanguageModelV3({
		doStream: async () => {
			step += 1;
			if (step > 1) return { stream: immediateTextStream("done") };
			return {
				stream: new ReadableStream<LanguageModelV3StreamPart>({
					start(controller) {
						controller.enqueue({ type: "stream-start", warnings: [] });
						controller.enqueue({
							type: "tool-call",
							toolCallId: "tool-call-1",
							toolName,
							input: JSON.stringify(input),
						});
						controller.enqueue({
							type: "finish",
							finishReason: { unified: "tool-calls", raw: undefined },
							usage,
						});
						controller.close();
					},
				}),
			};
		},
	});
}

function installToolCallModel(toolName: string, input: unknown) {
	const model = toolCallModel(toolName, input);
	const factory = vi.fn(() => model);
	vi.mocked(createWorkersAI).mockReturnValue(factory as never);
	return { model, factory };
}

function mockMcpClient() {
	const client = {
		tools: vi.fn(async () => ({})),
		close: vi.fn(async () => {}),
	};
	vi.mocked(createMCPClient).mockResolvedValue(client as never);
	return client;
}

/** Runs one chat turn that calls one tool and returns the emitted chunk JSON. */
async function runToolTurn(
	toolName: string,
	input: unknown,
	campaignId: string,
) {
	installToolCallModel(toolName, input);
	const turn = await runCampaignActorTurn(campaignId, {
		message: "do that",
	});
	return turn.wire;
}

async function campaignState(campaignId: string) {
	return env.DB.prepare('SELECT status, error FROM "Campaign" WHERE id = ?')
		.bind(campaignId)
		.first();
}

beforeEach(() => {
	mockMcpClient();
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("Campaign asset tRPC procedures", () => {
	it("createAsset seeds a design filed in the campaign's project with distilled context", async () => {
		const campaign = await createCampaign({ name: "Spring launch" });
		await insertBrief(campaign.id, {
			objective: "Launch the spring collection",
			// Raw transcript-style body: must NOT leak into the asset prompt.
			body: "RAW-BODY-MARKER full freeform prose transcript".repeat(50),
		});
		await insertPlan(campaign.id, ["Teaser", "Launch week"]);

		const client = adminClient(await createAdminSession());
		const created = await client.campaigns.createAsset.mutate({
			campaignId: campaign.id,
			name: "  Launch deck  ",
		});
		expect(created.assetId).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
		);
		expect(created.studioUrl).toBe(`/studio/${created.assetId}`);

		const row = await env.DB.prepare(
			'SELECT prompt, projectId, campaignId, uploadToken, status FROM "Design" WHERE id = ?',
		)
			.bind(created.assetId)
			.first<{
				prompt: string;
				projectId: string;
				campaignId: string;
				uploadToken: string | null;
				status: string;
			}>();
		expect(row).toMatchObject({
			projectId: campaign.projectId,
			campaignId: campaign.id,
			uploadToken: null,
			status: "ready",
		});
		expect(row?.prompt).toContain("Launch deck");
		expect(row?.prompt).toContain("Launch the spring collection");
		expect(row?.prompt).toContain("Teaser");
		expect(row?.prompt).toContain("Spring launch");
		// Distilled: the brief's raw body never reaches the asset prompt.
		expect(row?.prompt).not.toContain("RAW-BODY-MARKER");
		expect(row?.prompt.length).toBeLessThanOrEqual(3600);
	});

	it("createAsset without a seed defaults the prompt to the campaign name", async () => {
		const campaign = await createCampaign({ name: "Unseeded campaign" });
		const client = adminClient(await createAdminSession());
		const created = await client.campaigns.createAsset.mutate({
			campaignId: campaign.id,
		});
		expect(created.prompt).toContain("Unseeded campaign");
	});

	it("createAsset rejects invalid ids, unknown campaigns and invalid bodies", async () => {
		const campaign = await createCampaign();
		const client = adminClient(await createAdminSession());

		const invalidId = () =>
			client.campaigns.createAsset.mutate({ campaignId: "not-a-uuid" });
		expect(await trpcErrorCode(invalidId)).toBe("BAD_REQUEST");
		expect(await trpcErrorMessage(invalidId)).toBe("invalid campaign id");

		const missing = () =>
			client.campaigns.createAsset.mutate({
				campaignId: crypto.randomUUID(),
			});
		expect(await trpcErrorCode(missing)).toBe("NOT_FOUND");
		expect(await trpcErrorMessage(missing)).toBe("not found");

		const badBody = () =>
			client.campaigns.createAsset.mutate({
				campaignId: campaign.id,
				name: "",
			});
		expect(await trpcErrorCode(badBody)).toBe("BAD_REQUEST");
	});

	it("listAssets lists this campaign's assets with publish state, newest first", async () => {
		const campaign = await createCampaign();
		const other = await createCampaign();
		const first = await attachDesign(campaign.id);
		// The list is ordered by createdAt desc; two fixtures can land in the
		// same millisecond and flip the tie (D1 then lists the older insertion
		// first). Backdate one so the order is deterministic — same mitigation
		// as the campaigns list test.
		await env.DB.prepare('UPDATE "Design" SET createdAt = ? WHERE id = ?')
			.bind(new Date(Date.now() - 60_000).toISOString(), first)
			.run();
		const published = await attachDesign(campaign.id, {
			liveTurnId: "live-turn-1",
		});
		await attachDesign(other.id); // another campaign's asset — not listed
		const client = adminClient(await createAdminSession());

		const rows = await client.campaigns.listAssets.query({
			campaignId: campaign.id,
		});
		expect(rows.map((row) => row.id)).toEqual([published, first]);
		for (const row of rows) {
			expect(row.campaignId).toBe(campaign.id);
			expect(row.projectId).toBe(campaign.projectId);
			expect(row.status).toBe("ready");
			expect(Object.keys(row).sort()).toEqual([
				"campaignId",
				"createdAt",
				"id",
				"projectId",
				"prompt",
				"published",
				"status",
			]);
		}
		expect(rows.find((row) => row.id === published)?.published).toBe(true);
		expect(rows.find((row) => row.id === first)?.published).toBe(false);

		const invalid = () =>
			client.campaigns.listAssets.query({ campaignId: "not-a-uuid" });
		expect(await trpcErrorCode(invalid)).toBe("BAD_REQUEST");
		expect(await trpcErrorMessage(invalid)).toBe("invalid campaign id");
		const missing = () =>
			client.campaigns.listAssets.query({
				campaignId: crypto.randomUUID(),
			});
		expect(await trpcErrorCode(missing)).toBe("NOT_FOUND");
		expect(await trpcErrorMessage(missing)).toBe("not found");
	});

	it("updateEventSlot attaches and detaches this campaign's assets to calendar events", async () => {
		const campaign = await createCampaign();
		const assetId = await attachDesign(campaign.id);
		const unattached = await createDesign({ projectId: campaign.projectId });
		const eventId = await insertEvent(campaign.id);
		const client = adminClient(await createAdminSession());

		await client.campaigns.updateEventSlot.mutate({
			campaignId: campaign.id,
			eventId,
			assetId,
		});
		expect(
			await env.DB.prepare('SELECT assetId FROM "CalendarEvent" WHERE id = ?')
				.bind(eventId)
				.first(),
		).toEqual({ assetId });

		// An unattached design of the same project may be attached too.
		await client.campaigns.updateEventSlot.mutate({
			campaignId: campaign.id,
			eventId,
			assetId: unattached.id,
		});
		expect(
			await env.DB.prepare('SELECT assetId FROM "CalendarEvent" WHERE id = ?')
				.bind(eventId)
				.first(),
		).toEqual({ assetId: unattached.id });

		// Detach with an explicit null.
		await client.campaigns.updateEventSlot.mutate({
			campaignId: campaign.id,
			eventId,
			assetId: null,
		});
		expect(
			await env.DB.prepare('SELECT assetId FROM "CalendarEvent" WHERE id = ?')
				.bind(eventId)
				.first(),
		).toEqual({ assetId: null });
		// The design itself is untouched by attach/detach.
		const designRow = await env.DB.prepare(
			'SELECT campaignId, projectId FROM "Design" WHERE id = ?',
		)
			.bind(assetId)
			.first();
		expect(designRow).toEqual({
			campaignId: campaign.id,
			projectId: campaign.projectId,
		});
	});

	it("updateEventSlot fences assets and events to this campaign", async () => {
		const campaign = await createCampaign();
		const other = await createCampaign();
		const foreignAsset = await attachDesign(other.id);
		const foreignEvent = await insertEvent(other.id);
		const ownEvent = await insertEvent(campaign.id);
		const client = adminClient(await createAdminSession());

		const crossAsset = () =>
			client.campaigns.updateEventSlot.mutate({
				campaignId: campaign.id,
				eventId: ownEvent,
				assetId: foreignAsset,
			});
		expect(await trpcErrorCode(crossAsset)).toBe("BAD_REQUEST");
		expect(await trpcErrorMessage(crossAsset)).toBe(
			"asset does not belong to this campaign",
		);
		// The foreign event row and the foreign asset stay untouched.
		expect(
			await env.DB.prepare('SELECT assetId FROM "CalendarEvent" WHERE id = ?')
				.bind(ownEvent)
				.first(),
		).toEqual({ assetId: null });

		const unknownAsset = () =>
			client.campaigns.updateEventSlot.mutate({
				campaignId: campaign.id,
				eventId: ownEvent,
				assetId: crypto.randomUUID(),
			});
		expect(await trpcErrorCode(unknownAsset)).toBe("NOT_FOUND");
		expect(await trpcErrorMessage(unknownAsset)).toBe("asset not found");

		const crossEvent = () =>
			client.campaigns.updateEventSlot.mutate({
				campaignId: campaign.id,
				eventId: foreignEvent,
				title: "Hijacked",
			});
		expect(await trpcErrorCode(crossEvent)).toBe("BAD_REQUEST");
		expect(await trpcErrorMessage(crossEvent)).toBe(
			"event does not belong to this campaign",
		);
		const foreignRow = await env.DB.prepare(
			'SELECT title FROM "CalendarEvent" WHERE id = ?',
		)
			.bind(foreignEvent)
			.first();
		expect(foreignRow).toEqual({ title: "Launch email" });

		const unknownEvent = () =>
			client.campaigns.updateEventSlot.mutate({
				campaignId: campaign.id,
				eventId: crypto.randomUUID(),
				title: "Nowhere",
			});
		expect(await trpcErrorCode(unknownEvent)).toBe("NOT_FOUND");
		expect(await trpcErrorMessage(unknownEvent)).toBe("not found");

		const invalidCampaign = () =>
			client.campaigns.updateEventSlot.mutate({
				campaignId: "not-a-uuid",
				eventId: ownEvent,
				title: "x",
			});
		expect(await trpcErrorCode(invalidCampaign)).toBe("BAD_REQUEST");
		expect(await trpcErrorMessage(invalidCampaign)).toBe("invalid campaign id");
	});

	it("updateEventSlot edits event fields (title, channelId, scheduledAt, status, notes)", async () => {
		const campaign = await createCampaign();
		const eventId = await insertEvent(campaign.id);
		// KUK-890: channels link by enumerated id — create one and link it.
		// (The standard channels are seeded by the migration, so use a
		// non-standard name to avoid the unique-name constraint.)
		const channelId = crypto.randomUUID();
		const now = new Date().toISOString();
		await env.DB.prepare(
			'INSERT INTO "Channel" (id, name, color, createdAt) VALUES (?, ?, ?, ?)',
		)
			.bind(channelId, "Seasonal push", "#f97316", now)
			.run();
		const client = adminClient(await createAdminSession());
		await client.campaigns.updateEventSlot.mutate({
			campaignId: campaign.id,
			eventId,
			title: "  Launch email 2  ",
			channelId,
			scheduledAt: "2026-03-09T09:00:00Z",
			status: "scheduled",
			notes: "CTA: early access",
		});
		const row = await env.DB.prepare(
			`SELECT e.title, e.channel, e.channelId, c.name as linkedName, e.scheduledAt, e.status, e.notes
				FROM "CalendarEvent" e LEFT JOIN "Channel" c ON c.id = e.channelId
				WHERE e.id = ?`,
		)
			.bind(eventId)
			.first();
		// Prisma's D1 adapter normalizes stored datetimes to +00:00.
		expect(row).toEqual({
			title: "Launch email 2",
			// Legacy text is kept (deprecated, no longer written).
			channel: "email",
			channelId,
			linkedName: "Seasonal push",
			scheduledAt: "2026-03-09T09:00:00.000+00:00",
			status: "scheduled",
			notes: "CTA: early access",
		});

		// Unknown channel id: rejected with the available names, nothing written.
		const unknown = () =>
			client.campaigns.updateEventSlot.mutate({
				campaignId: campaign.id,
				eventId,
				channelId: "chan-nope",
			});
		expect(await trpcErrorCode(unknown)).toBe("BAD_REQUEST");
		const message = await trpcErrorMessage(unknown);
		expect(message).toContain("chan-nope");
		expect(message).toContain("Seasonal push");
	});

	it.each([
		{},
		{ title: "" },
		{ title: "x".repeat(201) },
		{ status: "archived" },
		{ scheduledAt: "not-a-date" },
		{ assetId: "not-a-uuid" },
		{ assetId: 42 },
	])("updateEventSlot rejects invalid bodies %#", async (body) => {
		const campaign = await createCampaign();
		const eventId = await insertEvent(campaign.id);
		const client = adminClient(await createAdminSession());
		expect(
			await trpcErrorCode(() =>
				client.campaigns.updateEventSlot.mutate({
					campaignId: campaign.id,
					eventId,
					...body,
				} as never),
			),
		).toBe("BAD_REQUEST");
	});

	it("deleting the campaign detaches seeded assets and leaves them filed (SetNull)", async () => {
		const campaign = await createCampaign();
		const client = adminClient(await createAdminSession());
		const created = await client.campaigns.createAsset.mutate({
			campaignId: campaign.id,
			name: "Doomed asset",
		});

		await client.campaigns.delete.mutate({ campaignId: campaign.id });

		const row = await env.DB.prepare(
			'SELECT campaignId, projectId, prompt FROM "Design" WHERE id = ?',
		)
			.bind(created.assetId)
			.first<{
				campaignId: string | null;
				projectId: string;
				prompt: string;
			}>();
		// The design survives, detached from the campaign, still filed.
		expect(row?.campaignId).toBeNull();
		expect(row?.projectId).toBe(campaign.projectId);
	});

	it("rejects anonymous and non-admin users before allowing an admin", async () => {
		const missing = crypto.randomUUID();
		const campaign = await createCampaign();
		const eventId = await insertEvent(campaign.id);
		const anonymous = createTrpcTestClient();
		const nonAdmin = adminClient(await createUserSession("user"));
		const admin = adminClient(await createAdminSession());

		// GET /campaigns/:id/assets → campaigns.listAssets
		// POST /campaigns/:id/assets → campaigns.createAsset
		// PATCH /campaigns/:id/events/:eventId → campaigns.updateEventSlot
		for (const client of [anonymous, nonAdmin]) {
			const expected = client === anonymous ? "UNAUTHORIZED" : "FORBIDDEN";
			expect(
				await trpcErrorCode(() =>
					client.campaigns.listAssets.query({ campaignId: missing }),
				),
			).toBe(expected);
			expect(
				await trpcErrorCode(() =>
					client.campaigns.createAsset.mutate({ campaignId: missing }),
				),
			).toBe(expected);
			expect(
				await trpcErrorCode(() =>
					client.campaigns.updateEventSlot.mutate({
						campaignId: missing,
						eventId: "x",
						title: "x",
					}),
				),
			).toBe(expected);
		}
		// Assets routes 404 unknown campaigns; the event-slot patch with no
		// fields is rejected as a bad body (the old "{}" PATCH → 400).
		expect(
			await trpcErrorCode(() =>
				admin.campaigns.listAssets.query({ campaignId: missing }),
			),
		).toBe("NOT_FOUND");
		expect(
			await trpcErrorCode(() =>
				admin.campaigns.createAsset.mutate({ campaignId: missing }),
			),
		).toBe("NOT_FOUND");
		expect(
			await trpcErrorCode(() =>
				admin.campaigns.updateEventSlot.mutate({
					campaignId: campaign.id,
					eventId,
				}),
			),
		).toBe("BAD_REQUEST");
	});
});

describe("Campaign chat asset tools", () => {
	it("create_asset seeds a design with distilled campaign context", async () => {
		const campaign = await createCampaign({ name: "Spring launch" });
		await insertBrief(campaign.id, {
			objective: "Launch the spring collection",
			body: "RAW-BODY-MARKER full freeform prose transcript".repeat(50),
		});
		await insertPlan(campaign.id, ["Teaser", "Launch week"]);

		const wire = await runToolTurn(
			"create_asset",
			{ focus: "launch deck for the teaser phase" },
			campaign.id,
		);
		expect(wire).toContain("Asset created");
		expect(wire).toContain("/studio/");
		expect(wire).toContain("Uploads are not available for seeded assets");

		const row = await env.DB.prepare(
			'SELECT id, prompt, projectId, campaignId, uploadToken FROM "Design" WHERE campaignId = ?',
		)
			.bind(campaign.id)
			.first<{
				id: string;
				prompt: string;
				projectId: string;
				campaignId: string;
				uploadToken: string | null;
			}>();
		expect(row).toMatchObject({
			projectId: campaign.projectId,
			campaignId: campaign.id,
			uploadToken: null,
		});
		expect(row?.prompt).toContain("launch deck for the teaser phase");
		expect(row?.prompt).toContain("Launch the spring collection");
		expect(row?.prompt).toContain("Teaser");
		expect(row?.prompt).not.toContain("RAW-BODY-MARKER");
		expect(row?.prompt.length).toBeLessThanOrEqual(3600);
		// The studio URL on the wire points at the created row.
		expect(wire).toContain(`/studio/${row?.id}`);

		expect(await campaignState(campaign.id)).toEqual({
			status: "ready",
			error: null,
		});
	});

	it("list_assets lists this campaign's assets compactly", async () => {
		const campaign = await createCampaign();
		const unpublished = await attachDesign(campaign.id);
		const published = await attachDesign(campaign.id, {
			liveTurnId: "live-turn-1",
		});
		const outside = await createDesign(); // unattached — never listed

		const wire = await runToolTurn("list_assets", {}, campaign.id);
		expect(wire).toContain(unpublished);
		expect(wire).toContain(published);
		expect(wire).toContain("[published]");
		expect(wire).toContain("[unpublished]");
		expect(wire).not.toContain(outside.id);
		expect(await campaignState(campaign.id)).toEqual({
			status: "ready",
			error: null,
		});
	});

	it("list_assets reports when the campaign has no assets yet", async () => {
		const campaign = await createCampaign();
		const wire = await runToolTurn("list_assets", {}, campaign.id);
		expect(wire).toContain("No assets yet for this campaign");
	});
});
