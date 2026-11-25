import { useEffect, useState } from "react";
import {
	useCreateSkill,
	useDeleteSkill,
	useSkills,
	useUpdateSkill,
} from "@/client/queries";
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { SKILL_CATEGORIES, type SkillCategory } from "@/features/skills";

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Compact manage-skills dialog (KUK-891): the admin-side owner of the skill
 * library. Create new skills (slug/name/description/markdown content),
 * edit content, enable/disable, and delete plain (non-builtin) skills —
 * builtin seeds can only be disabled. Reachable from the studio chat panel.
 */
export function ManageSkillsDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const { data: skills = [], isPending } = useSkills();
	const createSkill = useCreateSkill();
	const updateSkill = useUpdateSkill();
	const deleteSkill = useDeleteSkill();
	const [newSlug, setNewSlug] = useState("");
	const [newName, setNewName] = useState("");
	const [newDescription, setNewDescription] = useState("");
	const [newContent, setNewContent] = useState("");
	/** Which studio the new skill surfaces in (fixed at creation). */
	const [newCategory, setNewCategory] = useState<SkillCategory>("campaign");
	const [error, setError] = useState<string | null>(null);
	/** Row opened in the inline editor, keyed by skill id. */
	const [editingId, setEditingId] = useState<string | null>(null);
	/** Per-row edit drafts (name/description/content), keyed by skill id. */
	const [drafts, setDrafts] = useState<
		Record<
			string,
			{ name: string; description: string; content: string } | undefined
		>
	>({});

	useEffect(() => {
		if (open) return;
		// Reset drafts/errors when the dialog closes.
		setNewSlug("");
		setNewName("");
		setNewDescription("");
		setNewContent("");
		setError(null);
		setEditingId(null);
		setArmedDeleteId(null);
		setDrafts({});
	}, [open]);

	async function handleCreate(event: React.FormEvent) {
		event.preventDefault();
		if (!newSlug.trim() || !newName.trim() || !newContent.trim()) return;
		setError(null);
		try {
			await createSkill.mutateAsync({
				slug: newSlug.trim(),
				name: newName.trim(),
				description: newDescription.trim(),
				content: newContent,
				category: newCategory,
			});
			setNewSlug("");
			setNewName("");
			setNewDescription("");
			setNewContent("");
			setNewCategory("campaign");
		} catch (e) {
			setError(errorMessage(e));
		}
	}

	async function handleSave(skillId: string) {
		const draft = drafts[skillId];
		if (!draft) return;
		setError(null);
		try {
			await updateSkill.mutateAsync({
				skillId,
				name: draft.name.trim() || undefined,
				description: draft.description.trim() || undefined,
				content: draft.content,
			});
			setEditingId(null);
			setDrafts((prev) => ({ ...prev, [skillId]: undefined }));
		} catch (e) {
			setError(errorMessage(e));
		}
	}

	async function handleToggle(skillId: string, enabled: boolean) {
		setError(null);
		try {
			await updateSkill.mutateAsync({ skillId, enabled });
		} catch (e) {
			setError(errorMessage(e));
		}
	}

	async function handleDelete(skillId: string) {
		setError(null);
		try {
			await deleteSkill.mutateAsync(skillId);
		} catch (e) {
			setError(errorMessage(e));
		}
	}

	/** Two-step delete: the first click arms the row's button. */
	const [armedDeleteId, setArmedDeleteId] = useState<string | null>(null);

	function draftFor(skill: {
		id: string;
		name: string;
		description: string;
		content: string;
	}) {
		return (
			drafts[skill.id] ?? {
				name: skill.name,
				description: skill.description,
				content: skill.content,
			}
		);
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Skills</DialogTitle>
					<DialogDescription>
						Markdown playbooks the studio agents can load — design skills in the
						design studio, campaign/marketing/sales skills in the campaign
						studio. Type "/" in a studio chat to use one; disable a skill to
						hide it from the agent.
					</DialogDescription>
				</DialogHeader>
				<form className="space-y-2" onSubmit={handleCreate}>
					<div className="flex items-end gap-2">
						<div className="w-32 space-y-1">
							<Label htmlFor="new-skill-slug">Slug</Label>
							<Input
								id="new-skill-slug"
								maxLength={64}
								onChange={(e) => setNewSlug(e.target.value)}
								placeholder="e.g. holiday-push"
								value={newSlug}
							/>
						</div>
						<div className="min-w-0 flex-1 space-y-1">
							<Label htmlFor="new-skill-name">Name</Label>
							<Input
								id="new-skill-name"
								maxLength={120}
								onChange={(e) => setNewName(e.target.value)}
								placeholder="e.g. Holiday push"
								value={newName}
							/>
						</div>
						<div className="w-32 space-y-1">
							<Label htmlFor="new-skill-category">Studio</Label>
							<Select
								onValueChange={(value) =>
									setNewCategory(value as SkillCategory)
								}
								value={newCategory}
							>
								<SelectTrigger id="new-skill-category" size="sm">
									<SelectValue />
								</SelectTrigger>
								<SelectContent className="max-h-72">
									{SKILL_CATEGORIES.map((category) => (
										<SelectItem key={category} value={category}>
											{category}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>
					<div className="space-y-1">
						<Label htmlFor="new-skill-description">Description</Label>
						<Input
							id="new-skill-description"
							maxLength={300}
							onChange={(e) => setNewDescription(e.target.value)}
							placeholder="One line shown in the / menu"
							value={newDescription}
						/>
					</div>
					<div className="space-y-1">
						<Label htmlFor="new-skill-content">Content (markdown)</Label>
						<Textarea
							id="new-skill-content"
							onChange={(e) => setNewContent(e.target.value)}
							placeholder="Instructions the agent follows after loading this skill"
							rows={3}
							value={newContent}
						/>
					</div>
					<Button
						disabled={
							createSkill.isPending ||
							!newSlug.trim() ||
							!newName.trim() ||
							!newContent.trim()
						}
						size="sm"
						type="submit"
					>
						{createSkill.isPending ? <Spinner /> : "Add"}
					</Button>
				</form>
				{isPending ? (
					<p className="py-2 text-sm text-muted-foreground">Loading…</p>
				) : skills.length === 0 ? (
					<p className="py-2 text-sm text-muted-foreground">
						No skills yet — add the first one above.
					</p>
				) : (
					<ul className="space-y-2">
						{skills.map((skill) => {
							const editing = editingId === skill.id;
							const draft = draftFor(skill);
							const changed =
								draft.name !== skill.name ||
								draft.description !== skill.description ||
								draft.content !== skill.content;
							return (
								<li className="rounded-md border p-2" key={skill.id}>
									<div className="flex items-center gap-2">
										<div className="min-w-0 flex-1">
											<p className="truncate text-sm font-medium">
												{skill.name}{" "}
												<span className="font-mono text-xs text-muted-foreground">
													/{skill.slug}
												</span>
												<span className="ml-1 rounded bg-muted px-1 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
													{skill.category}
												</span>
												{skill.builtin && (
													<span className="ml-1 rounded bg-muted px-1 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
														builtin
													</span>
												)}
											</p>
											<p className="truncate text-xs text-muted-foreground">
												{skill.description}
											</p>
										</div>
										<Switch
											aria-label={`Enable ${skill.name}`}
											checked={skill.enabled}
											onCheckedChange={(checked) =>
												void handleToggle(skill.id, checked)
											}
											size="sm"
										/>
										<Button
											onClick={() => setEditingId(editing ? null : skill.id)}
											size="sm"
											type="button"
											variant="ghost"
										>
											{editing ? "Close" : "Edit"}
										</Button>
										{!skill.builtin && (
											<Button
												disabled={deleteSkill.isPending}
												onClick={() => {
													if (armedDeleteId === skill.id) {
														setArmedDeleteId(null);
														void handleDelete(skill.id);
													} else {
														setArmedDeleteId(skill.id);
													}
												}}
												size="sm"
												type="button"
												variant={
													armedDeleteId === skill.id ? "destructive" : "ghost"
												}
											>
												{armedDeleteId === skill.id
													? "Confirm delete"
													: "Delete"}
											</Button>
										)}
									</div>
									{editing && (
										<div className="mt-2 space-y-1 border-t pt-2">
											<Label
												className="sr-only"
												htmlFor={`skill-name-${skill.id}`}
											>
												Name
											</Label>
											<Input
												id={`skill-name-${skill.id}`}
												maxLength={120}
												onChange={(e) =>
													setDrafts((prev) => ({
														...prev,
														[skill.id]: { ...draft, name: e.target.value },
													}))
												}
												value={draft.name}
											/>
											<Label
												className="sr-only"
												htmlFor={`skill-description-${skill.id}`}
											>
												Description
											</Label>
											<Input
												id={`skill-description-${skill.id}`}
												maxLength={300}
												onChange={(e) =>
													setDrafts((prev) => ({
														...prev,
														[skill.id]: {
															...draft,
															description: e.target.value,
														},
													}))
												}
												placeholder="One line shown in the / menu"
												value={draft.description}
											/>
											<Label
												className="sr-only"
												htmlFor={`skill-content-${skill.id}`}
											>
												Content (markdown)
											</Label>
											<Textarea
												id={`skill-content-${skill.id}`}
												onChange={(e) =>
													setDrafts((prev) => ({
														...prev,
														[skill.id]: { ...draft, content: e.target.value },
													}))
												}
												value={draft.content}
											/>
											<Button
												disabled={!changed || updateSkill.isPending}
												onClick={() => void handleSave(skill.id)}
												size="sm"
												type="button"
												variant="outline"
											>
												{updateSkill.isPending ? <Spinner /> : "Save"}
											</Button>
										</div>
									)}
								</li>
							);
						})}
					</ul>
				)}
				{error && <p className="text-xs text-destructive">{error}</p>}
			</DialogContent>
		</Dialog>
	);
}
