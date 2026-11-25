import { useEffect, useMemo, useState } from "react";
import type {
	CalendarEventEntry,
	CampaignAssetSummary,
} from "@/client/api-types";
import { Button } from "@/components/ui/button";

/**
 * Present runner (KUK-877): chains a campaign's PUBLISHED assets full-screen
 * — each one served from its public /designs/:id/site endpoint inside a
 * CSP-sandboxed iframe, exactly like the share page sees it. A slim bottom
 * bar switches assets and carries the keyboard hints; Esc exits back to the
 * dashboard. Keys inside the iframe are consumed by the asset (decks
 * navigate their own slides); the parent frame handles the same keys for
 * asset-to-asset navigation, so the bar's prev/next buttons stay the
 * reliable fallback.
 */

/** Keyboard map: which runner step a key triggers. Pure — unit-testable. */
export function keyStep(
	key: string,
): "next" | "prev" | "first" | "last" | "exit" | null {
	switch (key) {
		case "ArrowRight":
		case "ArrowDown":
		case "PageDown":
		case " ":
			return "next";
		case "ArrowLeft":
		case "ArrowUp":
		case "PageUp":
			return "prev";
		case "Home":
			return "first";
		case "End":
			return "last";
		case "Escape":
			return "exit";
		default:
			return null;
	}
}

/**
 * Presentation order: when calendar events carry asset attachments, attached
 * assets lead in scheduledAt order (unscheduled slots last) and the rest
 * follow in assets-list order; with no attachments the assets-list order
 * (newest first) stands alone. Drafts never enter the chain.
 */
export function orderPresentAssets(
	assets: CampaignAssetSummary[],
	events: CalendarEventEntry[],
): CampaignAssetSummary[] {
	const published = assets.filter((asset) => asset.published);
	const schedule = new Map<string, string | null>();
	for (const event of events) {
		if (event.assetId != null && !schedule.has(event.assetId)) {
			schedule.set(event.assetId, event.scheduledAt);
		}
	}
	if (schedule.size === 0) return published;
	const attached = published.filter((asset) => schedule.has(asset.id));
	const rest = published.filter((asset) => !schedule.has(asset.id));
	attached.sort((a, b) => {
		const aAt = schedule.get(a.id);
		const bAt = schedule.get(b.id);
		if (!aAt && !bAt) return 0;
		if (!aAt) return 1;
		if (!bAt) return -1;
		return aAt.localeCompare(bAt);
	});
	return [...attached, ...rest];
}

/** Short bar label for an asset: first line of its prompt. */
function assetLabel(asset: CampaignAssetSummary): string {
	const line = asset.prompt.split("\n")[0]?.trim() || "Untitled asset";
	return line.length <= 48 ? line : `${line.slice(0, 47)}…`;
}

function clampIndex(index: number, count: number): number {
	if (count <= 0) return 0;
	return Math.min(Math.max(index, 0), count - 1);
}

export function CampaignPresentRunner({
	assets,
	events,
	onExit,
}: {
	assets: CampaignAssetSummary[];
	events: CalendarEventEntry[];
	/** Esc / Exit — back to the campaign dashboard. */
	onExit: () => void;
}) {
	const chain = useMemo(
		() => orderPresentAssets(assets, events),
		[assets, events],
	);
	const [index, setIndex] = useState(0);
	const current = chain[clampIndex(index, chain.length)];

	useEffect(() => {
		if (typeof window === "undefined") return;
		function onKey(event: KeyboardEvent) {
			const step = keyStep(event.key);
			if (!step) return;
			if (step === "exit") {
				onExit();
				return;
			}
			event.preventDefault();
			setIndex((cur) => {
				switch (step) {
					case "next":
						return clampIndex(cur + 1, chain.length);
					case "prev":
						return clampIndex(cur - 1, chain.length);
					case "first":
						return 0;
					case "last":
						return chain.length - 1;
					default:
						return cur;
				}
			});
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [chain.length, onExit]);

	if (chain.length === 0) {
		return (
			<div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background p-6 text-center">
				<p className="text-lg font-semibold">Nothing to present yet</p>
				<p className="max-w-md text-sm text-muted-foreground">
					Present chains this campaign's published assets. Publish an asset from
					its studio first, then come back.
				</p>
				<Button type="button" onClick={onExit}>
					Back to dashboard
				</Button>
			</div>
		);
	}

	const first = index <= 0;
	const last = index >= chain.length - 1;

	return (
		<div className="fixed inset-0 z-50 flex flex-col bg-black">
			{/* One asset at a time; key forces a fresh frame per asset. */}
			<div className="min-h-0 flex-1">
				<iframe
					key={current.id}
					src={`/designs/${current.id}/site`}
					title={assetLabel(current)}
					sandbox="allow-scripts allow-forms allow-popups"
					className="h-full w-full border-0 bg-white"
				/>
			</div>
			<nav
				aria-label="Present navigation"
				className="flex flex-wrap items-center gap-2 border-t border-white/10 bg-black/90 px-3 py-2 text-white"
			>
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={first}
					onClick={() => setIndex((cur) => clampIndex(cur - 1, chain.length))}
					aria-label="Previous asset"
				>
					Prev
				</Button>
				<span className="text-xs tabular-nums text-white/70">
					{index + 1} / {chain.length}
				</span>
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={last}
					onClick={() => setIndex((cur) => clampIndex(cur + 1, chain.length))}
					aria-label="Next asset"
				>
					Next
				</Button>
				<div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
					{chain.map((asset, position) => (
						<button
							key={asset.id}
							type="button"
							aria-current={position === index}
							onClick={() => setIndex(position)}
							className={`max-w-48 truncate rounded px-2 py-1 text-xs outline-none ${
								position === index
									? "bg-white/15 text-white"
									: "text-white/60 hover:bg-white/10 hover:text-white"
							}`}
						>
							{assetLabel(asset)}
						</button>
					))}
				</div>
				<kbd className="hidden rounded border border-white/20 px-1.5 py-0.5 text-[10px] text-white/60 sm:inline">
					←/→ assets
				</kbd>
				<kbd className="hidden rounded border border-white/20 px-1.5 py-0.5 text-[10px] text-white/60 sm:inline">
					Esc exit
				</kbd>
				<Button type="button" variant="outline" size="sm" onClick={onExit}>
					Exit
				</Button>
			</nav>
		</div>
	);
}
