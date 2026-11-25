// Orchestrates one design workspace:
//  1. resolve/create a per-project sandbox instance (id = the Design id,
//     so each design gets its own container, process table and port space)
//  2. write the design brief (AGENTS.md) into the project's container
//     directory and install the opencode config (Kimi provider +
//     design-uploads MCP). There is no long-lived `opencode web` server and
//     no public tunnel: the admin UI opens a regular terminal session
//     (routes /designs/:id/ui + /designs/:id/terminal) with opencode running
//     interactively inside it. The agent publishes files itself via the
//     MCP get_upload_url tool or POST /designs/:id/upload-url + curl PUT
//     (see lib/design-upload.ts). Nothing is bucket-mounted: production R2
//     mounts would need s3fs FUSE in the dind image, and the agent writing
//     straight to the bucket survives container restarts cleanly.
//
// ensureDesignSession is idempotent and safe to call from POST /designs
// (first bootstrap) and the terminal websocket route (re-open after container
// sleep). Sharing the "my-sandbox" instance instead would collide between
// concurrent designs.
import { getSandbox, type Sandbox } from "@cloudflare/sandbox";
import {
	designBriefMarkdown,
	isDesignId,
	opencodeConfig,
} from "@/features/design-studio/assets/design-files";
import { getPrisma } from "@/lib/db";
import { withRetry } from "@/lib/retry";

// Container-local staging for the opencode config: the container server's
// file APIs reject paths outside /workspace, so the config is written here
// and copied into /root by exec (sandbox.writeFile cannot target /root
// directly). /root is reset on every container restart, hence re-copy.
const OC_CONFIG_STAGING = "/workspace/.design-config/opencode.json";
const OC_CONFIG_HOME = "/root/.config/opencode/opencode.json";

export const designDir = (projectId: string) =>
	`/workspace/designs/${projectId}`;

// A cold Sandbox DO occasionally wedges its first RPCs (runtime connection
// close / never-resolving calls — observed in prod as a /service request
// hanging past the edge's ~100s cutoff). Every cold-path step below is
// therefore run through this guard: a per-attempt deadline turns a hang into
// a fast failure, and withRetry re-runs the (idempotent) step against the
// now-warm DO. Steps are all writes/execs/mkdir-style — retries are safe.
async function rpcStep<T>(
	label: string,
	fn: () => Promise<T>,
	options: { timeoutMs?: number; maxAttempts?: number; delayMs?: number } = {},
): Promise<T> {
	const { timeoutMs = 20_000, maxAttempts = 3, delayMs = 2000 } = options;
	return withRetry(
		() =>
			Promise.race([
				fn(),
				new Promise<never>((_, reject) => {
					setTimeout(
						() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
						timeoutMs,
					);
				}),
			]),
		{ label, maxAttempts, delayMs },
	);
}

/**
 * One place for the sandbox client contract. Per SDK contract, the transport
 * is fixed at creation time and identical on every getSandbox() call for the
 * same instance id — keep this single helper so that holds.
 */
export function designSandbox(env: Env, projectId: string): Sandbox {
	return getSandbox(env.Sandbox, projectId, {
		// RPC transport: the design feature previously needed it for the
		// tunnels API (HTTP transport threw "RPC transport required"). No
		// tunnels anymore, but the interactive terminal session API also
		// goes through the DO, and keeping one transport avoids mid-life
		// session drops.
		transport: "rpc",
		sleepAfter: "5m",
		// Review pipelines avoid the SDK's default session cache across
		// container rollouts (stale /tmp session id → ENOENT on watch).
		// Same reasoning here.
		enableDefaultSession: false,
	});
}

/**
 * Origin as seen from inside the sandbox container. In local dev the worker
 * listens on the host's localhost, which the container cannot reach — the
 * same problem the `localBucket` flag solves for bucket mounts — so
 * localhost origins are rewritten to host.docker.internal. Production
 * origins are public and pass through untouched.
 */
export function agentVisibleOrigin(env: Env, origin: string): string {
	if (env.ENVIRONMENT !== "local") return origin;
	let url: URL;
	try {
		url = new URL(origin);
	} catch {
		return origin;
	}
	if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
		url.hostname = "host.docker.internal";
	}
	return url.toString().replace(/\/$/, "");
}

