import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { ProjectSummary } from "@/client/api-types";
import { relativeTime } from "@/client/formatting";
import {
	useDeleteProject,
	useProjects,
	useUpdateProject,
} from "@/client/queries";
import { onUiEvent } from "@/client/ui-bus";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { ShareMarkdown } from "@/features/campaigns/components/share/markdown";
import { CreateProjectDialog } from "@/features/projects/components/create-project-dialog";

const SKELETON_KEYS = Array.from({ length: 6 }, (_, i) => `skeleton-${i}`);

function ProjectCard({ project }: { project: ProjectSummary }) {
	const updateProject = useUpdateProject();
	const deleteProject = useDeleteProject();
	const [editing, setEditing] = useState(false);
	const [name, setName] = useState(project.name);
	const [confirming, setConfirming] = useState(false);
	const [actionError, setActionError] = useState<string | null>(null);

	async function handleRename(event: React.FormEvent) {
		event.preventDefault();
		setActionError(null);
		try {
			await updateProject.mutateAsync({ projectId: project.id, name });
			setEditing(false);
		} catch (e) {
			setActionError(e instanceof Error ? e.message : String(e));
		}
	}

	async function handleDelete() {
		await deleteProject.mutateAsync(project.id);
		toast({
			title: "Project deleted",
			description: project.name,
		});
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
							aria-label="Project name"
						/>
						<div className="flex gap-2">
							<Button
								type="submit"
								size="sm"
								disabled={updateProject.isPending}
							>
								Save
							</Button>
							<Button
								type="button"
								size="sm"
								variant="ghost"
								onClick={() => {
									setEditing(false);
									setName(project.name);
								}}
							>
								Cancel
							</Button>
						</div>
					</form>
				) : (
					<div className="flex items-start justify-between gap-2">
						<Link
							to="/projects/$id"
							params={{ id: project.id }}
							className="min-w-0 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 rounded-md"
						>
							<h3 className="truncate text-sm font-medium hover:underline">
								{project.name}
							</h3>
						</Link>
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
					description={`This permanently removes the project and its ${project.designCount} design${project.designCount === 1 ? "" : "s"}. This cannot be undone.`}
					onConfirm={handleDelete}
					onOpenChange={setConfirming}
					open={confirming}
					pending={deleteProject.isPending}
					title={`Delete project "${project.name}"?`}
				/>
				{project.description ? (
					<div className="line-clamp-2 min-h-[2rem] text-xs text-muted-foreground [&_*]:text-xs!">
						<ShareMarkdown text={project.description} />
					</div>
				) : (
					<p className="line-clamp-2 min-h-[2rem] text-xs text-muted-foreground">
						No description
					</p>
				)}
				<div className="mt-auto flex flex-wrap items-center gap-2">
					<Badge variant="secondary">
						{project.designCount} design{project.designCount === 1 ? "" : "s"}
					</Badge>
					<Badge variant="secondary">
						{project.campaignCount} campaign
						{project.campaignCount === 1 ? "" : "s"}
					</Badge>
					{project.hasBrandKit && <Badge variant="outline">Brand kit</Badge>}
					<span className="text-xs text-muted-foreground">
						{relativeTime(project.createdAt)}
					</span>
				</div>
				{actionError && (
					<p className="text-xs text-destructive">{actionError}</p>
				)}
			</CardContent>
		</Card>
	);
}

export function ProjectsListPage() {
	const { data: projects, isPending, error: listError } = useProjects();
	const [createOpen, setCreateOpen] = useState(false);

	// The command palette's "New project" action lands here and opens the
	// dialog through the UI event bus (KUK-916).
	useEffect(() => onUiEvent("new-project", () => setCreateOpen(true)), []);

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between gap-2">
				<p className="text-sm text-muted-foreground">Your design projects</p>
				<Button onClick={() => setCreateOpen(true)} type="button">
					New project
				</Button>
			</div>
			<CreateProjectDialog onOpenChange={setCreateOpen} open={createOpen} />

			{listError && (
				<div className="rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
					<p className="font-medium">Failed to load projects</p>
					<p className="text-destructive/80">{listError.message}</p>
				</div>
			)}

			{isPending || !projects ? (
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{SKELETON_KEYS.map((key) => (
						<Card key={key} className="bg-card/50 backdrop-blur">
							<CardContent className="space-y-3 p-4">
								<Skeleton className="h-4 w-2/3" />
								<Skeleton className="h-8 w-full" />
								<Skeleton className="h-5 w-24 rounded-full" />
							</CardContent>
						</Card>
					))}
				</div>
			) : projects.length === 0 ? (
				<div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
					No projects yet — use the New project button above to group your
					designs.
				</div>
			) : (
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{projects.map((project) => (
						<ProjectCard key={project.id} project={project} />
					))}
				</div>
			)}
		</div>
	);
}
