import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { parseAttachments } from "@/features/design-studio/assets/design-assets";
import { backfillDesign } from "@/features/design-studio/assets/design-backfill";
import {
	isDesignId,
	isProjectId,
	listDesignFiles,
	newDesignId,
} from "@/features/design-studio/assets/design-files";
import { newDesignUploadToken } from "@/features/design-studio/assets/design-upload";
import { designSandbox } from "@/features/design-studio/chat/design-session";
import {
	listDesignVersions,
	restoreDesignVersion,
} from "@/features/design-studio/publish/design-publish";
import {
	listProjectLibrary,
	repinPageBlock,
} from "@/features/design-studio/tools/component-library";
import {
	ComponentPublishError,
	publishComponentVersion as publishComponentVersionOp,
	restoreComponentVersion as restoreComponentVersionOp,
	retirePublishedVersion as retireComponentVersionOp,
} from "@/features/design-studio/tools/component-publish";
import {
	createPageTool,
	deletePageTool,
	listDesignComposerPages,
	type PageToolFailure,
	replacePageBlocksTool,
	updatePageTool,
} from "@/features/design-studio/tools/page-tools";
import { getPrisma } from "@/lib/db";

// Input schemas — the tRPC router uses these via `.input(...)` so every
// mutation is zod-validated at the tRPC boundary before the handler runs.
export const createBody = z.object({
	prompt: z.string().trim().min(1).max(16000),
	// Designs always belong to a project — the unfiled creator is gone;
	// the all-designs form picks the container explicitly.
	projectId: z.string().refine(isProjectId, "invalid project id"),
});

export const restoreBody = z.object({
	n: z.number().int().min(1),
});

export const debugExecBody = z.object({
	command: z.string().min(1).max(2000),
});

const fileBody = z.object({
	// Move-to-project only: a design can change containers but never become
	// unfiled — every design is always part of a project.
	projectId: z.string().refine(isProjectId, "invalid project id"),
});

// Component lifecycle handlers accept an optional chat turn id for the same
// lease fencing the design publish path uses; admin callers omit it.
export const componentTurnBody = z.object({
	turnId: z.string().min(1).max(100).optional(),
});

function firstIssueMessage(error: { issues: { message?: string }[] }): string {
	return error.issues[0]?.message ?? "invalid body";
}

/** Maps an old HTTP-ish status onto the tRPC error code it stood for. */
function statusToCode(
	status: number,
): "BAD_REQUEST" | "NOT_FOUND" | "CONFLICT" | "INTERNAL_SERVER_ERROR" {
	switch (status) {
		case 400:
			return "BAD_REQUEST";
		case 404:
			return "NOT_FOUND";
		case 409:
			return "CONFLICT";
		default:
			return "INTERNAL_SERVER_ERROR";
	}
}

export async function createDesign(input: {
	env: Env;
	body: z.infer<typeof createBody>;
}): Promise<{ projectId: string }> {
	const prisma = getPrisma(input.env);
	const container = await prisma.project.findUnique({
		where: { id: input.body.projectId },
	});
	if (!container) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "project not found",
		});
	}
	// Every design is born filed: the container is part of creation.
	const projectId = newDesignId();
	const uploadToken = newDesignUploadToken();
	await prisma.design.create({
		data: {
			id: projectId,
			prompt: input.body.prompt,
			uploadToken,
			projectId: container.id,
		},
	});
	return { projectId };
}

export async function listDesigns(env: Env) {
	const projects = await getPrisma(env).design.findMany({
		orderBy: { createdAt: "desc" },
		take: 100,
	});
	// Designs are always filed (the container is part of creation — see
	// createDesign), so the public contract types projectId as string. The
	// column stays nullable for legacy rows; restore the contract on read.
	return projects.map((design) => ({
		...design,
		projectId: design.projectId as string,
	}));
}

// ---------------------------------------------------------------------------
// Legacy building-block backfill (KUK-930) — admin-triggered conversion of a
// pre-pipeline monolithic design into Page/PageBlock rows + an initial
// publication. Procedure: designs.backfill
// ---------------------------------------------------------------------------

