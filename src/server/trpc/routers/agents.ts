import { z } from "zod";
import { createAdmin, createAdminBody, listAdmins } from "@/server/data/admins";
import {
	createAgent,
	createAgentBody,
	listAgents,
	patchAgentCredential,
	patchCredentialBody,
	registerCredential,
	registerCredentialBody,
} from "@/server/data/agents";
import { adminProcedure, router } from "../trpc";

export const agentsRouter = router({
	list: adminProcedure.query(({ ctx }) => listAgents(ctx.env)),

	create: adminProcedure.input(createAgentBody).mutation(({ ctx, input }) =>
		createAgent({
			env: ctx.env,
			body: input,
			headers: ctx.request.headers,
		}),
	),

	registerCredential: adminProcedure
		.input(
			registerCredentialBody.extend({
				agentId: z.string().min(1),
			}),
		)
		.mutation(({ ctx, input }) =>
			registerCredential({
				env: ctx.env,
				agentId: input.agentId,
				adminUserId: ctx.auth.user.id,
				body: input,
			}),
		),

	updateCredential: adminProcedure
		.input(
			patchCredentialBody.and(
				z.object({
					agentId: z.string().min(1),
					credentialId: z.string().min(1),
				}),
			),
		)
		.mutation(({ ctx, input }) =>
			patchAgentCredential({
				env: ctx.env,
				agentId: input.agentId,
				credentialId: input.credentialId,
				adminUserId: ctx.auth.user.id,
				body: input,
			}),
		),
});

export const adminsRouter = router({
	list: adminProcedure.query(({ ctx }) => listAdmins(ctx.env)),

	create: adminProcedure.input(createAdminBody).mutation(({ ctx, input }) =>
		createAdmin({
			env: ctx.env,
			adminUserId: ctx.auth.user.id,
			body: input,
		}),
	),
});
