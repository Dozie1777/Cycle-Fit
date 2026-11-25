import { z } from "zod";

/**
 * Credential payload encryption.
 *
 * Layout of `payloadEnc` (base64):
 *   [1 byte format version] [12 byte nonce] [ciphertext + 16 byte GCM tag]
 *
 * - AES-256-GCM via WebCrypto (native on Workers). Nothing else in this
 *   codebase touches WebCrypto for credential material.
 * - AAD = `${rowId}:${keyVersion}` binds the ciphertext to its row, so a
 *   `payloadEnc` copied from another row (or re-labeled with a different
 *   keyVersion) fails authentication instead of decrypting.
 * - Keys come from a versioned map so rotation never destroys old keys:
 *   decrypt with the row's `keyVersion`, encrypt with `CURRENT_KEY_VERSION`.
 */

const FORMAT_VERSION = 1;
const KEY_LENGTH_BYTES = 32;
const NONCE_LENGTH_BYTES = 12;

/** Extracts the master-key configuration from the environment. Throws (fail closed) on any problem. */
export async function parseMasterKeys(
	env: Pick<Env, "AGENT_CRED_MASTER_KEYS" | "AGENT_CRED_MASTER_KEY_CURRENT">,
): Promise<MasterKeys> {
	const { AGENT_CRED_MASTER_KEYS, AGENT_CRED_MASTER_KEY_CURRENT } = env;

	if (!AGENT_CRED_MASTER_KEYS || !AGENT_CRED_MASTER_KEY_CURRENT) {
		throw new Error(
			"credential crypto unavailable: AGENT_CRED_MASTER_KEYS / AGENT_CRED_MASTER_KEY_CURRENT not set",
		);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(AGENT_CRED_MASTER_KEYS);
	} catch {
		throw new Error(
			"credential crypto unavailable: AGENT_CRED_MASTER_KEYS is not valid JSON",
		);
	}

	const shape = z.record(z.string(), z.string()).safeParse(parsed);
	if (!shape.success) {
		throw new Error(
			"credential crypto unavailable: AGENT_CRED_MASTER_KEYS must be a JSON object of version -> base64 key",
		);
	}

	const current = Number(AGENT_CRED_MASTER_KEY_CURRENT);
	if (!Number.isInteger(current) || current < 1) {
		throw new Error(
			"credential crypto unavailable: AGENT_CRED_MASTER_KEY_CURRENT must be a positive integer",
		);
	}

	const keys = new Map<number, CryptoKey>();
	for (const [version, encoded] of Object.entries(shape.data)) {
		const v = Number(version);
		if (!Number.isInteger(v) || v < 1) {
			throw new Error(
				`credential crypto unavailable: invalid key version "${version}"`,
			);
		}
		if (keys.has(v)) {
			// "1" and "01" both normalize to 1 and would silently collapse —
			// a malformed secret map must fail loudly instead.
			throw new Error(
				`credential crypto unavailable: duplicate key version ${v}`,
			);
		}
		let raw: Uint8Array;
		try {
			raw = base64ToBytes(encoded);
		} catch {
			throw new Error(
				`credential crypto unavailable: key version ${v} is not valid base64`,
			);
		}
		if (raw.byteLength !== KEY_LENGTH_BYTES) {
			throw new Error(
				`credential crypto unavailable: key version ${v} must decode to exactly ${KEY_LENGTH_BYTES} bytes (got ${raw.byteLength})`,
			);
		}
		keys.set(v, await importKey(raw));
	}

	if (!keys.has(current)) {
		throw new Error(
			`credential crypto unavailable: AGENT_CRED_MASTER_KEY_CURRENT (${current}) missing from AGENT_CRED_MASTER_KEYS`,
		);
	}

	return { keys, current };
}

export interface MasterKeys {
	/** key version -> imported AES-GCM key */
	keys: Map<number, CryptoKey>;
	/** version used for new writes */
	current: number;
}

export interface EncryptablePayload {
	appId: string;
	privateKey: string;
	botLogin: string;
	botEmail: string;
}

function aad(rowId: string, keyVersion: number): Uint8Array {
	return new TextEncoder().encode(`${rowId}:${keyVersion}`);
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function base64ToBytes(encoded: string): Uint8Array {
	const binary = atob(encoded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

async function importKey(raw: Uint8Array): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		"raw",
		raw as BufferSource,
		{ name: "AES-GCM" },
		false,
		["encrypt", "decrypt"],
	);
}

/** Encrypts the credential payload for a row. Returns the base64 `payloadEnc` value. */
export async function encryptPayload(
	payload: EncryptablePayload,
	rowId: string,
	keys: MasterKeys,
): Promise<string> {
	const key = keys.keys.get(keys.current);
	if (!key)
		throw new Error(
			`encrypt failed: no key for current version ${keys.current}`,
		);

	const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LENGTH_BYTES));
	const plaintext = new TextEncoder().encode(JSON.stringify(payload));

	const ciphertext = new Uint8Array(
		await crypto.subtle.encrypt(
			{
				name: "AES-GCM",
				iv: nonce as BufferSource,
				additionalData: aad(rowId, keys.current) as BufferSource,
				tagLength: 128,
			},
			key,
			plaintext as BufferSource,
		),
	);

	const out = new Uint8Array(1 + nonce.length + ciphertext.length);
	out[0] = FORMAT_VERSION;
	out.set(nonce, 1);
	out.set(ciphertext, 1 + nonce.length);
	return bytesToBase64(out);
}

/**
 * Decrypts a row's `payloadEnc` using the row's `keyVersion`.
 * Throws if the row id / keyVersion do not match the AAD the payload was
 * sealed with, if the ciphertext was tampered with, or if the key version is
 * no longer present in the master key map.
 */
export async function decryptPayload(
	row: { id: string; keyVersion: number; payloadEnc: string },
	keys: MasterKeys,
): Promise<EncryptablePayload> {
	const key = keys.keys.get(row.keyVersion);
	if (!key) {
		throw new Error(
			`decrypt failed: no key for version ${row.keyVersion} (row ${row.id})`,
		);
	}

	const raw = base64ToBytes(row.payloadEnc);
	if (raw.length < 1 + NONCE_LENGTH_BYTES + 16) {
		throw new Error(`decrypt failed: payload too short (row ${row.id})`);
	}
	if (raw[0] !== FORMAT_VERSION) {
		throw new Error(
			`decrypt failed: unknown format version ${raw[0]} (row ${row.id})`,
		);
	}

	const nonce = raw.slice(1, 1 + NONCE_LENGTH_BYTES);
	const ciphertext = raw.slice(1 + NONCE_LENGTH_BYTES);

	let plaintext: ArrayBuffer;
	try {
		plaintext = await crypto.subtle.decrypt(
			{
				name: "AES-GCM",
				iv: nonce as BufferSource,
				additionalData: aad(row.id, row.keyVersion) as BufferSource,
				tagLength: 128,
			},
			key,
			ciphertext as BufferSource,
		);
	} catch {
		throw new Error(
			`decrypt failed: authentication error (row ${row.id}, keyVersion ${row.keyVersion})`,
		);
	}

	const parsed = z
		.object({
			appId: z.string(),
			privateKey: z.string(),
			botLogin: z.string(),
			botEmail: z.string(),
		})
		.safeParse(JSON.parse(new TextDecoder().decode(plaintext)));

	if (!parsed.success) {
		throw new Error(
			`decrypt failed: payload does not match EncryptablePayload (row ${row.id})`,
		);
	}
	return parsed.data;
}
