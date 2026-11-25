import { z } from "zod";
import {
	generateCampaignShare,
	revokeCampaignShare,
	updateCampaignShare,
	updateCampaignShareBody,
} from "@/features/campaigns/share/campaign-share";
import {
	createAudience,
	createAudienceBody,
	deleteAudience,
	listAudiences,
	updateAudience,
	updateAudienceBody,
} from "@/server/data/campaign-audiences";
import {
	briefPatchBody,
	createEventBody,
	createPhaseBody,
	createPlanBody,
	createReportBody,
	deleteDocument,
	deleteDocumentBody,
	getDocument,
	patchDocument,
	patchEventBody,
	patchPhaseBody,
	patchPlanBody,
	patchReportBody,
	postDocument,
} from "@/server/data/campaign-documents";
import {
	createKpi,
	createKpiBody,
	createResult,
	createResultBody,
	deleteKpi,
	deleteResult,
	listKpis,
	listResults,
	updateKpi,
	updateKpiBody,
	updateResult,
	updateResultBody,
} from "@/server/data/campaign-kpis";
import {
	createAssetBody,
	createCampaign,
	createCampaignAssetManual,
	createCampaignBody,
	deleteCampaign,
	getCampaign,
	listCampaignAssets,
	listCampaignMessages,
	listCampaigns,
	releaseCampaignTurn,
	updateCampaign,
	updateCampaignBody,
	updateCampaignEvent,
	updateEventBody,
} from "@/server/data/campaigns";
import { adminProcedure, router } from "../trpc";

const campaignIdField = z.string().min(1);

