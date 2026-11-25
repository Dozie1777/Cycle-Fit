import { describe, expect, it } from "vitest";
import { extractDesignTokens } from "@/features/design-studio/assets/design-files";
import {
	ADOPT_SKIPPED_CAP,
	mapAdoptedTokens,
	missingRequiredRoles,
	parseGoogleFontLinks,
} from "./brand-kit-adopt";

describe("mapAdoptedTokens", () => {
	it("maps the shadcn role vocabulary onto color roles", () => {
		const tokens = extractDesignTokens(`<style>:root {
			--background: #ffffff;
			--foreground: #09090b;
			--primary: #2563eb;
			--primary-foreground: #fafafa;
			--muted: #f4f4f5;
			--border: #e4e4e7;
			--accent: #7c3aed;
		}</style>`);
		expect(mapAdoptedTokens(tokens)).toEqual({
			colors: [
				{ role: "background", value: "#ffffff" },
				{ role: "foreground", value: "#09090b" },
				{ role: "primary", value: "#2563eb" },
				{ role: "primary-foreground", value: "#fafafa" },
				{ role: "muted", value: "#f4f4f5" },
				{ role: "border", value: "#e4e4e7" },
				{ role: "accent", value: "#7c3aed" },
			],
			typography: [],
			skipped: [],
		});
	});

	it("maps --font-* variables onto typography roles from either bucket", () => {
		const tokens = extractDesignTokens(`<style>:root {
			--font-heading: Georgia, serif;
			--font-body: Inter, sans-serif;
			--font-display: "Space Grotesk", sans-serif;
		}</style>`);
		const mapped = mapAdoptedTokens(tokens);
		expect(mapped.typography).toEqual([
			{ role: "heading", stack: "Georgia, serif" },
			{ role: "body", stack: "Inter, sans-serif" },
			{ role: "display", stack: '"Space Grotesk", sans-serif' },
		]);
		expect(mapped.skipped).toEqual([]);
	});

	it("maps a short named stack misclassified as a color (bucket-agnostic)", () => {
		const tokens = extractDesignTokens(`<style>:root {
			--font-body: serif;
		}</style>`);
		expect(mapAdoptedTokens(tokens).typography).toEqual([
			{ role: "body", stack: "serif" },
		]);
	});

	it("skips unmapped variables and non-hex color values", () => {
		const tokens = extractDesignTokens(`<style>:root {
			--paper: #f6eddd;
			--primary: oklch(0.6 0.2 260);
			--background-foreground: #111111;
			--radius: 8px;
		}</style>`);
		const mapped = mapAdoptedTokens(tokens);
		expect(mapped.colors).toEqual([]);
		expect(mapped.skipped).toEqual([
			"--paper",
			"--primary",
			"--background-foreground",
			"--radius",
		]);
	});

	it("skips #rrggbbaa values the PUT validation would reject", () => {
		const tokens = extractDesignTokens(`<style>:root {
			--primary: #2563ebff;
			--border: #cccc;
		}</style>`);
		expect(mapAdoptedTokens(tokens).skipped).toEqual(["--primary", "--border"]);
	});

	it("skips oversized typography stacks", () => {
		const tokens = extractDesignTokens(`<style>:root {
			--font-heading: ${"a".repeat(501)};
			--font-body: ${"b".repeat(500)};
		}</style>`);
		const mapped = mapAdoptedTokens(tokens);
		expect(mapped.typography).toEqual([
			{ role: "body", stack: "b".repeat(500) },
		]);
		expect(mapped.skipped).toEqual(["--font-heading"]);
	});

	it("caps the skipped list at a sane count", () => {
		const vars = Array.from(
			{ length: ADOPT_SKIPPED_CAP + 5 },
			(_, i) => `  --extra-${i}: 1px;`,
		).join("\n");
		const tokens = extractDesignTokens(`<style>:root {\n${vars}\n}</style>`);
		expect(mapAdoptedTokens(tokens).skipped).toHaveLength(ADOPT_SKIPPED_CAP);
	});

	it("normalizes whitespace around values", () => {
		const tokens = extractDesignTokens(`<style>:root {
			--primary:   #0f0  ;
		}</style>`);
		expect(mapAdoptedTokens(tokens).colors).toEqual([
			{ role: "primary", value: "#0f0" },
		]);
	});
});

describe("missingRequiredRoles", () => {
	it("reports the required light roles that extraction did not yield", () => {
		expect(
			missingRequiredRoles([
				{ role: "background", value: "#fff" },
				{ role: "foreground", value: "#000" },
			]),
		).toEqual(["primary"]);
		expect(missingRequiredRoles([])).toEqual([
			"background",
			"foreground",
			"primary",
		]);
	});

	it("returns empty when all required roles are present", () => {
		expect(
			missingRequiredRoles([
				{ role: "background", value: "#fff" },
				{ role: "foreground", value: "#000" },
				{ role: "primary", value: "#0f0" },
			]),
		).toEqual([]);
	});
});

describe("parseGoogleFontLinks", () => {
	it("parses stylesheet css2 links back into font rows", () => {
		const html = `<head>
			<link rel="preconnect" href="https://fonts.googleapis.com">
			<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
			<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap">
		</head>`;
		expect(parseGoogleFontLinks(html)).toEqual([
			{
				family: "Inter",
				source: "google",
				url: undefined,
				weights: "400;700",
				italic: false,
			},
		]);
	});

	it("handles multiple families, variable ranges and ital tuples", () => {
		const html = `<head>
			<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300..700&family=Playfair+Display:ital,wght@0,400;1,700&display=swap">
			<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Dancing+Script:ital@1&display=swap">
			<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lora&display=swap">
		</head>`;
		expect(parseGoogleFontLinks(html)).toEqual([
			{
				family: "Space Grotesk",
				source: "google",
				url: undefined,
				weights: "300..700",
				italic: false,
			},
			{
				family: "Playfair Display",
				source: "google",
				url: undefined,
				weights: "400;700",
				italic: true,
			},
			{
				family: "Dancing Script",
				source: "google",
				url: undefined,
				weights: undefined,
				italic: true,
			},
			{
				family: "Lora",
				source: "google",
				url: undefined,
				weights: undefined,
				italic: false,
			},
		]);
	});

	it("ignores non-Google stylesheets, preconnects and malformed hrefs", () => {
		const html = `<head>
			<link rel="stylesheet" href="/styles/app.css">
			<link rel="stylesheet" href="https://cdn.example.com/fonts.css">
			<link rel="preconnect" href="https://fonts.googleapis.com/css2?family=Inter">
			<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=%C3%BCberfont">
		</head>`;
		expect(parseGoogleFontLinks(html)).toEqual([
			{
				family: "überfont",
				source: "google",
				url: undefined,
				weights: undefined,
				italic: false,
			},
		]);
	});

	it("dedupes a family loaded by two links", () => {
		const html = `<head>
			<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400&display=swap">
			<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@700&display=swap">
		</head>`;
		const fonts = parseGoogleFontLinks(html);
		expect(fonts).toHaveLength(1);
		expect(fonts[0].weights).toBe("400");
	});

	it("returns nothing for a document without font links", () => {
		expect(parseGoogleFontLinks("<html><body>hi</body></html>")).toEqual([]);
	});
});
