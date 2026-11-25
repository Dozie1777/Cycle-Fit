import { z } from "zod";
import {
	deleteAsset,
	descriptionBody,
	listDesignAssets,
	regenerateAssetDescription,
	updateAsset,
} from "@/server/data/design-assets";
import {
	backfillBody,
	backfillDesignRoute,
	componentTurnBody,
	createBody,
	createDesign,
	createPage,
	createPageBody,
	debugExec,
	debugExecBody,
	deleteDesign,
	deletePage,
	fileDesign,
	getDesign,
	listDesignPages,
	listDesigns,
	listMessages,
	listProjectComponents,
	listVersions,
	publishComponentVersion,
	repinBlock,
	repinBody,
	replaceBlocksBody,
	replacePageBlocks,
	restoreBody,
	restoreComponentVersion,
	restoreVersion,
	retireComponentVersion,
	updatePage,
	updatePageBody,
} from "@/server/data/designs";
import { adminProcedure, router } from "../trpc";

const projectIdInput = z.object({ projectId: z.string().min(1) });

export const designsRouter = router({
	list: adminProcedure.query(({ ctx }) => listDesigns(ctx.env)),

	create: adminProcedure
		.input(createBody)
		.mutation(({ ctx, input }) => createDesign({ env: ctx.env, body: input })),

	get: adminProcedure
		.input(projectIdInput)
		.query(({ ctx, input }) => getDesign(ctx.env, input.projectId)),

	file: adminProcedure
		.input(
			z.object({
				designId: z.string().min(1),
				targetProjectId: z.string().nullable(),
			}),
		)
		.mutation(({ ctx, input }) =>
			fileDesign({
				env: ctx.env,
				designId: input.designId,
				targetProjectId: input.targetProjectId,
			}),
		),

	delete: adminProcedure
		.input(projectIdInput)
		.mutation(({ ctx, input }) => deleteDesign(ctx.env, input.projectId)),

	listVersions: adminProcedure
		.input(projectIdInput)
		.query(({ ctx, input }) => listVersions(ctx.env, input.projectId)),

	restoreVersion: adminProcedure
		.input(restoreBody.extend({ projectId: z.string().min(1) }))
		.mutation(({ ctx, input }) =>
			restoreVersion({ env: ctx.env, projectId: input.projectId, n: input.n }),
		),

	listMessages: adminProcedure
		.input(projectIdInput)
		.query(({ ctx, input }) => listMessages(ctx.env, input.projectId)),

	debugExec: adminProcedure
		.input(debugExecBody.extend({ projectId: z.string().min(1) }))
		.mutation(({ ctx, input }) =>
			debugExec({
				env: ctx.env,
				projectId: input.projectId,
				adminUserId: ctx.auth.user.id,
				body: input,
			}),
		),

	backfill: adminProcedure
		.input(
			backfillBody.extend({
				projectId: z.string().min(1),
				designId: z.string().min(1),
			}),
		)
		.mutation(({ ctx, input }) =>
			backfillDesignRoute({
				env: ctx.env,
				projectId: input.projectId,
				designId: input.designId,
				body: input,
			}),
		),

	assets: router({
		list: adminProcedure
			.input(projectIdInput)
			.query(({ ctx, input }) => listDesignAssets(ctx.env, input.projectId)),

		update: adminProcedure
			.input(
				descriptionBody.extend({
					projectId: z.string().min(1),
					assetId: z.string().min(1),
				}),
			)
			.mutation(({ ctx, input }) =>
				updateAsset({
					env: ctx.env,
					projectId: input.projectId,
					assetId: input.assetId,
					description: input.description,
				}),
			),

		delete: adminProcedure
			.input(
				z.object({
					projectId: z.string().min(1),
					assetId: z.string().min(1),
				}),
			)
			.mutation(({ ctx, input }) =>
				deleteAsset({
					env: ctx.env,
					projectId: input.projectId,
					assetId: input.assetId,
				}),
			),

		describe: adminProcedure
			.input(
				z.object({
					projectId: z.string().min(1),
					assetId: z.string().min(1),
				}),
			)
			.mutation(({ ctx, input }) =>
				regenerateAssetDescription({
					env: ctx.env,
					projectId: input.projectId,
					assetId: input.assetId,
					waitUntil: (promise) => ctx.executionCtx.waitUntil(promise),
				}),
			),
	}),

	components: router({
		list: adminProcedure
			.input(
				z.object({
					projectId: z.string().min(1),
					designId: z.string().optional(),
				}),
			)
			.query(({ ctx, input }) =>
				listProjectComponents({
					env: ctx.env,
					projectId: input.projectId,
					designId: input.designId,
				}),
			),

		repin: adminProcedure
			.input(
				repinBody.extend({
					projectId: z.string().min(1),
					designId: z.string().min(1),
					pageId: z.string().min(1),
					blockId: z.string().min(1),
				}),
			)
			.mutation(({ ctx, input }) =>
				repinBlock({
					env: ctx.env,
					projectId: input.projectId,
					designId: input.designId,
					pageId: input.pageId,
					blockId: input.blockId,
					body: input,
				}),
			),

		publish: adminProcedure
			.input(
				componentTurnBody.extend({
					projectId: z.string().min(1),
					componentId: z.string().min(1),
					versionId: z.string().min(1),
				}),
			)
			.mutation(({ ctx, input }) =>
				publishComponentVersion({
					env: ctx.env,
					projectId: input.projectId,
					componentId: input.componentId,
					versionId: input.versionId,
					body: input,
				}),
			),

		restore: adminProcedure
			.input(
				componentTurnBody.extend({
					projectId: z.string().min(1),
					componentId: z.string().min(1),
					versionId: z.string().min(1),
				}),
			)
			.mutation(({ ctx, input }) =>
				restoreComponentVersion({
					env: ctx.env,
					projectId: input.projectId,
					componentId: input.componentId,
					versionId: input.versionId,
					body: input,
				}),
			),

		retire: adminProcedure
			.input(
				componentTurnBody.extend({
					projectId: z.string().min(1),
					componentId: z.string().min(1),
				}),
			)
			.mutation(({ ctx, input }) =>
				retireComponentVersion({
					env: ctx.env,
					projectId: input.projectId,
					componentId: input.componentId,
					body: input,
				}),
			),
	}),

	pages: router({
		list: adminProcedure
			.input(
				z.object({
					projectId: z.string().min(1),
					designId: z.string().min(1),
				}),
			)
			.query(({ ctx, input }) =>
				listDesignPages({
					env: ctx.env,
					projectId: input.projectId,
					designId: input.designId,
				}),
			),

		create: adminProcedure
			.input(
				createPageBody.extend({
					projectId: z.string().min(1),
					designId: z.string().min(1),
				}),
			)
			.mutation(({ ctx, input }) =>
				createPage({
					env: ctx.env,
					projectId: input.projectId,
					designId: input.designId,
					body: input,
				}),
			),

		update: adminProcedure
			.input(
				updatePageBody.extend({
					projectId: z.string().min(1),
					designId: z.string().min(1),
					pageId: z.string().min(1),
				}),
			)
			.mutation(({ ctx, input }) =>
				updatePage({
					env: ctx.env,
					projectId: input.projectId,
					designId: input.designId,
					pageId: input.pageId,
					body: input,
				}),
			),

		delete: adminProcedure
			.input(
				z.object({
					projectId: z.string().min(1),
					designId: z.string().min(1),
					pageId: z.string().min(1),
				}),
			)
			.mutation(({ ctx, input }) =>
				deletePage({
					env: ctx.env,
					projectId: input.projectId,
					designId: input.designId,
					pageId: input.pageId,
				}),
			),

		replaceBlocks: adminProcedure
			.input(
				replaceBlocksBody.extend({
					projectId: z.string().min(1),
					designId: z.string().min(1),
					pageId: z.string().min(1),
				}),
			)
			.mutation(({ ctx, input }) =>
				replacePageBlocks({
					env: ctx.env,
					projectId: input.projectId,
					designId: input.designId,
					pageId: input.pageId,
					body: input,
				}),
			),
	}),
});
