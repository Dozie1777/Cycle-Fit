import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type {
	CalendarEventEntry,
	CampaignAssetSummary,
} from "@/client/api-types";
import {
	useAttachCampaignEventAsset,
	useCampaignAssets,
} from "@/client/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Absolute link base — asset sites are same-origin. */
function siteOrigin(): string {
	return globalThis.location?.origin ?? "";
}

const dayLabelFormatter = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
	timeZone: "UTC",
});

function shortDate(iso: string | null): string {
	if (!iso) return "unscheduled";
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "unscheduled";
	return dayLabelFormatter.format(date);
}

function AssetCard({
	campaignId,
	asset,
	events,
}: {
	campaignId: string;
	asset: CampaignAssetSummary;
	events: CalendarEventEntry[];
}) {
	const attach = useAttachCampaignEventAsset(campaignId);
	const [eventId, setEventId] = useState("");
	const [error, setError] = useState<string | null>(null);
	const attachedEvent = events.find((event) => event.assetId === asset.id);
	const openSlots = events.filter(
		(event) => event.assetId === null || event.assetId === asset.id,
	);

	async function handleAttach(): Promise<void> {
		if (!eventId) return;
		setError(null);
		try {
			await attach.mutateAsync({ eventId, assetId: asset.id });
		} catch (e) {
			setError(errorMessage(e));
		}
	}

	async function handleDetach(): Promise<void> {
		if (!attachedEvent) return;
		setError(null);
		try {
			await attach.mutateAsync({ eventId: attachedEvent.id, assetId: null });
		} catch (e) {
			setError(errorMessage(e));
		}
	}

	async function copyPublicLink(): Promise<void> {
		setError(null);
		try {
			await navigator.clipboard?.writeText(
				`${siteOrigin()}/designs/${asset.id}/site`,
			);
		} catch (e) {
			setError(errorMessage(e));
		}
	}

	return (
		<div className="flex flex-col overflow-hidden rounded-lg border bg-card/50">
			<Link
				to="/studio/$id"
				params={{ id: asset.id }}
				className="block border-b bg-muted/30"
				aria-label={`Open ${asset.prompt || asset.id} in studio`}
			>
				<img
					src={`/designs/${asset.id}/preview`}
					alt=""
					loading="lazy"
					className="aspect-video w-full object-cover"
				/>
			</Link>
			<div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
				<p className="line-clamp-2 text-sm font-medium">
					{asset.prompt || "Untitled asset"}
				</p>
				{/* KUK-985: the raw agent prompt is plumbing, not the deliverable —
					keep the card readable and offer the full prompt on demand. */}
				{asset.prompt && (
					<details className="text-xs text-muted-foreground">
						<summary className="cursor-pointer select-none hover:text-foreground">
							View prompt
						</summary>
						<p className="mt-1 line-clamp-6 whitespace-pre-wrap">
							{asset.prompt}
						</p>
					</details>
				)}
				<div className="flex flex-wrap items-center gap-1.5">
					<Badge variant={asset.published ? "default" : "outline"}>
						{asset.published ? "Published" : "Draft"}
					</Badge>
					{attachedEvent && (
						<Badge variant="secondary">
							Scheduled {shortDate(attachedEvent.scheduledAt)}
							{(attachedEvent.linkedChannel?.name ?? attachedEvent.channel) &&
								` · ${attachedEvent.linkedChannel?.name ?? attachedEvent.channel}`}
						</Badge>
					)}
				</div>
				<div className="mt-auto space-y-2">
					<div className="flex flex-wrap gap-1.5">
						<Button type="button" variant="outline" size="sm" asChild>
							<Link to="/studio/$id" params={{ id: asset.id }}>
								Open in studio
							</Link>
						</Button>
						{/* Present route ships with KUK-877 — placeholder for now. */}
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled
							title="Present view is coming soon"
						>
							Present
						</Button>
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={!asset.published}
							title={
								asset.published
									? "Copy the public site link"
									: "Publish the asset in the studio to get a public link"
							}
							onClick={() => void copyPublicLink()}
						>
							Copy public link
						</Button>
					</div>
					{attachedEvent ? (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="h-7 px-2 text-destructive"
							onClick={() => void handleDetach()}
						>
							Detach from {shortDate(attachedEvent.scheduledAt)}
						</Button>
					) : (
						openSlots.length > 0 && (
							<div className="flex items-center gap-1.5">
								<select
									aria-label={`Attach ${asset.prompt || asset.id} to a calendar date`}
									title="Pin this asset to a scheduled post so it shows up on that day"
									value={eventId}
									onChange={(e) => setEventId(e.target.value)}
									className="h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-xs shadow-xs outline-none"
								>
									<option value="">Attach to a date…</option>
									{openSlots.map((event) => (
										<option key={event.id} value={event.id}>
											{shortDate(event.scheduledAt)} — {event.title}
										</option>
									))}
								</select>
								<Button
									type="button"
									variant="outline"
									size="sm"
									disabled={eventId === "" || attach.isPending}
									onClick={() => void handleAttach()}
								>
									Attach
								</Button>
							</div>
						)
					)}
					{error && <p className="text-xs text-destructive">{error}</p>}
				</div>
			</div>
		</div>
	);
}

/**
 * Asset gallery: every design filed into the campaign (GET
 * /campaigns/:id/assets). Preview thumbnails link to the design studio;
 * slots can be attached to calendar events right here via the event PATCH
 * route, and published assets expose their public /designs/:id/site link.
 */
export function CampaignAssetGallery({
	campaignId,
	events,
	onOpenStudio,
}: {
	campaignId: string;
	events: CalendarEventEntry[];
	onOpenStudio: (tab?: "brief" | "plan" | "calendar" | "reports") => void;
}) {
	const assetsQuery = useCampaignAssets(campaignId);

	return (
		<section aria-label="Assets">
			<div className="mb-2 flex items-center justify-between">
				<h2 className="text-sm font-semibold">Assets</h2>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onClick={() => onOpenStudio("brief")}
				>
					Ask the agent
				</Button>
			</div>
			{assetsQuery.isPending ? (
				<p className="text-sm text-muted-foreground">Loading assets…</p>
			) : assetsQuery.error ? (
				<p className="text-sm text-destructive">
					Failed to load assets: {errorMessage(assetsQuery.error)}
				</p>
			) : !assetsQuery.data || assetsQuery.data.length === 0 ? (
				<div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
					No assets yet — ask the agent in the studio to create the first post,
					email or landing page for this campaign.
					<div className="mt-2">
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => onOpenStudio("brief")}
						>
							Open studio
						</Button>
					</div>
				</div>
			) : (
				<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
					{assetsQuery.data.map((asset) => (
						<AssetCard
							key={asset.id}
							campaignId={campaignId}
							asset={asset}
							events={events}
						/>
					))}
				</div>
			)}
		</section>
	);
}
