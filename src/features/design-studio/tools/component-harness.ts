/**
 * Deterministic test harness for `tb-*` component drafts (KUK-926). The
 * document is assembled from the draft's structured inputs — never parsed
 * out of model prose — so the same bytes render in three places:
 *
 * 1. the headless Browser Rendering smoke test (`component-smoke.ts`) that
 *    gates `save_component`,
 * 2. the R2-served draft preview (`drafts/<name>.html`, `allow-scripts`
 *    sandbox CSP via the drafts file route),
 * 3. the in-chat test-drive iframe (`ComponentTestDrive`).
 *
 * The harness script collects runtime errors into `window.__tbHarness` and,
 * when actually framed, mirrors them to the host via `postMessage` — the
 * same collector serves both the server-side smoke test (which reads the
 * window object directly) and the client-side card (which listens for
 * messages). The component source always gets its own `<script>` tag after
 * the bridge, so a syntax error in the component cannot take the bridge
 * down with it.
 */

export type ComponentHarnessContent = {
	/** Custom element class source (one class + one customElements.define). */
	js: string;
	/** Component styles using var(--tb-…) tokens (optional). */
	css?: string | null;
	/** Template markup fragment to instantiate (optional). */
	html?: string | null;
	/** Project design tokens rendered as a `:root { … }` block (optional). */
	tokenCss?: string | null;
	/** Document title (defaults to "Component draft preview"). */
	title?: string;
};

/**
 * In-page collector + host bridge. Runs before the component source and
 * records errors in `window.__tbHarness.errors` (capped), mirrors each one
 * to the parent frame via postMessage, reports the document height so the
 * host iframe can size itself, and flips `__tbHarness.ready` on load —
 * the smoke test settles on that plus a fixed delay.
 *
 * There is deliberately NO early-return guard on an existing
 * `window.__tbHarness`: browsers expose elements with IDs as named window
 * properties, so a statically valid fragment like
 * `<div id="__tbHarness"></div>` would make the check truthy, suppress the
 * collector install, and let the smoke evaluator read an empty error list
 * (the draft would pass as clean). The inline script executes exactly once
 * per document, so the guard protects nothing — unconditional assignment
 * instead creates an own property that shadows any named property.
 */
const HARNESS_BRIDGE_JS = `(function () {
	var harness = (window.__tbHarness = { errors: [], ready: false });
	var post = function (message) {
		if (window.parent === window) return;
		try {
			window.parent.postMessage(Object.assign({ source: "tb-harness" }, message), "*");
		} catch (error) {}
	};
	var format = function (value) {
		if (value == null) return "";
		if (typeof value === "string") return value;
		if (value instanceof Error) return value.message;
		try { return JSON.stringify(value); } catch (error) { return String(value); }
	};
	var record = function (kind, detail) {
		if (harness.errors.length >= 20) return;
		var entry = {
			kind: kind,
			message: String(detail.message || "unknown error"),
			stack: detail.stack ? String(detail.stack).slice(0, 1000) : undefined
		};
		harness.errors.push(entry);
		post({ type: "error", error: entry });
	};
	window.addEventListener("error", function (event) {
		record("error", { message: event.message, stack: event.error && event.error.stack });
	});
	window.addEventListener("unhandledrejection", function (event) {
		record("rejection", { message: format(event.reason), stack: event.reason && event.reason.stack });
	});
	var nativeError = console.error.bind(console);
	console.error = function () {
		record("console", { message: Array.prototype.map.call(arguments, format).join(" ") });
		nativeError.apply(console, arguments);
	};
	var height = function () {
		return Math.max(
			document.body ? document.body.scrollHeight : 0,
			document.documentElement ? document.documentElement.scrollHeight : 0
		);
	};
	var lastHeight = 0;
	var reportHeight = function () {
		var next = height();
		if (Math.abs(next - lastHeight) > 1) {
			lastHeight = next;
			post({ type: "height", height: next });
		}
	};
	if (typeof ResizeObserver === "function") {
		new ResizeObserver(reportHeight).observe(document.documentElement);
	}
	window.addEventListener("load", function () {
		harness.ready = true;
		setTimeout(function () {
			reportHeight();
			post({ type: "ready", height: lastHeight, errors: harness.errors.length });
		}, 50);
	});
})();`;

/**
 * An inline script must not terminate early: escape literal `</script`
 * sequences inside the element source.
 */
function embedJs(js: string): string {
	return js.replace(/<\/(script)/gi, "<\\/$1");
}

/** Escapes model-supplied text interpolated into the document head. */
function escapeHtmlText(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

/**
 * Assembles the standalone harness document: project token fallback first,
 * then the component styles, the authored fragment in the body, the error
 * bridge, and the element source in its own trailing script so the custom
 * element upgrades after its markup parses.
 */
export function buildComponentHarnessDoc(
	content: ComponentHarnessContent,
): string {
	const styles = [content.tokenCss ?? "", content.css ?? ""]
		.filter((block) => block.trim().length > 0)
		.join("\n");
	const title = escapeHtmlText(content.title ?? "Component draft preview");
	return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${title}</title>
${
	styles.trim().length > 0
		? `<style>body { margin: 16px; font-family: system-ui, sans-serif; }\n${styles}</style>`
		: "<style>body { margin: 16px; font-family: system-ui, sans-serif; }</style>"
}
</head>
<body>
${content.html ?? ""}
<script>${HARNESS_BRIDGE_JS}</script>
<script>
${embedJs(content.js)}
</script>
</body>
</html>`;
}
