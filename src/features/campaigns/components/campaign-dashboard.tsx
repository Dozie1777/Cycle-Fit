import { Link } from "@tanstack/react-router";
import { MegaphoneIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { CampaignDetail } from "@/client/api-types";
import { relativeTime } from "@/client/formatting";
import {
	useGenerateCampaignShare,
	useProject,
	useRevokeCampaignShare,
	useRotateCampaignShare,
	useUpdateCampaign,
} from "@/client/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	daysUntil,
	deriveCampaignHealth,
	deriveLifecycle,
	lifecycleBadge,
} from "@/features/campaigns/health";
import { CampaignActionQueue } from "./campaign-action-queue";
import { CampaignActivityFeed } from "./campaign-activity-feed";
import { CampaignAssetGallery } from "./campaign-asset-gallery";
import { CampaignCalendarStrip } from "./campaign-calendar-strip";
import { CampaignOverviewStrip } from "./campaign-overview-strip";
import { CampaignPlanTimeline } from "./campaign-plan-timeline";

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Absolute link base — the share page is same-origin. */
function siteOrigin(): string {
	return globalThis.location?.origin ?? "";
}

function shortDate(iso: string | null): string {
	if (!iso) return "";
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "";
	return date.toISOString().slice(0, 10);
}

function shareStateLine(detail: CampaignDetail): string {
	if (detail.shareSlug) {
		return "Shared — anyone with the link can view this campaign.";
	}
	if (detail.shareRevokedAt) {
		return `Sharing revoked ${shortDate(detail.shareRevokedAt)} — links are dead until you share again.`;
	}
	return "Not shared — generate a link to let people follow along.";
}

/**
 * Campaign control tower header: breadcrumb to the parent project, inline
 * rename, status, the share menu (KUK-872 routes), a Present link into the
 * full-screen runner (KUK-877) and the switch into the studio workspace.
 */
