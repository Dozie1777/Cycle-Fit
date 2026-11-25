import { createFileRoute } from "@tanstack/react-router";
import { servePublicationPage } from "@/server/data/design-publications";

// Public (no session middleware): publication snapshots are time-travel
// views of the published site, served with the same sandboxed site-file
// headers. The $version splat carries the site path; the version root
// (empty splat) is the snapshot's homepage.
export const Route = createFileRoute(
	"/designs/$projectId/publication/$version/$",
)({
	server: {
		handlers: {
			GET: ({ params, context }) =>
				servePublicationPage({
					env: context.env,
					designId: params.projectId,
					version: params.version,
					path: params._splat ?? "",
				}),
		},
	},
});
