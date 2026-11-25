// Public serving of immutable component bundles (KUK-923): maps the
// componentBundlePath contract (src/lib/compose.ts) onto the R2 keys the
// publish pipeline writes (src/lib/component-publish.ts):
//
//   GET /projects/<projectId>/components/<componentId>/v<version>.js|.css
//     → DESIGNS object components/<componentId>/v<version>.<ext>
//
// Auth posture: bundles are public artifacts of published components — same
// surface as the design site routes (no session), guarded by DB state
// instead: the component must exist, not be soft-deleted, belong to the
// path's project, and the requested version must be `published` (or
// `retired` — old publications keep pinning retired versions). Drafts are
// never publicly servable.
import { componentBundleKey } from "@/features/design-studio/tools/component-publish";
import { getPrisma } from "@/lib/db";

/**
 * The `$file` route segment: exactly `v<n>.<ext>` — the single file-style
 * segment componentBundlePath emits (`v3.js`, not `versions/3.js`). Leading
 * zeros are rejected so `v01.js` cannot alias `v1.js`.
 */
const BUNDLE_FILE_RE = /^v([1-9]\d*)\.(js|css)$/;

function notFound(): Response {
	return new Response("not found", { status: 404 });
}

/**
 * Response headers for a bundle object. The R2 object's httpMetadata (the
 * content type + immutable cache control the publish pipeline wrote) is the
 * source of truth; the static fallbacks only cover objects written before
 * metadata was guaranteed. `sandbox` CSP keeps a direct navigation to the
 * bundle URL in an opaque origin (same posture as the site files); nosniff
 * stops content-type confusion.
 */
function bundleResponseHeaders(
	object: R2Object,
	ext: "js" | "css",
): Record<string, string> {
	const fallbackType = ext === "js" ? "text/javascript" : "text/css";
	return {
		"content-type": object.httpMetadata?.contentType ?? fallbackType,
		"cache-control":
			object.httpMetadata?.cacheControl ??
			"public, max-age=31536000, immutable",
		"x-content-type-options": "nosniff",
		"content-security-policy": "sandbox",
		// Served site pages run under `CSP: sandbox` → opaque origin; their
		// module imports (`import "/projects/…/v<n>.js"`) are CORS-mode
		// fetches from a null origin and are blocked without ACAO. Bundles
		// are public immutable artifacts of published components — `*` is
		// safe here.
		"access-control-allow-origin": "*",
	};
}

export async function serveComponentBundle(input: {
	env: Env;
	projectId: string;
	componentId: string;
	file: string;
}): Promise<Response> {
	const { env, projectId, componentId, file } = input;
	const match = BUNDLE_FILE_RE.exec(file);
	if (!match) return notFound();
	// Bound the numeric segment: arbitrarily long digit strings can produce
	// Infinity / precision loss through Number(), which would turn a
	// malformed path into a server error instead of a 404.
	const digits = match[1];
	const version = Number(digits);
	if (
		digits.length > 15 ||
		digits.startsWith("0") ||
		!Number.isSafeInteger(version) ||
		version < 1
	) {
		return notFound();
	}
	const ext = match[2] as "js" | "css";

	const row = await getPrisma(env).componentVersion.findUnique({
		where: { componentId_version: { componentId, version } },
		include: { component: { select: { projectId: true } } },
	});
	if (!row) return notFound();
	// Soft-deleted components keep serving their published/retired bundles:
	// existing publication snapshots pin these URLs, and deletion is soft
	// precisely so snapshots retain their bytes. Only drafts stay private.
	if (
		row.component.projectId !== projectId ||
		(row.status !== "published" && row.status !== "retired")
	) {
		return notFound();
	}

	const object = await env.DESIGNS.get(
		`${componentBundleKey(componentId, version)}.${ext}`,
	);
	if (!object) return notFound();
	return new Response(object.body, {
		status: 200,
		headers: bundleResponseHeaders(object, ext),
	});
}
