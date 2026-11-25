import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import type { Design } from "@/client/api-types";
import { relativeTime } from "@/client/formatting";
import {
	useCreateDesign,
	useDesigns,
	useFileDesign,
	useProjects,
} from "@/client/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

const SKELETON_KEYS = Array.from({ length: 8 }, (_, i) => `skeleton-${i}`);

// Real link semantics + focus ring instead of a div with onClick (F23).
// The preview endpoint 404s until a preview exists — hide the img and let
// the muted slot show through (F24). moveSlot renders below the link (a
// control must not be nested inside an <a>). `studioFrom` optionally sets
// the ?from= origin so closing the studio returns to the page this card
// was opened from (KUK-903).
export function ProjectCard({
	project,
	moveSlot,
	studioFrom,
}: {
	project: Design;
	moveSlot?: React.ReactNode;
	studioFrom?: string;
}) {
	return (
		<div className="group flex flex-col overflow-hidden rounded-xl bg-card/50 text-sm text-card-foreground ring-1 ring-foreground/10 backdrop-blur transition-shadow hover:ring-primary/50">
			<Link
				search={{ from: studioFrom }}
				to="/studio/$id"
				params={{ id: project.id }}
				className="outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
			>
				<div className="aspect-video bg-muted">
					<img
						src={`/designs/${project.id}/preview`}
						alt=""
						loading="lazy"
						className="h-full w-full object-cover"
						onError={(event) => {
							event.currentTarget.style.display = "none";
						}}
					/>
				</div>
				<div className="p-4 pb-3">
					<h3 className="line-clamp-2 text-sm font-medium">{project.prompt}</h3>
					<div className="mt-2 flex items-center gap-2">
						<Badge
							variant={project.status === "chatting" ? "default" : "secondary"}
						>
							{project.status}
						</Badge>
						<span className="text-xs text-muted-foreground">
							{relativeTime(project.createdAt)}
						</span>
					</div>
				</div>
			</Link>
			{moveSlot ? <div className="px-4 pb-4 pt-0">{moveSlot}</div> : null}
		</div>
	);
}

function ProjectCardSkeleton() {
	return (
		<Card className="overflow-hidden bg-card/50 backdrop-blur">
			<Skeleton className="aspect-video w-full rounded-none" />
			<CardContent className="space-y-3 p-4">
				<Skeleton className="h-4 w-full" />
				<Skeleton className="h-4 w-3/4" />
				<div className="flex items-center gap-2">
					<Skeleton className="h-5 w-16 rounded-full" />
					<Skeleton className="h-4 w-20" />
				</div>
			</CardContent>
		</Card>
	);
}