async function ensureOpencodeConfig(
	sandbox: Sandbox,
	env: Env,
	origin: string,
): Promise<void> {
	const agentOrigin = agentVisibleOrigin(env, origin);
	await rpcStep("sandbox.writeFile(opencode config)", () =>
		sandbox.writeFile(
			OC_CONFIG_STAGING,
			opencodeConfig({
				modelName: env.KIMI_MODEL_NAME,
				baseURL: env.KIMI_MODEL_BASE_URL,
				mcp: {
					name: "design-uploads",
					url: `${agentOrigin}/designs/mcp`,
					tokenEnvVar: "DESIGN_AGENT_TOKEN",
				},
				// Same Playwright MCP server the design chat uses (over
				// Browser Rendering): gives the interactive terminal agent
				// browser tools without local chromium work.
				...(env.BROWSER_MCP_TOKEN
					? {
							browserMcp: {
								url: `${agentOrigin}/browser-mcp`,
								tokenEnvVar: "BROWSER_MCP_TOKEN",
							},
						}
					: {}),
			}),
		),
	);
	const write = await rpcStep("sandbox.exec(install opencode config)", () =>
		sandbox.exec(
			`mkdir -p /root/.config/opencode && cp -f ${OC_CONFIG_STAGING} ${OC_CONFIG_HOME}`,
		),
	);
	if (!write.success) {
		throw new Error(
			`failed to install opencode config in container: ${write.stderr}`,
		);
	}
}

/**
 * Env vars the interactive design terminal session needs: opencode resolves
 * {env:KIMI_API_KEY} (model provider) and {env:DESIGN_AGENT_TOKEN} (design
 * uploads MCP auth header) from the process environment, and the seeded
 * AGENTS.md brief references $DESIGN_PROJECT_ID / $DESIGN_UPLOAD_URL /
 * $DESIGN_SITE_URL for the curl fallback. setEnvVars applies to every session
 * on the sandbox instance, so any shell opened on it gets the same values.
 */
export function designSessionEnv(
	env: Env,
	project: { id: string; uploadToken: string | null },
	origin: string,
): Record<string, string> {
	const agentOrigin = agentVisibleOrigin(env, origin);
	const vars: Record<string, string> = {};
	if (env.KIMI_API_KEY) vars.KIMI_API_KEY = env.KIMI_API_KEY;
	vars.DESIGN_PROJECT_ID = project.id;
	// The agent credential: minted on the project row, injected only into the
	// sandbox session env. The MCP config and the brief reference
	// $DESIGN_AGENT_TOKEN expansions, so neither the config nor the uploaded
	// AGENTS.md copy ever carries the secret.
	if (project.uploadToken) {
		vars.DESIGN_AGENT_TOKEN = project.uploadToken;
		vars.DESIGN_UPLOAD_URL = `${agentOrigin}/designs/${project.id}/upload-url`;
		vars.DESIGN_SITE_URL = `${agentOrigin}/designs/${project.id}/site`;
	}
	// Bearer for the /browser-mcp Playwright MCP server, registered as a
	// remote MCP server in the sandbox opencode config.
	if (env.BROWSER_MCP_TOKEN) vars.BROWSER_MCP_TOKEN = env.BROWSER_MCP_TOKEN;
	return vars;
}

/**
 * Prepares the design workspace for an interactive terminal session: opencode
 * config in place (Kimi provider + design-uploads MCP), the design directory
 * created, and the brief (AGENTS.md) rewritten — re-opening a project after a
 * worker deploy always ships the latest recipe. There is no long-lived
 * `opencode web` server and no quick tunnel anymore: the admin UI opens a
 * regular terminal session (routes /designs/:id/ui + /designs/:id/terminal)
 * and opencode runs interactively inside it.
 *
 * Idempotent and safe to call from POST /designs (first bootstrap) and the
 * terminal websocket route. Concurrent prepares for one project within this
 * isolate share a single in-flight promise — POST /designs fires a background
 * (waitUntil) prepare and the UI then opens the terminal, and racing the same
 * cold Sandbox DO doubles the RPC pressure exactly when it is most likely to
 * wedge (runtime connection close / never-resolving first calls).
 */
const inflightPrepares = new Map<string, Promise<void>>();

export function ensureDesignSession(
	env: Env,
	projectId: string,
	options: { origin: string },
): Promise<void> {
	const existing = inflightPrepares.get(projectId);
	if (existing) {
		return existing;
	}
	const started = prepareDesignWorkspace(env, projectId, options).finally(
		() => {
			inflightPrepares.delete(projectId);
		},
	);
	inflightPrepares.set(projectId, started);
	return started;
}

async function prepareDesignWorkspace(
	env: Env,
	projectId: string,
	options: { origin: string },
): Promise<void> {
	if (!isDesignId(projectId)) {
		throw new Error(`invalid design project id: ${projectId}`);
	}
	const project = await getPrisma(env).design.findUnique({
		where: { id: projectId },
	});
	if (!project) {
		throw new Error(`design project ${projectId} not found`);
	}

	const sandbox = designSandbox(env, projectId);
	await ensureOpencodeConfig(sandbox, env, options.origin);
	await rpcStep("sandbox.exec(mkdir design dir)", () =>
		sandbox.exec(`mkdir -p ${designDir(projectId)}`),
	);
	await rpcStep("sandbox.writeFile(AGENTS.md)", () =>
		sandbox.writeFile(
			`${designDir(projectId)}/AGENTS.md`,
			designBriefMarkdown(project.prompt),
		),
	);
}
