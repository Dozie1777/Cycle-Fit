import { describe, expect, it } from "vitest";
import {
	type AssetRef,
	assetContextLine,
	assetDescribePrompt,
	assetKindForContentType,
	assetsKey,
	attachmentsContextText,
	bytesToDataUrl,
	isAssetId,
	isVisionDescribing,
	maxBytesForKind,
	parseAttachments,
	sanitizeFilename,
	serializeAttachments,
} from "./design-assets";

function ref(overrides: Partial<AssetRef> = {}): AssetRef {
	return {
		id: "asset-1",
		kind: "image",
		filename: "hero-mock.png",
		contentType: "image/png",
		description: "A dark hero with a serif headline.",
		width: 1440,
		height: 900,
		durationSec: null,
		url: "/designs/design-1/assets/asset-1/file",
		...overrides,
	};
}

describe("assetKindForContentType", () => {
	it("maps image and video content types", () => {
		expect(assetKindForContentType("image/png")).toBe("image");
		expect(assetKindForContentType("video/mp4")).toBe("video");
		expect(assetKindForContentType("video/quicktime")).toBe("video");
	});

	it("rejects everything else", () => {
		expect(assetKindForContentType("text/html")).toBeNull();
		expect(assetKindForContentType("application/pdf")).toBeNull();
		expect(assetKindForContentType("")).toBeNull();
	});
});

describe("sanitizeFilename", () => {
	it("keeps the basename and strips path separators", () => {
		expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
		expect(sanitizeFilename("C:\\Users\\me\\logo.png")).toBe("logo.png");
	});

	it("replaces unsafe characters and leading dots", () => {
		expect(sanitizeFilename("..secret file?.png")).toBe("secret-file-.png");
		expect(sanitizeFilename(".gitignore")).toBe("gitignore");
	});

	it("falls back for empty names", () => {
		expect(sanitizeFilename("")).toBe("asset");
		expect(sanitizeFilename("...")).toBe("asset");
	});
});

describe("assetsKey", () => {
	it("builds assets/<assetId>/<safe-name>", () => {
		expect(assetsKey("abc123", "hero mock.png")).toBe(
			"assets/abc123/hero-mock.png",
		);
	});
});

describe("assetContextLine", () => {
	it("includes kind, dimensions, description and url", () => {
		expect(assetContextLine(ref())).toBe(
			'[Asset: hero-mock.png (image, 1440×900) — description: "A dark hero with a serif headline." — url: /designs/design-1/assets/asset-1/file]',
		);
	});

	it("falls back to duration for videos and flags missing descriptions", () => {
		const line = assetContextLine(
			ref({
				kind: "video",
				filename: "onboarding.mp4",
				contentType: "video/mp4",
				width: null,
				height: null,
				durationSec: 32.4,
				description: null,
			}),
		);
		expect(line).toContain("(video, 32s)");
		expect(line).toContain("no description yet");
	});
});

describe("attachmentsContextText", () => {
	it("returns empty string without attachments", () => {
		expect(attachmentsContextText([])).toBe("");
	});

	it("joins one line per asset", () => {
		const text = attachmentsContextText([
			ref(),
			ref({ id: "asset-2", filename: "b.png" }),
		]);
		expect(text).toMatch(/^\[Attached assets\]\n\[Asset: hero-mock\.png/);
		expect(text.split("\n")).toHaveLength(3);
	});
});

describe("parseAttachments / serializeAttachments", () => {
	it("round-trips refs", () => {
		const refs = [
			ref(),
			ref({ id: "asset-2", kind: "video", description: null }),
		];
		expect(parseAttachments(serializeAttachments(refs))).toEqual(refs);
	});

	it("tolerates junk", () => {
		expect(parseAttachments(null)).toEqual([]);
		expect(parseAttachments("not json")).toEqual([]);
		expect(parseAttachments("{}")).toEqual([]);
		expect(parseAttachments('[{"id":"x"}]')).toEqual([]);
	});
});

describe("assetDescribePrompt", () => {
	it("names the file and targets a design agent", () => {
		const prompt = assetDescribePrompt("moodboard.png");
		expect(prompt).toContain("moodboard.png");
		expect(prompt).toContain("design agent");
		expect(prompt).toContain("palette");
	});
});

describe("bytesToDataUrl", () => {
	it("encodes binary into a data URL", () => {
		const bytes = new TextEncoder().encode("hello").buffer;
		expect(bytesToDataUrl(bytes, "image/png")).toBe(
			`data:image/png;base64,${btoa("hello")}`,
		);
	});
});

describe("isVisionDescribing", () => {
	it("covers raster images only", () => {
		expect(isVisionDescribing("image", "image/png")).toBe(true);
		expect(isVisionDescribing("image", "image/svg+xml")).toBe(false);
		expect(isVisionDescribing("video", "video/mp4")).toBe(false);
	});
});

describe("maxBytesForKind", () => {
	it("allows larger videos than images", () => {
		expect(maxBytesForKind("video")).toBeGreaterThan(maxBytesForKind("image"));
	});
});

describe("isAssetId", () => {
	it("accepts cuid-ish ids and rejects path tricks", () => {
		expect(isAssetId("cmabc123def456ghi789")).toBe(true);
		expect(isAssetId("../../etc/passwd")).toBe(false);
		expect(isAssetId("short")).toBe(false);
	});
});
