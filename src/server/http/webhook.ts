import { createWebhookApp } from "../webhooks";

export async function handleWebhookRequest(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response> {
	console.log("[webhook] received delivery");
	const body = await request.text();
	const githubApp = createWebhookApp(env, new URL(request.url).origin);
	ctx.waitUntil(
		githubApp.webhooks
			.verifyAndReceive({
				id: request.headers.get("x-github-delivery") ?? "",
				name: request.headers.get("x-github-event") ?? "",
				payload: body,
				signature: request.headers.get("x-hub-signature-256") ?? "",
			})
			.catch((error) => {
				console.log("[webhooks] async dispatch failed:", error);
			}),
	);
	return new Response("ok", { status: 200 });
}
