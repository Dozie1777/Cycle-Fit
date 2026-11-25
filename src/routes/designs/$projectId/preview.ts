import { createFileRoute } from "@tanstack/react-router";
import { serveDesignFile } from "@/server/data/design-files";

export const Route = createFileRoute("/designs/$projectId/preview")({
	server: {
		handlers: {
			GET: ({ request, params, context }) =>
				serveDesignFile({
					request,
					env: context.env,
					projectId: params.projectId,
					path: "preview.png",
				}),
		},
	},
});