/**
 * Maps a BackfillResult onto tRPC errors: success resolves with the result
 * body (including the clean "no sections" and "contains scripts" refusals —
 * nothing was wrong, there is just nothing safely convertible), NOT_FOUND
 * when the design is missing or out of the project's scope, CONFLICT for the
 * row-state refusals: "already has pages" (another design's pages or a
 * completed backfill — final even with force) and "incomplete backfill"
 * (this design's own pages without a publication — the remedy is a retry
 * with `force: true`; nothing is deleted until the admin explicitly opts
 * in).
 */
export const backfillBody = z.object({
	/** Replace an incomplete prior attempt's pages (never a completed one). */
	force: z.boolean().optional(),
});

export async function backfillDesignRoute(input: {
	env: Env;
	projectId: string;
	designId: string;
	body: z.infer<typeof backfillBody>;
}) {
	const { env, projectId, designId, body } = input;
	if (!isProjectId(projectId) || !isDesignId(designId)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "invalid project id",
		});
	}
	const result = await backfillDesign(getPrisma(env), env, {
		designId,
		projectId,
		force: body.force,
	});
	if (!result.ok && result.reason === "not found") {
		throw new TRPCError({ code: "NOT_FOUND", message: "not found" });
	}
	if (!result.ok && result.reason === "already has pages") {
		throw new TRPCError({
			code: "CONFLICT",
			message: result.reason,
		});
	}
	if (!result.ok && result.reason === "incomplete backfill") {
		throw new TRPCError({
			code: "CONFLICT",
			message: result.reason,
		});
	}
	return result;
}

export async function getDesign(env: Env, projectId: string) {
	if (!isDesignId(projectId)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "invalid project id",
		});
	}
	const prisma = getPrisma(env);
	const project = await prisma.design.findUnique({
		where: { id: projectId },
	});
	if (!project) {
		throw new TRPCError({ code: "NOT_FOUND", message: "not found" });
	}
	// Latest publication (KUK-927): the inspector links the time-travel view
	// for it. Legacy designs (KUK-930) have no Publication rows — null there.
	const publication = await prisma.publication.findFirst({
		where: { designId: projectId },
		orderBy: { version: "desc" },
		select: { version: true, createdAt: true },
	});
	const files = await listDesignFiles(env.DESIGNS, projectId);
	// Legacy vs new-model branch (KUK-930): a design converted to the
	// building-block pipeline carries a Publication and its liveTurnId points
	// at the staged turns/<publicationId>/ prefix; a LEGACY design (no
	// Page/Publication rows) has no liveTurnId and its monolithic artifacts
	// sit at the bucket root. The `|| files.some(...)` fallbacks below are the
	// legacy branch — they must keep matching root-level index.html /
	// preview.png exactly as before, and `sections` stays emergent from
	// drafts/*.html regardless of pipeline state.
	return {
		...project,
		// Designs are always filed — restore the public contract's
		// non-null projectId (see listDesigns).
		projectId: project.projectId as string,
		/** Latest publication snapshot (null on legacy designs — KUK-930). */
		publication: publication
			? { version: publication.version, createdAt: publication.createdAt }
			: null,
		hasIndex:
			Boolean(project.liveTurnId) ||
			files.some((file) => file.path === "index.html"),
		hasPreview:
			Boolean(project.liveTurnId) ||
			files.some((file) => file.path === "preview.png"),
		sections: files
			.filter(
				(file) =>
					file.path.startsWith("drafts/") && file.path.endsWith(".html"),
			)
			.map((file) => file.path.slice("drafts/".length, -".html".length)),
		files,
	};
}

