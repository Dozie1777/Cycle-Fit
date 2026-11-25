import { createFileRoute } from "@tanstack/react-router";
import { killProcess, readProcessLogs } from "@/server/data/process-logs";

export const Route = createFileRoute("/process-logs")({
	server: {
		handlers: {
			GET: ({ request, context }) => readProcessLogs(request, context.env),
			DELETE: ({ request, context }) => killProcess(request, context.env),
			ANY: () =>
				new Response(null, {
					status: 405,
					headers: { Allow: "GET, DELETE" },
				}),
		},
	},
});