function DashboardHeader({
	detail,
	onOpenStudio,
	onClose,
}: {
	detail: CampaignDetail;
	onOpenStudio: () => void;
	onClose: () => void;
}) {
	const updateCampaign = useUpdateCampaign();
	const generateShare = useGenerateCampaignShare(detail.id);
	const rotateShare = useRotateCampaignShare(detail.id);
	const revokeShare = useRevokeCampaignShare(detail.id);
	const { data: project } = useProject(detail.projectId);
	const [editing, setEditing] = useState(false);
	const [name, setName] = useState(detail.name);
	const [targetEndDate, setTargetEndDate] = useState(
		detail.targetEndDate ? detail.targetEndDate.slice(0, 10) : "",
	);
	const [menuOpen, setMenuOpen] = useState(false);
	const [actionError, setActionError] = useState<string | null>(null);

	useEffect(() => {
		setName(detail.name);
		setTargetEndDate(
			detail.targetEndDate ? detail.targetEndDate.slice(0, 10) : "",
		);
	}, [detail.name, detail.targetEndDate]);

	async function runShare(action: () => Promise<unknown>): Promise<void> {
		setActionError(null);
		try {
			await action();
			setMenuOpen(false);
		} catch (e) {
			setActionError(errorMessage(e));
		}
	}

	async function copyShareLink(): Promise<void> {
		if (!detail.shareSlug) return;
		setActionError(null);
		try {
			await navigator.clipboard?.writeText(
				`${siteOrigin()}/share/campaign/${detail.shareSlug}`,
			);
			setMenuOpen(false);
		} catch (e) {
			setActionError(errorMessage(e));
		}
	}

	async function handleRename(event: React.FormEvent): Promise<void> {
		event.preventDefault();
		setActionError(null);
		try {
			await updateCampaign.mutateAsync({
				campaignId: detail.id,
				name: name.trim(),
			});
			setEditing(false);
		} catch (e) {
			setActionError(errorMessage(e));
		}
	}

	if (editing) {
		return (
			<form
				onSubmit={handleRename}
				className="flex flex-wrap items-center gap-2 border-b px-4 py-3"
			>
				<Input
					value={name}
					onChange={(e) => setName(e.target.value)}
					required
					maxLength={200}
					aria-label="Campaign name"
					className="max-w-sm"
				/>
				<Button type="submit" size="sm" disabled={updateCampaign.isPending}>
					{updateCampaign.isPending ? "Saving…" : "Save"}
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onClick={() => {
						setEditing(false);
						setName(detail.name);
					}}
				>
					Cancel
				</Button>
				{actionError && (
					<p className="text-sm text-destructive">{actionError}</p>
				)}
			</form>
		);
	}

	return (
		<div className="border-b px-4 py-3">
			<div className="flex flex-wrap items-center gap-2">
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={onClose}
					aria-label="Back to campaigns"
				>
					Back
				</Button>
				<nav
					aria-label="Breadcrumb"
					className="flex min-w-0 items-center gap-1 text-sm"
				>
					{project ? (
						<Link
							to="/projects/$id"
							params={{ id: detail.projectId }}
							className="truncate text-muted-foreground hover:underline"
						>
							{project.name}
						</Link>
					) : (
						<span className="truncate text-muted-foreground">Project</span>
					)}
					<span aria-hidden className="text-muted-foreground/60">
						/
					</span>
				</nav>
				<h1 className="truncate text-sm font-semibold">{detail.name}</h1>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onClick={() => setEditing(true)}
					aria-label="Rename campaign"
				>
					Rename
				</Button>
				<div className="flex items-center gap-2">
					<span className="text-xs text-muted-foreground">Target end</span>
					<Input
						type="date"
						value={targetEndDate}
						onChange={(e) => setTargetEndDate(e.target.value)}
						onBlur={async () => {
							setActionError(null);
							try {
								await updateCampaign.mutateAsync({
									campaignId: detail.id,
									targetEndDate: targetEndDate
										? `${targetEndDate}T00:00:00.000Z`
										: null,
								});
							} catch (e) {
								setActionError(errorMessage(e));
							}
						}}
						className="h-7 w-auto px-2 text-xs"
						aria-label="Target end date"
					/>
				</div>
				{(() => {
					// KUK-979: derived lifecycle label, not the raw chat-pipeline state.
					const badge = lifecycleBadge(
						deriveLifecycle({
							status: detail.status,
							targetEndDate: detail.targetEndDate,
							eventCount: detail.events.length,
						}),
					);
					return (
						<Badge
							variant={badge.variant}
							title="Calculated from the campaign's dates, plan and calendar"
						>
							{badge.label}
						</Badge>
					);
				})()}
				<span
					className="text-xs text-muted-foreground"
					title={`Last refreshed from the server`}
				>
					Updated {relativeTime(detail.updatedAt)}
				</span>
				<div className="ml-auto flex flex-wrap items-center gap-2">
					{/* Present runner (KUK-877) chains the published assets. */}
					<Button type="button" variant="outline" size="sm" asChild>
						<Link
							to="/campaigns/$id/present"
							params={{ id: detail.id }}
							title="Present your published campaign assets to stakeholders"
						>
							Present
						</Link>
					</Button>
					<div className="relative">
						<Button
							type="button"
							variant="outline"
							size="sm"
							aria-haspopup="menu"
							aria-expanded={menuOpen}
							onClick={() => setMenuOpen((prev) => !prev)}
						>
							Share
						</Button>
						{menuOpen && (
							<div
								role="menu"
								className="absolute right-0 z-20 mt-1 w-72 space-y-1 rounded-md border bg-popover p-2 text-popover-foreground shadow-md"
							>
								<p className="px-1 text-xs text-muted-foreground">
									{shareStateLine(detail)}
								</p>
								{detail.shareSlug && detail.shareSlug !== "" ? (
									<>
										<Button
											type="button"
											variant="ghost"
											size="sm"
											className="w-full justify-start"
											onClick={() => void copyShareLink()}
										>
											Copy public link
										</Button>
										<Button
											type="button"
											variant="ghost"
											size="sm"
											className="w-full justify-start"
											onClick={() =>
												void runShare(() => rotateShare.mutateAsync())
											}
										>
											Rotate link
										</Button>
										<Button
											type="button"
											variant="ghost"
											size="sm"
											className="w-full justify-start text-destructive"
											onClick={() =>
												void runShare(() => revokeShare.mutateAsync())
											}
										>
											Revoke sharing
										</Button>
									</>
								) : (
									<Button
										type="button"
										variant="ghost"
										size="sm"
										className="w-full justify-start"
										onClick={() =>
											void runShare(() => generateShare.mutateAsync())
										}
									>
										Generate share link
									</Button>
								)}
							</div>
						)}
					</div>
					<Button
						type="button"
						size="sm"
						onClick={onOpenStudio}
						title="Work with the agent to edit the brief, plan, calendar and reports"
					>
						Open studio
					</Button>
				</div>
			</div>
			{detail.error && (
				<p className="mt-1 truncate text-xs text-destructive">{detail.error}</p>
			)}
			{actionError && !editing && (
				<p className="mt-1 text-xs text-destructive">{actionError}</p>
			)}
		</div>
	);
}

