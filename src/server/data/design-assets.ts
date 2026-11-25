// Design asset handlers (KUK-864): upload/list/edit/delete assets and serve
// their bytes from R2 through the worker. All mutating/listing procedures
// are admin-gated by the tRPC router (adminProcedure); the file route stays
// public (like designs.$projectId.file) so the design agent's browser tools
// can fetch asset originals from the turn context.
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
	type AssetKind,
	type AssetRef,
	type AssetRowLike,
	assetKindForContentType,
	assetRefFromRow,
	assetsKey,
	assetUrlPath,
	bytesToDataUrl,
	describeImageAsset,
	isAssetId,
	isVisionDescribing,
	MAX_LIBRARY_ASSETS,
	maxBytesForKind,
	sanitizeFilename,
} from "@/features/design-studio/assets/design-assets";
import { isDesignId } from "@/features/design-studio/assets/design-files";
import { getPrisma } from "@/lib/db";

const MAX_LIST = 200;

export const descriptionBody = z.object({
	description: z.string().trim().min(1).max(2000),
});

type DesignRow = { id: string; projectId: string | null };

async function loadDesign(
	env: Env,
	projectId: string,
): Promise<DesignRow | null> {
	if (!isDesignId(projectId)) return null;
	return getPrisma(env).design.findUnique({
		where: { id: projectId },
		select: { id: true, projectId: true },
	});
}

/**
 * Assets visible to a design: design-owned, borrowed via a DesignAsset
 * link, or sitting in the design's project library. Unfiled designs only
 * ever see their own assets.
 */
export async function listDesignAssets(env: Env, projectId: string) {
	const design = await loadDesign(env, projectId);
	if (!design) {
		throw new TRPCError({ code: "NOT_FOUND", message: "not found" });
	}
	const ors: Record<string, unknown>[] = [{ designId: projectId }];
	if (design.projectId) ors.push({ projectId: design.projectId });
	ors.push({ designLinks: { some: { designId: projectId } } });
	const rows = await getPrisma(env).asset.findMany({
		where: { OR: ors },
		orderBy: { createdAt: "desc" },
		take: MAX_LIST,
	});
	return rows.map((row) => assetJson(row, projectId));
}

function assetJson<T extends AssetRowLike>(row: T, projectId: string) {
	return {
		...row,
		// The columns only ever hold the constrained values (kind comes from
		// assetKindForContentType, descriptionStatus from the describe flow),
		// so the public contract's unions are restored here.
		kind: row.kind as "image" | "video",
		descriptionStatus: row.descriptionStatus as
			| "pending"
			| "ready"
			| "failed"
			| "needs_description"
			| "manual",
		url: assetUrlPath(projectId, row.id),
	};
}

export type ResolvedChatAssets =
	| { ok: true; assets: AssetRef[] }
	| { ok: false; error: string };

/**
 * Validates the `assets` ids on a chat turn: every id must resolve to an
 * asset visible to the design, and videos must already carry a description.
 * Links project-library assets into the design on first use.
 */
