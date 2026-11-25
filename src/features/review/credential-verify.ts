import nodeCrypto from "node:crypto";
import { App, Octokit } from "octokit";

/**
 * Registration-time verification for GitHub App credentials.
 *
 * Eligibility for a repo is established HERE — the webhook payload's
 * `installation.id` belongs to the webhook app and can never validate other
 * apps' credentials, so a credential is only registered after it has been
 * proven against GitHub:
 *
 * 1. The submitted private key parses and mints an installation token.
 * 2. The token's `permissions` object is compared against the declared
 *    envelope — any operator-controlled permission outside the envelope
 *    rejects registration (bounds blast radius if the token ever leaks).
 *    GitHub-mandatory permissions every token carries (e.g. metadata: read)
 *    are ignored — they cannot be removed from the app. A rejection names
 *    exactly what to remove or add, and flags permission changes that are
 *    still pending approval on the installation.
 * 3. The installation actually has access to the target repo (when an
 *    `expectedRepository` is given, e.g. "Eden-Kukuana-PLC/kukuana").
 * 4. botLogin / botEmail are DERIVED from GET /app — never operator input.
 */

export type Envelope = "pusher" | "reviewer";

export type PermissionLevel = "read" | "write" | "admin";

export type TokenPermissions = Record<string, PermissionLevel>;

/**
 * The exact permission set each envelope permits. `admin` ≥ `write`.
 *
 * Both envelopes carry `pull_requests: write`: pushers propose their fixes as
 * PRs (new branch, then the PR) and reviewers comment on them. The envelopes
 * differ on the code axis — only the pusher may write contents.
 */
const ENVELOPE_PERMISSIONS: Record<
	Envelope,
	Record<string, Set<PermissionLevel>>
> = {
	pusher: {
		contents: new Set(["write", "admin"]),
		pull_requests: new Set(["write", "admin"]),
	},
	reviewer: {
		contents: new Set(["read"]),
		pull_requests: new Set(["write", "admin"]),
	},
};

/**
 * The levels each envelope requires — the operator-facing description of the
 * envelope's exact set, used verbatim in violation messages.
 */
const ENVELOPE_REQUIRED: Record<Envelope, TokenPermissions> = {
	pusher: { contents: "write", pull_requests: "write" },
	reviewer: { contents: "read", pull_requests: "write" },
};

/**
 * Permissions GitHub grants on every installation token by itself. Apps cannot
 * remove them (metadata: read is required for every GitHub App), so they are
 * not operator-controlled scope and must not count as envelope violations.
 * Each entry pins the only level GitHub grants for it.
 */
const GITHUB_MANDATORY_PERMISSIONS: TokenPermissions = {
	metadata: "read",
};

export function assertEnvelope(envelope: string): Envelope {
	if (envelope !== "pusher" && envelope !== "reviewer") {
		throw new Error(
			`invalid envelope "${envelope}" — expected 'pusher' | 'reviewer'`,
		);
	}
	return envelope;
}

