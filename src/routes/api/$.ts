import { createFileRoute } from "@tanstack/react-router";
import { apiNotFoundResponse } from "../../server/http/not-found";

function notFound() {
	return apiNotFoundResponse();
}

export const Route = createFileRoute("/api/$")({
	server: {
		handlers: {
			GET: notFound,
			POST: notFound,
			PUT: notFound,
			PATCH: notFound,
			DELETE: notFound,
			HEAD: notFound,
			OPTIONS: notFound,
		},
	},
});
