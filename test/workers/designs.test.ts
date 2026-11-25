import { env } from "cloudflare:workers";
import { launch } from "@cloudflare/playwright";
import { getSandbox } from "@cloudflare/sandbox";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createAdminSession,
	createUserSession,
	type TestSession,
} from "../helpers/auth";
import {
	createDesign,
	createProject,
	putDesignFile,
} from "../helpers/fixtures";
import { startWorkerRequest } from "../helpers/request";
import {
	createTrpcTestClient,
	type TrpcTestClient,
	trpcErrorCode,
	trpcErrorMessage,
} from "../helpers/trpc";

vi.mock("@cloudflare/playwright", () => ({ launch: vi.fn() }));
vi.mock("@cloudflare/sandbox", async (importOriginal) => ({
	...(await importOriginal<typeof import("@cloudflare/sandbox")>()),
	getSandbox: vi.fn(),
}));

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function adminClient(session: TestSession, requestEnv?: Env): TrpcTestClient {
	return createTrpcTestClient(session.headers, requestEnv);
}

async function insertProjectAt(index: number) {
	const id = crypto.randomUUID();
	const createdAt = new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();
	await env.DB.prepare(
		`INSERT INTO "Design"
			(id, prompt, uploadToken, status, createdAt, updatedAt)
			VALUES (?, ?, ?, 'ready', ?, ?)`,
	)
		.bind(id, `project-${index}`, `token-${index}`, createdAt, createdAt)
		.run();
	return { id, prompt: `project-${index}` };
}

async function insertMessage(
	projectId: string,
	index: number,
): Promise<string> {
	const id = crypto.randomUUID();
	const createdAt = new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();
	await env.DB.prepare(
		`INSERT INTO "Message" (id, designId, role, content, createdAt)
			VALUES (?, ?, ?, ?, ?)`,
	)
		.bind(
			id,
			projectId,
			index % 2 === 0 ? "user" : "assistant",
			`message-${index}`,
			createdAt,
		)
		.run();
	return id;
}

function mockPreview(bytes = Uint8Array.from([1, 2, 3, 4])) {
	const page = {
		setContent: vi.fn(async () => {}),
		screenshot: vi.fn(async () => bytes),
	};
	const browser = {
		newPage: vi.fn(async () => page),
		close: vi.fn(async () => {}),
	};
	vi.mocked(launch).mockResolvedValue(browser as never);
	return { browser, page };
}

function mockSandboxExec() {
	const sandbox = {
		exec: vi.fn(async () => ({
			success: true,
			exitCode: 0,
			stdout: "debug stdout",
			stderr: "debug stderr",
		})),
	};
	vi.mocked(getSandbox).mockReturnValue(sandbox as never);
	return sandbox;
}

afterEach(() => {
	vi.clearAllMocks();
	vi.restoreAllMocks();
});

