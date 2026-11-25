// Old app versions used hash-based URLs (#/designs, #/studio/<id>). Map any
// legacy hash to its current pathname so bookmarks keep working.
export function mapLegacyAdminHash(hash: string): string | null {
	if (hash === "#/" || hash === "#/designs") return "/projects/designs";
	if (hash === "#/agents") return "/agents";
	if (hash === "#/admins") return "/admins";
	const studio = hash.match(/^#\/studio\/([^/]+)$/);
	return studio ? `/studio/${studio[1]}` : null;
}
