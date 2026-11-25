import crypto from "node:crypto";
import { App } from "octokit";

/**
 * A GitHub App identity the worker can act as — either the env-configured
 * webhook/check app or a runtime-registered credential from D1 (see
 * lib/actors.ts). `privateKeyPkcs8` is always PKCS#8 PEM: Octokit's JWT
 * signer rejects PKCS#1, so conversions happen at identity construction.
 */
export type GitHubIdentity = {
	appId: string;
	privateKeyPkcs8: string;
	installationId: string;
	/** Bot display identity — present for credential identities, optional for env. */
	botLogin?: string;
	botEmail?: string;
};

export function toPkcs8Pem(privateKeyPem: string): string {
	return crypto
		.createPrivateKey(privateKeyPem)
		.export({
			type: "pkcs8",
			format: "pem",
		})
		.toString();
}

/** The env-configured webhook/check app identity (APP_ID, OCTOKIT_PRIVATE_KEY, INSTALLATION_ID). */
export function envIdentity(env: Env): GitHubIdentity {
	if (!env.APP_ID || !env.OCTOKIT_PRIVATE_KEY || !env.INSTALLATION_ID) {
		throw new Error(
			"GitHub env identity incomplete: APP_ID, OCTOKIT_PRIVATE_KEY and INSTALLATION_ID are required",
		);
	}
	return {
		appId: env.APP_ID,
		privateKeyPkcs8: toPkcs8Pem(env.OCTOKIT_PRIVATE_KEY),
		installationId: env.INSTALLATION_ID,
	};
}

// Memoized per isolate: key conversion is pure given stable env bindings.
let cachedEnv: { env: Env; identity: GitHubIdentity } | null = null;

export function getEnvIdentity(env: Env): GitHubIdentity {
	if (!cachedEnv || cachedEnv.env !== env) {
		cachedEnv = { env, identity: envIdentity(env) };
	}
	return cachedEnv.identity;
}

// Build an authenticated GitHub App client for a resolved identity. Pass
// webhookSecret only for the env webhook app (signature verification);
// actor identities never receive webhooks.
export function createGitHubApp(
	identity: GitHubIdentity,
	webhookSecret?: string,
): App {
	return new App({
		appId: identity.appId,
		privateKey: identity.privateKeyPkcs8,
		webhooks: webhookSecret ? { secret: webhookSecret } : undefined,
	});
}

// Mint a GitHub App installation access token (valid ~1h). Octokit signs the
// app JWT internally from appId + private key — callers only ever see the
// installation token, never the JWT or the private key.
export async function mintInstallationToken(
	app: App,
	identity: Pick<GitHubIdentity, "installationId">,
) {
	const { token, expiresAt } = (await app.octokit.auth({
		type: "installation",
		installationId: Number(identity.installationId),
	})) as { token: string; expiresAt: string };
	return { token, expiresAt };
}
