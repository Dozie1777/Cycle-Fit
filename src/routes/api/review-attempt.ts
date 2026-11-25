import { createFileRoute } from "@tanstack/react-router";
import { handleReviewAttemptRequest } from "../../server/http/review-attempt";

export const Route = createFileRoute("/api/review-attempt")({
	server: {
		handlers: {
			POST: ({ request, context }) =>
				handleReviewAttemptRequest(request, context.env),
		},
	},
});
