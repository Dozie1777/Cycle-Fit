import { createRouter } from "@tanstack/react-router";
import { getQueryClient } from "./client/query-client";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
	const queryClient = getQueryClient();
	const router = createRouter({
		routeTree,
		context: { queryClient },
		defaultPreload: "intent",
	});
	return router;
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
