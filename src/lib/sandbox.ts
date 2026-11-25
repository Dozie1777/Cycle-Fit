import { getSandbox } from "@cloudflare/sandbox";

// Tracks the one-time R2 mount per isolate. Repeated mountBucket calls
// reconfigure the sandbox proxy's egress path, and the churn kills in-flight
// TLS connections from the container (the intermittent "unexpected eof" on
// git clone) — so mount once and never again.
let mountReady = false;

/**
 * Resolves the shared sandbox instance and ensures the R2 working-dir mount
 * exists.
 *
 * localBucket is the wrangler-dev mount path (periodic sync with the
 * local R2 binding); drop it in production, where binding mounts use
 * credential-less egress interception instead.
 * The mount point must live under /workspace — the container server's
 * watch API (which syncs container-side changes back to R2) rejects
 * paths outside it with PermissionDeniedError.
 */
export async function getMountedSandbox(
	env: Env,
): Promise<ReturnType<typeof getSandbox>> {
	// sleepAfter: "5m" — idle containers shut down after 5 minutes
	const sandbox = getSandbox(env.Sandbox, "my-sandbox", {
		sleepAfter: "5m",
	});

	if (!mountReady) {
		try {
			if (env.ENVIRONMENT === "local") {
				await sandbox.mountBucket("WORKING_DIR", "/workspace/data", {
					localBucket: true,
					provider: "r2",
				});
			} else {
				await sandbox.mountBucket("WORKING_DIR", "/workspace/data", {});
			}
			mountReady = true;
		} catch (error) {
			if (error instanceof Error && error.message.includes("already in use")) {
				mountReady = true;
			} else {
				console.log("[sandbox] mountBucket failed:", error);
			}
		}
	}

	return sandbox;
}
