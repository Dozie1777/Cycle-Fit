import { z } from "zod";
import {
	adoptBody,
	adoptBrandKit,
	deleteBrandKit,
	getBrandKit,
	upsertBrandKit,
	upsertBrandKitBody,
} from "@/server/data/brand-kits";
import {
	collectionBody,
	createDataCollection,
	defineFlow,
	defineFlowBody,
	defineTemplate,
	defineTemplateBody,
	deleteDataCollection,
	deleteFlow,
	deleteTemplate,
	listDataCollections,
	listFlows,
	listTemplates,
	recordsBody,
	renameCollectionBody,
	renameDataCollection,
	replaceDataRecords,
} from "@/server/data/building-blocks";
import {
	createDesignBody,
	createProject,
	createProjectBody,
	createProjectDesign,
	deleteProject,
	getProject,
	listProjects,
	updateProject,
	updateProjectBody,
} from "@/server/data/projects";
import { adminProcedure, router } from "../trpc";

const projectId = z.string().min(1);

export const projectsRouter = router({
	list: adminProcedure.query(({ ctx }) => listProjects(ctx.env)),

	get: adminProcedure
		.input(z.object({ projectId }))
		.query(({ ctx, input }) => getProject(ctx.env, input.projectId)),

	create: adminProcedure
		.input(createProjectBody)
		.mutation(({ ctx, input }) => createProject({ env: ctx.env, body: input })),

	update: adminProcedure
		.input(updateProjectBody.extend({ projectId }))
		.mutation(({ ctx, input }) =>
			updateProject({
				env: ctx.env,
				projectId: input.projectId,
				body: input,
			}),
		),

	delete: adminProcedure
		.input(z.object({ projectId }))
		.mutation(({ ctx, input }) => deleteProject(ctx.env, input.projectId)),

	createDesign: adminProcedure
		.input(createDesignBody.extend({ projectId }))
		.mutation(({ ctx, input }) =>
			createProjectDesign({
				env: ctx.env,
				projectId: input.projectId,
				body: input,
			}),
		),

	brandKit: router({
		// GET semantics: NOT_FOUND when the project (or its kit) is missing —
		// the client maps that error to the empty state (null).
		get: adminProcedure
			.input(z.object({ projectId }))
			.query(({ ctx, input }) => getBrandKit(ctx.env, input.projectId)),

		// Full-replace upsert; the PUT body schema stays nested under `body`
		// (it's superRefine'd, so it can't be extended with the path id).
		upsert: adminProcedure
			.input(z.object({ projectId, body: upsertBrandKitBody }))
			.mutation(({ ctx, input }) =>
				upsertBrandKit({
					env: ctx.env,
					projectId: input.projectId,
					body: input.body,
				}),
			),

		delete: adminProcedure
			.input(z.object({ projectId }))
			.mutation(({ ctx, input }) => deleteBrandKit(ctx.env, input.projectId)),

		adopt: adminProcedure
			.input(adoptBody.extend({ projectId }))
			.mutation(({ ctx, input }) =>
				adoptBrandKit({
					env: ctx.env,
					projectId: input.projectId,
					designId: input.designId,
				}),
			),
	}),

	data: router({
		list: adminProcedure
			.input(z.object({ projectId }))
			.query(({ ctx, input }) =>
				listDataCollections({ env: ctx.env, projectId: input.projectId }),
			),

		create: adminProcedure
			.input(collectionBody.extend({ projectId }))
			.mutation(({ ctx, input }) =>
				createDataCollection({
					env: ctx.env,
					projectId: input.projectId,
					name: input.name,
				}),
			),

		rename: adminProcedure
			.input(
				renameCollectionBody.extend({ projectId, collectionId: projectId }),
			)
			.mutation(({ ctx, input }) =>
				renameDataCollection({
					env: ctx.env,
					projectId: input.projectId,
					collectionId: input.collectionId,
					name: input.name,
				}),
			),

		delete: adminProcedure
			.input(z.object({ projectId, collectionId: projectId }))
			.mutation(({ ctx, input }) =>
				deleteDataCollection({
					env: ctx.env,
					projectId: input.projectId,
					collectionId: input.collectionId,
				}),
			),

		replaceRecords: adminProcedure
			.input(recordsBody.extend({ projectId, collectionId: projectId }))
			.mutation(({ ctx, input }) =>
				replaceDataRecords({
					env: ctx.env,
					projectId: input.projectId,
					collectionId: input.collectionId,
					records: input.records,
				}),
			),
	}),

	templates: router({
		list: adminProcedure
			.input(z.object({ projectId }))
			.query(({ ctx, input }) =>
				listTemplates({ env: ctx.env, projectId: input.projectId }),
			),

		define: adminProcedure
			.input(z.object({ projectId, body: defineTemplateBody }))
			.mutation(({ ctx, input }) =>
				defineTemplate({
					env: ctx.env,
					projectId: input.projectId,
					body: input.body,
				}),
			),

		delete: adminProcedure
			.input(z.object({ projectId, templateId: projectId }))
			.mutation(({ ctx, input }) =>
				deleteTemplate({
					env: ctx.env,
					projectId: input.projectId,
					templateId: input.templateId,
				}),
			),
	}),

	flows: router({
		list: adminProcedure
			.input(z.object({ projectId }))
			.query(({ ctx, input }) =>
				listFlows({ env: ctx.env, projectId: input.projectId }),
			),

		define: adminProcedure
			.input(z.object({ projectId, body: defineFlowBody }))
			.mutation(({ ctx, input }) =>
				defineFlow({
					env: ctx.env,
					projectId: input.projectId,
					body: input.body,
				}),
			),

		delete: adminProcedure
			.input(z.object({ projectId, flowId: projectId }))
			.mutation(({ ctx, input }) =>
				deleteFlow({
					env: ctx.env,
					projectId: input.projectId,
					flowId: input.flowId,
				}),
			),
	}),
});
