import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import type { ProjectDetail } from "@/client/api-types";
import {
	useCreateProjectDesign,
	useDeleteProject,
	useProject,
	useUpdateProject,
} from "@/client/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { ProjectCampaignsSection } from "@/features/campaigns/components/project-campaigns-section";
import { ShareMarkdown } from "@/features/campaigns/components/share/markdown";
import { Chat } from "@/features/console/components/chat/chat";
import { ProjectCard } from "@/features/design-studio/pages/designs-list-page";
import { BrandPanel } from "@/features/projects/components/brand-panel";
import { DescriptionEditor } from "@/features/projects/components/description-editor";

const SKELETON_KEYS = Array.from({ length: 4 }, (_, i) => `skeleton-${i}`);

function ProjectHeader({ project }: { project: ProjectDetail }) {
	const updateProject = useUpdateProject();
	const deleteProject = useDeleteProject();
	const navigate = useNavigate();
	const [editing, setEditing] = useState(false);
	const [name, setName] = useState(project.name);
	const [description, setDescription] = useState(project.description ?? "");
	const [actionError, setActionError] = useState<string | null>(null);
	const [confirming, setConfirming] = useState(false);

	async function handleRename(event: React.FormEvent) {
		event.preventDefault();
		setActionError(null);
		try {
			await updateProject.mutateAsync({
				projectId: project.id,
				name: name.trim(),
				description: description.trim() || null,
			});
			setEditing(false);
		} catch (e) {
			setActionError(e instanceof Error ? e.message : String(e));
		}
	}

	async function handleDelete() {
		setActionError(null);
		try {
			await deleteProject.mutateAsync(project.id);
			toast({ title: "Project deleted", description: project.name });
			await navigate({ to: "/projects" });
		} catch (e) {
			// Re-throw so ConfirmDialog keeps itself open with the error.
			throw e instanceof Error ? e : new Error(String(e));
		}
	}

	if (editing) {
		return (
			<form onSubmit={handleRename} className="space-y-3">
				<div className="space-y-2">
					<Label htmlFor="project-edit-name">Name</Label>
					<Input
						id="project-edit-name"
						value={name}
						onChange={(e) => setName(e.target.value)}
						required
						maxLength={200}
					/>
				</div>
				<div className="space-y-2">
					<Label htmlFor="project-edit-description">Description</Label>
					<DescriptionEditor
						id="project-edit-description"
						onChange={setDescription}
						value={description}
					/>
				</div>
				<div className="flex gap-2">
					<Button type="submit" disabled={updateProject.isPending}>
						{updateProject.isPending ? "Saving…" : "Save"}
					</Button>
					<Button
						type="button"
						variant="ghost"
						onClick={() => {
							setEditing(false);
							setName(project.name);
							setDescription(project.description ?? "");
						}}
					>
						Cancel
					</Button>
				</div>
				{actionError && (
					<p className="text-sm text-destructive">{actionError}</p>
				)}
			</form>
		);
	}

	return (
		<div className="space-y-1">
			<div className="flex flex-wrap items-center gap-3">
				<h2 className="text-lg font-semibold">{project.name}</h2>
				<div className="ml-auto flex gap-2">
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => setEditing(true)}
					>
						Edit
					</Button>
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="text-destructive"
						onClick={() => setConfirming(true)}
					>
						Delete
					</Button>
				</div>
			</div>
			<ConfirmDialog
				description={`This permanently removes the project, its designs, chat history, and published files. This cannot be undone.`}
				onConfirm={handleDelete}
				onOpenChange={setConfirming}
				open={confirming}
				pending={deleteProject.isPending}
				title={`Delete project "${project.name}"?`}
			/>
			{project.description ? (
				<div className="text-sm text-muted-foreground">
					<ShareMarkdown text={project.description} />
				</div>
			) : (
				<p className="text-sm text-muted-foreground">No description</p>
			)}
			{actionError && <p className="text-sm text-destructive">{actionError}</p>}
		</div>
	);
}

