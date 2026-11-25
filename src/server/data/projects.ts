import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
	listDesignFiles,
	newDesignId,
} from "@/features/design-studio/assets/design-files";
import { newDesignUploadToken } from "@/features/design-studio/assets/design-upload";
import { getPrisma } from "@/lib/db";

// Input schemas — the router extends these with the path ids so every
// mutation/query is zod-validated at the tRPC boundary before the handler
// runs.
export const createProjectBody = z.object({
	name: z.string().trim().min(1).max(200),
	description: z.string().trim().max(5000).optional(),
});

export const updateProjectBody = z.object({
	name: z.string().trim().min(1).max(200).optional(),
	description: z.string().trim().max(5000).nullable().optional(),
});

export const createDesignBody = z.object({
	prompt: z.string().trim().min(1).max(16000),
});

export async function getProject(env: Env, projectId: string) {
	const prisma = getPrisma(env);
	const project = await prisma.project.findUnique({
		where: { id: projectId },
		include: {
			designs: { orderBy: { createdAt: "desc" } },
			// Sub-entity composition for the workspace hub (KUK-914).
			_count: { select: { campaigns: true } },
			brandKit: { select: { id: true } },
		},
	});
	if (!project) {
		throw new TRPCError({ code: "NOT_FOUND", message: "not found" });
	}
	// Each design carries the same bucket-state fields as getDesign.
	const designs = await Promise.all(
		project.designs.map(async (design) => {
			const files = await listDesignFiles(env.DESIGNS, design.id);
			return {
				...design,
				// Designs are always filed — restore the public contract's
				// non-null projectId (same as getDesign in handlers/designs.ts).
				projectId: design.projectId as string,
				hasIndex:
					Boolean(design.liveTurnId) ||
					files.some((file) => file.path === "index.html"),
				hasPreview:
					Boolean(design.liveTurnId) ||
					files.some((file) => file.path === "preview.png"),
				sections: files
					.filter(
						(file) =>
							file.path.startsWith("drafts/") && file.path.endsWith(".html"),
					)
					.map((file) => file.path.slice("drafts/".length, -".html".length)),
				files,
			};
		}),
	);
	const { designs: _designs, _count, brandKit, ...rest } = project;
	return {
		...rest,
		designs,
		campaignCount: _count.campaigns,
		hasBrandKit: brandKit !== null,
	};
}

export async function createProject(input: {
	env: Env;
	body: z.infer<typeof createProjectBody>;
}) {
	const project = await getPrisma(input.env).project.create({
		data: {
			name: input.body.name,
			description: input.body.description ?? null,
		},
	});
	return { project };
}

export async function listProjects(env: Env) {
	const prisma = getPrisma(env);
	const projects = await prisma.project.findMany({
		orderBy: { createdAt: "desc" },
		take: 100,
	});
	// Sub-entity composition for the project cards / sidebar (KUK-914):
	// counts are query-time aggregations — no schema change.
	const [designCounts, campaignCounts, brandKits] = await Promise.all([
		prisma.design.groupBy({
			by: ["projectId"],
			_count: { _all: true },
			where: { projectId: { not: null } },
		}),
		prisma.campaign.groupBy({
			by: ["projectId"],
			_count: { _all: true },
		}),
		prisma.brandKit.findMany({ select: { projectId: true } }),
	]);
	const designCountByProject = new Map(
		designCounts.map((count) => [count.projectId, count._count._all]),
	);
	const campaignCountByProject = new Map(
		campaignCounts.map((count) => [count.projectId, count._count._all]),
	);
	const brandKitProjectIds = new Set(brandKits.map((kit) => kit.projectId));
	return projects.map((project) => ({
		...project,
		designCount: designCountByProject.get(project.id) ?? 0,
		campaignCount: campaignCountByProject.get(project.id) ?? 0,
		hasBrandKit: brandKitProjectIds.has(project.id),
	}));
}

export async function updateProject(input: {
	env: Env;
	projectId: string;
	body: z.infer<typeof updateProjectBody>;
}) {
	const { env, projectId, body } = input;
	const prisma = getPrisma(env);
	const existing = await prisma.project.findUnique({
		where: { id: projectId },
	});
	if (!existing) {
		throw new TRPCError({ code: "NOT_FOUND", message: "not found" });
	}
	const data: { name?: string; description?: string | null } = {};
	if (body.name !== undefined) data.name = body.name;
	if (body.description !== undefined) {
		data.description = body.description;
	}
	return prisma.project.update({
		where: { id: projectId },
		data,
	});
}

export async function deleteProject(
	env: Env,
	projectId: string,
): Promise<void> {
	const prisma = getPrisma(env);
	const existing = await prisma.project.findUnique({
		where: { id: projectId },
	});
	if (!existing) {
		throw new TRPCError({ code: "NOT_FOUND", message: "not found" });
	}
	// Defensive spelled-out cascade (mirrors deleteDesign): DB rows only —
	// authored R2 objects stay in the bucket under each design id.
	const designs = await prisma.design.findMany({
		where: { projectId },
		select: { id: true },
	});
	const designIds = designs.map((design) => design.id);
	await prisma.message.deleteMany({
		where: { designId: { in: designIds } },
	});
	await prisma.design.deleteMany({ where: { projectId } });
	await prisma.project.delete({ where: { id: projectId } });
}

export async function createProjectDesign(input: {
	env: Env;
	projectId: string;
	body: z.infer<typeof createDesignBody>;
}) {
	const { env, projectId, body } = input;
	const prisma = getPrisma(env);
	const project = await prisma.project.findUnique({
		where: { id: projectId },
	});
	if (!project) {
		throw new TRPCError({ code: "NOT_FOUND", message: "not found" });
	}
	const designId = newDesignId();
	await prisma.design.create({
		data: {
			id: designId,
			prompt: body.prompt,
			uploadToken: newDesignUploadToken(),
			projectId,
		},
	});
	// The legacy "projectId" key names the created design's id, matching
	// createDesign's response shape for shared client handling.
	return { projectId: designId };
}
