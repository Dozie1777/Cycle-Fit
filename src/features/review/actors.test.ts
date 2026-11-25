import { generateKeyPairSync, type RSAKeyPairOptions } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	type CredentialRow,
	findCredentialByInstallationId,
	resolveCredentialIdentity,
	resolveIdentityForInstallation,
} from "@/features/review/actors";

const WEBHOOK_INSTALLATION = "150708719";

// Minimal in-memory prisma stand-in — only the surface actors.ts touches.
function fakePrisma(row: CredentialRow | null) {
	const calls: string[] = [];
	return {
		calls,
		prisma: {
			agentCredential: {
				findFirst: async ({ where }: { where: { externalId?: string } }) => {
					calls.push(String(where.externalId));
					return row;
				},
			},
		} as never,
	};
}

function envWithKey() {
	const { privateKey } = generateKeyPairSync("rsa", {
		modulusLength: 2048,
		privateKeyEncoding: { type: "pkcs1", format: "pem" },
	} as RSAKeyPairOptions<"pem", "pem">);
	return {
		INSTALLATION_ID: WEBHOOK_INSTALLATION,
		APP_ID: "123",
		OCTOKIT_PRIVATE_KEY: String(privateKey),
	} as unknown as Env;
}

describe("resolveIdentityForInstallation", () => {
	it("resolves the webhook installation from env secrets without touching the DB", async () => {
		const { prisma, calls } = fakePrisma(null);
		const identity = await resolveIdentityForInstallation(
			prisma,
			envWithKey(),
			WEBHOOK_INSTALLATION,
		);
		expect(identity.appId).toBe("123");
		expect(identity.installationId).toBe(WEBHOOK_INSTALLATION);
		expect(calls).toEqual([]); // env app must never come from a DB row
	});

	it("throws loudly when a non-webhook installation has no registered credential", async () => {
		const { prisma } = fakePrisma(null);
		await expect(
			resolveIdentityForInstallation(prisma, envWithKey(), "999999999"),
		).rejects.toThrow(/no credential registered for installation 999999999/);
	});
});

describe("resolveCredentialIdentity", () => {
	const baseRow: CredentialRow = {
		id: "cred-1",
		agentId: "agent-1",
		provider: "github_app",
		externalId: "111111111",
		envelope: "pusher",
		payloadEnc: "irrelevant",
		keyVersion: 1,
		status: "active",
		createdAt: new Date(),
		updatedAt: new Date(),
	};

	it("refuses to resolve a disabled credential", async () => {
		await expect(
			resolveCredentialIdentity(
				{ ...baseRow, status: "disabled" },
				envWithKey(),
			),
		).rejects.toThrow(/refusing to resolve/);
	});

	it("refuses non-github credentials", async () => {
		await expect(
			resolveCredentialIdentity(
				{ ...baseRow, provider: "linear" },
				envWithKey(),
			),
		).rejects.toThrow(/not a GitHub App installation credential/);
	});
});

describe("findCredentialByInstallationId", () => {
	it("queries by externalId for github_app credentials", async () => {
		const row = { id: "x" } as unknown as CredentialRow;
		const { prisma, calls } = fakePrisma(row);
		const found = await findCredentialByInstallationId(prisma, "42");
		expect(found).toBe(row);
		expect(calls).toEqual(["42"]);
	});
});
