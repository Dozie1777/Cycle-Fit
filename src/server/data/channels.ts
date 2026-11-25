import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getPrisma } from "@/lib/db";

// Channel enumeration handlers (KUK-890). Channels are a global, admin-owned
// enumeration: the agent picks from it (list_channels tool) but only admins
// create/rename/color through the tRPC procedures (see
// server/trpc/routers/channels.ts). Uniqueness is case-insensitive — checked
// with a lower(name) lookup before insert/update (SQLite UNIQUE is
// case-sensitive by design) — and a duplicate answers CONFLICT.

const NAME_MAX = 100;
const COLOR_MAX = 32;

export const createChannelBody = z.object({
	name: z.string().trim().min(1).max(NAME_MAX),
	// Loose color shape: a CSS color string (hex/rgb/named) up to 32 chars.
	color: z.string().trim().min(1).max(COLOR_MAX).optional(),
});

export const updateChannelBody = z
	.object({
		name: z.string().trim().min(1).max(NAME_MAX).optional(),
		color: z.string().trim().min(1).max(COLOR_MAX).nullish(),
	})
	.refine(
		(body) => body.name !== undefined || body.color !== undefined,
		"name or color is required",
	);

/** Channel ids: crypto.randomUUID() from createChannel, or the migration's
 * documented 'chan-<slug>' scheme for the seeded rows — free-form, checked
 * loosely by length. */
const CHANNEL_ID_RE = /^[0-9a-zA-Z_-]{1,64}$/;

function invalidChannelId(): TRPCError {
	return new TRPCError({ code: "BAD_REQUEST", message: "invalid channel id" });
}

/** Case-insensitive duplicate check → CONFLICT with the colliding name. */
async function duplicateName(env: Env, name: string, excludeId?: string) {
	const row = await env.DB.prepare(
		`SELECT id FROM "Channel" WHERE lower("name") = lower(?)${excludeId ? " AND id <> ?" : ""} LIMIT 1`,
	)
		.bind(...(excludeId ? [name, excludeId] : [name]))
		.first<{ id: string }>();
	if (row) {
		return new TRPCError({
			code: "CONFLICT",
			message: `a channel named "${name}" already exists`,
		});
	}
	return null;
}

export async function listChannels(env: Env) {
	return getPrisma(env).channel.findMany({
		orderBy: { name: "asc" },
	});
}

export async function createChannel(input: {
	env: Env;
	body: z.infer<typeof createChannelBody>;
}) {
	const duplicate = await duplicateName(input.env, input.body.name);
	if (duplicate) throw duplicate;
	const channel = await getPrisma(input.env).channel.create({
		data: {
			id: crypto.randomUUID(),
			name: input.body.name,
			color: input.body.color ?? null,
		},
	});
	return channel;
}

export async function updateChannel(input: {
	env: Env;
	channelId: string;
	body: z.infer<typeof updateChannelBody>;
}) {
	const { env, channelId, body } = input;
	if (!CHANNEL_ID_RE.test(channelId)) throw invalidChannelId();
	const prisma = getPrisma(env);
	const channel = await prisma.channel.findUnique({ where: { id: channelId } });
	if (!channel) {
		throw new TRPCError({ code: "NOT_FOUND", message: "not found" });
	}
	const data: { name?: string; color?: string | null } = {};
	if (body.name !== undefined) data.name = body.name;
	if (body.color !== undefined) data.color = body.color;
	if (body.name !== undefined) {
		const duplicate = await duplicateName(env, body.name, channelId);
		if (duplicate) throw duplicate;
	}
	return prisma.channel.update({
		where: { id: channelId },
		data,
	});
}

// ---------------------------------------------------------------------------
// Shared helpers for the campaign surfaces (document routes + agent tools)
// ---------------------------------------------------------------------------

type PrismaDb = ReturnType<typeof getPrisma>;

/**
 * Resolves a channel by id, or null when unknown — callers answer with a
 * message that lists the available names (the same recoverable-error style
 * the campaign tools use).
 */
export async function findChannel(
	prisma: PrismaDb,
	channelId: string,
): Promise<{ id: string; name: string } | null> {
	return prisma.channel.findUnique({
		where: { id: channelId },
		select: { id: true, name: true },
	});
}

/** Names of every channel, for the "unknown channel" guidance messages. */
export async function availableChannelNames(
	prisma: PrismaDb,
): Promise<string[]> {
	const channels = await prisma.channel.findMany({
		orderBy: { name: "asc" },
		select: { name: true },
	});
	return channels.map((channel) => channel.name);
}

/**
 * Atomically replaces a campaign's channel links with exactly the given
 * ids (all of which must already exist — callers validate). One D1 batch:
 * the delete + reinserts commit or roll back together. Duplicates in the
 * input are collapsed.
 */
export async function replaceCampaignChannels(
	env: Env,
	campaignId: string,
	channelIds: string[],
): Promise<void> {
	const unique = [...new Set(channelIds)];
	await env.DB.batch([
		env.DB.prepare('DELETE FROM "CampaignChannel" WHERE "campaignId" = ?').bind(
			campaignId,
		),
		...unique.map((channelId) =>
			env.DB.prepare(
				'INSERT INTO "CampaignChannel" ("campaignId", "channelId") VALUES (?, ?)',
			).bind(campaignId, channelId),
		),
	]);
}

/** Validates a channelIds set; returns the error message or null when valid. */
export async function validateChannelIds(
	prisma: PrismaDb,
	channelIds: string[],
): Promise<string | null> {
	const found = await prisma.channel.findMany({
		where: { id: { in: [...new Set(channelIds)] } },
		select: { id: true },
	});
	const known = new Set(found.map((channel) => channel.id));
	const missing = [...new Set(channelIds)].filter((id) => !known.has(id));
	if (missing.length > 0) {
		const names = await availableChannelNames(prisma);
		return `Unknown channel id(s): ${missing.join(", ")}. Available channels: ${
			names.join(", ") || "(none yet)"
		}. Call list_channels for the current ids.`;
	}
	return null;
}
