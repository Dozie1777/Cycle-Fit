// Pure helpers for the brand-kit feature (KUK-894): role enumeration,
// palette access, CSS custom-property emission, Google Fonts URL
// construction, font <head> HTML, and the prompt-injection markdown. No
// runtime dependencies — safe to unit-test in plain vitest. The rows are
// shaped structurally (Prisma rows satisfy these types as-is).

/** shadcn token names a palette color row can carry. */
export const BRAND_COLOR_ROLES = [
	"background",
	"foreground",
	"primary",
	"primary-foreground",
	"muted",
	"border",
	"accent",
] as const;

export type BrandColorRole = (typeof BRAND_COLOR_ROLES)[number];

/**
 * Light-palette roles the server requires once a light palette exists
 * (enforced by the PUT/adopt validation). Shared by the server handler and
 * the client editor so both can't drift.
 */
export const REQUIRED_LIGHT_ROLES = [
	"background",
	"foreground",
	"primary",
] as const;

/** Typography roles; shared across modes — only colors vary per mode. */
export const BRAND_TYPOGRAPHY_ROLES = ["heading", "body", "display"] as const;

export type BrandTypographyRole = (typeof BRAND_TYPOGRAPHY_ROLES)[number];

export type BrandPaletteLike = {
	mode: string;
	colors: { role: string; value: string }[];
};

export type BrandTypographyLike = { role: string; stack: string };

export type BrandFontLike = {
	family: string;
	/// 'system' | 'google' | 'url'
	source: string;
	url?: string | null;
	weights?: string | null;
	italic?: boolean | null;
};

export type BrandKitLike = {
	name?: string;
	palettes: BrandPaletteLike[];
	typography: BrandTypographyLike[];
	fonts: BrandFontLike[];
};

/** The color value of `role` in a palette, or undefined when absent. */
export function paletteColor(
	palette: { colors: { role: string; value: string }[] } | undefined | null,
	role: BrandColorRole,
): string | undefined {
	return palette?.colors.find((color) => color.role === role)?.value;
}

/** The typography stack of `role` in a kit, or undefined when absent. */
function typographyStack(
	typography: { role: string; stack: string }[],
	role: BrandTypographyRole,
): string | undefined {
	return typography.find((entry) => entry.role === role)?.stack;
}

/**
 * Resolves the palette for `mode`, falling back to light (never throws) —
 * the caller asks for the mode it is rendering; a kit without that palette
 * still renders from light.
 */
function resolvePalette(
	palettes: BrandPaletteLike[],
	mode: "light" | "dark",
): BrandPaletteLike | undefined {
	return (
		palettes.find((palette) => palette.mode === mode) ??
		palettes.find((palette) => palette.mode === "light")
	);
}

/**
 * Renders the palette of `mode` (falling back to light) plus the kit's font
 * stacks as CSS custom properties in one `:root` block; when a dark palette
 * exists, dark overrides are emitted both as a `prefers-color-scheme: dark`
 * media block and a `.dark { ... }` class block. Only roles present in the
 * palette are emitted. Missing palettes degrade to a fonts-only block.
 */
export function brandKitToCssRoot(
	kit: BrandKitLike,
	mode: "light" | "dark",
): string {
	const palette = resolvePalette(kit.palettes, mode);
	const lines: string[] = [];
	for (const role of BRAND_COLOR_ROLES) {
		const value = paletteColor(palette, role);
		if (value !== undefined) lines.push(`  --${role}: ${value};`);
	}
	for (const role of BRAND_TYPOGRAPHY_ROLES) {
		const stack = typographyStack(kit.typography, role);
		if (stack !== undefined) lines.push(`  --font-${role}: ${stack};`);
	}
	let css = lines.length ? `:root {\n${lines.join("\n")}\n}` : "";
	const dark = kit.palettes.find((entry) => entry.mode === "dark");
	if (dark) {
		const darkLines = BRAND_COLOR_ROLES.flatMap((role) => {
			const value = paletteColor(dark, role);
			return value === undefined ? [] : [`  --${role}: ${value};`];
		});
		if (darkLines.length) {
			if (css) css += "\n\n";
			css += `@media (prefers-color-scheme: dark) {\n:root {\n${darkLines.join("\n")}\n}\n}\n\n.dark {\n${darkLines.join("\n")}\n}`;
		}
	}
	return css;
}

/**
 * Builds a Google Fonts css2 stylesheet URL from a font row's family,
 * weights, and italic. Weight tokens (comma/semicolon-separated, e.g.
 * "400;700" or a variable range "100..900") become a `wght` axis; italic
 * doubles each weight as an `ital,wght` pair. With no weights and no italic
 * the axes segment is skipped entirely.
 */
