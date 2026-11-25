import { describe, expect, it } from "vitest";
import { decryptPayload, encryptPayload, parseMasterKeys } from "./crypto";

function bytesToBase64(bytes: Uint8Array): string {
	let binary = "";
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary);
}

function makeKeysEnv(count = 2) {
	const keys: Record<string, string> = {};
	for (let i = 1; i <= count; i++) {
		keys[String(i)] = bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));
	}
	return {
		AGENT_CRED_MASTER_KEYS: JSON.stringify(keys),
		AGENT_CRED_MASTER_KEY_CURRENT: String(count),
	};
}

const payload = {
	appId: "12345",
	privateKey: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
	botLogin: "test-app[bot]",
	botEmail: "12345+test-app[bot]@users.noreply.github.com",
};

describe("parseMasterKeys", () => {
	it("accepts a valid key map and current version", async () => {
		const keys = await parseMasterKeys(makeKeysEnv());
		expect(keys.current).toBe(2);
		expect(keys.keys.size).toBe(2);
	});

	it("fails closed on missing env vars", async () => {
		await expect(
			parseMasterKeys({
				AGENT_CRED_MASTER_KEYS: undefined,
				AGENT_CRED_MASTER_KEY_CURRENT: undefined,
			}),
		).rejects.toThrow(/credential crypto unavailable/);
	});

	it("fails closed on invalid JSON", async () => {
		await expect(
			parseMasterKeys({
				AGENT_CRED_MASTER_KEYS: "not json",
				AGENT_CRED_MASTER_KEY_CURRENT: "1",
			}),
		).rejects.toThrow(/not valid JSON/);
	});

	it("fails closed when current version is missing from the map", async () => {
		const env = makeKeysEnv(2);
		await expect(
			parseMasterKeys({ ...env, AGENT_CRED_MASTER_KEY_CURRENT: "3" }),
		).rejects.toThrow(/missing from/);
	});

	it("fails closed on a wrong-length key", async () => {
		const env = makeKeysEnv();
		const parsed = JSON.parse(env.AGENT_CRED_MASTER_KEYS) as Record<
			string,
			string
		>;
		parsed["1"] = bytesToBase64(new Uint8Array(16));
		await expect(
			parseMasterKeys({
				AGENT_CRED_MASTER_KEYS: JSON.stringify(parsed),
				AGENT_CRED_MASTER_KEY_CURRENT: "2",
			}),
		).rejects.toThrow(/exactly 32 bytes/);
	});

	it("fails closed on a non-integer current version", async () => {
		const env = makeKeysEnv();
		await expect(
			parseMasterKeys({ ...env, AGENT_CRED_MASTER_KEY_CURRENT: "x" }),
		).rejects.toThrow(/positive integer/);
	});
});

describe("encryptPayload / decryptPayload", () => {
	it("roundtrips the payload", async () => {
		const keys = await parseMasterKeys(makeKeysEnv());
		const enc = await encryptPayload(payload, "row-1", keys);
		expect(enc).not.toContain(payload.privateKey);
		const dec = await decryptPayload(
			{ id: "row-1", keyVersion: keys.current, payloadEnc: enc },
			keys,
		);
		expect(dec).toEqual(payload);
	});

	it("produces a distinct ciphertext for identical inputs (random nonce)", async () => {
		const keys = await parseMasterKeys(makeKeysEnv());
		const a = await encryptPayload(payload, "row-1", keys);
		const b = await encryptPayload(payload, "row-1", keys);
		expect(a).not.toBe(b);
	});

	it("rejects a payload copied to a different row (AAD binding)", async () => {
		const keys = await parseMasterKeys(makeKeysEnv());
		const enc = await encryptPayload(payload, "row-1", keys);
		await expect(
			decryptPayload(
				{ id: "row-2", keyVersion: keys.current, payloadEnc: enc },
				keys,
			),
		).rejects.toThrow(/authentication error/);
	});

	it("rejects when keyVersion differs from the sealed AAD", async () => {
		const env = makeKeysEnv(2);
		const keys = await parseMasterKeys(env);
		const keysV1 = await parseMasterKeys({
			...env,
			AGENT_CRED_MASTER_KEY_CURRENT: "1",
		});
		const enc = await encryptPayload(payload, "row-1", keysV1);
		await expect(
			decryptPayload(
				{ id: "row-1", keyVersion: keys.current, payloadEnc: enc },
				keys,
			),
		).rejects.toThrow(/authentication error/);
	});

	it("rejects tampered ciphertext", async () => {
		const keys = await parseMasterKeys(makeKeysEnv());
		const enc = await encryptPayload(payload, "row-1", keys);
		const raw = Uint8Array.from(atob(enc), (c) => c.charCodeAt(0));
		raw[raw.length - 1] ^= 0x01; // flip a bit in the tag
		const tampered = btoa(String.fromCharCode(...raw));
		await expect(
			decryptPayload(
				{ id: "row-1", keyVersion: keys.current, payloadEnc: tampered },
				keys,
			),
		).rejects.toThrow(/authentication error/);
	});

	it("rejects an unknown format version", async () => {
		const keys = await parseMasterKeys(makeKeysEnv());
		const enc = await encryptPayload(payload, "row-1", keys);
		const raw = Uint8Array.from(atob(enc), (c) => c.charCodeAt(0));
		raw[0] = 99;
		const badVersion = btoa(String.fromCharCode(...raw));
		await expect(
			decryptPayload(
				{ id: "row-1", keyVersion: keys.current, payloadEnc: badVersion },
				keys,
			),
		).rejects.toThrow(/unknown format version/);
	});

	it("rejects a payload too short to contain nonce + tag", async () => {
		const keys = await parseMasterKeys(makeKeysEnv());
		const garbage = btoa("short");
		await expect(
			decryptPayload(
				{ id: "row-1", keyVersion: keys.current, payloadEnc: garbage },
				keys,
			),
		).rejects.toThrow(/payload too short/);
	});

	it("fails when the row's key version is no longer in the map", async () => {
		const env = makeKeysEnv(2);
		const keysV1 = await parseMasterKeys({
			...env,
			AGENT_CRED_MASTER_KEY_CURRENT: "1",
		});
		const enc = await encryptPayload(payload, "row-1", keysV1);
		// Simulate rotation: only version 2 remains.
		const map = JSON.parse(env.AGENT_CRED_MASTER_KEYS) as Record<
			string,
			string
		>;
		delete map["1"];
		const rotated = await parseMasterKeys({
			AGENT_CRED_MASTER_KEYS: JSON.stringify(map),
			AGENT_CRED_MASTER_KEY_CURRENT: "2",
		});
		await expect(
			decryptPayload({ id: "row-1", keyVersion: 1, payloadEnc: enc }, rotated),
		).rejects.toThrow(/no key for version 1/);
	});

	it("decrypts with an older key version after rotation", async () => {
		const env = makeKeysEnv(2);
		const keysV1 = await parseMasterKeys({
			...env,
			AGENT_CRED_MASTER_KEY_CURRENT: "1",
		});
		const enc = await encryptPayload(payload, "row-1", keysV1);
		// keyVersion column records 1 even though current is now 2.
		const dec = await decryptPayload(
			{ id: "row-1", keyVersion: 1, payloadEnc: enc },
			await parseMasterKeys(env),
		);
		expect(dec).toEqual(payload);
	});
});
