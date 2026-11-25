import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { validateMessageOwner } from "../../src/lib/message-owner";
import {
	createCampaign,
	createDesign,
	createProject,
} from "../helpers/fixtures";

describe("Message exactly-one ownership (0016 CHECK widened by 0025 + shared helper)", () => {
	it("helper rejects both/neither and narrows valid ownership", () => {
		const design = { designId: "d1", campaignId: null, elementId: null };
		const campaign = { designId: null, campaignId: "c1", elementId: null };
		const element = { designId: null, campaignId: null, elementId: "e1" };
		expect(validateMessageOwner(design)).toEqual({
			designId: "d1",
			campaignId: null,
			elementId: null,
		});
		expect(validateMessageOwner(campaign)).toEqual({
			designId: null,
			campaignId: "c1",
			elementId: null,
		});
		expect(validateMessageOwner(element)).toEqual({
			designId: null,
			campaignId: null,
			elementId: "e1",
		});
		expect(() =>
			validateMessageOwner({ designId: "d1", campaignId: "c1" }),
		).toThrow(/exactly one/);
		expect(() => validateMessageOwner({})).toThrow(/exactly one/);
		// KUK-940: element + another owner is also a violation, as is a lone
		// element pair with a design id.
		expect(() =>
			validateMessageOwner({ designId: "d1", elementId: "e1" }),
		).toThrow(/exactly one/);
		expect(() =>
			validateMessageOwner({ campaignId: "c1", elementId: "e1" }),
		).toThrow(/exactly one/);
	});

	it("accepts an element-chat-owned message row", async () => {
		const project = await createProject();
		const sessionId = crypto.randomUUID();
		const now = new Date().toISOString();
		await env.DB.prepare(
			`INSERT INTO "ElementChat" (id, projectId, elementType, elementId, contextPrompt, createdAt, updatedAt)
				VALUES (?, ?, 'component', 'comp-1', 'context', ?, ?)`,
		)
			.bind(sessionId, project.id, now, now)
			.run();
		const id = crypto.randomUUID();
		await env.DB.prepare(
			`INSERT INTO "Message" (id, elementId, role, content)
				VALUES (?, ?, 'user', 'hello')`,
		)
			.bind(id, sessionId)
			.run();
		const row = await env.DB.prepare(
			`SELECT designId, campaignId, elementId FROM "Message" WHERE id = ?`,
		)
			.bind(id)
			.first<{
				designId: string | null;
				campaignId: string | null;
				elementId: string;
			}>();
		expect(row?.designId).toBeNull();
		expect(row?.campaignId).toBeNull();
		expect(row?.elementId).toBe(sessionId);
	});

	it("accepts a campaign-owned message row", async () => {
		const project = await createProject();
		const campaign = await createCampaign({ projectId: project.id });
		const id = crypto.randomUUID();
		await env.DB.prepare(
			`INSERT INTO "Message" (id, campaignId, role, content)
				VALUES (?, ?, 'user', 'hello')`,
		)
			.bind(id, campaign.id)
			.run();
		const row = await env.DB.prepare(
			`SELECT designId, campaignId FROM "Message" WHERE id = ?`,
		)
			.bind(id)
			.first<{ designId: string | null; campaignId: string }>();
		expect(row).toEqual({ designId: null, campaignId: campaign.id });
	});

	it("rejects rows with both owners at the DB level", async () => {
		const project = await createProject();
		const campaign = await createCampaign({ projectId: project.id });
		const design = await createDesign({ projectId: project.id });
		await expect(
			env.DB.prepare(
				`INSERT INTO "Message" (id, designId, campaignId, role, content)
					VALUES (?, ?, ?, 'user', 'x')`,
			)
				.bind(crypto.randomUUID(), design.id, campaign.id)
				.run(),
		).rejects.toThrow(/CHECK constraint/);
	});

	it("rejects rows with neither owner at the DB level", async () => {
		await expect(
			env.DB.prepare(
				`INSERT INTO "Message" (id, role, content)
					VALUES (?, 'user', 'x')`,
			)
				.bind(crypto.randomUUID())
				.run(),
		).rejects.toThrow(/CHECK constraint/);
	});
});
