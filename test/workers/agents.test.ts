import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	decryptPayload,
	encryptPayload,
	parseMasterKeys,
} from "@/features/review/crypto";
import {
	createAdminSession,
	createUserSession,
	type TestSession,
} from "../helpers/auth";
import {
	createTrpcTestClient,
	type TrpcTestClient,
	trpcErrorCode,
	trpcErrorMessage,
} from "../helpers/trpc";

type CredentialRow = {
	id: string;
	agentId: string;
	provider: string;
	externalId: string | null;
	envelope: string;
	payloadEnc: string;
	keyVersion: number;
	status: string;
	lastUsedAt: string | null;
	createdAt: string;
	updatedAt: string;
};

type LogSpy = { mock: { calls: unknown[][] } };

const INSTALLATION_TOKEN = "github-installation-token-secret";

function adminClient(session: TestSession, requestEnv?: Env): TrpcTestClient {
	return createTrpcTestClient(session.headers, requestEnv);
}

function agentBody(overrides: Record<string, unknown> = {}) {
	return {
		provider: "github_app",
		externalId: "123",
		appId: "12345",
		envelope: "pusher",
		privateKeyPem: env.OCTOKIT_PRIVATE_KEY,
		expectedRepository: "acme/widgets",
		...overrides,
	};
}

function mockGitHub(
	options: {
		permissions?: Record<string, string>;
		repositories?: string[];
		appId?: number;
		slug?: string;
		baseUrl?: string;
	} = {},
) {
	const permissions = options.permissions ?? {
		contents: "write",
		pull_requests: "write",
		metadata: "read",
	};
	const repositories = options.repositories ?? ["acme/widgets"];
	const baseUrl = options.baseUrl ?? "https://api.github.com";
	const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
		const url =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.href
					: input.url;
		const respond = (body: unknown) => {
			const response = Response.json(body);
			Object.defineProperty(response, "url", { value: url });
			return response;
		};
		if (url === `${baseUrl}/app/installations/123/access_tokens`) {
			return respond({
				token: INSTALLATION_TOKEN,
				expires_at: "2026-10-26T23:59:59Z",
				permissions,
			});
		}
		if (url === `${baseUrl}/app`) {
			return respond({
				id: options.appId ?? 12345,
				slug: options.slug ?? "review-bot",
				permissions,
			});
		}
		if (url.startsWith(`${baseUrl}/installation/repositories`)) {
			return respond({
				total_count: repositories.length,
				repositories: repositories.map((full_name) => ({ full_name })),
			});
		}
		throw new Error(`Unexpected external fetch: ${url}`);
	});
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

