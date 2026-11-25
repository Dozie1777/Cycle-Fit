import { createFileRoute } from "@tanstack/react-router";
import { serveAssetFile } from "@/server/data/design-assets";

// Public (ungated) like designs.$projectId.file — the design agent's
// browser tools fetch asset originals from the chat turn context.
export const Route = createFileRoute(
	"/designs/$projectId/assets/$assetId/file",
)({
	server: {
		handlers: {
			GET: ({ params, context }) =>
				serveAssetFile({
					env: context.env,
					projectId: params.projectId,
					assetId: params.assetId,
				}),
		},
	},
});