export async function resolveChatAssets(
	env: Env,
	projectId: string,
	assetIds: string[],
	origin: string,
	adminUserId: string,
): Promise<ResolvedChatAssets> {
	const design = await loadDesign(env, projectId);
	if (!design) return { ok: false, error: "design not found" };
	const deduped = [...new Set(assetIds)];
	const invalid = deduped.find((id) => !isAssetId(id));
	if (invalid) return { ok: false, error: `invalid asset id: ${invalid}` };

	const prisma = getPrisma(env);
	const rows = await prisma.asset.findMany({ where: { id: { in: deduped } } });
	if (rows.length !== deduped.length) {
		return { ok: false, error: "unknown asset in request" };
	}
	const linked = await prisma.designAsset.findMany({
		where: { designId: projectId, assetId: { in: deduped } },
		select: { assetId: true },
	});
	const linkedIds = new Set(linked.map((link) => link.assetId));

	const missing: string[] = [];
	const undescribed: string[] = [];
	for (const row of rows) {
		const visible =
			row.designId === projectId ||
			(design.projectId !== null && row.projectId === design.projectId) ||
			linkedIds.has(row.id);
		if (!visible) {
			missing.push(row.id);
			continue;
		}
		if (row.kind === "video" && row.descriptionStatus === "needs_description") {
			undescribed.push(row.filename);
		}
	}
	if (missing.length > 0) {
		return { ok: false, error: "asset not available for this design" };
	}
	if (undescribed.length > 0) {
		return {
			ok: false,
			error: `describe ${undescribed.join(", ")} before sending`,
		};
	}

	// First use of a project-library asset in this design: create the link.
	// A concurrent chat turn may insert the same link — P2002 (unique
	// constraint) is the expected no-op there; anything else is a real
	// failure and gets logged.
	const toLink = rows.filter(
		(row) => row.projectId !== null && !linkedIds.has(row.id),
	);
	if (toLink.length > 0) {
		await prisma.designAsset
			.createMany({
				data: toLink.map((row) => ({
					designId: projectId,
					assetId: row.id,
					addedById: adminUserId,
				})),
			})
			.catch((error) => {
				if (String(error).includes("Unique constraint")) return;
				console.log("[design-assets] linking assets failed:", error);
			});
	}

	return {
		ok: true,
		assets: rows.map((row) =>
			assetRefFromRow(row, `${origin}${assetUrlPath(projectId, row.id)}`),
		),
	};
}

/**
 * Client-measured metadata fields — bounded so a scripted client can't
 * store absurd values that later render into model context and the UI.
 */
const dimensionField = boundedNumber(20_000);
const durationField = boundedNumber(43_200); // 12 h

function boundedNumber(max: number) {
	return z
		.string()
		.trim()
		.regex(/^\d+(\.\d+)?$/, "invalid number")
		.transform(Number)
		.refine((value) => value <= max, `must be ≤ ${max}`);
}

/**
 * Counts the assets owned by this design's container (project library for
 * filed designs, the design itself for unfiled ones).
 */
async function prismaCountOwnedAssets(env: Env, design: DesignRow) {
	return getPrisma(env).asset.count({
		where: design.projectId
			? { projectId: design.projectId }
			: { designId: design.id },
	});
}

/**
 * Multipart upload. Ownership follows the design: filed designs upload into
 * their project's library; unfiled designs own the asset directly.
 */
export async function uploadAsset(input: {
	request: Request;
	env: Env;
	projectId: string;
	adminUserId: string;
	waitUntil?: (promise: Promise<unknown>) => void;
}): Promise<Response> {
	const { request, env, projectId, adminUserId, waitUntil } = input;
	const design = await loadDesign(env, projectId);
	if (!design) {
		return Response.json({ error: "not found" }, { status: 404 });
	}
	let form: FormData;
	try {
		form = await request.formData();
	} catch {
		return Response.json({ error: "invalid form data" }, { status: 400 });
	}
	const file = form.get("file");
	if (!(file instanceof File) || file.size === 0) {
		return Response.json({ error: "file is required" }, { status: 400 });
	}
	const contentType = file.type;
	const kind = assetKindForContentType(contentType);
	if (!kind) {
		return Response.json(
			{ error: `unsupported file type: ${contentType || "unknown"}` },
			{ status: 415 },
		);
	}
	if (file.size > maxBytesForKind(kind)) {
		return Response.json({ error: "file too large" }, { status: 413 });
	}

	const width = dimensionField.safeParse(form.get("width") ?? "");
	const height = dimensionField.safeParse(form.get("height") ?? "");
	const durationSec = durationField.safeParse(form.get("durationSec") ?? "");

	const id = crypto.randomUUID();
	const filename = sanitizeFilename(
		file.name || `asset${kind === "image" ? ".png" : ".mp4"}`,
	);
	// Server-side library cap — the client's drop/upload clamps are advisory;
	// a scripted client must not grow the library without bound.
	const existingCount = await prismaCountOwnedAssets(env, design);
	if (existingCount >= MAX_LIBRARY_ASSETS) {
		return Response.json(
			{ error: `asset library is full (${MAX_LIBRARY_ASSETS})` },
			{ status: 409 },
		);
	}
	const r2Key = assetsKey(id, filename);
	const bytes = await file.arrayBuffer();
	await env.DESIGNS.put(r2Key, bytes, {
		httpMetadata: { contentType },
	});
	const autoDescribe = isVisionDescribing(kind, contentType);
	const asset = await getPrisma(env).asset.create({
		data: {
			id,
			...(design.projectId ? { projectId: design.projectId } : {}),
			...(design.projectId ? {} : { designId: projectId }),
			kind,
			r2Key,
			filename,
			contentType,
			sizeBytes: file.size,
			width: width.success ? width.data : null,
			height: height.success ? height.data : null,
			durationSec: durationSec.success ? durationSec.data : null,
			descriptionStatus: autoDescribe ? "pending" : "needs_description",
			uploadedById: adminUserId,
		},
	});
	if (autoDescribe) {
		waitUntil?.(
			describeUploadedAsset(env, asset.id, bytes, contentType, filename),
		);
	}
	return Response.json(assetJson(asset, projectId), { status: 201 });
}

