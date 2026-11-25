"use client";

import { useRef, useState } from "react";
import type { DesignAsset } from "@/client/api-types";
import { cn } from "@/client/utils";
import { Button } from "@/components/ui/button";
import { SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { MAX_LIBRARY_ASSETS } from "@/features/design-studio/assets/design-assets";
import { ASSET_DRAG_TYPE, AssetThumb } from "./asset-chip";

/**
 * The design's asset library drawer: project-library assets + this design's
 * own. Attach into the composer, upload new files, write video
 * descriptions, and manage the library. Presentational — state and api
 * calls live in the parent (DesignChat) so the composer and drawer share
 * one copy of the data.
 */
export function StudioAssets({
	assets,
	isLoading,
	busy,
	onAttach,
	onUpload,
	onDescribe,
	onRetry,
	onDelete,
}: {
	assets: DesignAsset[];
	isLoading: boolean;
	/** True while a turn is streaming — attaching is disabled. */
	busy: boolean;
	onAttach: (asset: DesignAsset) => void;
	onUpload: (files: File[]) => void;
	onDescribe: (asset: DesignAsset, description: string) => void;
	onRetry: (asset: DesignAsset) => void;
	onDelete: (asset: DesignAsset) => void;
}) {
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [drafts, setDrafts] = useState<Record<string, string>>({});

	return (
		<div className="flex h-full flex-col">
			<div className="flex items-center justify-between border-b border-border px-4 py-3">
				<div>
					<SheetTitle className="text-sm font-semibold">Assets</SheetTitle>
					<SheetDescription className="text-xs text-muted-foreground">
						Attach reference images and videos to the chat
					</SheetDescription>
				</div>
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={assets.length >= MAX_LIBRARY_ASSETS}
					onClick={() => fileInputRef.current?.click()}
				>
					Upload
				</Button>
				<input
					ref={fileInputRef}
					type="file"
					accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml,video/mp4,video/webm,video/quicktime"
					multiple
					className="hidden"
					onChange={(e) => {
						const files = Array.from(e.target.files ?? []);
						e.target.value = "";
						if (files.length > 0) onUpload(files);
					}}
				/>
			</div>
			<div className="flex-1 overflow-y-auto p-4">
				{isLoading && (
					<p className="muted text-sm">
						<Spinner /> loading assets…
					</p>
				)}
				{!isLoading && assets.length === 0 && (
					<p className="text-sm text-muted-foreground">
						No assets yet. Upload images or videos to give the designer visual
						references.
					</p>
				)}
				<div className="grid grid-cols-1 gap-3">
					{assets.map((asset) => (
						<AssetCard
							key={asset.id}
							asset={asset}
							busy={busy}
							draft={drafts[asset.id] ?? ""}
							onDraft={(value) =>
								setDrafts((prev) => ({ ...prev, [asset.id]: value }))
							}
							onAttach={() => onAttach(asset)}
							onDescribe={() =>
								onDescribe(asset, (drafts[asset.id] ?? "").trim())
							}
							onRetry={() => onRetry(asset)}
							onDelete={() => onDelete(asset)}
						/>
					))}
				</div>
			</div>
		</div>
	);
}

function statusBadge(
	asset: DesignAsset,
): { label: string; tone: string } | null {
	switch (asset.descriptionStatus) {
		case "pending":
			return { label: "describing…", tone: "text-muted-foreground" };
		case "failed":
			return { label: "description failed", tone: "text-destructive" };
		case "needs_description":
			return { label: "needs description", tone: "text-amber-500" };
		case "manual":
			return { label: "your description", tone: "text-muted-foreground" };
		default:
			return null;
	}
}

function AssetCard({
	asset,
	busy,
	draft,
	onDraft,
	onAttach,
	onDescribe,
	onRetry,
	onDelete,
}: {
	asset: DesignAsset;
	busy: boolean;
	draft: string;
	onDraft: (value: string) => void;
	onAttach: () => void;
	onDescribe: () => void;
	onRetry: () => void;
	onDelete: () => void;
}) {
	const badge = statusBadge(asset);
	const needsDescription = asset.descriptionStatus === "needs_description";
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: HTML5 drag source; attach stays available as a button
		<div
			className="rounded-lg border border-border p-2"
			draggable
			onDragStart={(e) => e.dataTransfer.setData(ASSET_DRAG_TYPE, asset.id)}
		>
			<div className="flex gap-3">
				<AssetThumb asset={asset} className="h-16 w-24 shrink-0" />
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					<span className="truncate text-xs font-medium">{asset.filename}</span>
					<span className="text-[10px] text-muted-foreground">
						{asset.kind}
						{asset.width != null && asset.height != null
							? ` · ${asset.width}×${asset.height}`
							: ""}
						{asset.durationSec != null
							? ` · ${Math.round(asset.durationSec)}s`
							: ""}
					</span>
					{badge && (
						<span className={cn("text-[10px]", badge.tone)}>{badge.label}</span>
					)}
				</div>
			</div>
			{needsDescription && (
				<div className="mt-2 flex items-center gap-1">
					<input
						value={draft}
						onChange={(e) => onDraft(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								e.preventDefault();
								if (draft.trim()) onDescribe();
							}
						}}
						placeholder="Describe this video for the agent…"
						className="w-full min-w-0 rounded border border-border bg-background px-2 py-1 text-xs"
					/>
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={!draft.trim()}
						onClick={onDescribe}
					>
						Save
					</Button>
				</div>
			)}
			{asset.descriptionStatus === "failed" &&
				asset.contentType !== "image/svg+xml" && (
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="mt-2"
						onClick={onRetry}
					>
						Retry description
					</Button>
				)}
			<div className="mt-2 flex items-center justify-between">
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={busy || needsDescription}
					title={
						needsDescription
							? "Describe the video first"
							: busy
								? "Wait for the current turn"
								: `Attach ${asset.filename}`
					}
					onClick={onAttach}
				>
					＋ Attach
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="text-muted-foreground hover:text-destructive"
					onClick={onDelete}
				>
					Delete
				</Button>
			</div>
		</div>
	);
}
