import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import type { CampaignSummary } from "@/client/api-types";
import { useCampaigns, useProjects } from "@/client/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { CampaignCard } from "@/features/campaigns/components/campaign-card";
import { CreateCampaignDialog } from "@/features/campaigns/components/create-campaign-dialog";
import {
	type CampaignHealth,
	deriveCampaignHealthFromSummary,
	HEALTH_LABELS,
} from "@/features/campaigns/health";

const SKELETON_KEYS = Array.from({ length: 6 }, (_, i) => `skeleton-${i}`);

function CampaignCardSkeleton() {
	return (
		<Card className="bg-card/50 backdrop-blur">
			<CardContent className="space-y-3 p-4">
				<Skeleton className="h-4 w-2/3" />
				<Skeleton className="h-5 w-24 rounded-full" />
				<Skeleton className="h-4 w-1/2" />
			</CardContent>
		</Card>
	);
}

/**
 * Campaign dashboard home (/campaigns): every campaign grouped by its
 * parent project, with a ?projectId= filter and the create dialog. Mirrors
 * the designs list page's section-per-project layout.
 */
export function CampaignsPage({ projectId }: { projectId?: string }) {
	const navigate = useNavigate();
	const { data: campaigns, isPending, error: listError } = useCampaigns();
	const { data: projects } = useProjects();

	// The list endpoint is capped (100) and cheap to re-segment client-side,
	// so one query serves every filter value; switching the filter is instant.
	// KUK-983: health filter chip + triage row — one derivation shared with
	// the cards (deriveCampaignHealthFromSummary), so counts never drift.
	const [healthFilter, setHealthFilter] = useState<CampaignHealth | null>(null);

	const filtered = useMemo(() => {
		if (!campaigns) return [];
		let list = projectId
			? campaigns.filter((campaign) => campaign.projectId === projectId)
			: campaigns;
		if (healthFilter) {
			list = list.filter(
				(campaign) =>
					deriveCampaignHealthFromSummary(campaign).health === healthFilter,
			);
		}
		return list;
	}, [campaigns, projectId, healthFilter]);

	const healthCounts = useMemo(() => {
		const counts = new Map<CampaignHealth, number>();
		for (const campaign of projectId
			? (campaigns?.filter((c) => c.projectId === projectId) ?? [])
			: (campaigns ?? [])) {
			const health = deriveCampaignHealthFromSummary(campaign).health;
			counts.set(health, (counts.get(health) ?? 0) + 1);
		}
		return counts;
	}, [campaigns, projectId]);

	const sections = useMemo(() => {
		if (filtered.length === 0) return [];
		const nameById = new Map(
			(projects ?? []).map((project) => [project.id, project.name]),
		);
		const byProject = new Map<string, CampaignSummary[]>();
		for (const campaign of filtered) {
			const bucket = byProject.get(campaign.projectId);
			if (bucket) bucket.push(campaign);
			else byProject.set(campaign.projectId, [campaign]);
		}
		return [...byProject.entries()].map(([id, list]) => ({
			id,
			name: nameById.get(id) ?? "Project",
			campaigns: list,
		}));
	}, [filtered, projects]);

	return (
		<div className="space-y-6">
			<div className="flex flex-wrap items-center gap-3">
				<Select
					value={projectId ?? "all"}
					onValueChange={(value) => {
						if (value === null) return;
						void navigate({
							to: "/campaigns",
							search: value === "all" ? {} : { projectId: value },
						});
					}}
				>
					<SelectTrigger
						size="sm"
						className="w-56"
						aria-label="Filter campaigns by project"
					>
						<SelectValue placeholder="All projects">
							{projectId ? undefined : "All projects"}
						</SelectValue>
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">All projects</SelectItem>
						{(projects ?? []).map((project) => (
							<SelectItem key={project.id} value={project.id}>
								{project.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<CreateCampaignDialog
					key={projectId ?? "all"}
					projects={projects ?? []}
					initialProjectId={projectId}
				/>
			</div>

			{campaigns && campaigns.length > 0 && (
				<div className="space-y-3">
					{/* Triage row (KUK-983): what needs attention today, before any
						scrolling. */}
					<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
						{(
							[
								["needs_input", "Need your input"],
								["on_track", "On track"],
								["ending_soon", "Ending soon"],
								["off_track", "Off track"],
							] as const
						).map(([key, label]) => {
							const count = healthCounts.get(key) ?? 0;
							return (
								<div key={key} className="rounded-xl border bg-card/50 p-4">
									<p
										className={`text-2xl font-bold ${
											key === "off_track"
												? "text-destructive"
												: key === "on_track"
													? "text-emerald-600"
													: key === "ending_soon"
														? "text-amber-600"
														: "text-foreground"
										}`}
									>
										{count}
									</p>
									<p className="text-xs text-muted-foreground">{label}</p>
								</div>
							);
						})}
					</div>
					<div className="flex flex-wrap gap-2">
						<Button
							type="button"
							variant={healthFilter === null ? "secondary" : "ghost"}
							size="sm"
							onClick={() => setHealthFilter(null)}
						>
							All (
							{projectId
								? campaigns.filter((c) => c.projectId === projectId).length
								: campaigns.length}
							)
						</Button>
						{(
							["needs_input", "on_track", "ending_soon", "off_track"] as const
						).map((key) => (
							<Button
								key={key}
								type="button"
								variant={healthFilter === key ? "secondary" : "ghost"}
								size="sm"
								onClick={() =>
									setHealthFilter((prev) => (prev === key ? null : key))
								}
							>
								{HEALTH_LABELS[key]} ({healthCounts.get(key) ?? 0})
							</Button>
						))}
					</div>
				</div>
			)}

			{listError && (
				<div className="rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
					<p className="font-medium">Failed to load campaigns</p>
					<p className="text-destructive/80">{listError.message}</p>
				</div>
			)}

			{isPending || !campaigns ? (
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
					{SKELETON_KEYS.map((key) => (
						<CampaignCardSkeleton key={key} />
					))}
				</div>
			) : filtered.length === 0 ? (
				<div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
					{projectId
						? "No campaigns in this project yet — create one with New campaign."
						: "No campaigns yet — create the first one with New campaign."}
				</div>
			) : (
				<div className="space-y-8">
					{sections.map((section) => (
						<section key={section.id} className="space-y-3">
							<div className="flex items-center gap-2">
								<h2 className="text-sm font-semibold text-foreground">
									<Link
										to="/projects/$id"
										params={{ id: section.id }}
										className="hover:underline"
									>
										{section.name}
									</Link>
								</h2>
								<Badge variant="secondary" className="text-xs">
									{section.campaigns.length}
								</Badge>
							</div>
							<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
								{section.campaigns.map((campaign) => (
									<CampaignCard
										key={campaign.id}
										campaign={campaign}
										projectName={section.name}
									/>
								))}
							</div>
						</section>
					))}
				</div>
			)}
		</div>
	);
}
