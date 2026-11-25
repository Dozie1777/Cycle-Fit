// Multipart upload for design reference assets (KUK-864). This is the one
// admin call that stays outside tRPC — file bodies don't fit the JSON
// batch protocol. Same-origin, so the admin session cookie rides along.

import type { DesignAsset } from "./api-types";

export async function uploadDesignAsset(
	projectId: string,
	file: File,
	meta: { width?: number; height?: number; durationSec?: number },
): Promise<DesignAsset> {
	const form = new FormData();
	form.append("file", file);
	if (meta.width != null) form.append("width", String(Math.round(meta.width)));
	if (meta.height != null)
		form.append("height", String(Math.round(meta.height)));
	if (meta.durationSec != null)
		form.append("durationSec", String(meta.durationSec));
	const res = await fetch(`/designs/${projectId}/assets`, {
		method: "POST",
		body: form,
	});
	if (!res.ok) {
		let message = `HTTP ${res.status}`;
		try {
			const body = (await res.json()) as { error?: string };
			if (body.error) message = body.error;
		} catch {
			// non-JSON body — keep the status message
		}
		throw new Error(message);
	}
	return (await res.json()) as DesignAsset;
}
