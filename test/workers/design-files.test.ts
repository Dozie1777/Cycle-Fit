import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createAdminSession } from "../helpers/auth";
import { createDesign, putDesignFile } from "../helpers/fixtures";
import { startJsonRequest, startWorkerRequest } from "../helpers/request";

const INVALID_BODIES = [
	{},
	{ token: "token" },
	{ path: "index.html" },
	{ token: "", path: "index.html" },
	{ token: "token", path: "" },
	{ token: 42, path: "index.html" },
	{ token: "token", path: 42 },
	{ token: "x".repeat(257), path: "index.html" },
	{ token: "token", path: "x".repeat(201) },
];

function uploadRequest(
	projectId: string,
	body: unknown,
	init: RequestInit = {},
	requestEnv?: Env,
) {
	return startJsonRequest(
		`/designs/${projectId}/upload-url`,
		"POST",
		body,
		init,
		requestEnv,
	);
}

describe("Start design upload signing", () => {
	it.each(INVALID_BODIES)("rejects invalid body %#", async (body) => {
		const project = await createDesign();
		const response = await uploadRequest(project.id, body);
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: "invalid body" });
	});

	it("returns 400 for malformed JSON", async () => {
		const project = await createDesign();
		const response = await startWorkerRequest(
			`/designs/${project.id}/upload-url`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: "{",
			},
		);
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: "invalid body" });
	});

	it("rejects an invalid project id and returns 404 for a missing project", async () => {
		const invalid = await uploadRequest("not-a-uuid", {
			token: "token",
			path: "index.html",
		});
		expect(invalid.status).toBe(400);
		expect(await invalid.json()).toEqual({ error: "invalid project id" });

		const missing = await uploadRequest(crypto.randomUUID(), {
			token: "token",
			path: "index.html",
		});
		expect(missing.status).toBe(404);
		expect(await missing.json()).toEqual({ error: "not found" });
	});

	it("authenticates only the JSON agent token, not an admin session", async () => {
		const project = await createDesign();
		const wrong = await uploadRequest(project.id, {
			token: "wrong-token",
			path: "index.html",
		});
		expect(wrong.status).toBe(401);
		expect(await wrong.json()).toEqual({ error: "unauthorized" });

		const admin = await createAdminSession();
		const adminWithoutAgentToken = await uploadRequest(
			project.id,
			{ token: "wrong-token", path: "index.html" },
			{ headers: admin.headers },
		);
		expect(adminWithoutAgentToken.status).toBe(401);
		expect(await adminWithoutAgentToken.json()).toEqual({
			error: "unauthorized",
		});
	});

	it.each([
		"../secret.txt",
		"files/../../secret.txt",
		"./index.html",
		"/index.html",
		"bad path.html",
	])("rejects unsafe upload path %s", async (path) => {
		const project = await createDesign();
		const response = await uploadRequest(project.id, {
			token: project.uploadToken,
			path,
		});
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: "invalid file path" });
	});

	it("returns the existing 500 response when S3 credentials are missing", async () => {
		const project = await createDesign();
		const response = await uploadRequest(
			project.id,
			{ token: project.uploadToken, path: "index.html" },
			{},
			{ ...env, S3_ACCESS_KEY_ID: "" },
		);
		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({
			error: "uploads unavailable — S3 credentials not provisioned",
		});
	});

	it("signs a 15-minute PUT for the exact key without an admin session", async () => {
		const project = await createDesign();
		const response = await uploadRequest(project.id, {
			token: project.uploadToken,
			path: "assets/site.js",
		});
		expect(response.status).toBe(200);
		const upload = (await response.json()) as {
			url: string;
			key: string;
			expiresIn: number;
		};
		expect(upload.key).toBe(`designs/${project.id}/assets/site.js`);
		expect(upload.expiresIn).toBe(900);
		const url = new URL(upload.url);
		expect(url.origin).toBe(
			`https://${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
		);
		expect(url.pathname).toBe(
			`/working-dir-bucket/designs/${project.id}/assets/site.js`,
		);
		expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
		expect(url.searchParams.get("X-Amz-Signature")).toBeTruthy();
	});

	it("signs live uploads against the current publication pointer", async () => {
		const project = await createDesign();
		const liveTurnId = crypto.randomUUID();
		await env.DB.prepare('UPDATE "Design" SET liveTurnId = ? WHERE id = ?')
			.bind(liveTurnId, project.id)
			.run();
		const response = await uploadRequest(project.id, {
			token: project.uploadToken,
			path: "index.html",
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			key: `designs/${project.id}/turns/${liveTurnId}/index.html`,
		});
	});
});

describe("Start public design files", () => {
	it("serves site, preview, and nested files by UUID without a session", async () => {
		const project = await createDesign();
		const html = "<!doctype html><html><body>public site</body></html>";
		const previewBytes = Uint8Array.from([0, 255, 128, 1, 2, 3]);
		await putDesignFile(project.id, "index.html", html, "text/html");
		await putDesignFile(project.id, "preview.png", previewBytes, "image/png");
		await putDesignFile(project.id, "assets/app.css", "body{}", "text/css");

		const site = await startWorkerRequest(`/designs/${project.id}/site`);
		expect(site.status).toBe(200);
		expect(site.headers.get("content-type")).toBe("text/html; charset=utf-8");
		expect(site.headers.get("cache-control")).toBe("public, max-age=60");
		expect(site.headers.get("x-content-type-options")).toBe("nosniff");
		expect(site.headers.get("content-security-policy")).toBe(
			"sandbox allow-scripts allow-forms allow-popups",
		);
		expect(await site.text()).toBe(html);

		const preview = await startWorkerRequest(`/designs/${project.id}/preview`);
		expect(preview.status).toBe(200);
		expect(preview.headers.get("content-type")).toBe("image/png");
		expect(preview.headers.get("content-security-policy")).toBeNull();
		expect(new Uint8Array(await preview.arrayBuffer())).toEqual(previewBytes);

		const file = await startWorkerRequest(
			`/designs/${project.id}/file/assets/app.css`,
		);
		expect(file.status).toBe(200);
		expect(file.headers.get("content-type")).toBe("text/css; charset=utf-8");
		expect(file.headers.get("content-security-policy")).toBeNull();
		expect(await file.text()).toBe("body{}");
	});

	it("serves pointed live artifacts instead of stale legacy keys", async () => {
		const project = await createDesign();
		const liveTurnId = crypto.randomUUID();
		await putDesignFile(project.id, "index.html", "legacy", "text/html");
		await putDesignFile(
			project.id,
			`turns/${liveTurnId}/index.html`,
			"pointed live html",
			"text/html",
		);
		await putDesignFile(
			project.id,
			`turns/${liveTurnId}/preview.png`,
			"pointed preview",
			"image/png",
		);
		await env.DB.prepare('UPDATE "Design" SET liveTurnId = ? WHERE id = ?')
			.bind(liveTurnId, project.id)
			.run();

		const site = await startWorkerRequest(`/designs/${project.id}/site`);
		expect(await site.text()).toBe("pointed live html");
		const preview = await startWorkerRequest(`/designs/${project.id}/preview`);
		expect(new TextDecoder().decode(await preview.arrayBuffer())).toBe(
			"pointed preview",
		);
	});

	it("preserves binary response bytes instead of decoding R2 bodies as text", async () => {
		const project = await createDesign();
		const bytes = Uint8Array.from([0, 255, 254, 128, 65]);
		await putDesignFile(
			project.id,
			"blob.bin",
			bytes,
			"application/octet-stream",
		);
		const response = await startWorkerRequest(
			`/designs/${project.id}/file/blob.bin?selectable=1`,
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe(
			"application/octet-stream",
		);
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
	});

	it("returns plain-text 404 for missing site, preview, and file objects", async () => {
		const project = await createDesign();
		for (const path of ["site", "preview", "file/missing.txt"]) {
			const response = await startWorkerRequest(
				`/designs/${project.id}/${path}`,
			);
			expect(response.status).toBe(404);
			expect(await response.text()).toBe("not found");
		}
	});

	it.each([
		"..%2Fsecret.txt",
		"assets/..%2Fsecret.txt",
		".%2Findex.html",
		"bad%20path.html",
	])("rejects traversal and invalid public file path %s", async (path) => {
		const project = await createDesign();
		const response = await startWorkerRequest(
			`/designs/${project.id}/file/${path}`,
		);
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: "invalid file path" });
	});

	it("injects the selection bridge exactly once only for selectable HTML", async () => {
		const project = await createDesign();
		const html =
			"<html><body><main data-section='hero'>Hero</main></body></html>";
		await putDesignFile(project.id, "index.html", html, "text/html");

		const plain = await startWorkerRequest(`/designs/${project.id}/site`);
		const plainHtml = await plain.text();
		expect(plainHtml).toBe(html);
		expect(plainHtml).not.toContain("__designSelect");

		for (const path of ["site?selectable=1", "file/index.html?selectable=1"]) {
			const response = await startWorkerRequest(
				`/designs/${project.id}/${path}`,
			);
			const body = await response.text();
			// Section set + clear, plus the block branch's section deselect.
			expect(body.match(/__designSelect/g)).toHaveLength(3);
			expect(body.match(/<script>/g)).toHaveLength(1);
			expect(body.indexOf("<script>")).toBeGreaterThan(body.indexOf("<main"));
			expect(body.endsWith("</body></html>")).toBe(true);
			// KUK-929: the served bridge handles PageBlock selection too.
			expect(body).toContain("__designBlockSelect");
			expect(body).toContain("__designBlockHighlight");
			expect(body).toContain("[data-block-id]");
		}

		const notSelected = await startWorkerRequest(
			`/designs/${project.id}/site?selectable=0`,
		);
		expect(await notSelected.text()).toBe(html);
	});
});