async function insertUser(
	role: string,
	createdAt = "2026-01-01T00:00:00.000Z",
) {
	const id = crypto.randomUUID();
	const now = new Date().toISOString();
	await env.DB.prepare(
		`INSERT INTO "user"
			(id, name, email, emailVerified, createdAt, updatedAt, role)
			VALUES (?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(id, `${role} ${id}`, `${id}@example.com`, false, createdAt, now, role)
		.run();
	return id;
}

async function insertCredential(
	agentId: string,
	overrides: {
		id?: string;
		externalId?: string;
		envelope?: string;
		status?: string;
		privateKey?: string;
		appId?: string;
		keyVersion?: number;
	} = {},
) {
	const id = overrides.id ?? crypto.randomUUID();
	const keyVersion = overrides.keyVersion ?? 1;
	const keys = await parseMasterKeys(env);
	const payloadEnc = await encryptPayload(
		{
			appId: overrides.appId ?? "12345",
			privateKey: overrides.privateKey ?? env.OCTOKIT_PRIVATE_KEY,
			botLogin: "review-bot[bot]",
			botEmail: "12345+review-bot[bot]@users.noreply.github.com",
		},
		id,
		{ ...keys, current: keyVersion },
	);
	const now = new Date().toISOString();
	await env.DB.prepare(
		`INSERT INTO "AgentCredential"
			(id, agentId, provider, externalId, envelope, payloadEnc, keyVersion,
			 status, createdAt, updatedAt)
			VALUES (?, ?, 'github_app', ?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			id,
			agentId,
			overrides.externalId ?? "123",
			overrides.envelope ?? "pusher",
			payloadEnc,
			keyVersion,
			overrides.status ?? "active",
			now,
			now,
		)
		.run();
	return id;
}

async function getCredential(id: string): Promise<CredentialRow> {
	const row = await env.DB.prepare(
		'SELECT * FROM "AgentCredential" WHERE id = ?',
	)
		.bind(id)
		.first();
	expect(row).not.toBeNull();
	return row as CredentialRow;
}

/** Register a credential; resolves the created row (or throws the tRPC
 * error — the tests that care about failures call `.mutate` directly). */
async function postCredential(
	agentId: string,
	session: TestSession,
	body: unknown,
	requestEnv?: Env,
) {
	return adminClient(session, requestEnv).agents.registerCredential.mutate({
		agentId,
		...(body as Record<string, unknown>),
	} as never);
}

async function patchCredential(
	agentId: string,
	credentialId: string,
	session: TestSession,
	body: unknown,
	requestEnv?: Env,
) {
	return adminClient(session, requestEnv).agents.updateCredential.mutate({
		agentId,
		credentialId,
		...(body as Record<string, unknown>),
	} as never);
}

function auditEvents(log: LogSpy) {
	return log.mock.calls
		.map(([line]) => {
			try {
				return JSON.parse(String(line)) as Record<string, unknown>;
			} catch {
				return null;
			}
		})
		.filter(
			(event): event is Record<string, unknown> =>
				event?.event === "agent-credential",
		);
}

function expectSecretFree(text: string) {
	expect(text).not.toContain("payloadEnc");
	expect(text).not.toContain("privateKey");
	expect(text).not.toContain("BEGIN PRIVATE KEY");
	expect(text).not.toContain("BEGIN RSA PRIVATE KEY");
	expect(text).not.toContain(INSTALLATION_TOKEN);
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("Agent management tRPC API", () => {
	it("lists only agent users in ascending order without credential secrets", async () => {
		const second = await insertUser("agent", "2026-02-01T00:00:00.000Z");
		const first = await insertUser("agent", "2026-01-01T00:00:00.000Z");
		await insertUser("admin", "2025-01-01T00:00:00.000Z");
		await insertUser("user", "2025-01-01T00:00:00.000Z");
		await insertCredential(first);
		const session = await createAdminSession();

		const agents = await adminClient(session).agents.list.query();
		const text = JSON.stringify(agents);
		expectSecretFree(text);
		expect(agents.map((agent) => agent.id)).toEqual([first, second]);
		expect(agents[0]?.credentials).toHaveLength(1);
		expect(agents[0]?.credentials[0]).toEqual({
			id: expect.any(String),
			agentId: first,
			provider: "github_app",
			externalId: "123",
			envelope: "pusher",
			keyVersion: 1,
			status: "active",
			lastUsedAt: null,
			createdAt: expect.any(String),
			updatedAt: expect.any(String),
		});
	});

	it("rejects invalid agent creation bodies", async () => {
		const session = await createAdminSession();
		const message = await trpcErrorMessage(() =>
			adminClient(session).agents.create.mutate({
				name: "",
				email: "not-an-email",
			}),
		);
		expect(message).toContain("name");
		expect(message).toContain("email");
	});

	it("creates a role-agent user without a password or login account", async () => {
		const session = await createAdminSession();
		const created = await adminClient(session).agents.create.mutate({
			name: "Review agent",
			email: "review-agent@example.com",
		});
		expect(created).toEqual({
			id: expect.any(String),
			name: "Review agent",
			email: "review-agent@example.com",
			role: "agent",
		});
		const user = await env.DB.prepare('SELECT role FROM "user" WHERE id = ?')
			.bind(created.id)
			.first();
		expect(user).toEqual({ role: "agent" });
		const accounts = await env.DB.prepare(
			'SELECT COUNT(*) AS count FROM "account" WHERE userId = ?',
		)
			.bind(created.id)
			.first();
		expect(accounts).toEqual({ count: 0 });
	});

	it("rejects malformed credential registration before GitHub verification", async () => {
		const session = await createAdminSession();
		const github = mockGitHub();
		const message = await trpcErrorMessage(() =>
			postCredential("missing", session, {}),
		);
		expect(message).toBeTruthy();
		expect(github).not.toHaveBeenCalled();
	});

	it("returns NOT_FOUND when registering a credential for a missing agent", async () => {
		const session = await createAdminSession();
		const github = mockGitHub();
		const code = await trpcErrorCode(() =>
			postCredential("missing", session, agentBody()),
		);
		expect(code).toBe("NOT_FOUND");
		expect(
			await trpcErrorMessage(() =>
				postCredential("missing", session, agentBody()),
			),
		).toBe("agent not found");
		expect(github).not.toHaveBeenCalled();
	});

	it("returns the exact permission-envelope failure as UNPROCESSABLE_CONTENT", async () => {
		const agentId = await insertUser("agent");
		const session = await createAdminSession();
		mockGitHub({
			permissions: {
				contents: "write",
				pull_requests: "write",
				issues: "write",
				metadata: "read",
			},
		});
		const code = await trpcErrorCode(() =>
			postCredential(agentId, session, agentBody()),
		);
		expect(code).toBe("UNPROCESSABLE_CONTENT");
		const message = await trpcErrorMessage(() =>
			postCredential(agentId, session, agentBody()),
		);
		expect(message).toContain(
			"permission envelope violation: remove from the GitHub App: issues: write.",
		);
		expect(message).toContain(
			"The 'pusher' envelope requires exactly: contents: write, pull_requests: write",
		);
		expect(
			await env.DB.prepare('SELECT COUNT(*) AS count FROM "AgentCredential"')
				.first()
				.then((row) => row?.count),
		).toBe(0);
	});

	it("returns the exact repository-access failure as UNPROCESSABLE_CONTENT", async () => {
		const agentId = await insertUser("agent");
		const session = await createAdminSession();
		mockGitHub({ repositories: ["acme/other"] });
		const message = await trpcErrorMessage(() =>
			postCredential(agentId, session, agentBody()),
		);
		expect(message).toBe(
			"installation cannot access acme/widgets — accessible: acme/other",
		);
	});

	it("uses an explicitly configured GitHub API endpoint for credential verification", async () => {
		const agentId = await insertUser("agent");
		const session = await createAdminSession();
		const baseUrl = "https://github-integration.test";
		const github = mockGitHub({ baseUrl });
		await postCredential(agentId, session, agentBody(), {
			...env,
			GITHUB_API_BASE_URL: baseUrl,
		} as Env);

		expect(github.mock.calls.map(([input]) => String(input))).toEqual(
			expect.arrayContaining([
				`${baseUrl}/app/installations/123/access_tokens`,
				`${baseUrl}/app`,
			]),
		);
	});

	it("reports a fixed error when credential crypto is unavailable", async () => {
		const agentId = await insertUser("agent");
		const session = await createAdminSession();
		mockGitHub();
		const unavailableEnv = {
			...env,
			AGENT_CRED_MASTER_KEYS: undefined,
		} as Env;
		const code = await trpcErrorCode(() =>
			postCredential(agentId, session, agentBody(), unavailableEnv),
		);
		expect(code).toBe("INTERNAL_SERVER_ERROR");
		expect(
			await trpcErrorMessage(() =>
				postCredential(agentId, session, agentBody(), unavailableEnv),
			),
		).toBe(
			"credential crypto unavailable: AGENT_CRED_MASTER_KEYS / AGENT_CRED_MASTER_KEY_CURRENT not set",
		);
	});

	it("verifies, encrypts, audits, and returns a secret-free credential", async () => {
		const agentId = await insertUser("agent");
		const session = await createAdminSession();
		const github = mockGitHub();
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		const created = (await postCredential(
			agentId,
			session,
			agentBody(),
		)) as Record<string, unknown>;
		expectSecretFree(JSON.stringify(created));
		expect(created).toEqual({
			id: expect.any(String),
			agentId,
			provider: "github_app",
			externalId: "123",
			envelope: "pusher",
			keyVersion: 1,
			status: "active",
			lastUsedAt: null,
			createdAt: expect.any(String),
			updatedAt: expect.any(String),
			botLogin: "review-bot[bot]",
			repositories: ["acme/widgets"],
		});
		const stored = await getCredential(String(created.id));
		expect(stored.payloadEnc).not.toContain(env.OCTOKIT_PRIVATE_KEY);
		const decrypted = await decryptPayload(stored, await parseMasterKeys(env));
		expect(decrypted).toEqual({
			appId: "12345",
			privateKey: env.OCTOKIT_PRIVATE_KEY,
			botLogin: "review-bot[bot]",
			botEmail: "12345+review-bot[bot]@users.noreply.github.com",
		});
		expect(auditEvents(log)).toEqual([
			{
				event: "agent-credential",
				action: "register",
				agentId,
				credentialId: created.id,
				adminUserId: session.userId,
				provider: "github_app",
				envelope: "pusher",
			},
		]);
		expectSecretFree(JSON.stringify(log.mock.calls));
		const urls = github.mock.calls.map(([input]) => String(input));
		expect(urls).toContain(
			"https://api.github.com/app/installations/123/access_tokens",
		);
		expect(urls).toContain("https://api.github.com/app");
		expect(
			urls.some((url) =>
				url.startsWith("https://api.github.com/installation/repositories"),
			),
		).toBe(true);
	});

	it("returns NOT_FOUND when a credential belongs to another agent", async () => {
		const ownerId = await insertUser("agent");
		const otherAgentId = await insertUser("agent");
		const credentialId = await insertCredential(ownerId);
		const session = await createAdminSession();
		const code = await trpcErrorCode(() =>
			patchCredential(otherAgentId, credentialId, session, {
				status: "disabled",
			}),
		);
		expect(code).toBe("NOT_FOUND");
		expect(
			await trpcErrorMessage(() =>
				patchCredential(otherAgentId, credentialId, session, {
					status: "disabled",
				}),
			),
		).toBe("credential not found");
	});

	it("rejects incomplete rotations with the existing validation error", async () => {
		const agentId = await insertUser("agent");
		const credentialId = await insertCredential(agentId);
		const session = await createAdminSession();
		const message = await trpcErrorMessage(() =>
			patchCredential(agentId, credentialId, session, {
				privateKeyPem: env.OCTOKIT_PRIVATE_KEY,
			}),
		);
		expect(message).toContain(
			"rotation requires appId and envelope alongside privateKeyPem",
		);
	});

	it("audits disable and enable once but not no-op status updates", async () => {
		const agentId = await insertUser("agent");
		const credentialId = await insertCredential(agentId);
		const session = await createAdminSession();
		const log = vi.spyOn(console, "log").mockImplementation(() => {});

		for (const status of ["disabled", "disabled", "active", "active"]) {
			const updated = (await patchCredential(agentId, credentialId, session, {
				status,
			})) as { status: string };
			expect(updated.status).toBe(status);
		}
		expect(auditEvents(log).map((event) => event.action)).toEqual([
			"disable",
			"enable",
		]);
	});

	it("re-verifies, re-encrypts, rotates the key version, and audits", async () => {
		const agentId = await insertUser("agent");
		const credentialId = await insertCredential(agentId, {
			envelope: "reviewer",
			status: "disabled",
		});
		const before = await getCredential(credentialId);
		const session = await createAdminSession();
		mockGitHub();
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		const rotatedEnv = {
			...env,
			AGENT_CRED_MASTER_KEYS: JSON.stringify({
				"1": "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
				"2": "ZmVkY2JhOTg3NjU0MzIxMGZlZGNiYTk4NzY1NDMyMTA=",
			}),
			AGENT_CRED_MASTER_KEY_CURRENT: "2",
		} as Env;
		const updated = (await patchCredential(
			agentId,
			credentialId,
			session,
			{
				privateKeyPem: env.OCTOKIT_PRIVATE_KEY,
				appId: "12345",
				envelope: "pusher",
				externalId: "123",
				expectedRepository: "acme/widgets",
				status: "active",
			},
			rotatedEnv,
		)) as Record<string, unknown>;
		expectSecretFree(JSON.stringify(updated));
		expect(updated).toMatchObject({
			id: credentialId,
			agentId,
			envelope: "pusher",
			keyVersion: 2,
			status: "active",
		});
		const stored = await getCredential(credentialId);
		expect(stored.payloadEnc).not.toBe(before.payloadEnc);
		expect(stored.keyVersion).toBe(2);
		const decrypted = await decryptPayload(
			stored,
			await parseMasterKeys(rotatedEnv),
		);
		expect(decrypted.privateKey).toBe(env.OCTOKIT_PRIVATE_KEY);
		expect(auditEvents(log)).toEqual([
			expect.objectContaining({
				action: "rotate",
				agentId,
				credentialId,
				adminUserId: session.userId,
				envelope: "pusher",
			}),
		]);
		expectSecretFree(JSON.stringify(log.mock.calls));
	});

	it("rejects anonymous and non-admin users before allowing an admin", async () => {
		const anonymous = createTrpcTestClient();
		const nonAdmin = adminClient(await createUserSession("user"));
		const admin = adminClient(await createAdminSession());

		// GET /agents
		expect(await trpcErrorCode(() => anonymous.agents.list.query())).toBe(
			"UNAUTHORIZED",
		);
		expect(await trpcErrorCode(() => nonAdmin.agents.list.query())).toBe(
			"FORBIDDEN",
		);
		expect(await trpcErrorCode(() => admin.agents.list.query())).toBeNull();

		// POST /agents (invalid body → BAD_REQUEST once auth passes)
		for (const client of [anonymous, nonAdmin]) {
			expect(
				await trpcErrorCode(() =>
					client.agents.create.mutate({ name: "", email: "" }),
				),
			).toBe(client === anonymous ? "UNAUTHORIZED" : "FORBIDDEN");
		}
		expect(
			await trpcErrorCode(() =>
				admin.agents.create.mutate({ name: "", email: "" }),
			),
		).toBe("BAD_REQUEST");

		// POST /agents/missing/credentials
		for (const client of [anonymous, nonAdmin]) {
			expect(
				await trpcErrorCode(() =>
					client.agents.registerCredential.mutate({
						agentId: "missing",
						provider: "github_app",
						externalId: "",
						appId: "",
						envelope: "pusher",
						privateKeyPem: "",
					}),
				),
			).toBe(client === anonymous ? "UNAUTHORIZED" : "FORBIDDEN");
		}
		expect(
			await trpcErrorCode(() =>
				admin.agents.registerCredential.mutate({
					agentId: "missing",
					provider: "github_app",
					externalId: "",
					appId: "",
					envelope: "pusher",
					privateKeyPem: "",
				}),
			),
		).toBe("BAD_REQUEST");

		// PATCH /agents/missing/credentials/missing
		for (const client of [anonymous, nonAdmin]) {
			expect(
				await trpcErrorCode(() =>
					client.agents.updateCredential.mutate({
						agentId: "missing",
						credentialId: "missing",
						status: "active",
					}),
				),
			).toBe(client === anonymous ? "UNAUTHORIZED" : "FORBIDDEN");
		}
		expect(
			await trpcErrorCode(() =>
				admin.agents.updateCredential.mutate({
					agentId: "missing",
					credentialId: "missing",
					status: "active",
				}),
			),
		).toBe("NOT_FOUND");
	});
});
