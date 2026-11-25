import {
	createExecutionContext,
	waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";

export const TEST_ORIGIN = "https://code-review-bot.test";

export async function startWorkerRequest(
	path: string,
	init?: RequestInit,
	requestEnv: Env = env,
): Promise<Response> {
	const request = new Request(new URL(path, TEST_ORIGIN), init);
	const { default: worker } = await import("../../src/server");
	const ctx = createExecutionContext();
	const response = await worker.fetch(request, requestEnv, ctx);
	await waitOnExecutionContext(ctx);
	return response;
}

function withJsonBody(
	path: string,
	method: string,
	body: unknown,
	init: RequestInit,
	dispatch: typeof startWorkerRequest,
): Promise<Response> {
	const headers = new Headers(init.headers);
	headers.set("content-type", "application/json");
	return dispatch(path, {
		...init,
		method,
		headers,
		body: JSON.stringify(body),
	});
}

export function startJsonRequest(
	path: string,
	method: string,
	body: unknown,
	init: RequestInit = {},
	requestEnv?: Env,
): Promise<Response> {
	return withJsonBody(
		path,
		method,
		body,
		init,
		requestEnv
			? (requestPath, requestInit) =>
					startWorkerRequest(requestPath, requestInit, requestEnv)
			: startWorkerRequest,
	);
}

export async function responseText(response: Response): Promise<string> {
	const body = await response.text();
	return `${response.status} ${body}`;
}
