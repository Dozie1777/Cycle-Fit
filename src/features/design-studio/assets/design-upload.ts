/**
 * Design uploads: presigned PUT URLs.
 *
 * Design agents publish their own files straight into the DESIGNS bucket, but
 * they never see S3 credentials. The worker holds an R2 API token
 * (S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY — Object Read & Write scoped to
 * the designs bucket) in its secrets and signs a short-lived presigned PUT
 * URL for exactly one key; the agent either calls the MCP tool
 * `get_upload_url` (see lib/design-mcp.ts) or POSTs to
 * /designs/:id/upload-url, then PUTs the file itself:
 *
 *   { url, key, expiresIn }  ->  curl -X PUT --upload-file index.html $url
 *
 * Nothing is bucket-mounted into the container (production mounts need s3fs
 * FUSE in the dind image) and no rclone/aws-cli is needed — curl ships in the
 * image. Presigning reference:
 * https://developers.cloudflare.com/r2/api/s3/presigned-urls/
 */

import { AwsClient } from "aws4fetch";

/** Presigned URLs stay valid for this long; agents simply request fresh ones. */
export const DESIGN_UPLOAD_URL_TTL_SECONDS = 900;

export type DesignUploadUrl = {
	/** Exact bucket key the signed URL writes to. */
	key: string;
	/** Presigned PUT URL (host is the account's R2 S3 endpoint). */
	url: string;
	/** Signature lifetime in seconds. */
	expiresIn: number;
};

/** Random bearer token stored per design project and injected into agent env. */
export function newDesignUploadToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	let out = "";
	for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
	return out;
}

/**
 * Timing-agnostic comparison of the agent-provided token against the stored
 * one. Comparing digests (fixed 32 bytes) means the loop runs the same length
 * regardless of either string's length, so timing cannot leak where a guess
 * diverges.
 */
export async function uploadTokenMatches(
	provided: string,
	expected: string,
): Promise<boolean> {
	const encoder = new TextEncoder();
	const digests = await Promise.all(
		[provided, expected].map((value) =>
			crypto.subtle.digest("SHA-256", encoder.encode(value)),
		),
	);
	const a = new Uint8Array(digests[0]);
	const b = new Uint8Array(digests[1]);
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
	return diff === 0;
}

/**
 * Signs one presigned PUT URL for `key` inside the designs bucket named by
 * env.S3_BUCKET — the bucket the R2 API token is scoped to (which is not
 * necessarily the `DESIGNS` binding's bucket; see the S3_* secrets). The S3
 * credentials never leave the worker; the signed URL alone lets the holder
 * PUT exactly that object until it expires.
 */
export async function createDesignUploadUrl(
	env: Pick<
		Env,
		| "S3_ACCESS_KEY_ID"
		| "S3_SECRET_ACCESS_KEY"
		| "S3_BUCKET"
		| "CLOUDFLARE_ACCOUNT_ID"
	>,
	key: string,
): Promise<DesignUploadUrl> {
	if (!env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
		throw new Error(
			"design uploads unavailable: S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY not set",
		);
	}
	if (!env.S3_BUCKET) {
		throw new Error("design uploads unavailable: S3_BUCKET not set");
	}
	if (!env.CLOUDFLARE_ACCOUNT_ID) {
		throw new Error(
			"design uploads unavailable: CLOUDFLARE_ACCOUNT_ID not set",
		);
	}
	const ttl = DESIGN_UPLOAD_URL_TTL_SECONDS;
	const endpoint = `https://${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`;
	const client = new AwsClient({
		accessKeyId: env.S3_ACCESS_KEY_ID,
		secretAccessKey: env.S3_SECRET_ACCESS_KEY,
		service: "s3",
	});
	// signQuery moves the signature into the URL itself, so plain `curl -X PUT`
	// works. UNSIGNED-PAYLOAD keeps the body out of the signature — exactly
	// what the docs prescribe for presigned PUTs. X-Amz-Expires must be set on
	// the URL up front: aws4fetch only defaults it (to 24h) when absent.
	const target = new URL(`${endpoint}/${env.S3_BUCKET}/${key}`);
	target.searchParams.set("X-Amz-Expires", String(ttl));
	const signed = await client.sign(target.toString(), {
		method: "PUT",
		headers: {},
		aws: { signQuery: true },
	});
	return {
		key,
		url: signed.url,
		expiresIn: ttl,
	};
}
