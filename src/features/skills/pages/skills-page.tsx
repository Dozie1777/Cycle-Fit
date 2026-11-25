import { useMemo, useState } from "react";
import type { Skill } from "@/client/api-types";
import {
	useCreateSkill,
	useDeleteSkill,
	useSkills,
	useUpdateSkill,
} from "@/client/queries";
import { Button } from "@/components/ui/button";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SKILL_CATEGORIES, type SkillCategory } from "@/features/skills";
import { SkillMarkdownEditor } from "@/features/skills/components/skill-markdown-editor";
import { SkillsImportPanel } from "@/features/skills/components/skills-import-panel";

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Full-page skills manager: the admin-side owner of the skill library. Two
 * surfaces — a two-pane library (list + WYSIWYG markdown editor, replacing
 * the plain-textarea inline editing in the compact chat dialog) and a
 * GitHub import flow that seeds skills from any public repo following the
 * skills/<name>/SKILL.md layout. Builtin seeds can be disabled and edited
 * but never deleted.
 */
export function SkillsPage() {
	const { data: skills = [], isPending } = useSkills();
	return (
		<Tabs defaultValue="library">
			<TabsList>
				<TabsTrigger value="library">Library</TabsTrigger>
				<TabsTrigger value="import">Import from GitHub</TabsTrigger>
			</TabsList>
			<TabsContent value="library">
				<SkillsLibrary isPending={isPending} skills={skills} />
			</TabsContent>
			<TabsContent value="import">
				<SkillsImportPanel />
			</TabsContent>
		</Tabs>
	);
}