export function checkEnvelopePermissions(
	permissions: TokenPermissions,
	envelope: Envelope,
): { ok: true } | { ok: false; violation: string } {
	const allowed = ENVELOPE_PERMISSIONS[envelope];

	// Operator-controlled permissions to remove — present on the token but
	// outside the envelope (or at a level it does not allow).
	// GitHub-mandatory permissions (e.g. metadata: read) ride on every
	// installation token and cannot be removed, so they are exempt.
	const toRemove: string[] = [];
	for (const [permission, level] of Object.entries(permissions)) {
		if (GITHUB_MANDATORY_PERMISSIONS[permission] === level) {
			continue;
		}
		const levels = allowed[permission];
		if (!levels?.has(level)) {
			toRemove.push(`${permission}: ${level}`);
		}
	}

	// Requirements not met — the token must carry each of the envelope's
	// permissions at its level (`admin` satisfies `write`).
	const toAdd: string[] = [];
	for (const [permission, required] of Object.entries(
		ENVELOPE_REQUIRED[envelope],
	)) {
		const level = permissions[permission];
		const satisfied =
			required === "read"
				? level === "read"
				: level === "write" || level === "admin";
		if (!satisfied) {
			toAdd.push(`${permission}: ${required}`);
		}
	}

	if (toRemove.length === 0 && toAdd.length === 0) {
		return { ok: true };
	}

	// EVERY deviation is reported in one message — an operator fixing the app
	// should not need one round trip per permission.
	const parts: string[] = [];
	if (toRemove.length > 0) {
		parts.push(`remove from the GitHub App: ${toRemove.join(", ")}`);
	}
	if (toAdd.length > 0) {
		parts.push(`add to the GitHub App: ${toAdd.join(", ")}`);
	}
	return {
		ok: false,
		violation:
			`${parts.join("; ")}. ` +
			`The '${envelope}' envelope requires exactly: ${describeRequired(envelope)} ` +
			"(metadata: read is mandatory for every app and exempt from this check).",
	};
}

function describeRequired(envelope: Envelope): string {
	return Object.entries(ENVELOPE_REQUIRED[envelope])
		.map(([permission, level]) => `${permission}: ${level}`)
		.join(", ");
}

/**
 * GitHub serves an installation the permission set it last approved: an app's
 * permission change takes effect for the installation only after the update is
 * approved there. When the freshly minted token diverges from the app's
 * current settings, say so — otherwise removing a permission in the app looks
 * like it did nothing when registration is retried (and additions look lost).
 */
export function pendingPermissionUpdateHint(
	tokenPermissions: TokenPermissions,
	appPermissions: TokenPermissions,
	envelope: Envelope,
): string | null {
	// Every permission whose effective state differs from the app's current
	// settings: removed from the app but still served by the installation, or
	// requested at a level the installation has not adopted. GitHub-mandatory
	// permissions are excluded — they are always granted and never app
	// settings. App-only entries are restricted to the envelope's required
	// permissions so user-scoped app permissions (which installation tokens
	// never carry) cannot be mistaken for pending grants.
	const changed = new Map<string, string>();
	for (const [permission, servedLevel] of Object.entries(tokenPermissions)) {
		if (GITHUB_MANDATORY_PERMISSIONS[permission] === servedLevel) {
			continue;
		}
		const requestedLevel = appPermissions[permission];
		if (requestedLevel === servedLevel) {
			continue;
		}
		changed.set(
			permission,
			requestedLevel === undefined
				? `removed from the app — installation still serves ${servedLevel}`
				: `app requests ${requestedLevel} — installation still serves ${servedLevel}`,
		);
	}
	for (const permission of Object.keys(ENVELOPE_REQUIRED[envelope])) {
		const requestedLevel = appPermissions[permission];
		if (
			requestedLevel === undefined ||
			tokenPermissions[permission] !== undefined
		) {
			continue;
		}
		changed.set(
			permission,
			`app requests ${requestedLevel} — not yet granted to the installation`,
		);
	}
	if (changed.size === 0) {
		return null;
	}

	const details = [...changed]
		.map(([permission, state]) => `${permission}: ${state}`)
		.join("; ");

	return (
		`Note: the installation's effective permissions differ from the app's current settings (${details}) — ` +
		"GitHub applies permission changes to an existing installation only after the update is approved there. " +
		"Approve the pending update (account or organization settings → GitHub Apps) and retry."
	);
}

/** GET /app's loosely-typed permission map, reduced to token-shaped levels. */
function normalizeAppPermissions(permissions: unknown): TokenPermissions {
	const normalized: TokenPermissions = {};
	if (permissions && typeof permissions === "object") {
		for (const [permission, level] of Object.entries(permissions)) {
			if (level === "read" || level === "write" || level === "admin") {
				normalized[permission] = level;
			}
		}
	}
	return normalized;
}