export function DesignsListPage({
	onOpenStudio,
}: {
	onOpenStudio: (id: string) => void;
}) {
	const { data: designs, isPending, error: listError } = useDesigns();
	const { data: projects } = useProjects();
	const fileDesign = useFileDesign();
	const [moveError, setMoveError] = useState<string | null>(null);
	const [prompt, setPrompt] = useState("");
	const [createProjectId, setCreateProjectId] = useState<string | null>(null);
	const [createError, setCreateError] = useState<string | null>(null);
	const createDesign = useCreateDesign();

	// One section per project (newest first). Every design is always filed —
	// the API rejects unfiled creation and moves — but a design whose
	// project row is missing at render time (deleted mid-flight) is still
	// shown under a fallback section rather than vanishing. (KUK-907: the
	// section reads "No project" instead of the internal "Unfiled" jargon.)
	const sections = useMemo(() => {
		if (!designs) return [];
		const projectIds = new Set(projects?.map((p) => p.id) ?? []);
		const orphaned: Design[] = [];
		const byProject = new Map<string, Design[]>();
		for (const design of designs) {
			if (design.projectId && projectIds.has(design.projectId)) {
				const bucket = byProject.get(design.projectId);
				if (bucket) bucket.push(design);
				else byProject.set(design.projectId, [design]);
			} else {
				orphaned.push(design);
			}
		}
		return [
			{ id: null, name: "No project", designs: orphaned },
			...(projects ?? []).map((project) => ({
				id: project.id,
				name: project.name,
				designs: byProject.get(project.id) ?? [],
			})),
		].filter((section) => section.designs.length > 0);
	}, [designs, projects]);

	function moveDesign(designId: string, projectId: string) {
		setMoveError(null);
		fileDesign.mutate(
			{ designId, projectId },
			{
				onError: (e) =>
					setMoveError(e instanceof Error ? e.message : String(e)),
			},
		);
	}

	async function handleCreate(event: React.FormEvent) {
		event.preventDefault();
		setCreateError(null);
		if (!createProjectId) return;
		try {
			const created = await createDesign.mutateAsync({
				prompt: prompt.trim(),
				projectId: createProjectId,
			});
			setPrompt("");
			// Land in the studio so the auto-brief runs where the user is.
			onOpenStudio(created.projectId);
		} catch (e) {
			setCreateError(e instanceof Error ? e.message : String(e));
		}
	}

	return (
		<div className="space-y-6">
			<form onSubmit={handleCreate} className="space-y-3">
				<Label htmlFor="design-prompt">Design brief</Label>
				<Textarea
					id="design-prompt"
					rows={3}
					value={prompt}
					onChange={(e) => setPrompt(e.target.value)}
					required
					maxLength={16000}
					placeholder="e.g. A landing page for the Timbuktu course platform — bold typography, warm palette, strong hero CTA"
				/>
				<div className="flex flex-wrap items-center gap-3">
					<Select
						value={createProjectId ?? ""}
						onValueChange={(value) => {
							if (value !== null) setCreateProjectId(value);
						}}
						required
					>
						<SelectTrigger
							size="sm"
							className="w-56"
							aria-label="Project for the new design"
						>
							<SelectValue placeholder="Choose a project…" />
						</SelectTrigger>
						<SelectContent>
							{(projects ?? []).map((project) => (
								<SelectItem key={project.id} value={project.id}>
									{project.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<Button
						type="submit"
						disabled={
							createDesign.isPending ||
							prompt.trim().length === 0 ||
							!createProjectId
						}
					>
						{createDesign.isPending ? "Creating…" : "Create design"}
					</Button>
				</div>
				{createError && (
					<p className="text-sm text-destructive">{createError}</p>
				)}
			</form>

			{listError && (
				<div className="rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
					<p className="font-medium">Failed to load designs</p>
					<p className="text-destructive/80">{listError.message}</p>
				</div>
			)}

			{moveError && <p className="text-sm text-destructive">{moveError}</p>}

			{isPending || !designs ? (
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
					{SKELETON_KEYS.map((key) => (
						<ProjectCardSkeleton key={key} />
					))}
				</div>
			) : designs.length === 0 ? (
				<div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
					No designs yet — pick a project above, write a brief, create.
				</div>
			) : (
				<div className="space-y-8">
					{sections.map((section) => (
						<section key={section.id ?? "unfiled"} className="space-y-3">
							<div className="flex items-center gap-2">
								<h2 className="text-sm font-semibold text-foreground">
									{section.id ? (
										<Link
											to="/projects/$id"
											params={{ id: section.id }}
											className="hover:underline"
										>
											{section.name}
										</Link>
									) : (
										section.name
									)}
								</h2>
								<Badge variant="secondary" className="text-xs">
									{section.designs.length}
								</Badge>
							</div>
							<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
								{section.designs.map((design) => {
									// KUK-906: resolve the design's container name ourselves —
									// Radix SelectValue falls back to the raw value when the
									// loaded projects list doesn't contain the design's
									// project (e.g. briefly stale after a create), which used
									// to render an opaque project id in the trigger.
									const containerName =
										projects?.find((p) => p.id === design.projectId)?.name ??
										"Unknown project";
									return (
										<ProjectCard
											key={design.id}
											project={design}
											moveSlot={
												<Select
													value={design.projectId}
													onValueChange={(value) => {
														// The wrapper types onValueChange as string | null.
														if (value !== null) moveDesign(design.id, value);
													}}
												>
													<SelectTrigger size="sm" aria-label="Move to project">
														<SelectValue>{containerName}</SelectValue>
													</SelectTrigger>
													<SelectContent>
														{(projects ?? []).map((project) => (
															<SelectItem key={project.id} value={project.id}>
																{project.name}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
											}
										/>
									);
								})}
							</div>
						</section>
					))}
				</div>
			)}
		</div>
	);
}
