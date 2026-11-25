// Public time-travel serving of publication snapshots (KUK-923): exposes a
// publication's pages under
//
//   GET /designs/<designId>/publication/<version>/<site-path…>
//
// by mapping the site path through publicationPageSegment (KUK-922's
// injective path → snapshot-key convention) onto
// designs/<designId>/publications/<version>/pages/<segment>/index.html.
// The Publication row is the index: a version with no row → 404, and the
// requested path must match a page recorded in the row's manifest (the
// manifest's pages[].path → publicationPageSegment must equal the request's
// segment) — unknown paths 404 instead of serving orphaned snapshot bytes.
//
// Auth posture: public, same as the design site routes — publications are
// snapshots of the published site. The live homepage keeps serving from
// Design.liveTurnId via /designs/<id>/site; this route is for the other
// pages and for viewing any past version.

import {
	designResponseHeaders,
	isDesignId,
} from "@/features/design-studio/assets/design-files";
import { publicationPageSegment } from "@/features/design-studio/publish/publication-segment";
import { getPrisma } from "@/lib/db";

/** The manifest shape createPublication writes (subset read here). */
type ManifestPage = { path: string; htmlR2Key: string };

function notFound(): Response {
	return new Response("not found", { status: 404 });
}

/**
 * The route's `$version` param: a plain 1-based decimal, no leading zeros —
 * anything else (including `0`, `-1`, `1.5`, `01`) is not a publication.
 */
const VERSION_RE = /^[1-9]\d*$/;

export async function servePublicationPage(input: {
	env: Env;
	designId: string;
	version: string;
	/**
	 * Raw splat (already URL-decoded by the router, no leading slash; ""
	 * for the version root — the homepage).
	 */
	path: string;
}): Promise<Response> {
	const { env, designId, version, path } = input;
	if (!isDesignId(designId)) {
		return Response.json({ error: "invalid project id" }, { status: 400 });
	}
	if (!VERSION_RE.test(version)) return notFound();
	const v = Number(version);
	// Bound the numeric segment: arbitrarily long digit strings can produce
	// Infinity / precision loss through Number() — a server error instead of
	// a 404 for a malformed path.
	if (!Number.isSafeInteger(v)) return notFound();

	// Site path from the splat: "" → "/", else restore the leading slash.
	// A trailing slash is dropped so "/pricing/" addresses "/pricing" like a
	// directory URL would.
	const trimmed = path.replace(/\/+$/, "");
	const sitePath = trimmed === "" ? "/" : `/${trimmed}`;

	const publication = await getPrisma(env).publication.findUnique({
		where: { designId_version: { designId, version: v } },
		select: { manifest: true },
	});
	if (!publication) return notFound();

	// The row's manifest is the publication index: the request must name a
	// page it recorded. The object key is computed locally from the same
	// convention the snapshot was written with (never taken from the manifest
	// string), so a mutated manifest cannot point the route at other keys.
	const segment = publicationPageSegment(sitePath);
	let recorded = false;
	try {
		const parsed = JSON.parse(publication.manifest ?? "null") as {
			pages?: ManifestPage[];
		} | null;
		recorded =
			Array.isArray(parsed?.pages) &&
			parsed.pages.some(
				(page) => publicationPageSegment(page.path) === segment,
			);
	} catch {
		recorded = false;
	}
	if (!recorded) return notFound();

	const object = await env.DESIGNS.get(
		`designs/${designId}/publications/${v}/pages/${segment}/index.html`,
	);
	if (!object) return notFound();
	return new Response(object.body, {
		status: 200,
		// Same treatment as the site route: sandboxed HTML with the standard
		// design-file headers (designResponseHeaders of an .html path).
		headers: designResponseHeaders("index.html"),
	});
}
