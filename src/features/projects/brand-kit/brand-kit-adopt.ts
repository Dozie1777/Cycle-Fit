// Pure mapping helpers for token adoption (KUK-901): turning the CSS custom
// properties extracted from a published design (extractDesignTokens) into
// brand-kit rows, and Google Fonts css2 <link> hrefs back into BrandFont
// rows. No runtime dependencies — safe to unit-test in plain vitest. The
// server handler (server/handlers/brand-kits.ts) composes these with the R2
// read and the shared PUT validation/write path.

import type { DesignTokens } from "@/features/design-studio/assets/design-files";
import {
	BRAND_COLOR_ROLES,
	BRAND_TYPOGRAPHY_ROLES,
	type BrandColorRole,
	type BrandFontLike,
	type BrandTypographyRole,
	REQUIRED_LIGHT_ROLES,
} from "./brand-kit";

/** `--${role}` → role, for every shadcn color role we can adopt. */
const COLOR_ROLE_BY_VARIABLE = new Map<string, BrandColorRole>(
	BRAND_COLOR_ROLES.map((role) => [`--${role}`, role]),
);

/** `--font-${role}` → typography role, adopted when present. */
const TYPOGRAPHY_ROLE_BY_VARIABLE = new Map<string, BrandTypographyRole>(
	BRAND_TYPOGRAPHY_ROLES.map((role) => [`--font-${role}`, role]),
);

/** Same shape the PUT handler validates — anything else can't be adopted. */
export const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Max typography stack length the PUT body allows. */
const STACK_MAX = 500;

/** How many unmapped variable names the adopt response reports. */
export const ADOPT_SKIPPED_CAP = 12;

export type AdoptedColors = { role: BrandColorRole; value: string }[];

export type AdoptedTypography = { role: BrandTypographyRole; stack: string }[];

export type AdoptedTokens = {
	colors: AdoptedColors;
	typography: AdoptedTypography;
	/** Extracted variable names that could not be adopted (deduped, capped). */
	skipped: string[];
};

/**
 * Maps extracted `:root` custom properties onto the shadcn role vocabulary:
 * `--background` → color role `background`, `--font-heading` → typography
 * role `heading`, and so on. Color values must be #rgb/#rrggbb hex (the PUT
 * validation otherwise rejects the whole save) and stacks ≤ 500 chars;
 * everything else — unmapped variables, non-hex colors, oversized stacks —
 * is reported as skipped. DesignTokens colors/other buckets are merged so a
 * misclassified token (e.g. `--font-body: serif`) still maps by name.
 */
export function mapAdoptedTokens(tokens: DesignTokens): AdoptedTokens {
	const colors: AdoptedColors = [];
	const typography: AdoptedTypography = [];
	const skipped: string[] = [];
	const seenSkipped = new Set<string>();
	const noteSkipped = (name: string) => {
		if (seenSkipped.has(name)) return;
		seenSkipped.add(name);
		if (skipped.length < ADOPT_SKIPPED_CAP) skipped.push(name);
	};
	for (const token of [...tokens.colors, ...tokens.other]) {
		const colorRole = COLOR_ROLE_BY_VARIABLE.get(token.name);
		if (colorRole) {
			if (HEX_COLOR_RE.test(token.value.trim())) {
				colors.push({ role: colorRole, value: token.value.trim() });
			} else {
				noteSkipped(token.name);
			}
			continue;
		}
		const typoRole = TYPOGRAPHY_ROLE_BY_VARIABLE.get(token.name);
		if (typoRole) {
			const stack = token.value.trim();
			if (stack !== "" && stack.length <= STACK_MAX) {
				typography.push({ role: typoRole, stack });
			} else {
				noteSkipped(token.name);
			}
			continue;
		}
		noteSkipped(token.name);
	}
	return { colors, typography, skipped };
}

/**
 * Which light-palette roles the PUT validation would reject — empty when
 * the extraction yields a saveable light palette.
 */
export function missingRequiredRoles(colors: AdoptedColors): string[] {
	const roles = new Set(colors.map((color) => color.role));
	// The shared light-palette requirement (enforced by the PUT validation).
	return REQUIRED_LIGHT_ROLES.filter((role) => !roles.has(role));
}

/**
 * Parses Google Fonts stylesheet `<link>` hrefs
 * (`https://fonts.googleapis.com/css2?family=…`) in the document head back
 * into BrandFont rows — family/weights/italic best-effort from the css2 URL
 * shape. Preconnect tags carry no family data and are ignored, as are
 * non-Google stylesheet links. Multiple `family=` params (one css2 URL can
 * load several families) each become their own row, deduped by family.
 */
export function parseGoogleFontLinks(html: string): BrandFontLike[] {
	const fonts: BrandFontLike[] = [];
	const seen = new Set<string>();
	for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
		const tag = match[0];
		const rel = /(?:^|\s)rel\s*=\s*["']?([^"'>\s]+)/i.exec(tag)?.[1] ?? "";
		if (!/stylesheet/i.test(rel)) continue;
		const href = /(?:^|\s)href\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
		if (!href?.startsWith("https://fonts.googleapis.com/css2?")) continue;
		let url: URL;
		try {
			url = new URL(href);
		} catch {
			continue;
		}
		for (const raw of url.searchParams.getAll("family")) {
			const font = css2FamilyParamToFont(raw);
			if (!font || seen.has(font.family)) continue;
			seen.add(font.family);
			fonts.push(font);
		}
	}
	return fonts;
}

/**
 * One css2 `family=` param → a BrandFont row. Shapes handled:
 * `Inter`, `Inter:wght@400;700`, `Inter:wght@100..900`, `Inter:ital@1`,
 * `Inter:ital,wght@0,400;1,700`. null for unparseable/oversized families.
 */
function css2FamilyParamToFont(raw: string): BrandFontLike | null {
	const colon = raw.indexOf(":");
	const encoded = colon === -1 ? raw : raw.slice(0, colon);
	const axes = colon === -1 ? "" : raw.slice(colon + 1);
	let family = encoded.replace(/\+/g, " ");
	try {
		family = decodeURIComponent(family);
	} catch {
		// keep the raw value — percent signs in a family name are still text
	}
	family = family.trim();
	if (family === "" || family.length > 120) return null;
	let weights = "";
	let italic = false;
	const [axesKey, axesValues] = axes.split("@") as [string, string?];
	if (axesValues !== undefined) {
		const keys = axesKey.split(",");
		const wghtIndex = keys.indexOf("wght");
		const italIndex = keys.indexOf("ital");
		const values: string[] = [];
		for (const tuple of axesValues.split(";")) {
			const parts = tuple.split(",");
			if (wghtIndex >= 0 && parts[wghtIndex]) values.push(parts[wghtIndex]);
			if (italIndex >= 0 && parts[italIndex] === "1") italic = true;
		}
		weights = values.join(";");
	}
	return {
		family,
		source: "google",
		url: undefined,
		weights: weights === "" ? undefined : weights,
		italic,
	};
}
