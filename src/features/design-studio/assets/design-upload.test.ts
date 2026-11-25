import { afterEach, describe, expect, it, vi } from "vitest";
import { newDesignId } from "./design-files";
import {
	createDesignUploadUrl,
	DESIGN_UPLOAD_URL_TTL_SECONDS,
	newDesignUploadToken,
	uploadTokenMatches,
} from "./design-upload";

const env = {
	S3_ACCESS_KEY_ID: "r2-access-key-id",
	S3_SECRET_ACCESS_KEY: "r2-secret-access-key",
	S3_BUCKET: "designs-bucket",
	CLOUDFLARE_ACCOUNT_ID: "c45688b6c27db47659026bb3d520cad3",
};

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("newDesignUploadToken", () => {
	it("generates 64-char hex tokens", () => {
		const token = newDesignUploadToken();
		expect(token).toMatch(/^[0-9a-f]{64}$/);
	});

	it("generates unique tokens", () => {
		const seen = new Set<string>();
		for (let i = 0; i < 100; i++) seen.add(newDesignUploadToken());
		expect(seen.size).toBe(100);
	});
});

describe("uploadTokenMatches", () => {
	it("accepts the exact stored token", async () => {
		const token = newDesignUploadToken();
		expect(await uploadTokenMatches(token, token)).toBe(true);
	});

	it("rejects wrong, empty and prefix tokens", async () => {
		const token = newDesignUploadToken();
		expect(await uploadTokenMatches(newDesignUploadToken(), token)).toBe(false);
		expect(await uploadTokenMatches("", token)).toBe(false);
		expect(await uploadTokenMatches(token.slice(0, 32), token)).toBe(false);
	});
});

describe("createDesignUploadUrl", () => {
	it("signs a PUT url for the exact key with query-string credentials", async () => {
		const id = newDesignId();
		const key = `designs/${id}/index.html`;
		const upload = await createDesignUploadUrl(env, key);
		const url = new URL(upload.url);

		expect(upload.key).toBe(key);
		expect(upload.expiresIn).toBe(DESIGN_UPLOAD_URL_TTL_SECONDS);
		expect(url.origin).toBe(
			`https://${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
		);
		expect(url.pathname).toBe(`/${env.S3_BUCKET}/${key}`);
		// signQuery moves the signature into the URL itself, so plain
		// `curl -X PUT` works without any headers.
		expect(url.searchParams.get("X-Amz-Signature")).toBeTruthy();
		expect(url.searchParams.get("X-Amz-Expires")).toBe(
			String(DESIGN_UPLOAD_URL_TTL_SECONDS),
		);
		expect(url.searchParams.get("X-Amz-Credential")).toContain(
			env.S3_ACCESS_KEY_ID,
		);
		// Never leak the secret into the presigned URL.
		expect(upload.url).not.toContain(env.S3_SECRET_ACCESS_KEY);
	});

	it("fails closed when the S3 credentials are not provisioned", async () => {
		await expect(
			createDesignUploadUrl(
				{ ...env, S3_ACCESS_KEY_ID: "" },
				"designs/x/index.html",
			),
		).rejects.toThrow(/S3_ACCESS_KEY_ID/);
		await expect(
			createDesignUploadUrl(
				{ ...env, CLOUDFLARE_ACCOUNT_ID: "" },
				"designs/x/index.html",
			),
		).rejects.toThrow(/CLOUDFLARE_ACCOUNT_ID/);
		await expect(
			createDesignUploadUrl({ ...env, S3_BUCKET: "" }, "designs/x/index.html"),
		).rejects.toThrow(/S3_BUCKET/);
	});
});
