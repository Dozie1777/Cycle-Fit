import {
	createGitHubApp,
	getEnvIdentity,
	mintInstallationToken,
} from "@/features/review";
import { getMountedSandbox } from "../../lib/sandbox";

export async function handleTerminalRequest(
	request: Request,
	env: Env,
	_ctx: ExecutionContext,
): Promise<Response> {
	if (request.headers.get("Upgrade") !== "websocket") {
		return new Response("expected a websocket upgrade", { status: 426 });
	}

	const sandbox = await getMountedSandbox(env);
	const vars: Record<string, string> = {
		KIMI_MODEL_NAME: env.KIMI_MODEL_NAME ?? "kimi-for-coding-highspeed",
		KIMI_MODEL_PROVIDER_TYPE: env.KIMI_MODEL_PROVIDER_TYPE ?? "kimi",
		KIMI_MODEL_BASE_URL:
			env.KIMI_MODEL_BASE_URL ?? "https://api.kimi.com/coding/v1",
	};
	if (env.KIMI_API_KEY) {
		vars.KIMI_MODEL_API_KEY = env.KIMI_API_KEY;
	}
	if (env.INSTALLATION_ID) {
		const { token } = await mintInstallationToken(
			createGitHubApp(getEnvIdentity(env)),
			getEnvIdentity(env),
		);
		vars.GH_TOKEN = token;
		vars.GH_REFRESH_URL = `${new URL(request.url).origin}/github-token`;
		vars.GH_REFRESH_SECRET = env.TOKEN_REFRESH_SECRET ?? "";
	}
	await sandbox.setEnvVars(vars);

	const url = new URL(request.url);
	const sessionId = url.searchParams.get("session");
	if (sessionId && url.searchParams.get("create") !== "1") {
		const session = await sandbox.getSession(sessionId);
		return session.terminal(request);
	}

	const session = await sandbox.createSession(
		sessionId ? { id: sessionId } : undefined,
	);
	return session.terminal(request, { cols: 80, rows: 24 });
}