/** Runs in waitUntil: describes the image and records the outcome on the row. */
async function describeUploadedAsset(
	env: Env,
	assetId: string,
	bytes: ArrayBuffer,
	contentType: string,
	filename: string,
): Promise<void> {
	const prisma = getPrisma(env);
	try {
		const description = await describeImageAsset(
			env,
			bytesToDataUrl(bytes, contentType),
			filename,
		);
		await prisma.asset.update({
			where: { id: assetId },
			data: {
				description,
				descriptionStatus: "ready",
				descriptionError: null,
			},
		});
	} catch (error) {
		console.log(`[design-assets] describe failed for ${assetId}:`, error);
		await prisma.asset
			.update({
				where: { id: assetId },
				data: {
					descriptionStatus: "failed",
					descriptionError: "description failed — try regenerating",
				},
			})
			.catch(() => {});
	}
}

/**
 * PATCH — set a description (the video path, or overriding an image's
 * auto-description). Marks the description user-authored. Admin-gated by
 * the tRPC router's adminProcedure (the public `file` asset route stays
 * outside that gate).
 */
export async function updateAsset(input: {
	env: Env;
	projectId: string;
	assetId: string;
	description: string;
}) {
	const { env, projectId, assetId, description } = input;
	if (!isDesignId(projectId) || !isAssetId(assetId)) {
		throw new TRPCError({ code: "BAD_REQUEST", message: "invalid id" });
	}
	const prisma = getPrisma(env);
	const asset = await visibleAsset(env, projectId, assetId);
	if (!asset) {
		throw new TRPCError({ code: "NOT_FOUND", message: "not found" });
	}
	const updated = await prisma.asset.update({
		where: { id: assetId },
		data: {
			description,
			descriptionStatus: "manual",
			descriptionError: null,
		},
	});
	return assetJson(updated, projectId);
}

/**
 * POST — re-run auto-description for an image whose description failed
 * (or should be refreshed). Reads the bytes back from R2. Admin-gated by
 * the tRPC router's adminProcedure.
 */
export async function regenerateAssetDescription(input: {
	env: Env;
	projectId: string;
	assetId: string;
	waitUntil: (promise: Promise<unknown>) => void;
}) {
	const { env, projectId, assetId, waitUntil } = input;
	if (!isDesignId(projectId) || !isAssetId(assetId)) {
		throw new TRPCError({ code: "BAD_REQUEST", message: "invalid id" });
	}
	const asset = await visibleAsset(env, projectId, assetId);
	if (!asset) {
		throw new TRPCError({ code: "NOT_FOUND", message: "not found" });
	}
	if (!isVisionDescribing(asset.kind as AssetKind, asset.contentType)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "only raster images can be auto-described",
		});
	}
	const prisma = getPrisma(env);
	await prisma.asset.update({
		where: { id: assetId },
		data: { descriptionStatus: "pending", descriptionError: null },
	});
	waitUntil(
		(async () => {
			const object = await env.DESIGNS.get(asset.r2Key);
			if (!object) {
				await prisma.asset
					.update({
						where: { id: assetId },
						data: {
							descriptionStatus: "failed",
							descriptionError: "asset file missing",
						},
					})
					.catch(() => {});
				return;
			}
			const bytes = await object.arrayBuffer();
			await describeUploadedAsset(
				env,
				asset.id,
				bytes,
				asset.contentType,
				asset.filename,
			);
		})(),
	);
	return assetJson(
		{ ...asset, descriptionStatus: "pending", descriptionError: null },
		projectId,
	);
}

