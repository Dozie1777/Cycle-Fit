import { createFileRoute } from "@tanstack/react-router";
import { handleReviewSubmissionRequest } from "../../server/http/review-submission";

export const Route = createFileRoute("/api/review-submission")({
	server: {
		handlers: {
			POST: ({ request, context }) =>
				handleReviewSubmissionRequest(request, context.env),
		},
	},
});