describe("Design management tRPC API", () => {
	it.each([
		{},
		{ prompt: "" },
		{ prompt: "   " },
		{ prompt: "x".repeat(4001) },
		{ prompt: 42 },
		{ prompt: "no container" },
		{ prompt: "bad container", projectId: "not-a-uuid" },
	])("rejects invalid create bodies with the existing error shape", async (body) => {
		const session = await createAdminSession();
		const call = () =>
			adminClient(session).designs.create.mutate(body as never);
		expect(await trpcErrorCode(call)).toBe("BAD_REQUEST");
		expect(await trpcErrorMessage(call)).toBeTruthy();
		expect(getSandbox).not.toHaveBeenCalled();
	});

	it("creates a filed design with a trimmed prompt, UUID, and upload token", async () => {
		const container = await createProject({ name: "Creation target" });
		const session = await createAdminSession();
		const created = await adminClient(session).designs.create.mutate({
			prompt: "  Design a landing page  ",
			projectId: container.id,
		});
		const projectId = created.projectId;
		expect(projectId).toEqual(expect.stringMatching(UUID_RE));
		const project = await env.DB.prepare(
			'SELECT prompt, uploadToken, status, projectId FROM "Design" WHERE id = ?',
		)
			.bind(projectId)
			.first();
		expect(project).toEqual({
			prompt: "Design a landing page",
			uploadToken: expect.stringMatching(/^[0-9a-f]{64}$/),
			status: "ready",
			projectId: container.id,
		});
		expect(getSandbox).not.toHaveBeenCalled();
	});

	it("returns NOT_FOUND when creating into an unknown project", async () => {
		const session = await createAdminSession();
		const call = () =>
			adminClient(session).designs.create.mutate({
				prompt: "orphan brief",
				projectId: crypto.randomUUID(),
			});
		expect(await trpcErrorCode(call)).toBe("NOT_FOUND");
		expect(await trpcErrorMessage(call)).toBe("project not found");
	});

	it("lists the newest 100 projects in descending creation order", async () => {
		const inserted: Array<{ id: string; prompt: string }> = [];
		for (let index = 0; index <= 100; index++) {
			inserted.push(await insertProjectAt(index));
		}
		const session = await createAdminSession();
		const projects = await adminClient(session).designs.list.query();
		expect(projects).toHaveLength(100);
		expect(projects[0]).toMatchObject({
			id: inserted[100]?.id,
			prompt: "project-100",
		});
		expect(projects.at(-1)).toMatchObject({
			id: inserted[1]?.id,
			prompt: "project-1",
		});
		expect(projects.some((project) => project.id === inserted[0]?.id)).toBe(
			false,
		);
		expect(
			projects.every(
				(project, index) =>
					index === 0 ||
					String(projects[index - 1]?.createdAt ?? "") >=
						String(project.createdAt),
			),
		).toBe(true);
	});

	it("rejects an invalid project UUID and returns NOT_FOUND for a missing project", async () => {
		const session = await createAdminSession();
		const invalid = () =>
			adminClient(session).designs.get.query({ projectId: "not-a-uuid" });
		expect(await trpcErrorCode(invalid)).toBe("BAD_REQUEST");
		expect(await trpcErrorMessage(invalid)).toBe("invalid project id");
		const missing = () =>
			adminClient(session).designs.get.query({
				projectId: crypto.randomUUID(),
			});
		expect(await trpcErrorCode(missing)).toBe("NOT_FOUND");
		expect(await trpcErrorMessage(missing)).toBe("not found");
	});

	it("returns project fields, real R2 files, flags, and section drafts", async () => {
		const project = await createDesign({
			prompt: "Detail fixture",
			status: "failed",
		});
		await env.DB.prepare('UPDATE "Design" SET error = ? WHERE id = ?')
			.bind("previous failure", project.id)
			.run();
		await putDesignFile(project.id, "index.html", "<html></html>", "text/html");
		await putDesignFile(project.id, "preview.png", "png", "image/png");
		await putDesignFile(project.id, "drafts/hero.html", "hero", "text/html");
		await putDesignFile(
			project.id,
			"drafts/footer.html",
			"footer",
			"text/html",
		);
		await putDesignFile(project.id, "drafts/notes.txt", "notes", "text/plain");
		const session = await createAdminSession();
		const detail = await adminClient(session).designs.get.query({
			projectId: project.id,
		});
		expect(detail).toMatchObject({
			id: project.id,
			prompt: "Detail fixture",
			uploadToken: project.uploadToken,
			status: "failed",
			error: "previous failure",
			createdAt: expect.any(String),
			updatedAt: expect.any(String),
			hasIndex: true,
			hasPreview: true,
			sections: ["drafts/footer", "drafts/hero"].map((path) =>
				path.slice("drafts/".length),
			),
		});
		expect(detail.files.map((file) => file.path).sort()).toEqual([
			"drafts/footer.html",
			"drafts/hero.html",
			"drafts/notes.txt",
			"index.html",
			"preview.png",
		]);
		expect(detail.files).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					path: "index.html",
					size: 13,
					lastModified: expect.any(String),
				}),
			]),
		);
	});

	it("returns only public message fields in chronological order, capped at 200", async () => {
		const project = await createDesign();
		for (let index = 0; index <= 200; index++) {
			await insertMessage(project.id, index);
		}
		const session = await createAdminSession();
		const messages = await adminClient(session).designs.listMessages.query({
			projectId: project.id,
		});
		expect(messages).toHaveLength(200);
		expect(messages[0]).toEqual({
			id: expect.any(String),
			role: "user",
			content: "message-0",
			attachments: [],
			createdAt: expect.any(String),
		});
		expect(messages.at(-1)?.content).toBe("message-199");
		expect(messages.some((message) => message.content === "message-200")).toBe(
			false,
		);
		expect(messages.every((message) => !("projectId" in message))).toBe(true);
	});

	it("lists real R2 versions newest first with preview flags", async () => {
		const project = await createDesign();
		for (const n of [1, 2, 10]) {
			await putDesignFile(
				project.id,
				`versions/${n}/index.html`,
				`version-${n}`,
				"text/html",
			);
			if (n !== 2) {
				await putDesignFile(
					project.id,
					`versions/${n}/preview.png`,
					"png",
					"image/png",
				);
			}
		}
		const session = await createAdminSession();
		expect(
			await adminClient(session).designs.listVersions.query({
				projectId: project.id,
			}),
		).toEqual([
			{ n: 10, createdAt: expect.any(String), hasPreview: true },
			{ n: 2, createdAt: expect.any(String), hasPreview: false },
			{ n: 1, createdAt: expect.any(String), hasPreview: true },
		]);
	});

	it.each([
		{ n: 0 },
		{ n: 1.5 },
		{ n: "1" },
		{},
	])("rejects invalid restore version numbers", async (body) => {
		const project = await createDesign();
		const session = await createAdminSession();
		const call = () =>
			adminClient(session).designs.restoreVersion.mutate({
				projectId: project.id,
				...body,
			} as never);
		expect(await trpcErrorCode(call)).toBe("BAD_REQUEST");
		expect(await trpcErrorMessage(call)).toBeTruthy();
		expect(launch).not.toHaveBeenCalled();
	});

	it("returns NOT_FOUND for a missing restore snapshot", async () => {
		const project = await createDesign();
		const session = await createAdminSession();
		const call = () =>
			adminClient(session).designs.restoreVersion.mutate({
				projectId: project.id,
				n: 9,
			});
		expect(await trpcErrorCode(call)).toBe("NOT_FOUND");
		expect(await trpcErrorMessage(call)).toBe("version 9 not found");
	});

	it("restores by appending a new version and republishing live R2 files", async () => {
		const project = await createDesign();
		const original = "<!doctype html><html><body>original</body></html>";
		await putDesignFile(
			project.id,
			"versions/1/index.html",
			original,
			"text/html",
		);
		await putDesignFile(
			project.id,
			"versions/2/index.html",
			"<!doctype html><html><body>newer</body></html>",
			"text/html",
		);
		const preview = mockPreview(Uint8Array.from([9, 8, 7]));
		const session = await createAdminSession();
		expect(
			await adminClient(session).designs.restoreVersion.mutate({
				projectId: project.id,
				n: 1,
			}),
		).toEqual({ version: 3 });
		expect(launch).toHaveBeenCalledWith(env.BROWSER);
		expect(preview.page.setContent).toHaveBeenCalledWith(original, {
			waitUntil: "load",
		});
		const liveTurnId = await env.DB.prepare(
			'SELECT liveTurnId FROM "Design" WHERE id = ?',
		)
			.bind(project.id)
			.first<{ liveTurnId: string | null }>()
			.then((row) => row?.liveTurnId);
		expect(liveTurnId).toEqual(expect.any(String));
		expect(
			await env.DESIGNS.get(
				`designs/${project.id}/turns/${liveTurnId}/index.html`,
			).then((object) => object?.text()),
		).toBe(original);
		expect(
			await startWorkerRequest(`/designs/${project.id}/site`).then((site) =>
				site.text(),
			),
		).toBe(original);
		expect(
			await env.DESIGNS.get(`designs/${project.id}/versions/3/index.html`).then(
				(object) => object?.text(),
			),
		).toBe(original);
		const previewResponse = await startWorkerRequest(
			`/designs/${project.id}/preview`,
		);
		expect(new Uint8Array(await previewResponse.arrayBuffer())).toEqual(
			Uint8Array.from([9, 8, 7]),
		);
	});

	it.each([
		{},
		{ command: "" },
		{ command: "x".repeat(2001) },
	])("rejects invalid debug commands without sandbox execution", async (body) => {
		const sandbox = mockSandboxExec();
		const project = await createDesign();
		const session = await createAdminSession();
		const call = () =>
			adminClient(session).designs.debugExec.mutate({
				projectId: project.id,
				...body,
			} as never);
		expect(await trpcErrorCode(call)).toBe("BAD_REQUEST");
		expect(await trpcErrorMessage(call)).toContain("command");
		expect(sandbox.exec).not.toHaveBeenCalled();
	});

	it("audits and executes the exact debug command in the project sandbox", async () => {
		const sandbox = mockSandboxExec();
		const project = await createDesign();
		const session = await createAdminSession();
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		const command = "pwd && printf debug";
		expect(
			await adminClient(session).designs.debugExec.mutate({
				projectId: project.id,
				command,
			}),
		).toEqual({
			success: true,
			exitCode: 0,
			stdout: "debug stdout",
			stderr: "debug stderr",
		});
		expect(getSandbox).toHaveBeenCalledWith(env.Sandbox, project.id, {
			transport: "rpc",
			sleepAfter: "5m",
			enableDefaultSession: false,
		});
		expect(sandbox.exec).toHaveBeenCalledWith(command);
		expect(log.mock.calls.map(([line]) => String(line))).toContain(
			`[designs] debug-exec by ${session.userId} on ${project.id}: ${command}`,
		);
	});

	it("deletes a project and its messages, then returns NOT_FOUND", async () => {
		const project = await createDesign();
		await insertMessage(project.id, 0);
		await insertMessage(project.id, 1);
		const session = await createAdminSession();
		expect(
			await adminClient(session).designs.delete.mutate({
				projectId: project.id,
			}),
		).toBeUndefined();
		expect(
			await env.DB.prepare(
				'SELECT COUNT(*) AS count FROM "Message" WHERE designId = ?',
			)
				.bind(project.id)
				.first(),
		).toEqual({ count: 0 });
		expect(
			await env.DB.prepare('SELECT COUNT(*) AS count FROM "Design"').first(),
		).toEqual({ count: 0 });
		const second = () =>
			adminClient(session).designs.delete.mutate({ projectId: project.id });
		expect(await trpcErrorCode(second)).toBe("NOT_FOUND");
		expect(await trpcErrorMessage(second)).toBe("not found");
	});

	it("files a design into another project and refuses to unfile it", async () => {
		const container = await createProject({ name: "Filing target" });
		const other = await createProject({ name: "Second container" });
		const design = await createDesign();
		const session = await createAdminSession();
		const filed = await adminClient(session).designs.file.mutate({
			designId: design.id,
			targetProjectId: container.id,
		});
		expect(filed.projectId).toBe(container.id);
		const moved = await adminClient(session).designs.file.mutate({
			designId: design.id,
			targetProjectId: other.id,
		});
		expect(moved.projectId).toBe(other.id);
		// Every design is always part of a project — unfile is not a thing.
		const unfile = () =>
			adminClient(session).designs.file.mutate({
				designId: design.id,
				targetProjectId: null,
			});
		expect(await trpcErrorCode(unfile)).toBe("BAD_REQUEST");
	});

	it("rejects filing with BAD_REQUEST malformed body, NOT_FOUND unknown design, and NOT_FOUND unknown project", async () => {
		const session = await createAdminSession();
		const design = await createDesign();
		const malformed = () =>
			adminClient(session).designs.file.mutate({
				designId: design.id,
				targetProjectId: undefined,
			} as never);
		expect(await trpcErrorCode(malformed)).toBe("BAD_REQUEST");
		const missingDesign = () =>
			adminClient(session).designs.file.mutate({
				designId: crypto.randomUUID(),
				targetProjectId: crypto.randomUUID(),
			});
		expect(await trpcErrorCode(missingDesign)).toBe("NOT_FOUND");
		expect(await trpcErrorMessage(missingDesign)).toBe("not found");
		const missingProject = () =>
			adminClient(session).designs.file.mutate({
				designId: design.id,
				targetProjectId: crypto.randomUUID(),
			});
		expect(await trpcErrorCode(missingProject)).toBe("NOT_FOUND");
		expect(await trpcErrorMessage(missingProject)).toBe("project not found");
	});

	it.each([
		{
			method: "GET",
			path: "/designs",
			adminCode: null,
			call: (client: TrpcTestClient, _projectId: string) =>
				client.designs.list.query(),
		},
		{
			method: "POST",
			path: "/designs",
			adminCode: "BAD_REQUEST",
			call: (client: TrpcTestClient, _projectId: string) =>
				client.designs.create.mutate({} as never),
		},
		{
			method: "GET",
			path: "/designs/:id",
			adminCode: "NOT_FOUND",
			call: (client: TrpcTestClient, projectId: string) =>
				client.designs.get.query({ projectId }),
		},
		{
			method: "DELETE",
			path: "/designs/:id",
			adminCode: "NOT_FOUND",
			call: (client: TrpcTestClient, projectId: string) =>
				client.designs.delete.mutate({ projectId }),
		},
		{
			method: "GET",
			path: "/designs/:id/messages",
			// A missing design's messages list resolves empty (as before).
			adminCode: null,
			call: (client: TrpcTestClient, projectId: string) =>
				client.designs.listMessages.query({ projectId }),
		},
		{
			method: "GET",
			path: "/designs/:id/versions",
			// A missing design's R2-derived version list resolves empty (as before).
			adminCode: null,
			call: (client: TrpcTestClient, projectId: string) =>
				client.designs.listVersions.query({ projectId }),
		},
		{
			method: "POST",
			path: "/designs/:id/restore",
			adminCode: "BAD_REQUEST",
			call: (client: TrpcTestClient, projectId: string) =>
				client.designs.restoreVersion.mutate({ projectId } as never),
		},
		{
			method: "POST",
			path: "/designs/:id/debug-exec",
			adminCode: "BAD_REQUEST",
			call: (client: TrpcTestClient, projectId: string) =>
				client.designs.debugExec.mutate({ projectId } as never),
		},
	] as const)("$method $path rejects anonymous and non-admin users before allowing an admin", async ({
		call,
		adminCode,
	}) => {
		const projectId = crypto.randomUUID();
		const anonymous = createTrpcTestClient();
		const nonAdmin = adminClient(await createUserSession("user"));
		const admin = adminClient(await createAdminSession());

		expect(await trpcErrorCode(() => call(anonymous, projectId))).toBe(
			"UNAUTHORIZED",
		);
		expect(await trpcErrorCode(() => call(nonAdmin, projectId))).toBe(
			"FORBIDDEN",
		);
		expect(await trpcErrorCode(() => call(admin, projectId))).toBe(adminCode);
	});
});
