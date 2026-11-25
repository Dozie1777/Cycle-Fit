import { getShareProject, remixDesign, shareInput } from "@/server/data/share";
import { publicProcedure, router } from "../trpc";

/**
 * Public, unauthenticated surfaces backing the shared-design page: the
 * data lookup (used by the share loader's client branch) and the anonymous
 * remix fork. No admin gate — these are the visitor-facing side of /share.
 */
export const shareRouter = router({
	getProject: publicProcedure
		.input(shareInput)
		.query(({ ctx, input }) => getShareProject(ctx.env, input.projectId)),

	remix: publicProcedure
		.input(shareInput)
		.mutation(({ ctx, input }) => remixDesign(ctx.env, input.projectId)),
});
