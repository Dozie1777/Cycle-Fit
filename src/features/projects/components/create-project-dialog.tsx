import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useCreateProject } from "@/client/queries";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { DescriptionEditor } from "./description-editor";

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Create-project dialog (KUK-896): replaces the always-visible inline form
 * at the top of the projects list. Dismissing (cancel button, Esc, overlay
 * click) never submits. Success navigates into the new project with a
 * toast (KUK-902) — a silent card-insertion on the list read like nothing
 * happened and left the user to find their new container.
 */
export function CreateProjectDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const createProject = useCreateProject();
	const navigate = useNavigate();
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (open) return;
		// Reset fields/errors when the dialog closes.
		setName("");
		setDescription("");
		setError(null);
	}, [open]);

	async function handleSubmit(event: React.FormEvent) {
		event.preventDefault();
		if (!name.trim()) return;
		setError(null);
		try {
			const result = await createProject.mutateAsync({
				name: name.trim(),
				description: description.trim() || undefined,
			});
			setName("");
			setDescription("");
			onOpenChange(false);
			toast({
				description: "You're now inside your new project.",
				title: "Project created",
				variant: "success",
			});
			await navigate({
				to: "/projects/$id",
				params: { id: result.project.id },
			});
		} catch (e) {
			setError(errorMessage(e));
		}
	}

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className="sm:max-w-lg">
				<form className="space-y-4" onSubmit={handleSubmit}>
					<DialogHeader>
						<DialogTitle>New project</DialogTitle>
						<DialogDescription>
							Group related designs under one container.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-2">
						<Label htmlFor="project-name">Name</Label>
						<Input
							id="project-name"
							maxLength={200}
							onChange={(e) => setName(e.target.value)}
							placeholder="Project name"
							required
							value={name}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="project-description">Description</Label>
						<DescriptionEditor
							id="project-description"
							onChange={setDescription}
							value={description}
						/>
					</div>
					<div className="flex justify-end gap-2">
						<Button
							onClick={() => onOpenChange(false)}
							type="button"
							variant="ghost"
						>
							Cancel
						</Button>
						<Button
							disabled={createProject.isPending || name.trim().length === 0}
							type="submit"
						>
							{createProject.isPending ? "Creating…" : "Create project"}
						</Button>
					</div>
					{error && <p className="text-sm text-destructive">{error}</p>}
				</form>
			</DialogContent>
		</Dialog>
	);
}
