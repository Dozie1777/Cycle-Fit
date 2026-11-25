/**
 * Validate a login `redirect` search param before using it.
 *
 * Only same-origin absolute paths are allowed. Anything else — external
 * URLs, protocol-relative "//host", backslash tricks ("/\evil.com", which
 * some URL parsers treat like "//"), control characters browsers strip
 * from URLs — falls back to the caller's default target.
 */
export function safeRedirectPath(target: unknown): string | null {
	if (typeof target !== "string") return null;
	if (!target.startsWith("/") || target.startsWith("//")) return null;
	for (const ch of target) {
		const code = ch.charCodeAt(0);
		if (ch === "\\" || code < 0x20 || code === 0x7f) return null;
	}
	return target;
}
