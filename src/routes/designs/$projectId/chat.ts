import { createFileRoute } from "@tanstack/react-router";
import { chatDesign } from "@/server/data/design-chat";
import { adminMiddleware } from "../../../server/middleware";

export const Route = createFileRoute("/designs/$projectId/chat")({
	server: {
		middleware: [adminMiddleware],
		handlers: {
			POST: ({ request, params, context }) =>
				chatDesign({
					request,
					env: context.env,
					projectId: params.projectId,
					adminUserId: context.user.id,
					waitUntil: (promise) => context.executionCtx.waitUntil(promise),
				}),
		},
	},
});
