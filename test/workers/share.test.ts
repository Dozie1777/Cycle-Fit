import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
	createDesign,
	createProject,
	putDesignFile,
} from "../helpers/fixtures";
import { startWorkerRequest } from "../helpers/request";
import {
	createTrpcTestClient,
	trpcErrorCode,
	trpcErrorMessage,
} from "../helpers/trpc";

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("Start public share document", () => {
	it("renders an escaped title, sandboxed design iframe, and remix control without a session", async () => {
		const project = await createDesign({
			prompt: '<img src=x onerror="alert(1)"> & Friends',
		});
		const response = await startWorkerRequest(`/share/${project.id}`);
		expect(response.status, await response.clone().text()).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/html");
		const html = await response.text();
		expect(html).toContain(
			"&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; Friends",
		);
		expect(html).not.toContain('<img src=x onerror="alert(1)">');
		expect(html).toContain(`src="/designs/${project.id}/site"`);
		expect(html).toMatch(/<iframe[^>]*sandbox=""/);
		// The remix control stays on the public page (the fork renders in the
		// same iframe); the admin studio is reached only via the sign-in link,
		// so SSR must not carry a direct /admin/studio target.
		expect(html).toContain(">Remix<");
		expect(html).not.toContain("/admin/studio");
	});

	it("returns 404 for missing and invalid projects", async () => {
		const missing = await startWorkerRequest(`/share/${crypto.randomUUID()}`);
		expect(missing.status).toBe(404);
		const invalid = await startWorkerRequest("/share/not-a-uuid");
		expect(invalid.status).toBe(404);
	});

	it("does not share loader data across requests", async () => {
		const first = await createDesign({ prompt: "First private title" });
		const second = await createDesign({
			prompt: "Second private title",
		});
		const firstHtml = await startWorkerRequest(`/share/${first.id}`).then(
			(response) => response.text(),
		);
		const secondHtml = await startWorkerRequest(`/share/${second.id}`).then(
			(response) => response.text(),
		);
		expect(firstHtml).toContain("First private title");
		expect(firstHtml).not.toContain("Second private title");
		expect(secondHtml).toContain("Second private title");
		expect(secondHtml).not.toContain("First private title");
	});
});

describe("Public share tRPC API", () => {
	// The share endpoints are public — no session is ever attached.
	it("resolves the public project lookup for the share page", async () => {
		const client = createTrpcTestClient();
		const project = await createDesign({ prompt: "Public title" });
		expect(
			await client.share.getProject.query({ projectId: project.id }),
		).toEqual({ projectId: project.id, prompt: "Public title" });
		// Missing and malformed ids resolve null (the page renders a 404).
		expect(
			await client.share.getProject.query({
				projectId: crypto.randomUUID(),
			}),
		).toBeNull();
		expect(
			await client.share.getProject.query({ projectId: "not-a-uuid" }),
		).toBeNull();
	});

	it("returns CONFLICT without creating a fork when no published index exists", async () => {
		const project = await createDesign();
		const remix = () =>
			createTrpcTestClient().share.remix.mutate({ projectId: project.id });
		expect(await trpcErrorCode(remix)).toBe("CONFLICT");
		expect(await trpcErrorMessage(remix)).toBe("nothing published to remix");
		expect(
			await env.DB.prepare('SELECT COUNT(*) AS count FROM "Design"')
				.first()
				.then((row) => row?.count),
		).toBe(1);
	});

	it("copies published HTML and preview into a new project with fresh credentials", async () => {
		const project = await createDesign();
		const html = "<!doctype html><title>Published</title><p>remix me</p>";
		const preview = Uint8Array.from([8, 6, 7, 5]);
		await putDesignFile(project.id, "index.html", html, "text/html");
		await putDesignFile(project.id, "preview.png", preview, "image/png");

		const body = await createTrpcTestClient().share.remix.mutate({
			projectId: project.id,
		});
		expect(body.projectId).toMatch(UUID_RE);
		expect(body.projectId).not.toBe(project.id);
		const fork = await env.DB.prepare(
			'SELECT prompt, uploadToken, status, projectId FROM "Design" WHERE id = ?',
		)
			.bind(body.projectId)
			.first();
		expect(fork).toEqual({
			prompt: `Remix of: ${project.prompt}`,
			uploadToken: expect.stringMatching(/^[0-9a-f]{64}$/),
			status: "ready",
			// Unfiled sources fork unfiled.
			projectId: null,
		});
		expect(fork?.uploadToken).not.toBe(project.uploadToken);
		expect(
			await env.DESIGNS.get(`designs/${body.projectId}/index.html`).then(
				(object) => object?.text(),
			),
		).toBe(html);
		const copiedPreview = await env.DESIGNS.get(
			`designs/${body.projectId}/preview.png`,
		);
		expect(copiedPreview?.httpMetadata?.contentType).toBe("image/png");
		expect(
			copiedPreview
				? new Uint8Array(await copiedPreview.arrayBuffer())
				: undefined,
		).toEqual(preview);
	});

	it("copies HTML when no optional preview exists", async () => {
		const project = await createDesign();
		await putDesignFile(
			project.id,
			"index.html",
			"<p>html only</p>",
			"text/html",
		);
		const { projectId } = await createTrpcTestClient().share.remix.mutate({
			projectId: project.id,
		});
		expect(
			await env.DESIGNS.get(`designs/${projectId}/preview.png`),
		).toBeNull();
	});

	it("carries the source's projectId into the fork row for filed sources", async () => {
		const container = await createProject({ name: "Filed container" });
		const project = await createDesign({ projectId: container.id });
		await putDesignFile(
			project.id,
			"index.html",
			"<p>filed source</p>",
			"text/html",
		);
		const { projectId: forkId } =
			await createTrpcTestClient().share.remix.mutate({
				projectId: project.id,
			});
		const fork = await env.DB.prepare(
			'SELECT projectId, remixedFromId FROM "Design" WHERE id = ?',
		)
			.bind(forkId)
			.first();
		expect(fork).toEqual({
			projectId: container.id,
			remixedFromId: project.id,
		});
	});

	it("returns NOT_FOUND for a missing project and BAD_REQUEST for an invalid id", async () => {
		const missing = () =>
			createTrpcTestClient().share.remix.mutate({
				projectId: crypto.randomUUID(),
			});
		expect(await trpcErrorCode(missing)).toBe("NOT_FOUND");
		expect(await trpcErrorMessage(missing)).toBe("not found");
		const invalid = () =>
			createTrpcTestClient().share.remix.mutate({
				projectId: "not-a-uuid",
			});
		expect(await trpcErrorCode(invalid)).toBe("BAD_REQUEST");
		expect(await trpcErrorMessage(invalid)).toBe("invalid project id");
	});
});
