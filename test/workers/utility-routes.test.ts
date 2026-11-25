import { env } from "cloudflare:workers";
import { getSandbox } from "@cloudflare/sandbox";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TERMINAL_UI_HTML } from "../../src/lib/terminal-ui";
import { createAdminSession, startAdminRequest } from "../helpers/auth";
import { startWorkerRequest } from "../helpers/request";

vi.mock("@cloudflare/sandbox", async (importOriginal) => ({
	...(await importOriginal<typeof import("@cloudflare/sandbox")>()),
	getSandbox: vi.fn(),
}));

const TOKEN = "fresh-installation-token";
const EXPIRES_AT = "2026-10-26T23:59:59Z";

function mockSandbox(options: { process?: { status: string } | null } = {}) {
	const process =
		options.process === undefined ? { status: "running" } : options.process;
	const sandbox = {
		getProcess: vi.fn(async () => process),
		getProcessLogs: vi.fn(async () => ({
			stdout: "review stdout",
			stderr: "review stderr",
		})),
		killProcess: vi.fn(async () => {}),
	};
	vi.mocked(getSandbox).mockReturnValue(sandbox as never);
	return sandbox;
}

function mockGitHubToken() {
	const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
		const url =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.href
					: input.url;
		if (
			url !==
			`https://api.github.com/app/installations/${env.INSTALLATION_ID}/access_tokens`
		) {
			throw new Error(`Unexpected external fetch: ${url}`);
		}
		return Response.json({ token: TOKEN, expires_at: EXPIRES_AT });
	});
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

function authorizedEnv(overrides: Partial<Env> = {}) {
	return {
		...env,
		INSTALLATION_ID: env.INSTALLATION_ID || "150708719",
		...overrides,
	} as Env;
}

afterEach(() => {
	vi.clearAllMocks();
	vi.unstubAllGlobals();
});

describe("Start utility routes", () => {
	it("rejects an unauthenticated GET /ui with 401", async () => {
		const response = await startWorkerRequest("/ui");
		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ error: "unauthorized" });
	});

	it("serves the existing xterm HTML connected to /terminal for an admin session", async () => {
		const session = await createAdminSession();
		const response = await startAdminRequest("/ui", session);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/html");
		const html = await response.text();
		expect(html).toBe(TERMINAL_UI_HTML);
		expect(html).toContain("@xterm/xterm");
		expect(html).toContain('location.host + "/terminal"');
	});

	it.each([
		{ name: "installation ID", overrides: { INSTALLATION_ID: undefined } },
		{ name: "refresh secret", overrides: { TOKEN_REFRESH_SECRET: undefined } },
	])("returns 500 when the GitHub token $name is missing", async ({
		overrides,
	}) => {
		const github = mockGitHubToken();
		const response = await startWorkerRequest(
			"/github-token",
			undefined,
			authorizedEnv(overrides),
		);
		expect(response.status).toBe(500);
		expect(await response.text()).toBe(
			"INSTALLATION_ID / TOKEN_REFRESH_SECRET not set",
		);
		expect(github).not.toHaveBeenCalled();
	});

	it("rejects a mismatched GitHub token refresh Bearer secret", async () => {
		const github = mockGitHubToken();
		const response = await startWorkerRequest("/github-token", {
			headers: { authorization: "Bearer wrong-secret" },
		});
		expect(response.status).toBe(401);
		expect(await response.text()).toBe("unauthorized");
		expect(github).not.toHaveBeenCalled();
	});

	it("mints and returns only the installation token and expiry", async () => {
		const github = mockGitHubToken();
		const response = await startWorkerRequest("/github-token", {
			headers: { authorization: `Bearer ${env.TOKEN_REFRESH_SECRET}` },
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			token: TOKEN,
			expiresAt: EXPIRES_AT,
		});
		expect(github).toHaveBeenCalledOnce();
	});

	it.each([
		"GET",
		"DELETE",
	] as const)("%s /process-logs rejects missing sandbox or process query params", async (method) => {
		const sandbox = mockSandbox();
		for (const path of [
			"/process-logs",
			"/process-logs?sandbox=review-sandbox",
			"/process-logs?process=review-process",
		]) {
			const response = await startWorkerRequest(path, { method });
			expect(response.status).toBe(400);
			expect(await response.text()).toBe(
				"missing 'sandbox' and/or 'process' query params",
			);
		}
		expect(getSandbox).not.toHaveBeenCalled();
		expect(sandbox.getProcess).not.toHaveBeenCalled();
	});

	it.each([
		"GET",
		"DELETE",
	] as const)("%s /process-logs returns 404 for a missing process in the named sandbox", async (method) => {
		const sandbox = mockSandbox({ process: null });
		const response = await startWorkerRequest(
			"/process-logs?sandbox=missing-sandbox&process=missing-process",
			{ method },
		);
		expect(response.status).toBe(404);
		expect(await response.text()).toBe(
			"process missing-process not found in sandbox missing-sandbox",
		);
		expect(getSandbox).toHaveBeenCalledWith(env.Sandbox, "missing-sandbox");
		expect(sandbox.getProcess).toHaveBeenCalledWith("missing-process");
		expect(sandbox.getProcessLogs).not.toHaveBeenCalled();
		expect(sandbox.killProcess).not.toHaveBeenCalled();
	});

	it("returns status and logs for the requested process without a session", async () => {
		const sandbox = mockSandbox({ process: { status: "completed" } });
		const response = await startWorkerRequest(
			"/process-logs?sandbox=commit-sha&process=review-process",
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			status: "completed",
			stdout: "review stdout",
			stderr: "review stderr",
		});
		expect(getSandbox).toHaveBeenCalledWith(env.Sandbox, "commit-sha");
		expect(sandbox.getProcess).toHaveBeenCalledWith("review-process");
		expect(sandbox.getProcessLogs).toHaveBeenCalledWith("review-process");
		expect(sandbox.killProcess).not.toHaveBeenCalled();
	});

	it("kills only the requested process and returns its previous status", async () => {
		const sandbox = mockSandbox({ process: { status: "running" } });
		const response = await startWorkerRequest(
			"/process-logs?sandbox=other-commit&process=hung-review",
			{ method: "DELETE" },
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			killed: "hung-review",
			previousStatus: "running",
		});
		expect(getSandbox).toHaveBeenCalledWith(env.Sandbox, "other-commit");
		expect(sandbox.getProcess).toHaveBeenCalledWith("hung-review");
		expect(sandbox.killProcess).toHaveBeenCalledWith("hung-review");
		expect(sandbox.getProcessLogs).not.toHaveBeenCalled();
	});

	it.each([
		{ path: "/github-token", allow: "GET" },
		{ path: "/process-logs", allow: "GET, DELETE" },
	])("returns 405 and Allow for unsupported methods on $path", async ({
		path,
		allow,
	}) => {
		const response = await startWorkerRequest(path, { method: "POST" });
		expect(response.status).toBe(405);
		expect(response.headers.get("allow")).toBe(allow);
	});

	it("returns 405 and Allow for unsupported methods on /ui with an admin session", async () => {
		const session = await createAdminSession();
		const response = await startAdminRequest("/ui", session, {
			method: "POST",
		});
		expect(response.status).toBe(405);
		expect(response.headers.get("allow")).toBe("GET");
	});
});
