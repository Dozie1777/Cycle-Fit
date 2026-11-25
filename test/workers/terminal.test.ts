import {
	createExecutionContext,
	waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { getSandbox } from "@cloudflare/sandbox";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createGitHubApp,
	getEnvIdentity,
	mintInstallationToken,
} from "@/features/review/github";
import { handleBrowserMcpRequest } from "../../src/server/http/browser-mcp";
import { handleDesignMcpHttpRequest } from "../../src/server/http/design-mcp";
import { handleWebhookRequest } from "../../src/server/http/webhook";
import { createApiAdminSession } from "../helpers/auth";
import { TEST_ORIGIN } from "../helpers/request";

vi.mock("@cloudflare/playwright-mcp", () => ({
	createMcpAgent: vi.fn(() => ({ serve: vi.fn() })),
}));

vi.mock("@cloudflare/sandbox", async (importOriginal) => ({
	...(await importOriginal<typeof import("@cloudflare/sandbox")>()),
	getSandbox: vi.fn(),
}));

vi.mock("../../src/features/review/github", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/features/review/github")>()),
	createGitHubApp: vi.fn(),
	getEnvIdentity: vi.fn(),
	mintInstallationToken: vi.fn(),
}));

type SandboxMock = {
	mountBucket: ReturnType<typeof vi.fn>;
	setEnvVars: ReturnType<typeof vi.fn>;
	getSession: ReturnType<typeof vi.fn>;
	createSession: ReturnType<typeof vi.fn>;
};

let sandbox: SandboxMock;

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	sandbox = {
		mountBucket: vi.fn(async () => {}),
		setEnvVars: vi.fn(async () => {}),
		getSession: vi.fn(),
		createSession: vi.fn(),
	};
	vi.mocked(getSandbox).mockReturnValue(sandbox as never);
	vi.mocked(createGitHubApp).mockReturnValue({ id: "github-app" } as never);
	vi.mocked(getEnvIdentity).mockReturnValue({
		appId: 1,
		installationId: 123,
		privateKey: "private-key",
	} as never);
	vi.mocked(mintInstallationToken).mockResolvedValue({
		token: "fresh-installation-token",
		expiresAt: "2026-10-26T23:59:59Z",
	});
});

function terminalRequest(path = "/terminal") {
	return new Request(new URL(path, TEST_ORIGIN), {
		headers: { upgrade: "websocket" },
	});
}

function websocketResponse() {
	const pair = new WebSocketPair();
	return new Response(null, { status: 101, webSocket: pair[0] });
}

async function terminalHandler() {
	return (await import("../../src/server/http/terminal")).handleTerminalRequest;
}