export async function fileDesign(input: {
	env: Env;
	designId: string;
	/** New container project id; the design can never become unfiled. */
	targetProjectId: string | null;
}) {
	const { env, designId, targetProjectId } = input;
	if (!isDesignId(designId)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "invalid project id",
		});
	}
	// Same validation as the old PATCH body: null (unfile) is rejected with
	// the schema's own message.
	const parsed = fileBody.safeParse({ projectId: targetProjectId });
	if (!parsed.success) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: firstIssueMessage(parsed.error),
		});
	}
	const prisma = getPrisma(env);
	const design = await prisma.design.findUnique({
		where: { id: designId },
	});
	if (!design) {
		throw new TRPCError({ code: "NOT_FOUND", message: "not found" });
	}
	const project = await prisma.project.findUnique({
		where: { id: parsed.data.projectId },
	});
	if (!project) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "project not found",
		});
	}
	const updated = await prisma.design.update({
		where: { id: designId },
		data: { projectId: parsed.data.projectId },
	});
	// Just filed to an existing project — projectId is non-null.
	return { ...updated, projectId: updated.projectId as string };
}

export async function deleteDesign(env: Env, projectId: string): Promise<void> {
	if (!isDesignId(projectId)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "invalid project id",
		});
	}
	const prisma = getPrisma(env);
	const existing = await prisma.design.findUnique({
		where: { id: projectId },
	});
	if (!existing) {
		throw new TRPCError({ code: "NOT_FOUND", message: "not found" });
	}
	await prisma.message.deleteMany({ where: { designId: projectId } });
	await prisma.design.delete({ where: { id: projectId } });
}

export async function listMessages(env: Env, projectId: string) {
	if (!isDesignId(projectId)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "invalid project id",
		});
	}
	// Newest turns first, then reversed — so an overflow drops the OLDEST
	// rows and the cap never hides the current conversation (an asc window
	// would lose every recent turn once the transcript passes the cap).
	const messages = await getPrisma(env).message.findMany({
		where: { designId: projectId },
		orderBy: { createdAt: "desc" },
		take: 200,
	});
	return messages.reverse().map((message) => ({
		id: message.id,
		role: message.role,
		content: message.content,
		// Raw stored parts JSON (reasoning + tool calls); parsed and validated
		// client-side by parseStoredParts.
		parts: message.parts,
		attachments: parseAttachments(message.attachments),
		createdAt: message.createdAt,
	}));
}

export async function listVersions(env: Env, projectId: string) {
	if (!isDesignId(projectId)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "invalid project id",
		});
	}
	return listDesignVersions(env, projectId);
}

export async function restoreVersion(input: {
	env: Env;
	projectId: string;
	n: number;
}) {
	const { env, projectId, n } = input;
	if (!isDesignId(projectId)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "invalid project id",
		});
	}
	try {
		return await restoreDesignVersion(env, projectId, n);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message.includes("not found")) {
			throw new TRPCError({ code: "NOT_FOUND", message });
		}
		console.log(`[designs] restore failed for ${projectId}:`, error);
		throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
	}
}

export async function debugExec(input: {
	env: Env;
	projectId: string;
	adminUserId: string;
	body: z.infer<typeof debugExecBody>;
}) {
	const { env, projectId, adminUserId, body } = input;
	if (!isDesignId(projectId)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "invalid project id",
		});
	}
	console.log(
		`[designs] debug-exec by ${adminUserId} on ${projectId}: ${body.command}`,
	);
	const result = await designSandbox(env, projectId).exec(body.command);
	return {
		success: result.success,
		exitCode: result.exitCode,
		stdout: result.stdout,
		stderr: result.stderr,
	};
}

// ---------------------------------------------------------------------------
// Component lifecycle (KUK-921) — publish / restore / retire. Procedures:
//   designs.components.publish   (componentId, versionId)
//   designs.components.restore   (componentId, versionId)
//   designs.components.retire    (componentId)
// ---------------------------------------------------------------------------

/**
 * Maps library failures onto tRPC error codes (404/409/400/500), keeping
 * the library's own message text.
 */
function componentError(error: unknown, label: string): never {
	if (error instanceof ComponentPublishError) {
		throw new TRPCError({
			code: statusToCode(error.status),
			message: error.message,
		});
	}
	console.log(`[designs] ${label} failed:`, error);
	// Generic body on the unexpected path: library/Prisma internals do not
	// reach the client (admin-only surface, but defensive practice matches
	// the other handlers); the details are in the server log above.
	throw new TRPCError({
		code: "INTERNAL_SERVER_ERROR",
		message: `${label} failed — see server logs`,
	});
}

