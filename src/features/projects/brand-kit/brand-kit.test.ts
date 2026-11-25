import { describe, expect, it } from "vitest";
import {
	BRAND_COLOR_ROLES,
	BRAND_KIT_EXTERNAL_ASSETS_RULE,
	BRAND_TYPOGRAPHY_ROLES,
	brandKitPromptSection,
	brandKitToCssRoot,
	brandKitToFontHtml,
	brandKitToPromptMarkdown,
	googleFontsUrl,
	paletteColor,
} from "./brand-kit";

function kit(overrides?: Partial<Parameters<typeof brandKitToCssRoot>[0]>) {
	return {
		name: "Acme brand",
		palettes: [
			{
				mode: "light",
				colors: [
					{ role: "background", value: "#ffffff" },
					{ role: "foreground", value: "#111111" },
					{ role: "primary", value: "#2563eb" },
					{ role: "primary-foreground", value: "#ffffff" },
					{ role: "muted", value: "#f1f5f9" },
					{ role: "border", value: "#e2e8f0" },
					{ role: "accent", value: "#7c3aed" },
				],
			},
		],
		typography: [
			{ role: "heading", stack: "Georgia, serif" },
			{ role: "body", stack: "Inter, sans-serif" },
			{ role: "display", stack: "Space Grotesk, sans-serif" },
		],
		fonts: [],
		...overrides,
	};
}

describe("paletteColor", () => {
	it("returns the value for a present role", () => {
		const palette = { colors: [{ role: "primary", value: "#2563eb" }] };
		expect(paletteColor(palette, "primary")).toBe("#2563eb");
	});

	it("returns undefined for a missing role, missing palette, or null", () => {
		expect(paletteColor({ colors: [] }, "primary")).toBeUndefined();
		expect(paletteColor(undefined, "primary")).toBeUndefined();
		expect(paletteColor(null, "primary")).toBeUndefined();
	});
});

