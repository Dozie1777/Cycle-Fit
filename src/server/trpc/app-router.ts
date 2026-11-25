import { adminsRouter, agentsRouter } from "./routers/agents";
import { campaignsRouter } from "./routers/campaigns";
import { channelsRouter, skillsRouter } from "./routers/channels";
import { designsRouter } from "./routers/designs";
import { elementChatsRouter } from "./routers/element-chats";
import { projectsRouter } from "./routers/projects";
import { shareRouter } from "./routers/share";
import { router } from "./trpc";

export const appRouter = router({
	agents: agentsRouter,
	admins: adminsRouter,
	channels: channelsRouter,
	skills: skillsRouter,
	designs: designsRouter,
	projects: projectsRouter,
	campaigns: campaignsRouter,
	elementChats: elementChatsRouter,
	share: shareRouter,
});

export type AppRouter = typeof appRouter;
