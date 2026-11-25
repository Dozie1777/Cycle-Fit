// Design assets (KUK-864): upload validation, R2 key construction, the
// Workers AI image-description call, and the chat turn-context text built
// from attachment snapshots. Pure helpers have no runtime dependencies —
// safe to unit-test in plain vitest; the describe call takes `env` and uses
// nothing else from the worker.

/** Max images attached per chat turn. */
export const MAX_CHAT_ASSETS = 5;

/** Library size cap, enforced server-side at upload (client mirrors it). */
export const MAX_LIBRARY_ASSETS = 20;

/** Upload size caps. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

/** Workers AI vision model used to describe uploaded images, plus a cheap fallback. */
export const ASSET_DESCRIBE_MODEL =
	"@cf/mistralai/mistral-small-3.1-24b-instruct";
export const ASSET_DESCRIBE_FALLBACK_MODEL =
	"@cf/meta/llama-3.2-11b-vision-instruct";

export type AssetKind = "image" | "video";

/** Allowed upload content types → canonical file extension for the R2 key. */
export const IMAGE_CONTENT_TYPES: Record<string, string> = {
	"image/png": ".png",
	"image/jpeg": ".jpg",
	"image/gif": ".gif",
	"image/webp": ".webp",
	"image/svg+xml": ".svg",
};

export const VIDEO_CONTENT_TYPES: Record<string, string> = {
	"video/mp4": ".mp4",
	"video/webm": ".webm",
	"video/quicktime": ".mov",
};

export function assetKindForContentType(contentType: string): AssetKind | null {
	if (contentType in IMAGE_CONTENT_TYPES) return "image";
	if (contentType in VIDEO_CONTENT_TYPES) return "video";
	return null;
}

/** SVG can't be fed to the vision models as a data URL — it needs a written description like video. */
export function isVisionDescribing(kind: AssetKind, contentType: string) {
	return kind === "image" && contentType !== "image/svg+xml";
}

export function maxBytesForKind(kind: AssetKind): number {
	return kind === "image" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
}

/**
 * Display-safe filename: basename only, segment-safe characters, no leading
 * dots, capped length. Used for the R2 key suffix and UI labels — never the
 * key's identity (the cuid owns that).
 */
export function sanitizeFilename(name: string): string {
	const base = name.split(/[/\\]/).pop() ?? "";
	const cleaned = base
		.replace(/[^A-Za-z0-9._-]+/g, "-")
		.replace(/\.+/g, ".")
		.replace(/^-+/, "")
		.slice(0, 64)
		.replace(/^[.-]+|[.-]+$/g, "");
	return cleaned || "asset";
}

/** Bucket key under the DESIGNS binding: assets/<assetId>/<safe-filename>. */
export function assetsKey(assetId: string, filename: string): string {
	return `assets/${assetId}/${sanitizeFilename(filename)}`;
}

/** Worker-proxied file URL path for an asset (used by UI, chat context, agents). */
export function assetUrlPath(projectId: string, assetId: string): string {
	return `/designs/${projectId}/assets/${assetId}/file`;
}

/** Snapshot of an asset embedded in a chat message (D1 JSON + client wire format). */
export type AssetRef = {
	id: string;
	kind: AssetKind;
	filename: string;
	contentType: string;
	description: string | null;
	width: number | null;
	height: number | null;
	durationSec: number | null;
	/** Absolute or origin-relative URL serving the original file. */
	url: string;
};

/** Structural shape of the Prisma Asset row — keeps this module dependency-free. */
export type AssetRowLike = {
	id: string;
	kind: string;
	filename: string;
	contentType: string;
	r2Key: string;
	sizeBytes: number;
	description: string | null;
	descriptionStatus: string;
	descriptionError: string | null;
	width: number | null;
	height: number | null;
	durationSec: number | null;
	uploadedById: string;
};

export function assetRefFromRow(row: AssetRowLike, url: string): AssetRef {
	return {
		id: row.id,
		kind: row.kind === "video" ? "video" : "image",
		filename: row.filename,
		contentType: row.contentType,
		description: row.description,
		width: row.width,
		height: row.height,
		durationSec: row.durationSec,
		url,
	};
}