describe("brandKitToCssRoot", () => {
	it("emits a light :root with shadcn variables plus font stacks", () => {
		const css = brandKitToCssRoot(kit(), "light");
		expect(css).toContain(":root {");
		for (const role of BRAND_COLOR_ROLES) {
			expect(css).toContain(`--${role}:`);
		}
		for (const role of BRAND_TYPOGRAPHY_ROLES) {
			expect(css).toContain(`--font-${role}:`);
		}
		expect(css).toContain("--background: #ffffff;");
		expect(css).toContain("--font-heading: Georgia, serif;");
	});

	it("emits only the roles present in the palette", () => {
		const css = brandKitToCssRoot(
			kit({
				palettes: [
					{
						mode: "light",
						colors: [{ role: "background", value: "#ffffff" }],
					},
				],
				typography: [],
			}),
			"light",
		);
		expect(css).toContain("--background: #ffffff;");
		expect(css).not.toContain("--primary");
		expect(css).not.toContain("--font-");
	});

	it("adds both dark blocks when a dark palette exists", () => {
		const css = brandKitToCssRoot(
			kit({
				palettes: [
					...kit().palettes,
					{
						mode: "dark",
						colors: [
							{ role: "background", value: "#0b1120" },
							{ role: "foreground", value: "#e2e8f0" },
						],
					},
				],
			}),
			"light",
		);
		expect(css).toContain("@media (prefers-color-scheme: dark) {");
		expect(css).toContain(".dark {");
		expect(css.match(/--background: #0b1120;/g)?.length).toBe(2);
		// Dark blocks override colors only — fonts stay in :root once.
		expect(css.match(/--font-heading:/g)?.length).toBe(1);
	});

	it("falls back to light when the requested mode has no palette", () => {
		const css = brandKitToCssRoot(kit(), "dark");
		expect(css).toContain("--background: #ffffff;");
		expect(css).not.toContain("@media");
	});

	it("emits only font stacks when no palettes exist at all", () => {
		const css = brandKitToCssRoot(kit({ palettes: [] }), "light");
		expect(css).toContain("--font-body: Inter, sans-serif;");
		expect(css).not.toContain("--background");
	});
});

describe("googleFontsUrl", () => {
	it("builds a variable-range URL with italic", () => {
		expect(
			googleFontsUrl({
				family: "Roboto",
				source: "google",
				weights: "100..900",
				italic: true,
			}),
		).toBe(
			"https://fonts.googleapis.com/css2?family=Roboto:ital,wght@0,100..900;1,100..900&display=swap",
		);
	});

	it("builds a discrete-weights URL without italic", () => {
		expect(
			googleFontsUrl({
				family: "Roboto",
				source: "google",
				weights: "400;700",
			}),
		).toBe(
			"https://fonts.googleapis.com/css2?family=Roboto:wght@400;700&display=swap",
		);
	});

	it("skips the axes segment when there are no weights and no italic", () => {
		expect(googleFontsUrl({ family: "Inter", source: "google" })).toBe(
			"https://fonts.googleapis.com/css2?family=Inter&display=swap",
		);
	});

	it("requests italic-only when italic is set with no weights", () => {
		expect(
			googleFontsUrl({ family: "Inter", source: "google", italic: true }),
		).toBe(
			"https://fonts.googleapis.com/css2?family=Inter:ital@1&display=swap",
		);
	});
});

describe("brandKitToFontHtml", () => {
	it("emits preconnects only when a google font exists", () => {
		const withGoogle = brandKitToFontHtml(
			kit({ fonts: [{ family: "Inter", source: "google", weights: "400" }] }),
		);
		expect(withGoogle).toContain(
			'rel="preconnect" href="https://fonts.googleapis.com"',
		);
		expect(withGoogle).toContain(
			'href="https://fonts.gstatic.com" crossorigin',
		);
		expect(withGoogle).toContain(
			'href="https://fonts.googleapis.com/css2?family=Inter:wght@400&display=swap"',
		);

		const withoutGoogle = brandKitToFontHtml(
			kit({ fonts: [{ family: "Arial", source: "system" }] }),
		);
		expect(withoutGoogle).not.toContain("preconnect");
		expect(withoutGoogle).toBe("");
	});

	it("emits stored https urls for url-source fonts and nothing for system", () => {
		const html = brandKitToFontHtml(
			kit({
				fonts: [
					{
						family: "Custom",
						source: "url",
						url: "https://cdn.example.com/f.css",
					},
					{ family: "Arial", source: "system" },
				],
			}),
		);
		expect(html).toBe(
			'<link rel="stylesheet" href="https://cdn.example.com/f.css">',
		);
	});

	it("never emits @import", () => {
		const html = brandKitToFontHtml(
			kit({
				fonts: [
					{ family: "Inter", source: "google", weights: "400" },
					{
						family: "Custom",
						source: "url",
						url: "https://cdn.example.com/f.css",
					},
				],
			}),
		);
		expect(html).not.toContain("@import");
	});
});

describe("brandKitToPromptMarkdown", () => {
	it("composes the css and font sections", () => {
		const md = brandKitToPromptMarkdown(
			kit({
				fonts: [{ family: "Inter", source: "google", weights: "400;700" }],
			}),
		);
		expect(md).toContain("## Brand kit: Acme brand");
		expect(md).toContain("```css");
		expect(md).toContain("```html");
		expect(md).toContain("--background: #ffffff;");
		expect(md).toContain("family=Inter:wght@400;700");
	});

	it("omits empty sections and degrades to an empty string", () => {
		expect(
			brandKitToPromptMarkdown(kit({ palettes: [], typography: [] })),
		).toBe("");
	});
});

describe("brandKitPromptSection (KUK-898/899 shared injection)", () => {
	it("composes the verbatim-injection rules, tokens, fonts and the external-assets rule", () => {
		const section = brandKitPromptSection(
			kit({
				fonts: [{ family: "Inter", source: "google", weights: "400;700" }],
			}),
		);
		expect(section).toContain("## Brand kit: Acme brand");
		expect(section).toContain("source of truth");
		expect(section).toContain("VERBATIM");
		expect(section).toContain("never `@import`");
		expect(section).toContain("```css");
		expect(section).toContain("--background: #ffffff;");
		expect(section).toContain("--font-heading: Georgia, serif;");
		expect(section).toContain("```html");
		expect(section).toContain("family=Inter:wght@400;700");
		expect(section).toContain(BRAND_KIT_EXTERNAL_ASSETS_RULE);
	});

	it("carries the dark-mode override language when a dark palette exists", () => {
		const section = brandKitPromptSection(
			kit({
				palettes: [
					...kit().palettes,
					{
						mode: "dark",
						colors: [
							{ role: "background", value: "#0b1120" },
							{ role: "foreground", value: "#e2e8f0" },
						],
					},
				],
			}),
		);
		expect(section).toContain("dark-mode override blocks");
		expect(section).toContain("@media (prefers-color-scheme: dark)");
	});

	it("drops the token rule for a fonts-only kit", () => {
		const section = brandKitPromptSection(
			kit({
				palettes: [],
				typography: [],
				fonts: [{ family: "Inter", source: "google" }],
			}),
		);
		expect(section).toContain("### Fonts");
		expect(section).not.toContain("### Colors");
		expect(section).not.toContain("--font-heading");
		expect(section).toContain(BRAND_KIT_EXTERNAL_ASSETS_RULE);
	});

	it("degrades to an empty string for a kit with nothing to emit", () => {
		expect(
			brandKitPromptSection(kit({ palettes: [], typography: [], fonts: [] })),
		).toBe("");
	});
});