describe("direct terminal WebSocket transport", () => {
	it("returns 426 for a non-upgrade request", async () => {
		const handleTerminalRequest = await terminalHandler();
		const response = await handleTerminalRequest(
			new Request(new URL("/terminal", TEST_ORIGIN)),
			env,
			createExecutionContext(),
		);

		expect(response.status).toBe(426);
		expect(await response.text()).toBe("expected a websocket upgrade");
		expect(getSandbox).not.toHaveBeenCalled();
	});

	it("creates an anonymous 80x24 session and preserves the raw 101 response identity", async () => {
		const handleTerminalRequest = await terminalHandler();
		const rawResponse = websocketResponse();
		const terminal = vi.fn(() => rawResponse);
		sandbox.createSession.mockResolvedValue({ terminal });
		const request = terminalRequest();
		const requestEnv = {
			...env,
			INSTALLATION_ID: "",
			KIMI_MODEL_NAME: "test-kimi-model",
			KIMI_MODEL_PROVIDER_TYPE: "test-provider",
			KIMI_MODEL_BASE_URL: "https://kimi.test/v1",
			KIMI_API_KEY: "test-kimi-key",
		};
		const ctx = createExecutionContext();

		const response = await handleTerminalRequest(request, requestEnv, ctx);

		expect(response).toBe(rawResponse);
		expect(response.status).toBe(101);
		expect(response.webSocket).toBe(rawResponse.webSocket);
		expect(sandbox.createSession).toHaveBeenCalledOnce();
		expect(sandbox.getSession).not.toHaveBeenCalled();
		expect(terminal).toHaveBeenCalledWith(request, { cols: 80, rows: 24 });
		expect(sandbox.setEnvVars).toHaveBeenCalledWith({
			KIMI_MODEL_NAME: "test-kimi-model",
			KIMI_MODEL_PROVIDER_TYPE: "test-provider",
			KIMI_MODEL_BASE_URL: "https://kimi.test/v1",
			KIMI_MODEL_API_KEY: "test-kimi-key",
		});
		await waitOnExecutionContext(ctx);
	});

	it("creates a caller-named session for a later verified reattach", async () => {
		const handleTerminalRequest = await terminalHandler();
		const terminal = vi.fn(() => websocketResponse());
		sandbox.createSession.mockResolvedValue({ terminal });

		await handleTerminalRequest(
			terminalRequest("/terminal?session=smoke-session&create=1"),
			{ ...env, INSTALLATION_ID: "" },
			createExecutionContext(),
		);

		expect(sandbox.createSession).toHaveBeenCalledWith({
			id: "smoke-session",
		});
		expect(sandbox.getSession).not.toHaveBeenCalled();
		expect(terminal).toHaveBeenCalledWith(expect.any(Request), {
			cols: 80,
			rows: 24,
		});
	});

	it("reattaches to an existing session with the identical original request", async () => {
		const handleTerminalRequest = await terminalHandler();
		const rawResponse = websocketResponse();
		const terminal = vi.fn(() => rawResponse);
		sandbox.getSession.mockResolvedValue({ terminal });
		const request = terminalRequest("/terminal?session=existing-session");
		const requestEnv = { ...env, INSTALLATION_ID: "" };

		const response = await handleTerminalRequest(
			request,
			requestEnv,
			createExecutionContext(),
		);

		expect(response).toBe(rawResponse);
		expect(sandbox.getSession).toHaveBeenCalledWith("existing-session");
		expect(sandbox.createSession).not.toHaveBeenCalled();
		expect(terminal).toHaveBeenCalledWith(request);
	});

	it("refreshes GitHub credentials and configures token refresh from the request origin", async () => {
		const handleTerminalRequest = await terminalHandler();
		const rawResponse = websocketResponse();
		sandbox.createSession.mockResolvedValue({
			terminal: vi.fn(() => rawResponse),
		});
		const request = terminalRequest();
		const requestEnv = {
			...env,
			INSTALLATION_ID: "123",
			TOKEN_REFRESH_SECRET: "refresh-secret",
			KIMI_API_KEY: "",
		};

		await handleTerminalRequest(request, requestEnv, createExecutionContext());

		expect(createGitHubApp).toHaveBeenCalledOnce();
		expect(mintInstallationToken).toHaveBeenCalledOnce();
		expect(sandbox.setEnvVars).toHaveBeenCalledWith(
			expect.objectContaining({
				GH_TOKEN: "fresh-installation-token",
				GH_REFRESH_URL: `${TEST_ORIGIN}/github-token`,
				GH_REFRESH_SECRET: "refresh-secret",
			}),
		);
		expect(sandbox.setEnvVars.mock.calls[0]?.[0]).not.toHaveProperty(
			"KIMI_MODEL_API_KEY",
		);
	});

	it.each([
		{
			environment: "local",
			options: { localBucket: true, provider: "r2" },
		},
		{ environment: "production", options: {} },
	])("mounts the shared R2 sandbox once per isolate in $environment", async ({
		environment,
		options,
	}) => {
		const handleTerminalRequest = await terminalHandler();
		sandbox.createSession.mockImplementation(async () => ({
			terminal: vi.fn(() => websocketResponse()),
		}));
		const requestEnv = {
			...env,
			ENVIRONMENT: environment,
			INSTALLATION_ID: "",
		};

		await handleTerminalRequest(
			terminalRequest(),
			requestEnv,
			createExecutionContext(),
		);
		await handleTerminalRequest(
			terminalRequest(),
			requestEnv,
			createExecutionContext(),
		);

		expect(getSandbox).toHaveBeenCalledTimes(2);
		expect(getSandbox).toHaveBeenCalledWith(requestEnv.Sandbox, "my-sandbox", {
			sleepAfter: "5m",
		});
		expect(sandbox.mountBucket).toHaveBeenCalledOnce();
		expect(sandbox.mountBucket).toHaveBeenCalledWith(
			"WORKING_DIR",
			"/workspace/data",
			options,
		);
	});

	it("treats an already-in-use mount as ready without retrying", async () => {
		const handleTerminalRequest = await terminalHandler();
		sandbox.mountBucket.mockRejectedValue(
			new Error("mount point already in use"),
		);
		sandbox.createSession.mockImplementation(async () => ({
			terminal: vi.fn(() => websocketResponse()),
		}));
		const requestEnv = { ...env, INSTALLATION_ID: "" };

		await handleTerminalRequest(
			terminalRequest(),
			requestEnv,
			createExecutionContext(),
		);
		await handleTerminalRequest(
			terminalRequest(),
			requestEnv,
			createExecutionContext(),
		);

		expect(sandbox.mountBucket).toHaveBeenCalledOnce();
		expect(sandbox.createSession).toHaveBeenCalledTimes(2);
	});

	it("returns a direct 405 for non-GET /terminal requests", async () => {
		const directHandler = vi.fn();
		const { createWorkerFetch } = await import("../../src/server");
		const fetch = createWorkerFetch(
			handleDesignMcpHttpRequest,
			handleWebhookRequest,
			handleBrowserMcpRequest,
			directHandler,
		);
		const response = await fetch(
			new Request(new URL("/terminal", TEST_ORIGIN), { method: "POST" }),
			env,
			createExecutionContext(),
		);

		expect(response.status).toBe(405);
		expect(response.headers.get("allow")).toBe("GET");
		expect(response.headers.get("content-type") ?? "").not.toContain(
			"text/html",
		);
		expect(directHandler).not.toHaveBeenCalled();
	});

	it("rejects an unauthenticated GET /terminal at the Worker entry", async () => {
		const directHandler = vi.fn(async () => websocketResponse());
		const { createWorkerFetch } = await import("../../src/server");
		const fetch = createWorkerFetch(
			handleDesignMcpHttpRequest,
			handleWebhookRequest,
			handleBrowserMcpRequest,
			directHandler,
		);
		const request = terminalRequest();

		const response = await fetch(request, env, createExecutionContext());

		expect(response.status).toBe(401);
		expect(directHandler).not.toHaveBeenCalled();
	});

	it("dispatches an authenticated GET /terminal directly from the Worker entry with response identity", async () => {
		const rawResponse = websocketResponse();
		const directHandler = vi.fn(async () => rawResponse);
		const { createWorkerFetch } = await import("../../src/server");
		const fetch = createWorkerFetch(
			handleDesignMcpHttpRequest,
			handleWebhookRequest,
			handleBrowserMcpRequest,
			directHandler,
		);
		const session = await createApiAdminSession();
		const request = new Request(new URL("/terminal", TEST_ORIGIN), {
			headers: { upgrade: "websocket", cookie: session.cookie },
		});
		const ctx = createExecutionContext();

		const response = await fetch(request, env, ctx);

		expect(response).toBe(rawResponse);
		expect(response.status).toBe(101);
		expect(directHandler).toHaveBeenCalledWith(request, env, ctx);
		await waitOnExecutionContext(ctx);
	});
});