export const campaignsRouter = router({
	list: adminProcedure
		.input(z.object({ projectId: z.string().optional() }).optional())
		.query(({ ctx, input }) =>
			listCampaigns(ctx.env, input?.projectId ?? null),
		),

	create: adminProcedure
		.input(createCampaignBody)
		.mutation(({ ctx, input }) =>
			createCampaign({ env: ctx.env, body: input }),
		),

	get: adminProcedure
		.input(z.object({ campaignId: campaignIdField }))
		.query(({ ctx, input }) => getCampaign(ctx.env, input.campaignId)),

	update: adminProcedure
		.input(updateCampaignBody.and(z.object({ campaignId: campaignIdField })))
		.mutation(({ ctx, input }) =>
			updateCampaign({
				env: ctx.env,
				campaignId: input.campaignId,
				body: input,
			}),
		),

	delete: adminProcedure
		.input(z.object({ campaignId: campaignIdField }))
		.mutation(({ ctx, input }) => deleteCampaign(ctx.env, input.campaignId)),

	listAssets: adminProcedure
		.input(z.object({ campaignId: campaignIdField }))
		.query(({ ctx, input }) => listCampaignAssets(ctx.env, input.campaignId)),

	createAsset: adminProcedure
		.input(createAssetBody.extend({ campaignId: campaignIdField }))
		.mutation(({ ctx, input }) =>
			createCampaignAssetManual({
				env: ctx.env,
				campaignId: input.campaignId,
				body: input,
			}),
		),

	listMessages: adminProcedure
		.input(z.object({ campaignId: campaignIdField }))
		.query(({ ctx, input }) => listCampaignMessages(ctx.env, input.campaignId)),

	releaseTurn: adminProcedure
		.input(z.object({ campaignId: campaignIdField }))
		.mutation(({ ctx, input }) =>
			releaseCampaignTurn(ctx.env, input.campaignId),
		),

	updateEventSlot: adminProcedure
		.input(
			updateEventBody.and(
				z.object({
					campaignId: campaignIdField,
					eventId: z.string().min(1),
				}),
			),
		)
		.mutation(({ ctx, input }) => {
			const { campaignId, eventId, ...body } = input;
			// Only the PATCH fields may reach Prisma — the update path
			// writes every body key (same pattern as kpis.update).
			return updateCampaignEvent({
				env: ctx.env,
				campaignId,
				eventId,
				body,
			});
		}),

	share: router({
		generate: adminProcedure
			.input(z.object({ campaignId: campaignIdField }))
			.mutation(({ ctx, input }) =>
				generateCampaignShare(ctx.env, input.campaignId),
			),

		update: adminProcedure
			.input(
				updateCampaignShareBody.and(z.object({ campaignId: campaignIdField })),
			)
			.mutation(({ ctx, input }) =>
				updateCampaignShare({
					env: ctx.env,
					campaignId: input.campaignId,
					body: input,
				}),
			),

		revoke: adminProcedure
			.input(z.object({ campaignId: campaignIdField }))
			.mutation(({ ctx, input }) =>
				revokeCampaignShare(ctx.env, input.campaignId),
			),
	}),

	kpis: router({
		list: adminProcedure
			.input(z.object({ campaignId: campaignIdField }))
			.query(({ ctx, input }) => listKpis(ctx.env, input.campaignId)),

		create: adminProcedure
			.input(createKpiBody.extend({ campaignId: campaignIdField }))
			.mutation(({ ctx, input }) =>
				createKpi({ env: ctx.env, campaignId: input.campaignId, body: input }),
			),

		update: adminProcedure
			.input(
				updateKpiBody.extend({
					campaignId: campaignIdField,
					kpiId: z.string().min(1),
				}),
			)
			.mutation(({ ctx, input }) => {
				const { campaignId, kpiId, ...body } = input;
				// Only the PATCH fields may reach Prisma — the update path
				// writes every body key.
				return updateKpi({ env: ctx.env, campaignId, kpiId, body });
			}),

		delete: adminProcedure
			.input(
				z.object({ campaignId: campaignIdField, kpiId: z.string().min(1) }),
			)
			.mutation(({ ctx, input }) =>
				deleteKpi(ctx.env, input.campaignId, input.kpiId),
			),
	}),

	kpiResults: router({
		list: adminProcedure
			.input(z.object({ campaignId: campaignIdField }))
			.query(({ ctx, input }) => listResults(ctx.env, input.campaignId)),

		create: adminProcedure
			.input(createResultBody.extend({ campaignId: campaignIdField }))
			.mutation(({ ctx, input }) =>
				createResult({
					env: ctx.env,
					campaignId: input.campaignId,
					body: input,
				}),
			),

		update: adminProcedure
			.input(
				updateResultBody.extend({
					campaignId: campaignIdField,
					resultId: z.string().min(1),
				}),
			)
			.mutation(({ ctx, input }) => {
				const { campaignId, resultId, ...body } = input;
				// Only the PATCH fields may reach Prisma — the update path
				// writes every body key.
				return updateResult({
					env: ctx.env,
					campaignId,
					resultId,
					body,
				});
			}),

		delete: adminProcedure
			.input(
				z.object({ campaignId: campaignIdField, resultId: z.string().min(1) }),
			)
			.mutation(({ ctx, input }) =>
				deleteResult(ctx.env, input.campaignId, input.resultId),
			),
	}),

	// Per-campaign target audiences (structured segmentation rows) — fenced
	// CRUD, same shape as the kpis router above.
	audiences: router({
		list: adminProcedure
			.input(z.object({ campaignId: campaignIdField }))
			.query(({ ctx, input }) => listAudiences(ctx.env, input.campaignId)),

		create: adminProcedure
			.input(createAudienceBody.extend({ campaignId: campaignIdField }))
			.mutation(({ ctx, input }) =>
				createAudience({
					env: ctx.env,
					campaignId: input.campaignId,
					body: input,
				}),
			),

		update: adminProcedure
			.input(
				updateAudienceBody.extend({
					campaignId: campaignIdField,
					audienceId: z.string().min(1),
				}),
			)
			.mutation(({ ctx, input }) => {
				const { campaignId, audienceId, ...body } = input;
				// Only the PATCH fields may reach Prisma — the update path
				// writes every body key (same pattern as kpis.update).
				return updateAudience({
					env: ctx.env,
					campaignId,
					audienceId,
					body,
				});
			}),

		delete: adminProcedure
			.input(
				z.object({
					campaignId: campaignIdField,
					audienceId: z.string().min(1),
				}),
			)
			.mutation(({ ctx, input }) =>
				deleteAudience(ctx.env, input.campaignId, input.audienceId),
			),
	}),

	// Thin semantic wrappers over the kind-dispatching document handlers —
	// the internal dispatch logic stays in the handler (campaign-documents.ts).
	documents: router({
		getReport: adminProcedure
			.input(
				z.object({ campaignId: campaignIdField, reportId: z.string().min(1) }),
			)
			.query(({ ctx, input }) =>
				getDocument({
					env: ctx.env,
					campaignId: input.campaignId,
					reportId: input.reportId,
				}),
			),

		saveBrief: adminProcedure
			.input(z.object({ campaignId: campaignIdField, fields: briefPatchBody }))
			.mutation(({ ctx, input }) =>
				patchDocument({
					env: ctx.env,
					campaignId: input.campaignId,
					body: { kind: "brief", ...input.fields },
				}),
			),

		createPlan: adminProcedure
			.input(createPlanBody.extend({ campaignId: campaignIdField }))
			.mutation(({ ctx, input }) =>
				postDocument({
					env: ctx.env,
					campaignId: input.campaignId,
					body: {
						kind: "plan",
						name: input.name,
						status: input.status,
					},
				}),
			),

		updatePlan: adminProcedure
			.input(
				patchPlanBody.extend({
					campaignId: campaignIdField,
					planId: z.string().min(1),
				}),
			)
			.mutation(({ ctx, input }) =>
				patchDocument({
					env: ctx.env,
					campaignId: input.campaignId,
					body: {
						kind: "plan",
						planId: input.planId,
						name: input.name,
						status: input.status,
					},
				}),
			),

		addPhase: adminProcedure
			.input(createPhaseBody.extend({ campaignId: campaignIdField }))
			.mutation(({ ctx, input }) =>
				postDocument({
					env: ctx.env,
					campaignId: input.campaignId,
					body: {
						kind: "phase",
						planId: input.planId,
						name: input.name,
						objective: input.objective,
						startsAt: input.startsAt,
						endsAt: input.endsAt,
						body: input.body,
					},
				}),
			),

		updatePhase: adminProcedure
			.input(
				patchPhaseBody.extend({
					campaignId: campaignIdField,
					phaseId: z.string().min(1),
				}),
			)
			.mutation(({ ctx, input }) =>
				patchDocument({
					env: ctx.env,
					campaignId: input.campaignId,
					body: {
						kind: "phase",
						phaseId: input.phaseId,
						name: input.name,
						objective: input.objective,
						startsAt: input.startsAt,
						endsAt: input.endsAt,
						body: input.body,
						position: input.position,
					},
				}),
			),

		createEvent: adminProcedure
			.input(createEventBody.extend({ campaignId: campaignIdField }))
			.mutation(({ ctx, input }) =>
				postDocument({
					env: ctx.env,
					campaignId: input.campaignId,
					body: {
						kind: "event",
						title: input.title,
						channelId: input.channelId,
						scheduledAt: input.scheduledAt,
						status: input.status,
						notes: input.notes,
					},
				}),
			),

		updateEvent: adminProcedure
			.input(
				patchEventBody.extend({
					campaignId: campaignIdField,
					eventId: z.string().min(1),
				}),
			)
			.mutation(({ ctx, input }) =>
				patchDocument({
					env: ctx.env,
					campaignId: input.campaignId,
					body: {
						kind: "event",
						eventId: input.eventId,
						title: input.title,
						channelId: input.channelId,
						scheduledAt: input.scheduledAt,
						status: input.status,
						notes: input.notes,
					},
				}),
			),

		createReport: adminProcedure
			.input(createReportBody.extend({ campaignId: campaignIdField }))
			.mutation(({ ctx, input }) =>
				postDocument({
					env: ctx.env,
					campaignId: input.campaignId,
					body: {
						kind: "report",
						title: input.title,
						periodStart: input.periodStart,
						periodEnd: input.periodEnd,
						summary: input.summary,
						metrics: input.metrics,
						body: input.body,
					},
				}),
			),

		updateReport: adminProcedure
			.input(
				patchReportBody.extend({
					campaignId: campaignIdField,
					reportId: z.string().min(1),
				}),
			)
			.mutation(({ ctx, input }) =>
				patchDocument({
					env: ctx.env,
					campaignId: input.campaignId,
					body: {
						kind: "report",
						reportId: input.reportId,
						title: input.title,
						periodStart: input.periodStart,
						periodEnd: input.periodEnd,
						summary: input.summary,
						metrics: input.metrics,
						body: input.body,
					},
				}),
			),

		delete: adminProcedure
			.input(deleteDocumentBody.extend({ campaignId: campaignIdField }))
			.mutation(({ ctx, input }) =>
				deleteDocument({
					env: ctx.env,
					campaignId: input.campaignId,
					body: { kind: input.kind, id: input.id },
				}),
			),
	}),
});
