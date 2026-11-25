import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { resolveCampaignShareSlug } from "@/features/campaigns/share/campaign-share";
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

const SLUG_RE =
	/^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{22}$/;

type SharePayload = {
	shared: boolean;
	shareSlug: string | null;
	shareUrl: string | null;
	shareIncludeReports: boolean;
	// Dates cross the JSON batch link as ISO strings.
	shareRevokedAt: string | null;
};

async function getCampaignRow(campaignId: string) {
	return (await env.DB.prepare(
		`SELECT shareSlug, shareRevokedAt, shareIncludeReports
			FROM "Campaign" WHERE id = ?`,
	)
		.bind(campaignId)
		.first()) as {
		shareSlug: string | null;
		shareRevokedAt: string | null;
		shareIncludeReports: number;
	} | null;
}

function adminClient(session: TestSession): TrpcTestClient {
	return createTrpcTestClient(session.headers);
}

describe("Campaign share tRPC API", () => {
	it("generates a base58 slug and public URL, then is idempotent", async () => {
		const session = await createAdminSession();
		const campaign = await createCampaign();

		const payload = (await adminClient(session).campaigns.share.generate.mutate(
			{
				campaignId: campaign.id,
			},
		)) as SharePayload;
		expect(payload.shared).toBe(true);
		expect(payload.shareSlug).toMatch(SLUG_RE);
		expect(payload.shareUrl).toBe(`/share/campaign/${payload.shareSlug}`);
		expect(payload.shareIncludeReports).toBe(false);
		expect(payload.shareRevokedAt).toBeNull();

		const row = await getCampaignRow(campaign.id);
		expect(row?.shareSlug).toBe(payload.shareSlug);

		// Second generate returns the existing slug — no rotation. (The old
		// REST transport distinguished 201 create from 200 read; tRPC returns
		// the same payload shape either way, so only the slug is asserted.)
		const again = (await adminClient(session).campaigns.share.generate.mutate({
			campaignId: campaign.id,
		})) as SharePayload;
		expect(again.shareSlug).toBe(payload.shareSlug);
		expect(again.shareUrl).toBe(payload.shareUrl);
	});

	it("returns NOT_FOUND for unknown campaigns and non-UUID ids", async () => {
		const session = await createAdminSession();
		const generate = (campaignId: string) => () =>
			adminClient(session).campaigns.share.generate.mutate({ campaignId });
		expect(await trpcErrorCode(generate(crypto.randomUUID()))).toBe(
			"NOT_FOUND",
		);
		expect(await trpcErrorCode(generate("not-a-uuid"))).toBe("NOT_FOUND");
		expect(await trpcErrorMessage(generate(crypto.randomUUID()))).toBe(
			"not found",
		);
	});

	it("rotates the slug — old links resolve null, new ones resolve", async () => {
		const session = await createAdminSession();
		const campaign = await createCampaign();

		const initial = (await adminClient(session).campaigns.share.generate.mutate(
			{
				campaignId: campaign.id,
			},
		)) as SharePayload;
		expect(initial.shareSlug).toMatch(SLUG_RE);

		const rotated = (await adminClient(session).campaigns.share.update.mutate({
			campaignId: campaign.id,
			rotate: true,
		})) as SharePayload;
		expect(rotated.shared).toBe(true);
		expect(rotated.shareSlug).toMatch(SLUG_RE);
		expect(rotated.shareSlug).not.toBe(initial.shareSlug);
		expect(rotated.shareUrl).toBe(`/share/campaign/${rotated.shareSlug}`);

		// Old slug is dead; the new one resolves to the campaign id.
		expect(
			await resolveCampaignShareSlug(env, initial.shareSlug ?? ""),
		).toBeNull();
		expect(
			await resolveCampaignShareSlug(env, rotated.shareSlug ?? ""),
		).toEqual({
			id: campaign.id,
		});
	});

	it("defaults includeReports to false and toggles it via update", async () => {
		const session = await createAdminSession();
		const campaign = await createCampaign();

		const shared = (await adminClient(session).campaigns.share.generate.mutate({
			campaignId: campaign.id,
		})) as SharePayload;
		expect(shared.shareIncludeReports).toBe(false);

		const enabled = (await adminClient(session).campaigns.share.update.mutate({
			campaignId: campaign.id,
			includeReports: true,
		})) as SharePayload;
		expect(enabled.shareIncludeReports).toBe(true);
		expect(enabled.shareSlug).toBe(shared.shareSlug);
		const enabledRow = await getCampaignRow(campaign.id);
		expect(enabledRow?.shareIncludeReports).toBe(1);

		const disabled = (await adminClient(session).campaigns.share.update.mutate({
			campaignId: campaign.id,
			includeReports: false,
		})) as SharePayload;
		expect(disabled.shareIncludeReports).toBe(false);
	});

	it("rotates and toggles reports in a single update", async () => {
		const session = await createAdminSession();
		const campaign = await createCampaign();

		const shared = (await adminClient(session).campaigns.share.generate.mutate({
			campaignId: campaign.id,
		})) as SharePayload;
		const both = (await adminClient(session).campaigns.share.update.mutate({
			campaignId: campaign.id,
			rotate: true,
			includeReports: true,
		})) as SharePayload;
		expect(both.shareSlug).not.toBe(shared.shareSlug);
		expect(both.shareIncludeReports).toBe(true);
	});

	it("rejects invalid update bodies", async () => {
		const session = await createAdminSession();
		const campaign = await createCampaign();
		for (const body of [
			{},
			{ rotate: "yes" },
			{ includeReports: "true" },
			{ rotate: true, includeReports: 1 },
		]) {
			const call = () =>
				adminClient(session).campaigns.share.update.mutate({
					campaignId: campaign.id,
					...(body as Record<string, unknown>),
				} as never);
			expect(await trpcErrorCode(call), JSON.stringify(body)).toBe(
				"BAD_REQUEST",
			);
		}
		// The empty body hits the "at least one field" refinement.
		expect(
			await trpcErrorMessage(() =>
				adminClient(session).campaigns.share.update.mutate({
					campaignId: campaign.id,
				} as never),
			),
		).toContain("invalid body");
	});

	it("revokes — slug cleared, shareRevokedAt stamped, resolution null", async () => {
		const session = await createAdminSession();
		const campaign = await createCampaign();

		const shared = (await adminClient(session).campaigns.share.generate.mutate({
			campaignId: campaign.id,
		})) as SharePayload;
		// Void mutation: resolves null over the batch link (old 204).
		const revoked = await adminClient(session).campaigns.share.revoke.mutate({
			campaignId: campaign.id,
		});
		expect(revoked ?? null).toBeNull();

		const row = await getCampaignRow(campaign.id);
		expect(row?.shareSlug).toBeNull();
		expect(row?.shareRevokedAt).not.toBeNull();
		expect(
			await resolveCampaignShareSlug(env, shared.shareSlug ?? ""),
		).toBeNull();

		// Re-sharing after a revoke starts a fresh slug and clears the stamp.
		const reshared = (await adminClient(
			session,
		).campaigns.share.generate.mutate({
			campaignId: campaign.id,
		})) as SharePayload;
		expect(reshared.shared).toBe(true);
		expect(reshared.shareSlug).not.toBe(shared.shareSlug);
		expect(reshared.shareRevokedAt).toBeNull();
	});

	it("returns NOT_FOUND for update and revoke on unknown campaigns", async () => {
		const session = await createAdminSession();
		const update = () =>
			adminClient(session).campaigns.share.update.mutate({
				campaignId: crypto.randomUUID(),
				rotate: true,
			});
		expect(await trpcErrorCode(update)).toBe("NOT_FOUND");
		const revoke = () =>
			adminClient(session).campaigns.share.revoke.mutate({
				campaignId: crypto.randomUUID(),
			});
		expect(await trpcErrorCode(revoke)).toBe("NOT_FOUND");
		expect(await trpcErrorMessage(revoke)).toBe("not found");
	});

	it("requires an admin session on all three procedures", async () => {
		const campaign = await createCampaign();
		const anonymous = createTrpcTestClient();
		const nonAdmin = adminClient(await createUserSession("user"));
		const admin = adminClient(await createAdminSession());

		const callAll = (client: TrpcTestClient) => [
			() => client.campaigns.share.generate.mutate({ campaignId: campaign.id }),
			() =>
				client.campaigns.share.update.mutate({
					campaignId: campaign.id,
					rotate: true,
				}),
			() => client.campaigns.share.revoke.mutate({ campaignId: campaign.id }),
		];
		for (const client of [anonymous, nonAdmin]) {
			for (const call of callAll(client)) {
				expect(await trpcErrorCode(call)).toBe(
					client === anonymous ? "UNAUTHORIZED" : "FORBIDDEN",
				);
			}
		}
		// Auth passes first for the admin: a missing campaign yields
		// NOT_FOUND, not an auth error.
		expect(
			await trpcErrorCode(() =>
				admin.campaigns.share.generate.mutate({
					campaignId: crypto.randomUUID(),
				}),
			),
		).toBe("NOT_FOUND");

		// Mutations were rejected — the campaign was never shared.
		const row = await getCampaignRow(campaign.id);
		expect(row?.shareSlug).toBeNull();
	});
});

describe("resolveCampaignShareSlug", () => {
	it("returns null for malformed slugs without touching the database", async () => {
		for (const slug of [
			"",
			"short",
			"0OIl000000000000000000",
			"a".repeat(21),
			"a".repeat(23),
		]) {
			expect(await resolveCampaignShareSlug(env, slug)).toBeNull();
		}
	});
});
