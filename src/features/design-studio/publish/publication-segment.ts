/**
 * A page's site path → the snapshot key segment under
 * publications/<v>/pages/. The mapping is INJECTIVE over valid site paths
 * (raw `path` is unique per project): "/" maps to "index"; every other
 * path maps to "p/<percent-encoded path sans leading slash>" — so "/",
 * "/index", "/a b", "/a-b", "/x" and "//x" all land on distinct keys and
 * no page can silently overwrite another in the snapshot. (Assumes site
 * paths start with "/", which the Page validation enforces; empty-string
 * paths are not valid site paths.)
 *
 * Standalone module (no cloudflare:/prisma imports) so unit tests can
 * exercise the mapping without the worker runtime.
 */
export function publicationPageSegment(path: string): string {
	if (path === "/") return "index";
	const rel = path.startsWith("/") ? path.slice(1) : path;
	const encoded = rel
		.split("/")
		.map((segment) => encodeURIComponent(segment))
		.join("/");
	return `p/${encoded}`;
}