/** Loads the component and asserts it belongs to the path's project. */
async function loadProjectComponent(
	env: Env,
	projectId: string,
	componentId: string,
) {
	const component = await getPrisma(env).component.findUnique({
		where: { id: componentId },
	});
	if (!component || component.projectId !== projectId) return null;
	return component;
}

async function requireProjectComponent(
	env: Env,
	projectId: string,
	componentId: string,
) {
	if (!(await loadProjectComponent(env, projectId, componentId))) {
		throw new TRPCError({ code: "NOT_FOUND", message: "not found" });
	}
}

export async function publishComponentVersion(input: {
	env: Env;
	projectId: string;
	componentId: string;
	versionId: string;
	body: z.infer<typeof componentTurnBody>;
}) {
	const { env, projectId, componentId, versionId, body } = input;
	await requireProjectComponent(env, projectId, componentId);
	try {
		return await publishComponentVersionOp(getPrisma(env), env, {
			componentId,
			versionId,
			turnId: body.turnId,
		});
	} catch (error) {
		componentError(error, "component publish");
	}
}

export async function restoreComponentVersion(input: {
	env: Env;
	projectId: string;
	componentId: string;
	versionId: string;
	body: z.infer<typeof componentTurnBody>;
}) {
	const { env, projectId, componentId, versionId, body } = input;
	await requireProjectComponent(env, projectId, componentId);
	try {
		return await restoreComponentVersionOp(getPrisma(env), env, {
			componentId,
			versionId,
			turnId: body.turnId,
		});
	} catch (error) {
		componentError(error, "component restore");
	}
}

export async function retireComponentVersion(input: {
	env: Env;
	projectId: string;
	componentId: string;
	body: z.infer<typeof componentTurnBody>;
}) {
	const { env, projectId, componentId, body } = input;
	await requireProjectComponent(env, projectId, componentId);
	try {
		return await retireComponentVersionOp(getPrisma(env), env, {
			componentId,
			turnId: body.turnId,
		});
	} catch (error) {
		componentError(error, "component retire");
	}
}

// ---------------------------------------------------------------------------
// Component library inspector (KUK-927) — the studio's read surface for the
// component library plus the single-block re-pin. Procedures:
//   designs.components.list    ({ projectId, designId? })
//   designs.components.repin   ({ projectId, designId, pageId, blockId })
// ---------------------------------------------------------------------------

export async function listProjectComponents(input: {
	env: Env;
	projectId: string;
	designId?: string;
}) {
	const { env, projectId, designId } = input;
	if (!isProjectId(projectId)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "invalid project id",
		});
	}
	if (designId !== undefined && !isDesignId(designId)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "invalid design id",
		});
	}
	try {
		return await listProjectLibrary(getPrisma(env), env, {
			projectId,
			designId,
		});
	} catch (error) {
		console.log(
			`[designs] component library read failed for ${projectId}:`,
			error,
		);
		throw new TRPCError({
			code: "INTERNAL_SERVER_ERROR",
			message: "component library read failed — see server logs",
		});
	}
}

export const repinBody = z.object({
	componentId: z.string().min(1),
});

export async function repinBlock(input: {
	env: Env;
	projectId: string;
	designId: string;
	pageId: string;
	blockId: string;
	body: z.infer<typeof repinBody>;
}) {
	const { env, projectId, designId, pageId, blockId, body } = input;
	if (!isProjectId(projectId) || !isDesignId(designId)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "invalid project id",
		});
	}
	const outcome = await repinPageBlock(getPrisma(env), {
		projectId,
		designId,
		pageId,
		blockId,
		componentId: body.componentId,
	});
	if (!outcome.ok && outcome.reason === "not found") {
		throw new TRPCError({ code: "NOT_FOUND", message: "not found" });
	}
	if (!outcome.ok) {
		throw new TRPCError({ code: "CONFLICT", message: outcome.message });
	}
	return outcome.block;
}