/** GitHub's bot identity format: `{slug}[bot]`, noreply email with the app id. */
export function deriveBotIdentity(app: { id: number; slug: string }) {
	return {
		botLogin: `${app.slug}[bot]`,
		botEmail: `${app.id}+${app.slug}[bot]@users.noreply.github.com`,
	};
}

// Octokit needs PKCS#8 PEM; registrations may submit PKCS#1.
function toPkcs8Pem(privateKeyPem: string): string {
	return nodeCrypto
		.createPrivateKey(privateKeyPem)
		.export({ type: "pkcs8", format: "pem" })
		.toString();
}

export function gitHubClientOptions(baseUrl?: string) {
	return baseUrl ? { baseUrl } : {};
}

export type VerifiedCredential = {
	botLogin: string;
	botEmail: string;
	repositories: string[];
};

export async function verifyGitHubCredential(input: {
	appId: string;
	privateKeyPem: string;
	installationId: string;
	envelope: Envelope;
	expectedRepository?: string;
	githubApiBaseUrl?: string;
}): Promise<VerifiedCredential> {
	const installationId = Number(input.installationId);
	if (!Number.isInteger(installationId) || installationId <= 0) {
		throw new Error(`invalid installation id "${input.installationId}"`);
	}

	let pkcs8: string;
	try {
		pkcs8 = toPkcs8Pem(input.privateKeyPem);
	} catch (error) {
		throw new Error(
			`private key PEM does not parse: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	const app = new App({
		appId: input.appId,
		privateKey: pkcs8,
		Octokit: Octokit.defaults(gitHubClientOptions(input.githubApiBaseUrl)),
	});

	// Mint an installation token and read its permission set.
	const auth = (await app.octokit.auth({
		type: "installation",
		installationId,
	})) as { token?: string; permissions?: TokenPermissions };
	if (!auth.token) {
		throw new Error(
			"GitHub did not return an installation token for this installation",
		);
	}

	// App-level metadata (bot identity + the app's CURRENT permission
	// settings, which the installation may not have adopted yet) —
	// authenticated as the app JWT.
	const { data: appInfo } = await app.octokit.request("GET /app");
	if (
		!appInfo ||
		typeof appInfo.slug !== "string" ||
		appInfo.slug.length === 0
	) {
		throw new Error("GitHub did not return app metadata for this private key");
	}
	if (String(appInfo.id) !== String(input.appId)) {
		throw new Error(
			`appId mismatch: private key belongs to app "${appInfo.slug}" (id ${appInfo.id}), not "${input.appId}"`,
		);
	}

	const tokenPermissions = auth.permissions ?? {};
	const envelopeCheck = checkEnvelopePermissions(
		tokenPermissions,
		input.envelope,
	);
	if (!envelopeCheck.ok) {
		const hint = pendingPermissionUpdateHint(
			tokenPermissions,
			normalizeAppPermissions(appInfo.permissions),
			input.envelope,
		);
		throw new Error(
			`permission envelope violation: ${envelopeCheck.violation}${hint ? ` ${hint}` : ""}`,
		);
	}

	// Installation-level repo access.
	const octokit = new Octokit({
		auth: auth.token,
		...gitHubClientOptions(input.githubApiBaseUrl),
	});
	const repositories: string[] = [];
	for await (const page of octokit.paginate.iterator(
		octokit.rest.apps.listReposAccessibleToInstallation,
		{ per_page: 100 },
	)) {
		for (const repo of page.data) {
			repositories.push(repo.full_name);
		}
	}
	if (repositories.length === 0) {
		throw new Error("installation has access to no repositories");
	}
	if (
		input.expectedRepository &&
		!repositories.includes(input.expectedRepository)
	) {
		throw new Error(
			`installation cannot access ${input.expectedRepository} — accessible: ${repositories.join(", ")}`,
		);
	}

	return {
		...deriveBotIdentity({ id: Number(appInfo.id), slug: appInfo.slug }),
		repositories,
	};
}
