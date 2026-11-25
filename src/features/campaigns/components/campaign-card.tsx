import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { CampaignSummary } from "@/client/api-types";
import { relativeTime } from "@/client/formatting";
import { useDeleteCampaign, useUpdateCampaign } from "@/client/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import {
	daysUntil,
	deriveCampaignHealthFromSummary,
	deriveLifecycle,
	HEALTH_LABELS,
	lifecycleBadge,
} from "@/features/campaigns/health";

/**
 * One campaign in a grid (dashboard home or project page). Actions live on
 * the card, mirroring ProjectCard in projects-list-page: rename, delete with
 * a cascade warning, and copy the public share link when one exists.
 * `fromPath` records the page this card lives on so the campaign's Back
 * button returns there (KUK-903).
 */
export function CampaignCard({
	campaign,
	projectName,
	showProject = true,
	fromPath,
}: {
	campaign: CampaignSummary;
	/** Resolved parent project name for the chip; falls back when unknown. */
	projectName?: string;
	showProject?: boolean;
	/** Origin path threaded into ?from= for the campaign detail route. */
	fromPath?: string;
}) {
	const updateCampaign = useUpdateCampaign();
	const deleteCampaign = useDeleteCampaign();
	const [editing, setEditing] = useState(false);
	const [name, setName] = useState(campaign.name);
	const [confirming, setConfirming] = useState(false);
	const [actionError, setActionError] = useState<string | null>(null);
	const [copiedShare, setCopiedShare] = useState(false);

	async function handleRename(event: React.FormEvent) {
		event.preventDefault();
		setActionError(null);
		try {
			await updateCampaign.mutateAsync({
				campaignId: campaign.id,
				name: name.trim(),
			});
			setEditing(false);
		} catch (e) {
			setActionError(e instanceof Error ? e.message : String(e));
		}
	}

	async function handleDelete() {
		// The backend cascade removes the campaign's messages, calendar
		// events, reports and plans; design assets stay filed in the project.
		await deleteCampaign.mutateAsync(campaign.id);
	}

	async function handleCopyShare() {
		setActionError(null);
		try {
			await navigator.clipboard.writeText(
				`${window.location.origin}/share/campaign/${campaign.shareSlug}`,
			);
			setCopiedShare(true);
		} catch (e) {
			setActionError(e instanceof Error ? e.message : String(e));
		}
	}

	return (
		<Card className="flex flex-col bg-card/50 backdrop-blur">
			<CardContent className="flex flex-1 flex-col gap-3 p-4">
				{editing ? (
					<form onSubmit={handleRename} className="space-y-2">
						<Input
							value={name}
							onChange={(e) => setName(e.target.value)}
							required
							maxLength={200}
							aria-label="Campaign name"
						/>
						<div className="flex gap-2">
							<Button
								type="submit"
								size="sm"
								disabled={updateCampaign.isPending}
							>
								Save
							</Button>
							<Button
								type="button"
								size="sm"
								variant="ghost"
								onClick={() => {
									setEditing(false);
									setName(campaign.name);
								}}
							>
								Cancel
							</Button>
						</div>
					</form>
				) : (
					<div className="flex items-start justify-between gap-2">
						<h3 className="min-w-0 truncate text-sm font-medium">
							<Link
								search={{ from: fromPath }}
								to="/campaigns/$id"
								params={{ id: campaign.id }}
								className="hover:underline outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
							>
								{campaign.name}
							</Link>
						</h3>
						<div className="flex shrink-0 gap-1">
							<Button
								type="button"
								variant="ghost"
								size="sm"
								onClick={() => setEditing(true)}
							>
								Rename
							</Button>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								className="text-destructive"
								onClick={() => setConfirming(true)}
							>
								Delete
							</Button>
						</div>
					</div>
				)}
				<ConfirmDialog
					description={`This permanently removes the campaign and its ${campaign.eventCount} scheduled post${campaign.eventCount === 1 ? "" : "s"}, reports and plans. Design assets stay filed in their project. This cannot be undone.`}
					onConfirm={handleDelete}
					onOpenChange={setConfirming}
					open={confirming}
					pending={deleteCampaign.isPending}
					title={`Delete campaign "${campaign.name}"?`}
				/>
				{campaign.briefPrompt && (
					<p className="line-clamp-2 text-xs text-muted-foreground">
						{campaign.briefPrompt}
					</p>
				)}
				<div className="flex flex-wrap items-center gap-2">
					{(() => {
						// KUK-979: raw chat-pipeline states (chatting/ready/failed) are
						// meaningless to marketers — show a derived lifecycle instead.
						const badge = lifecycleBadge(
							deriveLifecycle({
								status: campaign.status,
								targetEndDate: campaign.targetEndDate,
								eventCount: campaign.eventCount,
							}),
						);
						// KUK-982: derived triage state + why, from list-row health inputs.
						const health = deriveCampaignHealthFromSummary(campaign);
						const healthVariant =
							health.health === "off_track"
								? "destructive"
								: health.health === "on_track"
									? "default"
									: "outline";
						return (
							<>
								<Badge
									variant={badge.variant}
									title="Calculated from the campaign's dates, plan and calendar"
								>
									{badge.label}
								</Badge>
								<Badge
									variant={healthVariant}
									title={health.reasons.join(" ") || undefined}
								>
									{HEALTH_LABELS[health.health]}
								</Badge>
							</>
						);
					})()}
					{showProject && (
						<Link
							to="/projects/$id"
							params={{ id: campaign.projectId }}
							className="rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
						>
							<Badge variant="outline">{projectName ?? "Project"}</Badge>
						</Link>
					)}
					{campaign.shareSlug && (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={() => void handleCopyShare()}
						>
							{copiedShare ? "Copied!" : "Copy share link"}
						</Button>
					)}
				</div>
				{/* KUK-982: dates and the primary KPI in plain words — the numbers a
					marketer scans before opening the campaign. */}
				<div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
					{campaign.nextScheduledAt && (
						<span>
							{(() => {
								const days = daysUntil(campaign.nextScheduledAt);
								if (days < 0)
									return `Started ${relativeTime(campaign.nextScheduledAt)}`;
								if (days === 0) return "First post today";
								return `First post in ${days} day${days === 1 ? "" : "s"}`;
							})()}
						</span>
					)}
					{campaign.targetEndDate && (
						<span>
							Ends {new Date(campaign.targetEndDate).toISOString().slice(0, 10)}
						</span>
					)}
					{campaign.primaryKpi &&
						(campaign.primaryKpi.latestResult?.actualNumber != null ||
							campaign.primaryKpi.targetNumber != null) && (
							<span>
								{campaign.primaryKpi.name}:{" "}
								{campaign.primaryKpi.latestResult?.actualNumber != null
									? campaign.primaryKpi.latestResult.actualNumber.toLocaleString()
									: "—"}
								{campaign.primaryKpi.targetNumber != null &&
									` / ${campaign.primaryKpi.targetNumber.toLocaleString()}${campaign.primaryKpi.unit ? ` ${campaign.primaryKpi.unit}` : ""}`}
							</span>
						)}
					<span>
						{campaign.eventCount} scheduled post
						{campaign.eventCount === 1 ? "" : "s"}
					</span>
					<span title={`Created ${relativeTime(campaign.createdAt)}`}>
						{campaign.assetCount} asset{campaign.assetCount === 1 ? "" : "s"}
					</span>
				</div>
				{campaign.latestReportTitle && (
					<p className="truncate text-xs text-muted-foreground">
						Latest report: {campaign.latestReportTitle}
					</p>
				)}
				{actionError && (
					<p className="text-xs text-destructive">{actionError}</p>
				)}
			</CardContent>
		</Card>
	);
}