// ---------------------------------------------------------------------------
// Page composer (KUK-928) — the studio's authoring surface for a design's
// pages and their ordered blocks. Procedures:
//   designs.pages.list           ({ projectId, designId })
//   designs.pages.create         ({ projectId, designId, path, title })
//   designs.pages.update         ({ projectId, designId, pageId, ... })
//   designs.pages.delete         ({ projectId, designId, pageId })
//   designs.pages.replaceBlocks  ({ projectId, designId, pageId, blocks })
// ---------------------------------------------------------------------------

/**
 * Maps a lib PageToolFailure (model-correctable errors as values) onto tRPC
 * errors: the client surfaces the full error list joined into one message —
 * the old JSON body carried `errors` which jfetch joined with "; " — and the
 * op's status (400/404/409) is preserved as the tRPC error code.
 */
function pageToolError(result: PageToolFailure): never {
	throw new TRPCError({
		code: statusToCode(result.status),
		message: result.errors.join("; "),
	});
}

export const createPageBody = z.object({
	path: z.string().min(1).max(200),
	title: z.string().min(1).max(200),
});

export const updatePageBody = z.object({
	path: z.string().min(1).max(200).nullish(),
	title: z.string().min(1).max(200).nullish(),
});

// Loose on purpose: the lib op shape-checks every block field (unknown
// component/draft pin/unknown attribute/unknown collection are all
// model-correctable errors) — the route only bounds the envelope.
export const replaceBlocksBody = z.object({
	blocks: z.array(z.unknown()).max(100),
});

export async function listDesignPages(input: {
	env: Env;
	projectId: string;
	designId: string;
}) {
	const { env, projectId, designId } = input;
	if (!isProjectId(projectId) || !isDesignId(designId)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "invalid project id",
		});
	}
	const view = await listDesignComposerPages(getPrisma(env), {
		projectId,
		designId,
	});
	if (!view) {
		throw new TRPCError({ code: "NOT_FOUND", message: "not found" });
	}
	return view;
}

export async function createPage(input: {
	env: Env;
	projectId: string;
	designId: string;
	body: z.infer<typeof createPageBody>;
}) {
	const { env, projectId, designId, body } = input;
	if (!isProjectId(projectId) || !isDesignId(designId)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "invalid project id",
		});
	}
	const result = await createPageTool(getPrisma(env), {
		projectId,
		designId,
		path: body.path,
		title: body.title,
	});
	if (!result.ok) pageToolError(result);
	return { page: result.page };
}

export async function updatePage(input: {
	env: Env;
	projectId: string;
	designId: string;
	pageId: string;
	body: z.infer<typeof updatePageBody>;
}) {
	const { env, projectId, designId, pageId, body } = input;
	if (!isProjectId(projectId) || !isDesignId(designId)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "invalid project id",
		});
	}
	const result = await updatePageTool(getPrisma(env), {
		projectId,
		designId,
		pageId,
		path: body.path ?? null,
		title: body.title ?? null,
	});
	if (!result.ok) pageToolError(result);
	return { page: result.page };
}

export async function deletePage(input: {
	env: Env;
	projectId: string;
	designId: string;
	pageId: string;
}): Promise<void> {
	const { env, projectId, designId, pageId } = input;
	if (!isProjectId(projectId) || !isDesignId(designId)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "invalid project id",
		});
	}
	const result = await deletePageTool(getPrisma(env), {
		projectId,
		designId,
		pageId,
	});
	if (!result.ok) pageToolError(result);
}

export async function replacePageBlocks(input: {
	env: Env;
	projectId: string;
	designId: string;
	pageId: string;
	body: z.infer<typeof replaceBlocksBody>;
}) {
	const { env, projectId, designId, pageId, body } = input;
	if (!isProjectId(projectId) || !isDesignId(designId)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "invalid project id",
		});
	}
	const result = await replacePageBlocksTool(getPrisma(env), env.DB, {
		projectId,
		designId,
		pageId,
		blocks: body.blocks,
	});
	if (!result.ok) pageToolError(result);
	return {
		page: result.page,
		blocks: result.blocks ?? [],
	};
}