/**
 * Campaign control tower (KUK-875): the read-mostly overview the campaign
 * detail route lands on. Every zone renders from the same detail payload /
 * routes the studio and agent tools write, so quick edits made here show up
 * in the studio without a reload.
 */
/**
 * Guided-home hero (KUK-987): one plain-language sentence answering "how am
 * I doing?", plus a single next-action CTA with a one-line why. Derives
 * everything from the health engine so it can never contradict the badges.
 */
function CampaignStatusHero({
	detail,
	onOpenStudio,
}: {
	detail: CampaignDetail;
	onOpenStudio: (tab?: "brief" | "plan" | "calendar" | "reports") => void;
}) {
	const health = deriveCampaignHealth(detail);

	// Days until the first upcoming scheduled item (the "launch" signal).
	const upcoming = detail.events
		.map((event) => event.scheduledAt)
		.filter((at): at is string => at != null)
		.sort();
	const launchDays = upcoming.length > 0 ? daysUntil(upcoming[0]) : null;

	// Current phase of the current plan (same preference as the timeline).
	const finalPlans = detail.plans.filter((plan) => plan.status === "final");
	const pool = finalPlans.length > 0 ? finalPlans : detail.plans;
	const currentPlan =
		pool.length > 0
			? [...pool].sort(
					(a, b) =>
						new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
				)[0]
			: null;
	const nowMs = Date.now();
	const activePhase = currentPlan?.phases.find((phase) => {
		const start = phase.startsAt ? new Date(phase.startsAt).getTime() : null;
		const end = phase.endsAt ? new Date(phase.endsAt).getTime() : null;
		return (start === null || start <= nowMs) && (end === null || end >= nowMs);
	});

	// Sentence: launch → phase → attention points. Always plain words.
	const parts: string[] = [];
	if (launchDays !== null && launchDays > 0) {
		parts.push(`launches in ${launchDays} day${launchDays === 1 ? "" : "s"}`);
	} else if (launchDays !== null) {
		parts.push("is already out in the world");
	}
	if (activePhase && currentPlan) {
		parts.push(
			`you're in phase ${activePhase.position + 1} of ${currentPlan.phases.length} (${activePhase.name})`,
		);
	}
	if (health.draftEventCount > 0) {
		parts.push(
			`${health.draftEventCount} item${health.draftEventCount === 1 ? "" : "s"} still need${health.draftEventCount === 1 ? "s" : ""} approval`,
		);
	}
	if (health.pendingKpiCount > 0 && detail.kpis.length > 0) {
		parts.push(
			`${health.pendingKpiCount} KPI${health.pendingKpiCount === 1 ? "" : "s"} have no result recorded yet`,
		);
	}
	if (health.health === "off_track") {
		// The engine already wrote the why (failed turn / missed targets near
		// the deadline) — lead with it instead of a success sentence.
		parts.unshift(...health.reasons);
	} else if (parts.length === 0) {
		// Structural parts ran dry but the engine still has something to say
		// (missed/partial results on a needs_input campaign, ending-soon
		// countdown, …) — surface it rather than claiming all is well.
		parts.push(
			health.reasons[0] ??
				(health.health === "on_track"
					? "everything is on schedule"
					: "needs your attention"),
		);
	}

	// One next action, most urgent first.
	let cta: { label: string; why: string; tab: "plan" | "calendar" | "reports" };
	if (health.health === "off_track") {
		cta = {
			label: "See what's off track",
			why:
				health.reasons[0] ?? "Check the latest results to decide next steps.",
			tab: "reports",
		};
	} else if (health.draftEventCount > 0) {
		cta = {
			label: `Review ${health.draftEventCount} draft item${health.draftEventCount === 1 ? "" : "s"}`,
			why: "Drafts need approval before they can go out on their date.",
			tab: "calendar",
		};
	} else if (health.pendingKpiCount > 0 && detail.kpis.length > 0) {
		cta = {
			label: "Record your first KPI results",
			why: "Actuals turn the targets into progress you and stakeholders can see.",
			tab: "reports",
		};
	} else if (!detail.plans.some((plan) => plan.status === "final")) {
		cta = {
			label: "Finalize the plan",
			why: "A final plan marks this campaign as ready to execute.",
			tab: "plan",
		};
	} else {
		cta = {
			label: "Check the latest report",
			why: "Reports recap what moved and what to do next.",
			tab: "reports",
		};
	}

	return (
		<section
			aria-label="Campaign status"
			className="rounded-xl border bg-card/50 p-4 sm:p-5"
		>
			<p className="text-sm sm:text-base">
				<b className="font-semibold">{detail.name}</b> {parts.join("; ")}.
			</p>
			<div className="mt-3 flex flex-wrap items-center gap-3">
				<Button type="button" size="sm" onClick={() => onOpenStudio(cta.tab)}>
					{cta.label} →
				</Button>
				<span className="text-xs text-muted-foreground">{cta.why}</span>
			</div>
		</section>
	);
}

