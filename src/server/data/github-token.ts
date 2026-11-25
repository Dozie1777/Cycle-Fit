import {
	createGitHubApp,
	getEnvIdentity,
	mintInstallationToken,
} from "@/features/review";

export async function refreshGitHubToken(
	request: Request,
	env: Env,
): Promise<Response> {
	if (!env.INSTALLATION_ID || !env.TOKEN_REFRESH_SECRET) {
		return new Response("INSTALLATION_ID / TOKEN_REFRESH_SECRET not set", {
			status: 500,
		});
	}
	if (
		request.headers.get("authorization") !==
		`Bearer ${env.TOKEN_REFRESH_SECRET}`
	) {
		return new Response("unauthorized", { status: 401 });
	}
	const identity = getEnvIdentity(env);
	return Response.json(
		await mintInstallationToken(createGitHubApp(identity), identity),
	);
}