export function ProjectDetailPage({ projectId }: { projectId: string }) {
	const { data: project, isPending, error: loadError } = useProject(projectId);
	const createDesign = useCreateProjectDesign();
	const navigate = useNavigate();
	const [prompt, setPrompt] = useState("");
	const [createError, setCreateError] = useState<string | null>(null);

	async function handleCreate(event: React.FormEvent) {
		event.preventDefault();
		setCreateError(null);
		try {
			const created = await createDesign.mutateAsync({
				projectId,
				prompt: prompt.trim(),
			});
			setPrompt("");
			// Land in the studio so the auto-brief runs where the user is —
			// and remember this page as the origin so closing the studio
			// returns here (KUK-903).
			await navigate({
				to: "/studio/$id",
				params: { id: created.projectId },
				search: { from: `/projects/${projectId}` },
			});
		} catch (e) {
			setCreateError(e instanceof Error ? e.message : String(e));
		}
	}

	if (loadError) {
		return (
			<div className="rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
				<p className="font-medium">Failed to load project</p>
				<p className="text-destructive/80">{loadError.message}</p>
			</div>
		);
	}

	if (isPending || !project) {
		return (
			<div className="space-y-4">
				<Skeleton className="h-8 w-64" />
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
					{SKELETON_KEYS.map((key) => (
						<Card
							key={key}
							className="overflow-hidden bg-card/50 backdrop-blur"
						>
							<Skeleton className="aspect-video w-full rounded-none" />
							<CardContent className="space-y-3 p-4">
								<Skeleton className="h-4 w-full" />
								<Skeleton className="h-4 w-3/4" />
							</CardContent>
						</Card>
					))}
				</div>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<ProjectHeader project={project} />

			{/* Workspace hub (KUK-915): what the project contains, at a glance. */}
			<div className="flex flex-wrap items-center gap-2 text-sm">
				<Badge variant="secondary">
					{project.designs.length} design
					{project.designs.length === 1 ? "" : "s"}
				</Badge>
				<Badge variant="secondary">
					{project.campaignCount} campaign
					{project.campaignCount === 1 ? "" : "s"}
				</Badge>
				<Badge variant={project.hasBrandKit ? "outline" : "secondary"}>
					{project.hasBrandKit ? "Brand kit set" : "No brand kit"}
				</Badge>
				{project.designs.length > 0 && (
					<span className="text-xs text-muted-foreground">
						{
							project.designs.filter((design) => design.status === "chatting")
								.length
						}{" "}
						in progress
					</span>
				)}
			</div>

			<Tabs defaultValue="designs" className="space-y-4">
				<TabsList>
					<TabsTrigger value="designs">
						Designs ({project.designs.length})
					</TabsTrigger>
					<TabsTrigger value="campaigns">
						Campaigns ({project.campaignCount})
					</TabsTrigger>
					<TabsTrigger value="brand">Brand</TabsTrigger>
					<TabsTrigger value="chat">Chat</TabsTrigger>
				</TabsList>
				<TabsContent value="designs" className="space-y-6">
					<form onSubmit={handleCreate} className="space-y-3">
						<Label htmlFor="project-design-prompt">
							New design in this project
						</Label>
						<Textarea
							id="project-design-prompt"
							rows={3}
							value={prompt}
							onChange={(e) => setPrompt(e.target.value)}
							required
							maxLength={16000}
							placeholder="e.g. A pricing page with a three-tier comparison table"
						/>
						<div className="flex items-center gap-3">
							<Button
								type="submit"
								disabled={createDesign.isPending || prompt.trim().length === 0}
							>
								{createDesign.isPending ? "Creating…" : "Create design"}
							</Button>
						</div>
						{createError && (
							<p className="text-sm text-destructive">{createError}</p>
						)}
					</form>

					{project.designs.length === 0 ? (
						<div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
							No designs yet — create one above.
						</div>
					) : (
						<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
							{project.designs.map((design) => (
								<ProjectCard
									key={design.id}
									project={design}
									studioFrom={`/projects/${projectId}`}
								/>
							))}
						</div>
					)}
				</TabsContent>
				<TabsContent value="campaigns">
					<ProjectCampaignsSection projectId={projectId} />
				</TabsContent>
				<TabsContent value="brand">
					<BrandPanel projectId={projectId} />
				</TabsContent>
				<TabsContent value="chat" className="min-h-0">
					<Chat
						actorName="projectChat"
						actorKey={["project", projectId]}
						title="Project chat"
					/>
				</TabsContent>
			</Tabs>
		</div>
	);
}
