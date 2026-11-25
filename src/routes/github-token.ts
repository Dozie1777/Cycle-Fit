import { createFileRoute } from "@tanstack/react-router";
import { refreshGitHubToken } from "@/server/data/github-token";

export const Route = createFileRoute("/github-token")({
	server: {
		handlers: {
			GET: ({ request, context }) => refreshGitHubToken(request, context.env),
			ANY: () => new Response(null, { status: 405, headers: { Allow: "GET" } }),
		},
	},
});
