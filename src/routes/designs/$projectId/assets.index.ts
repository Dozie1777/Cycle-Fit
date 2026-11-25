import { createFileRoute } from "@tanstack/react-router";
import { uploadAsset } from "@/server/data/design-assets";
import { adminMiddleware } from "../../../server/middleware";

// Multipart asset upload (KUK-864). This is the one admin write that stays
// outside tRPC — file bodies don't fit the JSON batch protocol. The asset
// library's JSON reads/writes live in the designs tRPC router
// (designs.assets.list/update/delete/describe).
export const Route = createFileRoute("/designs/$projectId/assets/")({
	server: {
		middleware: [adminMiddleware],
		handlers: {
			POST: ({ request, params, context }) =>
				uploadAsset({
					request,
					env: context.env,
					projectId: params.projectId,
					adminUserId: context.user.id,
					waitUntil: (promise) => context.executionCtx.waitUntil(promise),
				}),
		},
	},
});
