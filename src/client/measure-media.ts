// Client-side media measuring for design asset uploads: dimensions for
// images, dimensions + duration for videos. Read before upload so the
// server stores metadata without any codec work.

export type MediaMeta = {
	width?: number;
	height?: number;
	durationSec?: number;
};

export async function measureMedia(file: File): Promise<MediaMeta> {
	if (file.type.startsWith("image/")) {
		if (file.type === "image/svg+xml") return {};
		try {
			const bitmap = await createImageBitmap(file);
			const meta = { width: bitmap.width, height: bitmap.height };
			bitmap.close();
			return meta;
		} catch {
			// decode failure shouldn't block the upload — metadata is optional
			return {};
		}
	}
	if (file.type.startsWith("video/")) {
		return measureVideo(file);
	}
	return {};
}

function measureVideo(file: File): Promise<MediaMeta> {
	return new Promise((resolve) => {
		const url = URL.createObjectURL(file);
		const video = document.createElement("video");
		video.preload = "metadata";
		video.muted = true;
		let settled = false;
		const done = (meta: MediaMeta) => {
			if (settled) return;
			settled = true;
			URL.revokeObjectURL(url);
			resolve(meta);
		};
		video.onloadedmetadata = () =>
			done({
				width: video.videoWidth || undefined,
				height: video.videoHeight || undefined,
				durationSec:
					Number.isFinite(video.duration) && video.duration > 0
						? video.duration
						: undefined,
			});
		video.onerror = () => done({});
		// Don't hang the upload on a file the browser can't decode.
		setTimeout(() => done({}), 4000);
		video.src = url;
	});
}
