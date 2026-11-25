import { createFileRoute } from "@tanstack/react-router";
import { createUploadUrl } from "@/server/data/design-files";

export const Route = createFileRoute("/designs/$projectId/upload-url")({
	server: {
		handlers: {
			POST: ({ request, params, context }) =>
				createUploadUrl({
					request,
					env: context.env,
					projectId: params.projectId,
				}),
		},
	},
});
