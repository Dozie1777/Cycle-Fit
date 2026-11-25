// Design preview rendering via Cloudflare Browser Rendering — no container
// involved. The chat model publishes an HTML document (see design-chat.ts);
// this renders it in a real browser and returns a full-page PNG.
import { launch } from "@cloudflare/playwright";

/** Viewport for the full-page design screenshot (matches the old sandbox brief). */
export const DESIGN_VIEWPORT = { width: 1440, height: 900 } as const;

/**
 * Renders one self-contained HTML document to a full-page PNG screenshot.
 * The browser session is short-lived: launch, render, close — Browser
 * Rendering only bills for the seconds it is alive.
 */
export async function renderDesignPreview(
	browser: Parameters<typeof launch>[0],
	html: string,
): Promise<Uint8Array> {
	const instance = await launch(browser);
	try {
		const page = await instance.newPage({
			viewport: DESIGN_VIEWPORT,
		});
		// The design HTML is self-contained (no external assets by contract),
		// so "load" is the honest wait condition.
		await page.setContent(html, { waitUntil: "load" });
		const shot = await page.screenshot({ fullPage: true });
		return new Uint8Array(shot);
	} finally {
		await instance.close();
	}
}