export function googleFontsUrl(font: BrandFontLike): string {
	const tokens = (font.weights ?? "")
		.split(/[,;]/)
		.map((token) => token.trim())
		.filter(Boolean);
	const family = encodeURIComponent(font.family.replace(/\s+/g, "+"));
	if (tokens.length === 0 && !font.italic) {
		return `https://fonts.googleapis.com/css2?family=${family}&display=swap`;
	}
	if (tokens.length === 0) {
		return `https://fonts.googleapis.com/css2?family=${family}:ital@1&display=swap`;
	}
	const axes = font.italic
		? `ital,wght@${tokens.flatMap((token) => [`0,${token}`, `1,${token}`]).join(";")}`
		: `wght@${tokens.join(";")}`;
	return `https://fonts.googleapis.com/css2?family=${family}:${axes}&display=swap`;
}

/**
 * The <head> markup that loads the kit's fonts: preconnects to Google Fonts
 * only when a google-sourced font exists, then one stylesheet <link> per
 * font (google → generated css2 URL, url → the stored https URL, system →
 * nothing). Never emits @import.
 */
export function brandKitToFontHtml(kit: BrandKitLike): string {
	const links: string[] = [];
	const hasGoogle = kit.fonts.some((font) => font.source === "google");
	if (hasGoogle) {
		links.push('<link rel="preconnect" href="https://fonts.googleapis.com">');
		links.push(
			'<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
		);
	}
	for (const font of kit.fonts) {
		if (font.source === "google") {
			links.push(`<link rel="stylesheet" href="${googleFontsUrl(font)}">`);
		} else if (font.source === "url" && font.url?.startsWith("https://")) {
			links.push(`<link rel="stylesheet" href="${font.url}">`);
		}
	}
	return links.join("\n");
}

/**
 * Compact markdown block for prompt injection (wave-2): the CSS variables
 * (light root + dark overrides when present) and the font <head> HTML. Used
 * by later tickets; kept deliberately thin — a composition of the helpers
 * above.
 */
export function brandKitToPromptMarkdown(kit: BrandKitLike): string {
	const css = brandKitToCssRoot(kit, "light");
	const fontHtml = brandKitToFontHtml(kit);
	const sections: string[] = [];
	if (css) {
		sections.push(
			`### Colors (CSS custom properties)\n\nApply to the design's \`<style>\` \`:root\`:\n\n\`\`\`css\n${css}\n\`\`\``,
		);
	}
	if (fontHtml) {
		sections.push(
			`### Fonts\n\nAdd to \`<head>\`:\n\n\`\`\`html\n${fontHtml}\n\`\`\``,
		);
	}
	const header = kit.name
		? `## Brand kit: ${kit.name}\n\n`
		: "## Brand kit\n\n";
	return sections.length ? `${header}${sections.join("\n\n")}` : "";
}

/**
 * The one carve-out in every self-contained-output contract that can carry
 * a brand kit (KUK-898 design chat, KUK-899 campaign assets): the kit's
 * font stylesheets are the only external network assets published output
 * may ever request.
 */
export const BRAND_KIT_EXTERNAL_ASSETS_RULE = `External network assets: published output stays self-contained with exactly one exception — the brand-kit font stylesheets above. They are the only external requests allowed (no images, no CDNs, no analytics); every other asset is recreated inline with CSS.`;

/**
 * The full prompt-injection section for a brand kit (KUK-898/899), shared
 * verbatim by both call sites: the injection rules (declare the tokens
 * verbatim in `:root` including dark overrides, emit the font `<head>`
 * markup verbatim, never `@import`), then the CSS custom properties and
 * font markup itself, then the external-assets carve-out. Empty string for
 * a kit with nothing to emit (caller then behaves as kit-less).
 */
export function brandKitPromptSection(kit: BrandKitLike): string {
	const css = brandKitToCssRoot(kit, "light");
	const fontHtml = brandKitToFontHtml(kit);
	if (!css && !fontHtml) return "";
	const rules: string[] = [];
	if (css) {
		rules.push(
			"- Declare the CSS custom properties below VERBATIM in the page's\n  `<style>` `:root` block — including the dark-mode override blocks when\n  present — and use the variables (`--background`, `--primary`,\n  `--font-heading`, `--font-body`, `--font-display`, …) throughout\n  instead of hardcoding values.",
		);
	}
	if (fontHtml) {
		rules.push(
			'- Emit the font `<head>` markup below VERBATIM (preconnects +\n  `<link rel="stylesheet">` tags — never `@import`).',
		);
	}
	const header = kit.name ? `## Brand kit: ${kit.name}` : "## Brand kit";
	const parts: string[] = [
		`${header}\n\nThis project has a brand kit — it is the source of truth for the\ndesign's colors, typography and fonts. Apply it exactly; do not invent\nor offer alternative palettes, font pairings or typography:\n\n${rules.join("\n")}`,
	];
	if (css) {
		parts.push(
			`### Colors (CSS custom properties)\n\n\`\`\`css\n${css}\n\`\`\``,
		);
	}
	if (fontHtml) {
		parts.push(`### Fonts\n\n\`\`\`html\n${fontHtml}\n\`\`\``);
	}
	parts.push(BRAND_KIT_EXTERNAL_ASSETS_RULE);
	return parts.join("\n\n");
}
