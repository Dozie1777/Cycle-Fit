import type { getPrisma } from "@/lib/db";
import { decryptPayload, parseMasterKeys } from "./crypto";
import { type GitHubIdentity, getEnvIdentity, toPkcs8Pem } from "./github";

/**
 * Identity resolution by installation id (externalId).
 *
 * The worker does NOT model permission roles — GitHub App permissions are
 * configured by humans on GitHub's side, and a credential is simply "the
 * token for installation X". Callers say which installation a job needs;
 * the matching credential's token is injected (by the caller) as GH_TOKEN.
 *
 * Precedence: the env webhook/check app (env.INSTALLATION_ID) always
 * resolves from env secrets — it receives webhooks (signature verification
 * and the module-level JWT are env-backed), so a DB row for the same
 * installation would be inconsistent. Every other installation resolves
 * from a registered credential row and fails loudly when none exists.
 */

export type CredentialRow = {
	id: string;
	agentId: string;
	provider: string;
	externalId: string | null;
	envelope: string;
	payloadEnc: string;
	keyVersion: number;
	status: string;
	createdAt: Date;
	updatedAt: Date;
};

type Prisma = ReturnType<typeof getPrisma>;

export async function findCredentialByInstallationId(
	prisma: Prisma,
	installationId: string,
): Promise<CredentialRow | null> {
	return prisma.agentCredential.findFirst({
		where: { provider: "github_app", externalId: installationId },
	});
}

/**
 * Resolve the identity for an installation: env app for the webhook
 * installation, registered credential otherwise. Throws when no credential
 * exists for a non-webhook installation — never fall back to a wrong
 * identity silently.
 */
export async function resolveIdentityForInstallation(
	prisma: Prisma,
	env: Pick<Env, "INSTALLATION_ID"> & Parameters<typeof getEnvIdentity>[0],
	installationId: string,
): Promise<GitHubIdentity> {
	if (installationId === env.INSTALLATION_ID) {
		return getEnvIdentity(env);
	}
	const row = await findCredentialByInstallationId(prisma, installationId);
	if (!row) {
		throw new Error(
			`no credential registered for installation ${installationId}`,
		);
	}
	return resolveCredentialIdentity(row, env);
}

/**
 * Decrypt a credential row into a usable identity. Fails loudly on any
 * decrypt problem or inactive status — never fall back to another identity
 * silently.
 */
export async function resolveCredentialIdentity(
	row: CredentialRow,
	env: Env,
): Promise<GitHubIdentity> {
	if (row.status !== "active") {
		throw new Error(
			`credential ${row.id} is '${row.status}' — refusing to resolve`,
		);
	}
	if (row.provider !== "github_app" || !row.externalId) {
		throw new Error(
			`credential ${row.id} is not a GitHub App installation credential`,
		);
	}
	const payload = await decryptPayload(
		{ id: row.id, keyVersion: row.keyVersion, payloadEnc: row.payloadEnc },
		await parseMasterKeys(env),
	);
	return {
		appId: payload.appId,
		privateKeyPkcs8: toPkcs8Pem(payload.privateKey),
		installationId: row.externalId,
		botLogin: payload.botLogin,
		botEmail: payload.botEmail,
	};
}

/** Record that a credential acted: bump lastUsedAt and log which identity ran. */
export async function markUsed(
	prisma: Prisma,
	row: Pick<CredentialRow, "id" | "agentId"> &
		Partial<Pick<CredentialRow, "envelope">>,
	identity: Pick<GitHubIdentity, "botLogin">,
): Promise<void> {
	await prisma.agentCredential.update({
		where: { id: row.id },
		data: { lastUsedAt: new Date() },
	});
	console.log(
		JSON.stringify({
			event: "actor-selection",
			credentialId: row.id,
			agentId: row.agentId,
			envelope: row.envelope ?? null,
			botLogin: identity.botLogin ?? null,
		}),
	);
}