export function CampaignDashboard({
	detail,
	onOpenStudio,
	onClose,
}: {
	detail: CampaignDetail;
	/** Switch into the studio workspace, optionally opening a document tab. */
	onOpenStudio: (tab?: "brief" | "plan" | "calendar" | "reports") => void;
	/** Back to the campaigns list. */
	onClose: () => void;
}) {
	const campaignIsEmpty =
		!detail.brief &&
		detail.plans.length === 0 &&
		detail.events.length === 0 &&
		detail.reports.length === 0;
	// KUK-993: one derivation feeds the alert banner (and matches the hero).
	const health = deriveCampaignHealth(detail);

	return (
		<div className="flex min-h-screen flex-col bg-background">
			<DashboardHeader
				detail={detail}
				onOpenStudio={() => onOpenStudio("brief")}
				onClose={onClose}
			/>
			{campaignIsEmpty ? (
				<div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
					<div className="rounded-full border border-border bg-card p-3 text-muted-foreground">
						<MegaphoneIcon className="size-5" aria-hidden="true" />
					</div>
					<div className="space-y-1">
						<h2 className="text-lg font-semibold">
							Start by briefing the agent
						</h2>
						<p className="text-sm text-muted-foreground">
							Open the studio and describe the campaign - the agent drafts the
							brief, plan, calendar and reports from there. Everything it
							produces lands back on this dashboard.
						</p>
					</div>
					<Button type="button" onClick={() => onOpenStudio("brief")}>
						Open studio and brief the agent
					</Button>
					{detail.briefPrompt && (
						<p className="max-w-md text-xs text-muted-foreground">
							Seeded prompt: &ldquo;{detail.briefPrompt}&rdquo;
						</p>
					)}
				</div>
			) : (
				<div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6">
					{health.health === "off_track" && (
						<div
							role="alert"
							className="rounded-xl border border-destructive/30 bg-destructive/10 p-4"
						>
							<p className="text-sm font-semibold text-destructive">
								This campaign is off track
							</p>
							<p className="mt-1 text-xs text-destructive/80">
								{health.reasons.join(" ")}
							</p>
						</div>
					)}
					<CampaignStatusHero detail={detail} onOpenStudio={onOpenStudio} />
					<CampaignActionQueue detail={detail} onOpenStudio={onOpenStudio} />
					<CampaignOverviewStrip detail={detail} onOpenStudio={onOpenStudio} />
					<CampaignPlanTimeline detail={detail} onOpenStudio={onOpenStudio} />
					<CampaignCalendarStrip
						campaignId={detail.id}
						events={detail.events}
						onOpenStudio={onOpenStudio}
					/>
					<CampaignAssetGallery
						campaignId={detail.id}
						events={detail.events}
						onOpenStudio={onOpenStudio}
					/>
					<CampaignActivityFeed detail={detail} onOpenStudio={onOpenStudio} />
				</div>
			)}
		</div>
	);
}