/** One-line model-context summary of an attached asset. */
export function assetContextLine(ref: AssetRef): string {
	const parts: string[] = [ref.kind];
	if (ref.width != null && ref.height != null) {
		parts.push(`${ref.width}×${ref.height}`);
	} else if (ref.durationSec != null) {
		parts.push(`${Math.round(ref.durationSec)}s`);
	}
	const description = ref.description?.trim()
		? ` — description: "${ref.description.trim()}"`
		: " — no description yet";
	return `[Asset: ${ref.filename} (${parts.join(", ")})${description} — url: ${ref.url}]`;
}

/** The asset block appended to a user turn's text when replaying history. */
export function attachmentsContextText(refs: AssetRef[]): string {
	if (refs.length === 0) return "";
	return `[Attached assets]\n${refs.map(assetContextLine).join("\n")}`;
}

/** Parses a Message.attachments JSON column; tolerates junk. */
export function parseAttachments(json: string | null | undefined): AssetRef[] {
	if (!json) return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		return [];
	}
	if (!Array.isArray(parsed)) return [];
	const out: AssetRef[] = [];
	for (const item of parsed) {
		if (!item || typeof item !== "object") continue;
		const ref = item as Record<string, unknown>;
		if (
			typeof ref.id !== "string" ||
			typeof ref.filename !== "string" ||
			typeof ref.url !== "string" ||
			(ref.kind !== "image" && ref.kind !== "video")
		) {
			continue;
		}
		out.push({
			id: ref.id,
			kind: ref.kind,
			filename: ref.filename,
			contentType: typeof ref.contentType === "string" ? ref.contentType : "",
			description: typeof ref.description === "string" ? ref.description : null,
			width: typeof ref.width === "number" ? ref.width : null,
			height: typeof ref.height === "number" ? ref.height : null,
			durationSec: typeof ref.durationSec === "number" ? ref.durationSec : null,
			url: ref.url,
		});
	}
	return out;
}

/** Serializes refs for the Message.attachments column. */
export function serializeAttachments(refs: AssetRef[]): string {
	return JSON.stringify(refs);
}

/**
 * The description prompt: tuned for the design agent consumer — the
 * vocabulary it needs to reuse the asset (palette, typography, layout,
 * components, mood), not alt-text.
 */
export function assetDescribePrompt(filename: string): string {
	return [
		`Describe the attached image (${filename}) for a design agent that will use it as visual reference for building a web page.`,
		"Cover, concisely: overall subject and purpose; layout structure; color palette with hex values where readable; typography style; UI components or visual elements present; mood/tone.",
		"2-5 sentences, plain prose. No preamble, no headings, no markdown.",
	].join(" ");
}

/** Chunked base64 — spreading a 10 MB buffer into btoa would blow the stack. */
export function bytesToDataUrl(
	bytes: ArrayBuffer,
	contentType: string,
): string {
	const view = new Uint8Array(bytes);
	const chunks: string[] = [];
	const step = 0x8000;
	for (let i = 0; i < view.length; i += step) {
		chunks.push(String.fromCharCode(...view.subarray(i, i + step)));
	}
	return `data:${contentType};base64,${btoa(chunks.join(""))}`;
}

type VisionOutput = { response?: unknown; description?: unknown };

/**
 * Describes an image with the Workers AI vision model, falling back to the
 * cheaper Llama 3.2 Vision when the primary errors. Throws when both fail
 * or return nothing usable — the caller marks the asset `failed`.
 */
export async function describeImageAsset(
	env: Env,
	dataUrl: string,
	filename: string,
): Promise<string> {
	const run = async (model: string): Promise<string> => {
		const output = (await env.AI.run(model, {
			messages: [
				{
					role: "user",
					content: [
						{ type: "text", text: assetDescribePrompt(filename) },
						{ type: "image_url", image_url: { url: dataUrl } },
					],
				},
			],
			max_tokens: 500,
		})) as VisionOutput;
		const text =
			typeof output?.response === "string"
				? output.response
				: typeof output?.description === "string"
					? output.description
					: "";
		const trimmed = text.trim();
		if (!trimmed) throw new Error(`empty description from ${model}`);
		return trimmed;
	};
	try {
		return await run(ASSET_DESCRIBE_MODEL);
	} catch (error) {
		console.log("[design-assets] describe model failed, falling back:", error);
		return run(ASSET_DESCRIBE_FALLBACK_MODEL);
	}
}

/** Loose asset id shape (Prisma cuid); hygiene only — queries are parameterized. */
const ASSET_ID_RE = /^[A-Za-z0-9_-]{10,40}$/;

export function isAssetId(value: string): boolean {
	return ASSET_ID_RE.test(value);
}
