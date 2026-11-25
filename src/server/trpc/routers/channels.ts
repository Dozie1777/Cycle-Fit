import { z } from "zod";
import { githubImportBody, githubImportPreviewInput } from "@/features/skills";
import {
	createChannel,
	createChannelBody,
	listChannels,
	updateChannel,
	updateChannelBody,
} from "@/server/data/channels";
import {
	createSkill,
	createSkillBody,
	deleteSkill,
	importGithubSkills,
	listSkills,
	previewGithubSkills,
	updateSkill,
	updateSkillBody,
} from "@/server/data/skills";
import { adminProcedure, router } from "../trpc";

export const channelsRouter = router({
	list: adminProcedure.query(({ ctx }) => listChannels(ctx.env)),

	create: adminProcedure
		.input(createChannelBody)
		.mutation(({ ctx, input }) => createChannel({ env: ctx.env, body: input })),

	update: adminProcedure
		.input(z.object({ id: z.string().min(1) }).and(updateChannelBody))
		.mutation(({ ctx, input }) =>
			updateChannel({ env: ctx.env, channelId: input.id, body: input }),
		),
});

export const skillsRouter = router({
	list: adminProcedure.query(({ ctx }) => listSkills(ctx.env)),

	create: adminProcedure
		.input(createSkillBody)
		.mutation(({ ctx, input }) => createSkill({ env: ctx.env, body: input })),

	update: adminProcedure
		.input(z.object({ id: z.string().min(1) }).and(updateSkillBody))
		.mutation(({ ctx, input }) =>
			updateSkill({ env: ctx.env, skillId: input.id, body: input }),
		),

	delete: adminProcedure
		.input(z.object({ id: z.string().min(1) }))
		.mutation(({ ctx, input }) =>
			deleteSkill({ env: ctx.env, skillId: input.id }),
		),

	// GitHub skill import: preview lists a repo's SKILL.md files (no writes),
	// import fetches only the selected files and upserts them as
	// non-builtin rows. Both hit github.com from the Worker — see
	// features/skills/github-import.ts.
	importPreview: adminProcedure
		.input(githubImportPreviewInput)
		.query(({ ctx, input }) => previewGithubSkills(ctx.env, input.source)),

	importSkills: adminProcedure
		.input(githubImportBody)
		.mutation(({ ctx, input }) => importGithubSkills(ctx.env, input)),
});
