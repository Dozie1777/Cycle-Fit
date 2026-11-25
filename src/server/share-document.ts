import { createIsomorphicFn } from "@tanstack/react-start";
import { trpc } from "@/client/trpc";
import { getShareProject } from "./data/share";
import { getWorkerEnv } from "./worker-env";

export const loadShareProject = createIsomorphicFn()
	.server((projectId: string) => {
		const env = getWorkerEnv();
		if (!env) throw new Error("worker env unavailable");
		return getShareProject(env, projectId);
	})
	.client((projectId: string) => trpc.share.getProject.query({ projectId }));
