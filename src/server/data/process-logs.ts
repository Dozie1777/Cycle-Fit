import { getSandbox } from "@cloudflare/sandbox";

function processQuery(request: Request) {
	const url = new URL(request.url);
	const sandboxId = url.searchParams.get("sandbox");
	const processId = url.searchParams.get("process");
	if (!sandboxId || !processId) {
		return {
			error: new Response("missing 'sandbox' and/or 'process' query params", {
				status: 400,
			}),
		};
	}
	return { sandboxId, processId };
}

function processNotFound(sandboxId: string, processId: string) {
	return new Response(
		`process ${processId} not found in sandbox ${sandboxId}`,
		{ status: 404 },
	);
}

export async function readProcessLogs(
	request: Request,
	env: Env,
): Promise<Response> {
	const query = processQuery(request);
	if (query.error) return query.error;
	const { sandboxId, processId } = query;
	const sandbox = getSandbox(env.Sandbox, sandboxId);
	const process = await sandbox.getProcess(processId);
	if (!process) return processNotFound(sandboxId, processId);
	const logs = await sandbox.getProcessLogs(processId);
	return Response.json({ status: process.status, ...logs });
}

export async function killProcess(
	request: Request,
	env: Env,
): Promise<Response> {
	const query = processQuery(request);
	if (query.error) return query.error;
	const { sandboxId, processId } = query;
	const sandbox = getSandbox(env.Sandbox, sandboxId);
	const process = await sandbox.getProcess(processId);
	if (!process) return processNotFound(sandboxId, processId);
	await sandbox.killProcess(processId);
	return Response.json({ killed: processId, previousStatus: process.status });
}
