import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
	isDesignId,
	newDesignId,
} from "@/features/design-studio/assets/design-files";
import { newDesignUploadToken } from "@/features/design-studio/assets/design-upload";
import { getLiveDesignFile } from "@/features/design-studio/publish/design-publish";
import { getPrisma } from "@/lib/db";

export async function getShareProject(
	env: Env,
	projectId: string,
): Promise<{ projectId: string; prompt: string } | null> {
	if (!isDesignId(projectId)) return null;
	const project = await getPrisma(env).design.findUnique({
		where: { id: projectId },
	});
	return project ? { projectId: project.id, prompt: project.prompt } : null;
}

export async function remixDesign(env: Env, projectId: string) {
	if (!isDesignId(projectId)) {
		throw new TRPCError({ code: "BAD_REQUEST", message: "invalid project id" });
	}
	const prisma = getPrisma(env);
	const project = await prisma.design.findUnique({
		where: { id: projectId },
	});
	if (!project) {
		throw new TRPCError({ code: "NOT_FOUND", message: "not found" });
	}
	const html = await getLiveDesignFile(env, projectId, "index.html");
	if (!html) {
		throw new TRPCError({
			code: "CONFLICT",
			message: "nothing published to remix",
		});
	}

	const forkId = newDesignId();
	await prisma.design.create({
		data: {
			id: forkId,
			prompt: `Remix of: ${project.prompt}`,
			uploadToken: newDesignUploadToken(),
			status: "ready",
			remixedFromId: projectId,
			// Forks land in the same container as their source; unfiled
			// sources fork unfiled (projectId is nullable).
			projectId: project.projectId,
		},
	});
	// Carry the source design's project-library asset links into the fork so
	// the remixed chat keeps its references. Design-owned assets are skipped:
	// they cascade away with the original design.
	const assetLinks = await prisma.designAsset.findMany({
		where: { designId: projectId, asset: { projectId: { not: null } } },
	});
	if (assetLinks.length > 0) {
		await prisma.designAsset.createMany({
			data: assetLinks.map((link) => ({
				designId: forkId,
				assetId: link.assetId,
				addedById: link.addedById,
			})),
		});
	}
	await env.DESIGNS.put(`designs/${forkId}/index.html`, html.body, {
		httpMetadata: { contentType: "text/html; charset=utf-8" },
	});
	const preview = await getLiveDesignFile(env, projectId, "preview.png");
	if (preview) {
		await env.DESIGNS.put(`designs/${forkId}/preview.png`, preview.body, {
			httpMetadata: { contentType: "image/png" },
		});
	}
	return { projectId: forkId };
}

// ---------------------------------------------------------------------------

export const shareInput = z.object({ projectId: z.string().min(1) });
