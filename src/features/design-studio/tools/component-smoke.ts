/**
 * Headless runtime check for component drafts (KUK-926). Renders the
 * harness document (`component-harness.ts`) in a short-lived Browser
 * Rendering session and fails the draft when the page actually throws:
 *
 * - uncaught errors / unhandled rejections (collected by the harness bridge
 *   into `window.__tbHarness.errors` — the same collector the in-chat
 *   test-drive iframe reports through),
 * - `console.error` calls,
 * - the element never registering (customElements.define did not run or
 *   silently threw and was swallowed).
 *
 * Failure policy is asymmetric on purpose:
 * - Runtime errors are REAL user-visible breakage → `ok: false`, the draft
 *   is not saved, and the errors return to the model verbatim so it can
 *   self-correct within the turn (same contract as the static validator).
 * - Infrastructure problems (browser binding down, evaluate failures,
 *   timeout) are NOT evidence of a broken component → `skipped: true`,
 *   fail-open, the save proceeds. A smoke outage must never block saves.
 */
import { launch } from "@cloudflare/playwright";

/** Settle time after "load": microtasks, attribute-driven re-renders. */
const SMOKE_SETTLE_MS = 600;

/** Hard wall for the whole browser session (turns run under a deadline). */
const SMOKE_TIMEOUT_MS = 20_000;

export type ComponentSmokeResult = {
	/** true when the draft may be saved (clean run OR skipped smoke). */
	ok: boolean;
	/** Model-facing runtime error lines (empty when ok or skipped). */
	errors: string[];
	/** true when the smoke test could not run (infra failure/timeout). */
	skipped?: boolean;
	/** Why the smoke test was skipped (when skipped). */
	reason?: string;
};

type HarnessError = { kind?: string; message?: string };

type HarnessState = {
	errors: HarnessError[];
	ready: boolean;
	registered: boolean;
};

function formatHarnessError(entry: HarnessError): string {
	const message = typeof entry.message === "string" ? entry.message : "";
	const kind = entry.kind ?? "error";
	return kind === "console"
		? `console.error: ${message}`
		: `Runtime error: ${message}`;
}

/**
 * Runs the smoke test for one harness document. `tagName` (when provided)
 * adds the registration check: a draft whose define call never executes
 * fails even when nothing else throws.
 */
export async function runComponentSmokeTest(
	browser: Parameters<typeof launch>[0],
	html: string,
	options: { tagName?: string } = {},
): Promise<ComponentSmokeResult> {
	const instance = await launch(browser).catch((error: unknown) => {
		console.log("[component-smoke] browser launch failed:", error);
		return null;
	});
	if (!instance) {
		return {
			ok: true,
			errors: [],
			skipped: true,
			reason: "browser rendering was unavailable",
		};
	}
	try {
		// The catch keeps the race's runner promise always handled: if the
		// page rejects AFTER the timeout already resolved the race, the
		// rejection would otherwise be unhandled.
		const run = runSmokePage(instance, html, options).catch(
			(error: unknown): ComponentSmokeResult => {
				// Evaluate/setContent failures are infra, not component evidence.
				console.log("[component-smoke] smoke run failed:", error);
				return {
					ok: true,
					errors: [],
					skipped: true,
					reason: "smoke test could not run",
				};
			},
		);
		return await Promise.race([
			run,
			new Promise<ComponentSmokeResult>((resolve) =>
				setTimeout(
					() =>
						resolve({
							ok: false,
							errors: [
								`component smoke test timed out after ${SMOKE_TIMEOUT_MS / 1000}s — the script likely loops or blocks rendering`,
							],
						}),
					SMOKE_TIMEOUT_MS,
				),
			),
		]);
	} finally {
		await instance.close();
	}
}

async function runSmokePage(
	instance: Awaited<ReturnType<typeof launch>>,
	html: string,
	options: { tagName?: string },
): Promise<ComponentSmokeResult> {
	const page = await instance.newPage({
		viewport: { width: 1280, height: 800 },
	});
	// Belt-and-braces: the harness collector records into the page object,
	// but a syntax error in the component's own script tag surfaces as a
	// pageerror without ever running the bridge.
	const pageErrors: string[] = [];
	page.on("pageerror", (error: unknown) => {
		pageErrors.push(
			`Runtime error: ${error instanceof Error ? error.message : String(error)}`,
		);
	});
	await page.setContent(html, { waitUntil: "load" });
	await page.waitForTimeout(SMOKE_SETTLE_MS);
	const state = await page.evaluate(
		`(function () {
			var tag = ${options.tagName ? JSON.stringify(options.tagName) : "null"};
			var h = window.__tbHarness;
			return {
				errors: h && h.errors ? h.errors : [],
				ready: !!(h && h.ready),
				registered: tag ? !!customElements.get(tag) : true
			};
		})()`,
	);
	const harness = state as HarnessState;
	const errors: string[] = [];
	const seen = new Set<string>();
	// isArray guard: a component that clobbers window.__tbHarness must not
	// crash the read (it just yields no harness errors; pageerror still fires).
	for (const entry of Array.isArray(harness.errors) ? harness.errors : []) {
		const line = formatHarnessError(entry);
		if (!seen.has(line)) {
			seen.add(line);
			errors.push(line);
		}
	}
	for (const line of pageErrors) {
		if (!seen.has(line)) {
			seen.add(line);
			errors.push(line);
		}
	}
	if (options.tagName && !harness.registered) {
		errors.push(
			`the element "${options.tagName}" was never registered — customElements.define did not run successfully.`,
		);
	}
	if (errors.length === 0) return { ok: true, errors: [] };
	return { ok: false, errors };
}

/**
 * Renders the smoke verdict as the model-facing error list. The first line
 * frames the contract: nothing was saved; fix every line and re-save.
 */
export function smokeErrorsToToolErrors(errors: string[]): string[] {
	return [
		"runtime check failed — the component threw in a real browser and was NOT saved. Fix every error below and re-save:",
		...errors,
	];
}
