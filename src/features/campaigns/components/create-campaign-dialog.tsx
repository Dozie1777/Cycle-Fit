import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import type { ProjectSummary } from "@/client/api-types";
import { useCreateCampaign, useCreateProject } from "@/client/queries";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";

/** Select value for the inline "create a new project" mode. */
const NEW_PROJECT = "__new__";

/**
 * Create-campaign dialog for the dashboard home. Campaigns are always filed,
 * so a container is part of creation: pick an existing project or create one
 * inline (no separate project-create dialog exists to reuse). When the page
 * is already filtered to a project the selection is pre-filled.
 */
export function CreateCampaignDialog({
	projects,
	initialProjectId,
}: {
	projects: ProjectSummary[];
	initialProjectId?: string;
}) {
	const navigate = useNavigate();
	const createCampaign = useCreateCampaign();
	const createProject = useCreateProject();
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const [brief, setBrief] = useState("");
	const [projectId, setProjectId] = useState(initialProjectId ?? "");
	const [newProjectName, setNewProjectName] = useState("");
	const [creatingNewProject, setCreatingNewProject] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const submitting = createCampaign.isPending || createProject.isPending;

	async function handleCreate(event: React.FormEvent) {
		event.preventDefault();
		setError(null);
		try {
			let containerId = projectId;
			if (creatingNewProject) {
				const created = await createProject.mutateAsync({
					name: newProjectName.trim(),
				});
				containerId = created.project.id;
			}
			if (!containerId) return;
			const createdCampaign = await createCampaign.mutateAsync({
				projectId: containerId,
				name: name.trim(),
				briefPrompt: brief.trim() || undefined,
			});
			setOpen(false);
			setName("");
			setBrief("");
			// Land in the campaign dashboard. That route ships in a later
			// ticket (KUK-874+), so this navigation 404s until it exists —
			// registering the route is all that's missing. `href` bypasses
			// typed-route checking, which has not seen the route yet.
			await navigate({
				href: `/campaigns/${createdCampaign.campaignId}`,
			});
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	}

	return (
		<>
			<Button
				type="button"
				onClick={() => {
					setError(null);
					setOpen(true);
				}}
			>
				New campaign
			</Button>
			<Dialog
				open={open}
				onOpenChange={(next) => {
					setOpen(next);
					if (!next) setError(null);
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>New campaign</DialogTitle>
						<DialogDescription>
							Campaigns always live in a project — pick or create the container,
							then name the campaign.
						</DialogDescription>
					</DialogHeader>
					<form onSubmit={handleCreate} className="space-y-3">
						<div className="space-y-2">
							<Label htmlFor="campaign-project">Project</Label>
							<Select
								value={
									creatingNewProject ? NEW_PROJECT : projectId || undefined
								}
								onValueChange={(value) => {
									if (value === null) return;
									if (value === NEW_PROJECT) {
										setCreatingNewProject(true);
									} else {
										setCreatingNewProject(false);
										setProjectId(value);
									}
								}}
								required
							>
								<SelectTrigger
									id="campaign-project"
									size="sm"
									className="w-full"
									aria-label="Project for the new campaign"
								>
									<SelectValue placeholder="File into project…" />
								</SelectTrigger>
								<SelectContent>
									{projects.map((project) => (
										<SelectItem key={project.id} value={project.id}>
											{project.name}
										</SelectItem>
									))}
									<SelectItem value={NEW_PROJECT}>➕ New project…</SelectItem>
								</SelectContent>
							</Select>
						</div>
						{creatingNewProject && (
							<div className="space-y-2">
								<Label htmlFor="campaign-new-project">New project name</Label>
								<Input
									id="campaign-new-project"
									value={newProjectName}
									onChange={(e) => setNewProjectName(e.target.value)}
									required
									maxLength={200}
									placeholder="e.g. Q4 launch"
								/>
							</div>
						)}
						<div className="space-y-2">
							<Label htmlFor="campaign-name">Campaign name</Label>
							<Input
								id="campaign-name"
								value={name}
								onChange={(e) => setName(e.target.value)}
								required
								maxLength={200}
								placeholder="e.g. Back-to-school push"
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="campaign-brief">One-line brief (optional)</Label>
							<Input
								id="campaign-brief"
								value={brief}
								onChange={(e) => setBrief(e.target.value)}
								maxLength={4000}
								placeholder="e.g. Drive January enrollments with a 3-week email + social push"
							/>
						</div>
						{error && <p className="text-sm text-destructive">{error}</p>}
						<DialogFooter>
							<Button type="submit" disabled={submitting || !name.trim()}>
								{submitting ? "Creating…" : "Create campaign"}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</>
	);
}