/**
 * DELETE — only the asset's owner (the design for standalone assets, the
 * project library for shared ones) may remove it. Borrowing designs can
 * simply stop referencing it. Admin-gated by the tRPC router's
 * adminProcedure.
 */
export async function deleteAsset(input: {
	env: Env;
	projectId: string;
	assetId: string;
}) {
	const { env, projectId, assetId } = input;
	if (!isDesignId(projectId) || !isAssetId(assetId)) {
		throw new TRPCError({ code: "BAD_REQUEST", message: "invalid id" });
	}
	const design = await loadDesign(env, projectId);
	if (!design) {
		throw new TRPCError({ code: "NOT_FOUND", message: "not found" });
	}
	const prisma = getPrisma(env);
	const asset = await prisma.asset.findUnique({ where: { id: assetId } });
	if (!asset) {
		throw new TRPCError({ code: "NOT_FOUND", message: "not found" });
	}
	const owned =
		asset.designId === projectId ||
		(design.projectId !== null && asset.projectId === design.projectId);
	if (!owned) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "only the asset owner can delete it",
		});
	}
	await prisma.asset.delete({ where: { id: assetId } });
	await env.DESIGNS.delete(asset.r2Key).catch(() => {});
}

/** Asset visible to the design (own, linked, or same project library), else null. */
async function visibleAsset(
	env: Env,
	projectId: string,
	assetId: string,
): Promise<AssetRowLike | null> {
	const design = await loadDesign(env, projectId);
	if (!design) return null;
	const prisma = getPrisma(env);
	const asset = await prisma.asset.findUnique({ where: { id: assetId } });
	if (!asset) return null;
	const visible =
		asset.designId === projectId ||
		(design.projectId !== null && asset.projectId === design.projectId) ||
		(await prisma.designAsset.findUnique({
			where: { designId_assetId: { designId: projectId, assetId } },
		})) !== null;
	return visible ? asset : null;
}

/**
 * Serves the asset bytes from R2 through the worker (public, like design
 * files). Unauthenticated by design — the agent's browser tools open asset
 * originals from the chat turn context without an admin session. The gate
 * is asset-id unpredictability: nothing unauthenticated lists asset ids
 * (list/upload/etc. are admin-gated), so don't add an unauthenticated
 * listing endpoint without revisiting this.
 */
export async function serveAssetFile(input: {
	env: Env;
	projectId: string;
	assetId: string;
}): Promise<Response> {
	const { env, projectId, assetId } = input;
	if (!isDesignId(projectId) || !isAssetId(assetId)) {
		return new Response("invalid id", { status: 400 });
	}
	const asset = await visibleAsset(env, projectId, assetId);
	if (!asset) return new Response("not found", { status: 404 });
	const object = await env.DESIGNS.get(asset.r2Key);
	if (!object) return new Response("not found", { status: 404 });
	const headers: Record<string, string> = {
		"content-type": asset.contentType,
		// Keys are unique per upload and never mutated in place.
		"cache-control": "public, max-age=31536000, immutable",
		"x-content-type-options": "nosniff",
	};
	// SVG can carry scripts — serve it in an opaque origin like model-authored
	// HTML (see designResponseHeaders). The type allowlists never admit HTML.
	if (asset.contentType === "image/svg+xml") {
		headers["content-security-policy"] = "sandbox";
	}
	return new Response(object.body, { headers });
}
