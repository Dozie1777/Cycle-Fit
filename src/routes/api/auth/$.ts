import { createFileRoute } from "@tanstack/react-router";
import { getAuth } from "../../../lib/auth";

export const Route = createFileRoute("/api/auth/$")({
	server: {
		handlers: {
			GET: ({ request, context }) => {
				if (!context) throw new Error("Start request context is required");
				return getAuth(context.env).handler(request);
			},
			POST: ({ request, context }) => {
				if (!context) throw new Error("Start request context is required");
				return getAuth(context.env).handler(request);
			},
		},
	},
});
