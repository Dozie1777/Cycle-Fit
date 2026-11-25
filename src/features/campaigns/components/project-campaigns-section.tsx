import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
	useCreateProjectCampaign,
	useProjectCampaigns,
} from "@/client/queries";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { CampaignCard } from "./campaign-card";

const SKELETON_KEYS = Array.from({ length: 4 }, (_, i) => `skeleton-${i}`);

/**
 * Campaigns tab of the project detail page: create-from-project (the
 * container is pre-filled by the endpoint) plus the project's campaign grid.
 */
export function ProjectCampaignsSection({ projectId }: { projectId: string }) {
	const navigate = useNavigate();
	const {
		data: campaigns,
		isPending,
		error: listError,
	} = useProjectCampaigns(projectId);
	const createCampaign = useCreateProjectCampaign();
	const [name, setName] = useState("");
	const [brief, setBrief] = useState("");
	const [createError, setCreateError] = useState<string | null>(null);

	async function handleCreate(event: React.FormEvent) {
		event.preventDefault();
		setCreateError(null);
		try {
			const created = await createCampaign.mutateAsync({
				projectId,
				name: name.trim(),
				briefPrompt: brief.trim() || undefined,
			});
			setName("");
			setBrief("");
			// Land in the campaign dashboard. That route ships in a later
			// ticket, so this navigation 404s until it exists; `href`
			// bypasses typed-route checking the route has not joined yet.
			// `from` records this project page as the origin so the campaign's
			// Back button returns here (KUK-903).
			await navigate({
				href: `/campaigns/${created.campaignId}?from=${encodeURIComponent(`/projects/${projectId}`)}`,
			});
		} catch (e) {
			setCreateError(e instanceof Error ? e.message : String(e));
		}
	}

	return (
		<div className="space-y-6">
			<form onSubmit={handleCreate} className="space-y-3">
				<Label htmlFor="project-campaign-name">
					New campaign in this project
				</Label>
				<div className="flex flex-col gap-2 sm:flex-row">
					<Input
						id="project-campaign-name"
						value={name}
						onChange={(e) => setName(e.target.value)}
						required
						maxLength={200}
						placeholder="Campaign name"
					/>
					<Input
						value={brief}
						onChange={(e) => setBrief(e.target.value)}
						maxLength={4000}
						placeholder="One-line brief (optional)"
						className="sm:max-w-md"
					/>
					<Button
						type="submit"
						disabled={createCampaign.isPending || name.trim().length === 0}
					>
						{createCampaign.isPending ? "Creating…" : "Create campaign"}
					</Button>
				</div>
				{createError && (
					<p className="text-sm text-destructive">{createError}</p>
				)}
			</form>

			{listError && (
				<div className="rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
					<p className="font-medium">Failed to load campaigns</p>
					<p className="text-destructive/80">{listError.message}</p>
				</div>
			)}

			{isPending || !campaigns ? (
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{SKELETON_KEYS.map((key) => (
						<Card key={key} className="bg-card/50 backdrop-blur">
							<CardContent className="space-y-3 p-4">
								<Skeleton className="h-4 w-2/3" />
								<Skeleton className="h-5 w-24 rounded-full" />
								<Skeleton className="h-4 w-1/2" />
							</CardContent>
						</Card>
					))}
				</div>
			) : campaigns.length === 0 ? (
				<div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
					No campaigns in this project yet — create one above.
				</div>
			) : (
				<div className="space-y-3">
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
						{campaigns.map((campaign) => (
							// The project chip is redundant inside its own project.
							<CampaignCard
								key={campaign.id}
								campaign={campaign}
								showProject={false}
								fromPath={`/projects/${projectId}`}
							/>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
