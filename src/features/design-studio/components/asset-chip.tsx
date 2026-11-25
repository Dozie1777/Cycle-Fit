"use client";

import { useState } from "react";
import type { DesignAsset, DesignChatAssetRef } from "@/client/api-types";
import { cn } from "@/client/utils";

/** dataTransfer type used when dragging an asset from the drawer into the composer. */
export const ASSET_DRAG_TYPE = "application/x-design-asset";

/**
 * Small inline preview of an asset: real thumbnail for images, a muted
 * metadata frame for videos. Falls back to a letter chip when the file
 * can't render.
 */
export function AssetThumb({
	asset,
	className,
}: {
	asset: Pick<DesignChatAssetRef, "kind" | "filename" | "url">;
	className?: string;
}) {
	const [failed, setFailed] = useState(false);
	if (failed) {
		return (
			<span
				className={cn(
					"flex items-center justify-center rounded-md bg-muted text-xs text-muted-foreground",
					className,
				)}
				title={asset.filename}
			>
				{asset.kind === "video" ? "▶" : "🖼"}
			</span>
		);
	}
	if (asset.kind === "video") {
		return (
			<video
				src={asset.url}
				muted
				playsInline
				preload="metadata"
				onError={() => setFailed(true)}
				className={cn("rounded-md object-cover", className)}
			/>
		);
	}
	return (
		<img
			src={asset.url}
			alt={asset.filename}
			onError={() => setFailed(true)}
			className={cn("rounded-md object-cover", className)}
		/>
	);
}

function statusLabel(asset: DesignAsset): string | null {
	if (asset.descriptionStatus === "pending") return "describing…";
	if (asset.descriptionStatus === "failed") return "description failed";
	return null;
}

/**
 * Composer attachment chip. A video still missing its description shows an
 * inline input (sending is blocked until it's filled); failed
 * auto-descriptions show a retry hint via the assets drawer. Saving routes
 * through the parent's `onDescribe` so the shared asset state refreshes and
 * sending unblocks.
 */
export function AssetChip({
	asset,
	onRemove,
	onDescribe,
}: {
	asset: DesignAsset;
	onRemove: () => void;
	onDescribe: (description: string) => void;
}) {
	const [draft, setDraft] = useState("");
	const needsDescription = asset.descriptionStatus === "needs_description";

	const submitDescription = () => {
		const value = draft.trim();
		if (!value) return;
		onDescribe(value);
		setDraft("");
	};

	return (
		<div className="group relative flex items-start gap-2 rounded-lg border border-border bg-muted/50 p-2">
			<AssetThumb asset={asset} className="h-10 w-14 shrink-0" />
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<div className="flex items-center gap-2">
					<span className="truncate text-xs font-medium">{asset.filename}</span>
					{statusLabel(asset) && (
						<span className="shrink-0 text-[10px] text-muted-foreground">
							{statusLabel(asset)}
						</span>
					)}
				</div>
				{needsDescription && (
					<div className="flex items-center gap-1">
						<input
							value={draft}
							onChange={(e) => setDraft(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter") {
									e.preventDefault();
									submitDescription();
								}
							}}
							placeholder="Describe this video for the agent…"
							className="w-full min-w-0 rounded border border-border bg-background px-2 py-1 text-xs"
						/>
						<button
							type="button"
							onClick={submitDescription}
							disabled={!draft.trim()}
							className="shrink-0 rounded bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50"
						>
							Save
						</button>
					</div>
				)}
			</div>
			<button
				type="button"
				onClick={onRemove}
				aria-label={`Remove ${asset.filename} from the message`}
				className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background text-xs text-muted-foreground hover:text-foreground"
			>
				✕
			</button>
		</div>
	);
}