function SkillsLibrary({
	skills,
	isPending,
}: {
	skills: Skill[];
	isPending: boolean;
}) {
	const [search, setSearch] = useState("");
	const [categoryFilter, setCategoryFilter] = useState<"all" | SkillCategory>(
		"all",
	);
	const [selectedId, setSelectedId] = useState<string | null>(null);

	const filtered = useMemo(() => {
		const needle = search.trim().toLowerCase();
		return skills.filter((skill) => {
			if (categoryFilter !== "all" && skill.category !== categoryFilter) {
				return false;
			}
			if (needle.length === 0) return true;
			return (
				skill.name.toLowerCase().includes(needle) ||
				skill.slug.toLowerCase().includes(needle) ||
				skill.description.toLowerCase().includes(needle)
			);
		});
	}, [skills, search, categoryFilter]);

	// Keep a valid selection when the list shrinks or data reloads.
	const selected =
		filtered.find((skill) => skill.id === selectedId) ?? filtered[0] ?? null;

	return (
		<div className="grid gap-4 lg:grid-cols-[320px_1fr]">
			<div className="flex flex-col gap-2">
				<Input
					aria-label="Search skills"
					onChange={(e) => setSearch(e.target.value)}
					placeholder="Search name, slug, description…"
					value={search}
				/>
				<Select
					onValueChange={(value) =>
						setCategoryFilter(value as "all" | SkillCategory)
					}
					value={categoryFilter}
				>
					<SelectTrigger aria-label="Filter by studio" size="sm">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">All studios</SelectItem>
						{SKILL_CATEGORIES.map((category) => (
							<SelectItem key={category} value={category}>
								{category}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				{isPending ? (
					<p className="p-2 text-sm text-muted-foreground">Loading…</p>
				) : filtered.length === 0 ? (
					<p className="p-2 text-sm text-muted-foreground">
						No skills match — clear the search or import some from GitHub.
					</p>
				) : (
					<ul
						aria-label="Skills"
						className="max-h-[70vh] overflow-y-auto rounded-md border"
					>
						{filtered.map((skill) => (
							<li key={skill.id}>
								<button
									className={`flex w-full flex-col gap-0.5 border-b px-3 py-2 text-left last:border-b-0 hover:bg-accent/50 ${
										selected?.id === skill.id ? "bg-accent" : ""
									}`}
									onClick={() => setSelectedId(skill.id)}
									type="button"
								>
									<span className="flex w-full items-center gap-1.5">
										<span className="min-w-0 flex-1 truncate text-sm font-medium">
											{skill.name}
										</span>
										<span className="font-mono text-[10px] text-muted-foreground">
											/{skill.slug}
										</span>
									</span>
									<span className="flex w-full items-center gap-1.5">
										<SkillBadges skill={skill} />
										<span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
											{skill.description}
										</span>
									</span>
								</button>
							</li>
						))}
					</ul>
				)}
			</div>
			{selected ? (
				<SkillDetail
					key={selected.id}
					onSelect={setSelectedId}
					skill={selected}
				/>
			) : (
				<p className="text-sm text-muted-foreground">
					Select a skill from the list to view and edit it.
				</p>
			)}
		</div>
	);
}

function SkillBadges({ skill }: { skill: Skill }) {
	return (
		<span className="flex shrink-0 items-center gap-1">
			<span className="rounded bg-muted px-1 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
				{skill.category}
			</span>
			{skill.builtin && (
				<span className="rounded bg-muted px-1 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
					builtin
				</span>
			)}
		</span>
	);
}

function SkillDetail({
	skill,
	onSelect,
}: {
	skill: Skill;
	onSelect: (skillId: string) => void;
}) {
	const updateSkill = useUpdateSkill();
	const deleteSkill = useDeleteSkill();
	const createSkill = useCreateSkill();
	const [name, setName] = useState(skill.name);
	const [description, setDescription] = useState(skill.description);
	const [content, setContent] = useState(skill.content);
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);
	const [armedDelete, setArmedDelete] = useState(false);
	// Creating a skill from scratch: slug + category fixed at creation.
	const [creating, setCreating] = useState(false);
	const [newSlug, setNewSlug] = useState("");
	const [newCategory, setNewCategory] = useState<SkillCategory>("marketing");

	const changed =
		name !== skill.name ||
		description !== skill.description ||
		content !== skill.content;

	async function handleSave() {
		setError(null);
		setSaved(false);
		try {
			await updateSkill.mutateAsync({
				skillId: skill.id,
				name: name.trim() || undefined,
				description: description.trim() || undefined,
				content,
			});
			setSaved(true);
		} catch (e) {
			setError(errorMessage(e));
		}
	}

	async function handleToggle(enabled: boolean) {
		setError(null);
		try {
			await updateSkill.mutateAsync({ skillId: skill.id, enabled });
		} catch (e) {
			setError(errorMessage(e));
		}
	}

	async function handleDelete() {
		setError(null);
		try {
			await deleteSkill.mutateAsync(skill.id);
			// The list re-renders without the row; selection falls through.
			setArmedDelete(false);
		} catch (e) {
			setError(errorMessage(e));
		}
	}

	async function handleCreate() {
		setError(null);
		try {
			const created = await createSkill.mutateAsync({
				slug: newSlug.trim(),
				name: name.trim() || newSlug.trim(),
				description: description.trim() || "No description yet",
				content,
				category: newCategory,
			});
			setCreating(false);
			setNewSlug("");
			// Select the freshly created row so the editor shows what was made,
			// not the previously selected skill.
			onSelect(created.id);
			// Reuse the same detail form for the freshly created row.
			setName(created.name);
			setDescription(created.description);
			setContent(created.content);
		} catch (e) {
			setError(errorMessage(e));
		}
	}

	if (creating) {
		return (
			<div className="space-y-3">
				<div className="flex items-end gap-2">
					<div className="w-56 space-y-1">
						<Label htmlFor="skills-new-slug">Slug (fixed at creation)</Label>
						<Input
							id="skills-new-slug"
							maxLength={64}
							onChange={(e) => setNewSlug(e.target.value)}
							placeholder="e.g. exam-season-push"
							value={newSlug}
						/>
					</div>
					<div className="w-40 space-y-1">
						<Label htmlFor="skills-new-category">Studio</Label>
						<Select
							onValueChange={(value) => setNewCategory(value as SkillCategory)}
							value={newCategory}
						>
							<SelectTrigger id="skills-new-category" size="sm">
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
					<Button
						disabled={createSkill.isPending || !newSlug.trim()}
						onClick={() => void handleCreate()}
						size="sm"
						type="button"
					>
						{createSkill.isPending ? <Spinner /> : "Create"}
					</Button>
					<Button
						onClick={() => setCreating(false)}
						size="sm"
						type="button"
						variant="ghost"
					>
						Cancel
					</Button>
				</div>
				<SharedFields
					description={description}
					disabled={false}
					onDescriptionChange={setDescription}
					onNameChange={setName}
					name={name}
				/>
				<SkillMarkdownEditor onChange={setContent} value={content} />
				{error && <p className="text-xs text-destructive">{error}</p>}
			</div>
		);
	}

	return (
		<div className="space-y-3">
			<div className="flex items-center gap-2">
				<div className="min-w-0 flex-1">
					<p className="truncate text-sm">
						<span className="font-mono text-xs text-muted-foreground">
							/{skill.slug}
						</span>{" "}
						<SkillBadges skill={skill} />
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Label
						className="text-xs text-muted-foreground"
						htmlFor={`skills-enabled-${skill.id}`}
					>
						Enabled
					</Label>
					<Switch
						aria-label={`Enable ${skill.name}`}
						checked={skill.enabled}
						id={`skills-enabled-${skill.id}`}
						onCheckedChange={(checked) => void handleToggle(checked)}
						size="sm"
					/>
					<Button
						disabled={!changed || updateSkill.isPending}
						onClick={() => void handleSave()}
						size="sm"
						type="button"
					>
						{updateSkill.isPending ? <Spinner /> : saved ? "Saved" : "Save"}
					</Button>
					<Button
						onClick={() => setCreating(true)}
						size="sm"
						type="button"
						variant="ghost"
					>
						New skill
					</Button>
					{!skill.builtin && (
						<Button
							disabled={deleteSkill.isPending}
							onClick={() => {
								if (armedDelete) {
									void handleDelete();
								} else {
									setArmedDelete(true);
								}
							}}
							size="sm"
							type="button"
							variant={armedDelete ? "destructive" : "ghost"}
						>
							{armedDelete ? "Confirm delete" : "Delete"}
						</Button>
					)}
				</div>
			</div>
			<SharedFields
				description={description}
				disabled={false}
				onDescriptionChange={setDescription}
				onNameChange={setName}
				name={name}
			/>
			<SkillMarkdownEditor onChange={setContent} value={content} />
			{changed && (
				<p className="text-xs text-muted-foreground">
					Unsaved changes — content saves as markdown.
				</p>
			)}
			{error && <p className="text-xs text-destructive">{error}</p>}
		</div>
	);
}

function SharedFields({
	name,
	description,
	onNameChange,
	onDescriptionChange,
	disabled,
}: {
	name: string;
	description: string;
	onNameChange: (value: string) => void;
	onDescriptionChange: (value: string) => void;
	disabled: boolean;
}) {
	return (
		<div className="grid gap-2 sm:grid-cols-2">
			<div className="space-y-1">
				<Label htmlFor="skills-name">Name</Label>
				<Input
					disabled={disabled}
					id="skills-name"
					maxLength={120}
					onChange={(e) => onNameChange(e.target.value)}
					value={name}
				/>
			</div>
			<div className="space-y-1">
				<Label htmlFor="skills-description">
					Description (shown in the / menu)
				</Label>
				<Input
					disabled={disabled}
					id="skills-description"
					maxLength={300}
					onChange={(e) => onDescriptionChange(e.target.value)}
					value={description}
				/>
			</div>
		</div>
	);
}
