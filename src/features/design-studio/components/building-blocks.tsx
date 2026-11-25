import {
	ArrowDownIcon,
	ArrowUpIcon,
	Loader2Icon,
	PlusIcon,
	Trash2Icon,
} from "lucide-react";
import { useState } from "react";
import type {
	ComposerBlock,
	ComposerPage,
	LibraryComponent,
} from "@/client/api-types";
import {
	useCreateDataCollection,
	useCreatePage,
	useDefineFlow,
	useDefineTemplate,
	useDeleteDataCollection,
	useDeleteFlow,
	useDeletePage,
	useDeleteTemplate,
	useDesignPages,
	useProjectComponents,
	useProjectData,
	useProjectFlows,
	useProjectTemplates,
	useRenameDataCollection,
	useReplaceDataRecords,
	useReplacePageBlocks,
	useUpdatePage,
} from "@/client/queries";
import { cn } from "@/client/utils";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogTitle,
} from "@/components/ui/dialog";
import { ComponentLibrary } from "./component-library";
import { ElementChatButton } from "./element-chat-button";
import type { OpenElementChat } from "./element-chat-panel";

// ---------------------------------------------------------------------------
// Studio building-block views (KUK-928): the page composer, data
// collections, templates and flows panels. Rendered in the studio inspector
// as tabs beside the KUK-927 component library (which stays the default
// tab, untouched). Every write is a full-list replace through the admin
// routes, so the server stays the source of truth — no optimistic state.
// ---------------------------------------------------------------------------

const TABS = ["Components", "Pages", "Data", "Templates", "Flows"] as const;

export function BuildingBlocks({
	projectId,
	designId,
	className,
	onOpenElementChat,
}: {
	projectId: string;
	designId: string;
	className?: string;
	/** A row's Chat action opens the focused element chat (KUK-945). */
	onOpenElementChat?: (session: OpenElementChat) => void;
}) {
	const [tab, setTab] = useState<(typeof TABS)[number]>("Components");
	return (
		<div className={cn("flex flex-1 flex-col gap-3", className)}>
			<div
				role="tablist"
				aria-label="Building blocks"
				className="flex flex-wrap gap-1"
			>
				{TABS.map((entry) => (
					<button
						key={entry}
						type="button"
						role="tab"
						aria-selected={tab === entry}
						onClick={() => setTab(entry)}
						className={cn(
							"rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
							tab === entry
								? "bg-muted text-foreground"
								: "text-muted-foreground hover:bg-muted/50",
						)}
					>
						{entry}
					</button>
				))}
			</div>
			{tab === "Components" && (
				<ComponentLibrary
					projectId={projectId}
					designId={designId}
					onOpenElementChat={onOpenElementChat}
				/>
			)}
			{tab === "Pages" && (
				<PagesPanel
					projectId={projectId}
					designId={designId}
					onOpenElementChat={onOpenElementChat}
				/>
			)}
			{tab === "Data" && (
				<DataPanel
					projectId={projectId}
					onOpenElementChat={onOpenElementChat}
				/>
			)}
			{tab === "Templates" && (
				<TemplatesPanel
					projectId={projectId}
					designId={designId}
					onOpenElementChat={onOpenElementChat}
				/>
			)}
			{tab === "Flows" && (
				<FlowsPanel
					projectId={projectId}
					onOpenElementChat={onOpenElementChat}
				/>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Shared bits: compact unstyled-native inputs (deliberately not the
// base-ui wrappers — the panels run under react-test-renderer in tests) and
// a section heading matching the inspector's other sections.
// ---------------------------------------------------------------------------

const FIELD_CLASS =
	"h-7 w-full min-w-0 rounded-md border border-input bg-transparent px-2 text-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring";

function Field(props: React.ComponentProps<"input">) {
	return <input {...props} className={cn(FIELD_CLASS, props.className)} />;
}

function FieldArea(props: React.ComponentProps<"textarea">) {
	return (
		<textarea
			{...props}
			className={cn(FIELD_CLASS, "h-auto py-1 font-mono", props.className)}
		/>
	);
}

function Choice(props: React.ComponentProps<"select">) {
	return (
		<select
			{...props}
			className={cn(FIELD_CLASS, "appearance-none", props.className)}
		/>
	);
}

function PanelHeading({ title, count }: { title: string; count?: number }) {
	return (
		<h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
			{title}
			{count !== undefined && count > 0 && (
				<span className="text-muted-foreground"> ({count})</span>
			)}
		</h3>
	);
}

/** One component's pinnable (published) versions for the pickers. */
function pinnableVersions(component: LibraryComponent) {
	return component.versions.filter((version) => version.status === "published");
}

function componentLabel(component: LibraryComponent): string {
	return component.publishedVersion != null
		? `${component.name} (v${component.publishedVersion} published)`
		: `${component.name} (nothing published)`;
}

// ---------------------------------------------------------------------------
// Pages panel: the design's pages + the selected page's block composer.
// ---------------------------------------------------------------------------

function PagesPanel({
	projectId,
	designId,
	onOpenElementChat,
}: {
	projectId: string;
	designId: string;
	onOpenElementChat?: (session: OpenElementChat) => void;
}) {
	const { data, isPending, error } = useDesignPages(projectId, designId);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);
	const pages = data?.pages ?? [];
	const selected = pages.find((page) => page.id === selectedId) ?? null;

	return (
		<section className="flex-1">
			<PanelHeading title="Pages" count={pages.length} />
			{isPending ? (
				<p className="text-xs text-muted-foreground">Loading…</p>
			) : error ? (
				<p className="text-xs text-destructive">{error.message}</p>
			) : pages.length === 0 ? (
				<p className="text-xs text-muted-foreground">
					No pages yet — create the first one below.
				</p>
			) : (
				<ul className="space-y-1.5">
					{pages.map((page) => (
						<li key={page.id} className="flex items-center gap-1">
							<button
								type="button"
								onClick={() =>
									setSelectedId((current) =>
										current === page.id ? null : page.id,
									)
								}
								aria-expanded={selected?.id === page.id}
								className="min-w-0 flex-1 rounded-md px-1.5 py-1 text-left text-xs transition-colors hover:bg-muted/50"
							>
								<span className="flex items-center gap-2">
									<span className="flex-1 truncate font-medium text-foreground">
										{page.path}
									</span>
									<span className="shrink-0 text-muted-foreground">
										{page.status} · {page.blocks.length} block
										{page.blocks.length === 1 ? "" : "s"}
									</span>
								</span>
								<span className="block truncate text-[10px] text-muted-foreground">
									{page.title}
								</span>
							</button>
							<ElementChatButton
								projectId={projectId}
								elementType="page"
								elementId={page.id}
								elementName={page.title || page.path}
								onOpenElementChat={onOpenElementChat}
							/>
						</li>
					))}
				</ul>
			)}
			<div className="mt-2">
				{creating ? (
					<NewPageForm
						projectId={projectId}
						designId={designId}
						onDone={() => setCreating(false)}
					/>
				) : (
					<Button
						type="button"
						variant="outline"
						size="xs"
						onClick={() => setCreating(true)}
					>
						<PlusIcon data-icon="inline-start" />
						New page
					</Button>
				)}
			</div>
			{selected && (
				<PageComposer
					key={selected.id}
					projectId={projectId}
					designId={designId}
					page={selected}
					onDeleted={() => setSelectedId(null)}
				/>
			)}
		</section>
	);
}

function NewPageForm({
	projectId,
	designId,
	onDone,
}: {
	projectId: string;
	designId: string;
	onDone: () => void;
}) {
	const create = useCreatePage(projectId, designId);
	const [path, setPath] = useState("/");
	const [title, setTitle] = useState("");
	const [error, setError] = useState<string | null>(null);

	return (
		<div className="rounded-md border border-border/60 bg-muted/30 p-2">
			<p className="mb-1.5 text-[11px] font-medium text-foreground">New page</p>
			<div className="space-y-1.5">
				<Field
					aria-label="Page path"
					placeholder="/pricing"
					value={path}
					onChange={(e) => setPath(e.target.value)}
				/>
				<Field
					aria-label="Page title"
					placeholder="Pricing"
					value={title}
					onChange={(e) => setTitle(e.target.value)}
				/>
			</div>
			{error && <p className="mt-1.5 text-[11px] text-destructive">{error}</p>}
			<div className="mt-2 flex gap-1.5">
				<Button
					type="button"
					size="xs"
					disabled={create.isPending}
					onClick={async () => {
						setError(null);
						try {
							await create.mutateAsync({ path, title });
							onDone();
						} catch (e) {
							setError(
								e instanceof Error ? e.message : "Create failed — try again",
							);
						}
					}}
				>
					{create.isPending ? (
						<Loader2Icon className="size-3 animate-spin" />
					) : (
						"Create page"
					)}
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="xs"
					disabled={create.isPending}
					onClick={onDone}
				>
					Cancel
				</Button>
			</div>
		</div>
	);
}

/**
 * The selected page's composer: rename/delete the page, reorder or remove
 * its blocks, add a component / template / html block. Every action is a
 * full-list replace (PUT …/blocks) — existing component blocks keep their
 * exact pin via componentVersionId (pins never move on their own).
 */
function PageComposer({
	projectId,
	designId,
	page,
	onDeleted,
}: {
	projectId: string;
	designId: string;
	page: ComposerPage;
	onDeleted: () => void;
}) {
	const update = useUpdatePage(projectId, designId);
	const remove = useDeletePage(projectId, designId);
	const replaceBlocks = useReplacePageBlocks(projectId, designId);
	const [title, setTitle] = useState(page.title);
	const [path, setPath] = useState(page.path);
	const [deleting, setDeleting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	/** Sends the full surviving list with the given change applied. Entries
	 * are stored blocks (round-tripped via blockToInput) or fresh add-form
	 * inputs (passed through as-is). */
	async function writeBlocks(
		blocks: Array<ComposerBlock | Record<string, unknown>>,
	): Promise<boolean> {
		setError(null);
		try {
			await replaceBlocks.mutateAsync({
				pageId: page.id,
				blocks: blocks.map((block) =>
					"kind" in block ? blockToInput(block as ComposerBlock) : block,
				),
			});
			return true;
		} catch (e) {
			setError(e instanceof Error ? e.message : "Save failed — try again");
			return false;
		}
	}

	async function move(index: number, delta: -1 | 1) {
		const target = index + delta;
		if (target < 0 || target >= page.blocks.length) return;
		const blocks = [...page.blocks];
		const [moved] = blocks.splice(index, 1);
		blocks.splice(target, 0, moved);
		await writeBlocks(blocks);
	}

	return (
		<div className="mt-2 rounded-md border border-border/60 bg-muted/30 p-2">
			<div className="mb-1.5 flex items-center gap-1.5">
				<Field
					aria-label="Page path"
					value={path}
					onChange={(e) => setPath(e.target.value)}
					className="flex-1 font-mono"
				/>
				<Trash2IconButton
					label={`Delete page ${page.path}`}
					onClick={() => setDeleting(true)}
					disabled={remove.isPending}
				/>
			</div>
			<div className="flex items-center gap-1.5">
				<Field
					aria-label="Page title"
					value={title}
					onChange={(e) => setTitle(e.target.value)}
					className="flex-1"
				/>
				<Button
					type="button"
					size="xs"
					disabled={update.isPending}
					onClick={async () => {
						setError(null);
						try {
							await update.mutateAsync({ pageId: page.id, path, title });
						} catch (e) {
							setError(
								e instanceof Error ? e.message : "Rename failed — try again",
							);
						}
					}}
				>
					{update.isPending ? "Saving…" : "Rename"}
				</Button>
			</div>
			<ul className="mt-2 space-y-1">
				{page.blocks.map((block, index) => (
					<li
						key={block.id}
						className="flex items-center gap-1 rounded-md bg-background/60 px-1.5 py-1"
					>
						<span className="w-4 shrink-0 font-mono text-[10px] text-muted-foreground">
							{block.ordinal}
						</span>
						<span
							className="min-w-0 flex-1 truncate text-xs text-foreground"
							title={blockLabel(block)}
						>
							{blockLabel(block)}
						</span>
						<Trash2IconButton
							label={`Remove block ${block.ordinal}`}
							disabled={replaceBlocks.isPending}
							onClick={() => {
								void writeBlocks(
									page.blocks.filter((entry) => entry.id !== block.id),
								);
							}}
						/>
						<MoveIconButton
							label={`Move block ${block.ordinal} up`}
							direction="up"
							disabled={index === 0 || replaceBlocks.isPending}
							onClick={() => void move(index, -1)}
						/>
						<MoveIconButton
							label={`Move block ${block.ordinal} down`}
							direction="down"
							disabled={
								index === page.blocks.length - 1 || replaceBlocks.isPending
							}
							onClick={() => void move(index, 1)}
						/>
					</li>
				))}
			</ul>
			<AddBlockForm
				projectId={projectId}
				designId={designId}
				page={page}
				onAdd={(input) => writeBlocks([...page.blocks, input])}
			/>
			{error && <p className="mt-1.5 text-[11px] text-destructive">{error}</p>}

			<Dialog
				open={deleting}
				onOpenChange={(open) => {
					if (!open) setDeleting(false);
				}}
			>
				<DialogContent className="sm:max-w-xs">
					<DialogTitle>Delete page {page.path}?</DialogTitle>
					<DialogDescription>
						The page, its blocks and its flow steps are removed. Publications
						that already rendered it are untouched.
					</DialogDescription>
					{error && <p className="text-xs text-destructive">{error}</p>}
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => setDeleting(false)}
							disabled={remove.isPending}
						>
							Cancel
						</Button>
						<Button
							type="button"
							variant="destructive"
							size="sm"
							disabled={remove.isPending}
							onClick={async () => {
								setError(null);
								try {
									await remove.mutateAsync(page.id);
									setDeleting(false);
									onDeleted();
								} catch (e) {
									setError(
										e instanceof Error
											? e.message
											: "Delete failed — try again",
									);
								}
							}}
						>
							{remove.isPending ? "Deleting…" : "Delete"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}

function blockLabel(block: ComposerBlock): string {
	if (block.kind === "component") {
		return `${block.componentName ?? "component"} v${block.version} (${block.versionStatus})`;
	}
	if (block.kind === "template") {
		return `template ${block.templateName ?? ""}`;
	}
	return "inline html";
}

/** Round-trips a stored block into its replace-all input shape. */
function blockToInput(block: ComposerBlock): Record<string, unknown> {
	if (block.kind === "component") {
		// Existing component blocks keep their exact pin (stale pins
		// included) — re-pinning is the library panel's explicit affordance.
		return {
			componentVersionId: block.componentVersionId,
			...(block.propsOverrides !== null
				? { propsOverrides: block.propsOverrides }
				: {}),
			...(block.dataBindings !== null
				? { dataBindings: block.dataBindings }
				: {}),
		};
	}
	if (block.kind === "template") {
		return {
			template: block.templateName,
			...(block.propsOverrides !== null
				? { propsOverrides: block.propsOverrides }
				: {}),
		};
	}
	return { sourceHtml: block.sourceHtml };
}

function AddBlockForm({
	projectId,
	designId,
	page,
	onAdd,
}: {
	projectId: string;
	designId: string;
	page: ComposerPage;
	onAdd: (input: Record<string, unknown>) => Promise<boolean>;
}) {
	const { data: library } = useProjectComponents(projectId, designId);
	const { data: templates } = useProjectTemplates(projectId);
	const [kind, setKind] = useState<"component" | "template" | "html">(
		"component",
	);
	const [componentId, setComponentId] = useState<string>("");
	const [versionId, setVersionId] = useState<string>("");
	const [templateId, setTemplateId] = useState<string>("");
	const [sourceHtml, setSourceHtml] = useState("<section>…</section>");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const components = library?.components ?? [];
	const component = components.find((entry) => entry.id === componentId);
	const versions = component ? pinnableVersions(component) : [];
	const templateOptions = templates?.templates ?? [];
	const template = templateOptions.find((entry) => entry.id === templateId);

	async function submit() {
		setError(null);
		let input: Record<string, unknown>;
		if (kind === "component") {
			const version = versions.find((entry) => entry.id === versionId);
			if (!component || !version) {
				setError("Pick a component with a published version.");
				return;
			}
			input = {
				component: {
					name: component.name,
					version: version.version,
				},
			};
		} else if (kind === "template") {
			if (!template) {
				setError("Pick a template.");
				return;
			}
			input = { template: template.name };
		} else {
			if (sourceHtml.trim() === "") {
				setError("Inline HTML cannot be empty.");
				return;
			}
			input = { sourceHtml };
		}
		setBusy(true);
		const done = await onAdd(input);
		setBusy(false);
		if (done) {
			setComponentId("");
			setVersionId("");
			setTemplateId("");
		}
	}

	return (
		<div className="mt-2 rounded-md border border-border/60 bg-background/60 p-2">
			<p className="mb-1.5 text-[11px] font-medium text-foreground">
				Add block
			</p>
			<div className="flex gap-1.5">
				{(["component", "template", "html"] as const).map((option) => (
					<button
						key={option}
						type="button"
						onClick={() => setKind(option)}
						aria-pressed={kind === option}
						className={cn(
							"rounded-md px-2 py-1 text-[11px] transition-colors",
							kind === option
								? "bg-muted text-foreground"
								: "text-muted-foreground hover:bg-muted/50",
						)}
					>
						{option}
					</button>
				))}
			</div>
			<div className="mt-1.5 space-y-1.5">
				{kind === "component" && (
					<>
						<Choice
							aria-label="Component"
							value={componentId}
							onChange={(e) => {
								setComponentId(e.target.value);
								setVersionId("");
							}}
						>
							<option value="">Pick a component…</option>
							{components.map((entry) => (
								<option key={entry.id} value={entry.id}>
									{componentLabel(entry)}
								</option>
							))}
						</Choice>
						<Choice
							aria-label="Version"
							value={versionId}
							onChange={(e) => setVersionId(e.target.value)}
							disabled={!component || versions.length === 0}
						>
							<option value="">
								{component
									? versions.length > 0
										? "Pick a published version…"
										: "No published version"
									: "Pick a component first…"}
							</option>
							{versions.map((version) => (
								<option key={version.id} value={version.id}>
									v{version.version}
								</option>
							))}
						</Choice>
					</>
				)}
				{kind === "template" && (
					<Choice
						aria-label="Template"
						value={templateId}
						onChange={(e) => setTemplateId(e.target.value)}
					>
						<option value="">Pick a template…</option>
						{templateOptions.map((entry) => (
							<option key={entry.id} value={entry.id}>
								{entry.name} ({entry.slots.length} slot
								{entry.slots.length === 1 ? "" : "s"})
							</option>
						))}
					</Choice>
				)}
				{kind === "html" && (
					<FieldArea
						aria-label="Inline HTML"
						value={sourceHtml}
						onChange={(e) => setSourceHtml(e.target.value)}
					/>
				)}
			</div>
			{error && <p className="mt-1.5 text-[11px] text-destructive">{error}</p>}
			<Button
				type="button"
				size="xs"
				className="mt-2"
				disabled={busy}
				onClick={() => void submit()}
			>
				{busy ? (
					<Loader2Icon className="size-3 animate-spin" />
				) : (
					`Add to end (${page.blocks.length})`
				)}
			</Button>
		</div>
	);
}

function Trash2IconButton({
	label,
	onClick,
	disabled,
}: {
	label: string;
	onClick: () => void;
	disabled?: boolean;
}) {
	return (
		<Button
			type="button"
			variant="ghost"
			size="icon-xs"
			aria-label={label}
			title={label}
			disabled={disabled}
			onClick={onClick}
		>
			<Trash2Icon className="size-3 text-muted-foreground" />
		</Button>
	);
}

function MoveIconButton({
	label,
	direction,
	onClick,
	disabled,
}: {
	label: string;
	direction: "up" | "down";
	onClick: () => void;
	disabled?: boolean;
}) {
	return (
		<Button
			type="button"
			variant="ghost"
			size="icon-xs"
			aria-label={label}
			title={label}
			disabled={disabled}
			onClick={onClick}
		>
			{direction === "up" ? (
				<ArrowUpIcon className="size-3 text-muted-foreground" />
			) : (
				<ArrowDownIcon className="size-3 text-muted-foreground" />
			)}
		</Button>
	);
}

// ---------------------------------------------------------------------------
// Data panel: collections + a records table per collection.
// ---------------------------------------------------------------------------

function DataPanel({
	projectId,
	onOpenElementChat,
}: {
	projectId: string;
	onOpenElementChat?: (session: OpenElementChat) => void;
}) {
	const { data, isPending, error } = useProjectData(projectId);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);
	const [name, setName] = useState("");
	const [deleteError, setDeleteError] = useState<string | null>(null);
	const [deleting, setDeleting] = useState<string | null>(null);
	const create = useCreateDataCollection(projectId);
	const rename = useRenameDataCollection(projectId);
	const remove = useDeleteDataCollection(projectId);
	const collections = data?.collections ?? [];
	const selected = collections.find((entry) => entry.id === selectedId) ?? null;
	const [renaming, setRenaming] = useState<string | null>(null);
	const [renameValue, setRenameValue] = useState("");

	async function submitCreate() {
		setDeleteError(null);
		try {
			const created = await create.mutateAsync(name);
			setName("");
			setCreating(false);
			setSelectedId(created.collection.id);
		} catch (e) {
			setDeleteError(
				e instanceof Error ? e.message : "Create failed — try again",
			);
		}
	}

	return (
		<section className="flex-1">
			<PanelHeading title="Data collections" count={collections.length} />
			{isPending ? (
				<p className="text-xs text-muted-foreground">Loading…</p>
			) : error ? (
				<p className="text-xs text-destructive">{error.message}</p>
			) : (
				<>
					{collections.length === 0 ? (
						<p className="text-xs text-muted-foreground">
							No collections yet — create the first one below.
						</p>
					) : (
						<ul className="space-y-1.5">
							{collections.map((collection) => (
								<li key={collection.id}>
									{renaming === collection.id ? (
										<div className="flex items-center gap-1.5">
											<Field
												aria-label="Collection name"
												value={renameValue}
												onChange={(e) => setRenameValue(e.target.value)}
												className="flex-1"
											/>
											<Button
												type="button"
												size="xs"
												disabled={rename.isPending}
												onClick={async () => {
													setDeleteError(null);
													try {
														await rename.mutateAsync({
															collectionId: collection.id,
															name: renameValue,
														});
														setRenaming(null);
													} catch (e) {
														setDeleteError(
															e instanceof Error
																? e.message
																: "Rename failed — try again",
														);
													}
												}}
											>
												Save
											</Button>
											<Button
												type="button"
												variant="ghost"
												size="xs"
												onClick={() => setRenaming(null)}
											>
												Cancel
											</Button>
										</div>
									) : (
										<div className="flex items-center gap-1">
											<button
												type="button"
												onClick={() =>
													setSelectedId((current) =>
														current === collection.id ? null : collection.id,
													)
												}
												aria-expanded={selected?.id === collection.id}
												className="min-w-0 flex-1 rounded-md px-1.5 py-1 text-left text-xs transition-colors hover:bg-muted/50"
											>
												<span className="flex items-center gap-2">
													<span className="flex-1 truncate font-medium text-foreground">
														{collection.name}
													</span>
													<span className="shrink-0 text-muted-foreground">
														{collection.records.length} record
														{collection.records.length === 1 ? "" : "s"}
													</span>
												</span>
											</button>
											<ElementChatButton
												projectId={projectId}
												elementType="data"
												elementId={collection.id}
												elementName={collection.name}
												onOpenElementChat={onOpenElementChat}
											/>
											<Trash2IconButton
												label={`Delete collection ${collection.name}`}
												disabled={remove.isPending}
												onClick={() => setDeleting(collection.id)}
											/>
											<Button
												type="button"
												variant="ghost"
												size="xs"
												className="h-6 px-2 text-[11px]"
												onClick={() => {
													setRenaming(collection.id);
													setRenameValue(collection.name);
												}}
											>
												Rename
											</Button>
										</div>
									)}
								</li>
							))}
						</ul>
					)}
					<div className="mt-2">
						{creating ? (
							<div className="rounded-md border border-border/60 bg-muted/30 p-2">
								<Field
									aria-label="Collection name"
									placeholder="courses"
									value={name}
									onChange={(e) => setName(e.target.value)}
								/>
								{deleteError && (
									<p className="mt-1.5 text-[11px] text-destructive">
										{deleteError}
									</p>
								)}
								<div className="mt-2 flex gap-1.5">
									<Button
										type="button"
										size="xs"
										disabled={create.isPending}
										onClick={() => void submitCreate()}
									>
										{create.isPending ? "Creating…" : "Create collection"}
									</Button>
									<Button
										type="button"
										variant="ghost"
										size="xs"
										onClick={() => setCreating(false)}
									>
										Cancel
									</Button>
								</div>
							</div>
						) : (
							<Button
								type="button"
								variant="outline"
								size="xs"
								onClick={() => setCreating(true)}
							>
								<PlusIcon data-icon="inline-start" />
								New collection
							</Button>
						)}
					</div>
					{selected && (
						<RecordsEditor projectId={projectId} collection={selected} />
					)}
					{deleteError && !creating && (
						<p className="mt-1.5 text-[11px] text-destructive">{deleteError}</p>
					)}
				</>
			)}
			<Dialog
				open={deleting !== null}
				onOpenChange={(open) => {
					if (!open) setDeleting(null);
				}}
			>
				<DialogContent className="sm:max-w-xs">
					<DialogTitle>Delete collection?</DialogTitle>
					<DialogDescription>
						The collection and all of its records are removed. Collections that
						page blocks still bind cannot be deleted.
					</DialogDescription>
					{deleteError && (
						<p className="text-xs text-destructive">{deleteError}</p>
					)}
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => setDeleting(null)}
							disabled={remove.isPending}
						>
							Cancel
						</Button>
						<Button
							type="button"
							variant="destructive"
							size="sm"
							disabled={remove.isPending}
							onClick={async () => {
								if (!deleting) return;
								setDeleteError(null);
								try {
									await remove.mutateAsync(deleting);
									setDeleting(null);
									if (selectedId === deleting) setSelectedId(null);
								} catch (e) {
									setDeleteError(
										e instanceof Error
											? e.message
											: "Delete failed — try again",
									);
								}
							}}
						>
							{remove.isPending ? "Deleting…" : "Delete"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</section>
	);
}

/** A collection's records: JSON-as-TEXT rows edited via full-list replace. */
function RecordsEditor({
	projectId,
	collection,
}: {
	projectId: string;
	collection: {
		id: string;
		name: string;
		records: Array<{ id: string; ordinal: number; data: string }>;
	};
}) {
	const replace = useReplaceDataRecords(projectId);
	const [error, setError] = useState<string | null>(null);
	const [newRecord, setNewRecord] = useState("{}");

	/** Sends the full record list after mapping each row through `parse`
	 * (returning undefined drops the row — the delete path). */
	async function writeRecords(
		map: (text: string, index: number) => unknown,
	): Promise<boolean> {
		setError(null);
		try {
			await replace.mutateAsync({
				collectionId: collection.id,
				records: collection.records.flatMap((record, index) => {
					const mapped = map(record.data, index);
					return mapped === undefined ? [] : [mapped];
				}),
			});
			return true;
		} catch (e) {
			setError(e instanceof Error ? e.message : "Save failed — try again");
			return false;
		}
	}

	async function addRecord(): Promise<boolean> {
		setError(null);
		let parsed: unknown;
		try {
			parsed = JSON.parse(newRecord);
		} catch {
			setError("New record is not valid JSON.");
			return false;
		}
		try {
			await replace.mutateAsync({
				collectionId: collection.id,
				records: [
					...collection.records.map((record) => JSON.parse(record.data)),
					parsed,
				],
			});
			setNewRecord("{}");
			return true;
		} catch (e) {
			setError(e instanceof Error ? e.message : "Save failed — try again");
			return false;
		}
	}

	return (
		<div className="mt-2 rounded-md border border-border/60 bg-muted/30 p-2">
			<p className="mb-1.5 font-mono text-[10px] text-muted-foreground">
				{collection.name}
			</p>
			<ul className="space-y-1">
				{collection.records.map((record, index) => (
					<RecordRow
						key={record.id}
						projectId={projectId}
						collection={collection}
						record={record}
						index={index}
						onSave={(text) =>
							writeRecords((current, i) =>
								i === index ? JSON.parse(text) : JSON.parse(current),
							)
						}
						onDelete={() =>
							writeRecords((current, i) =>
								i === index ? undefined : JSON.parse(current),
							)
						}
						onParseError={setError}
						busy={replace.isPending}
					/>
				))}
			</ul>
			{error && <p className="mt-1.5 text-[11px] text-destructive">{error}</p>}
			<div className="mt-2 space-y-1.5">
				<FieldArea
					aria-label="New record JSON"
					value={newRecord}
					onChange={(e) => setNewRecord(e.target.value)}
				/>
				<Button
					type="button"
					size="xs"
					disabled={replace.isPending}
					onClick={() => void addRecord()}
				>
					{replace.isPending ? (
						<Loader2Icon className="size-3 animate-spin" />
					) : (
						"Add record"
					)}
				</Button>
			</div>
		</div>
	);
}

function RecordRow({
	record,
	index,
	onSave,
	onDelete,
	onParseError,
	busy,
}: {
	projectId: string;
	collection: { id: string; name: string };
	record: { id: string; ordinal: number; data: string };
	index: number;
	onSave: (text: string) => Promise<boolean>;
	onDelete: () => Promise<boolean>;
	onParseError: (message: string) => void;
	busy: boolean;
}) {
	const [text, setText] = useState(record.data);

	function parseOrReport(): unknown {
		try {
			return JSON.parse(text);
		} catch {
			onParseError(`Record ${index} is not valid JSON.`);
			return undefined;
		}
	}

	return (
		<li className="rounded-md bg-background/60 p-1.5">
			<div className="flex items-center gap-1.5">
				<span className="w-4 shrink-0 font-mono text-[10px] text-muted-foreground">
					{record.ordinal}
				</span>
				<FieldArea
					aria-label={`Record ${record.ordinal} JSON`}
					value={text}
					onChange={(e) => setText(e.target.value)}
					className="flex-1"
				/>
				<Button
					type="button"
					variant="ghost"
					size="xs"
					className="h-6 px-2 text-[11px]"
					disabled={busy}
					onClick={async () => {
						if (parseOrReport() === undefined) return;
						await onSave(text);
					}}
				>
					Save
				</Button>
				<Trash2IconButton
					label={`Delete record ${record.ordinal}`}
					disabled={busy}
					onClick={() => {
						if (parseOrReport() === undefined) return;
						void onDelete();
					}}
				/>
			</div>
		</li>
	);
}

// ---------------------------------------------------------------------------
// Templates panel: create (with slots) / inspect / delete.
// ---------------------------------------------------------------------------

/**
 * Unsaved slot drafts. Each carries a local id so React keys stay stable
 * across reorders (the slots have no identity until the template is saved).
 */
type SlotDraft = {
	draftId: string;
	componentId: string;
	versionId: string;
	overrides: string;
};

function newSlotDraft(): SlotDraft {
	return {
		draftId: crypto.randomUUID(),
		componentId: "",
		versionId: "",
		overrides: "",
	};
}

function TemplatesPanel({
	projectId,
	designId,
	onOpenElementChat,
}: {
	projectId: string;
	designId: string;
	onOpenElementChat?: (session: OpenElementChat) => void;
}) {
	const { data, isPending, error } = useProjectTemplates(projectId);
	const { data: library } = useProjectComponents(projectId, designId);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);
	const [name, setName] = useState("");
	const [slots, setSlots] = useState<SlotDraft[]>(() => [newSlotDraft()]);
	const [busy, setBusy] = useState(false);
	const [formError, setFormError] = useState<string | null>(null);
	const [deleting, setDeleting] = useState<string | null>(null);
	const [deleteError, setDeleteError] = useState<string | null>(null);
	const define = useDefineTemplate(projectId);
	const remove = useDeleteTemplate(projectId);
	const templates = data?.templates ?? [];
	const selected = templates.find((entry) => entry.id === selectedId) ?? null;
	const components = library?.components ?? [];

	async function submitCreate() {
		setFormError(null);
		// defineTemplate upserts by (project, name) and replace-alls the
		// named template's slots — a create-mode collision would silently
		// restomp an existing template and every block instantiating it.
		const finalName = name.trim();
		if (templates.some((entry) => entry.name === finalName)) {
			setFormError(
				`A template named “${finalName}” already exists — pick another name.`,
			);
			return;
		}
		const prepared: Array<{
			component: { name: string; version?: number };
			propsOverrides?: Record<string, unknown>;
		}> = [];
		for (const [index, slot] of slots.entries()) {
			const component = components.find(
				(entry) => entry.id === slot.componentId,
			);
			const version = component
				? pinnableVersions(component).find(
						(entry) => entry.id === slot.versionId,
					)
				: undefined;
			if (!component || !version) {
				setFormError(
					`Slot ${index}: pick a component with a published version.`,
				);
				return;
			}
			const preparedSlot: {
				component: { name: string; version?: number };
				propsOverrides?: Record<string, unknown>;
			} = {
				component: { name: component.name, version: version.version },
			};
			if (slot.overrides.trim() !== "") {
				try {
					preparedSlot.propsOverrides = JSON.parse(slot.overrides);
				} catch {
					setFormError(`Slot ${index}: overrides are not valid JSON.`);
					return;
				}
			}
			prepared.push(preparedSlot);
		}
		setBusy(true);
		try {
			await define.mutateAsync({ name, slots: prepared });
			setName("");
			setSlots([newSlotDraft()]);
			setCreating(false);
		} catch (e) {
			setFormError(
				e instanceof Error ? e.message : "Create failed — try again",
			);
		} finally {
			setBusy(false);
		}
	}

	return (
		<section className="flex-1">
			<PanelHeading title="Templates" count={templates.length} />
			{isPending ? (
				<p className="text-xs text-muted-foreground">Loading…</p>
			) : error ? (
				<p className="text-xs text-destructive">{error.message}</p>
			) : (
				<>
					{templates.length === 0 ? (
						<p className="text-xs text-muted-foreground">
							No templates yet — create the first one below.
						</p>
					) : (
						<ul className="space-y-1.5">
							{templates.map((template) => (
								<li key={template.id}>
									<div className="flex items-center gap-1">
										<button
											type="button"
											onClick={() =>
												setSelectedId((current) =>
													current === template.id ? null : template.id,
												)
											}
											aria-expanded={selected?.id === template.id}
											className="min-w-0 flex-1 rounded-md px-1.5 py-1 text-left text-xs transition-colors hover:bg-muted/50"
										>
											<span className="flex items-center gap-2">
												<span className="flex-1 truncate font-medium text-foreground">
													{template.name}
												</span>
												<span className="shrink-0 text-muted-foreground">
													{template.slots.length} slot
													{template.slots.length === 1 ? "" : "s"}
												</span>
											</span>
										</button>
										<ElementChatButton
											projectId={projectId}
											elementType="template"
											elementId={template.id}
											elementName={template.name}
											onOpenElementChat={onOpenElementChat}
										/>
										<Trash2IconButton
											label={`Delete template ${template.name}`}
											disabled={remove.isPending}
											onClick={() => setDeleting(template.id)}
										/>
									</div>
									{selected?.id === template.id && (
										<ul className="mt-1 space-y-1 pl-3">
											{template.slots.map((slot) => (
												<li
													key={slot.id}
													className="flex items-center gap-2 text-[11px] text-muted-foreground"
												>
													<span className="w-3 shrink-0 font-mono">
														{slot.ordinal}
													</span>
													<span className="min-w-0 flex-1 truncate text-foreground">
														{slot.componentName
															? `${slot.componentName} v${slot.version} (${slot.versionStatus})`
															: "missing pin"}
													</span>
													{slot.propsOverrides && (
														<span
															className="shrink-0 font-mono"
															title={JSON.stringify(slot.propsOverrides)}
														>
															overrides
														</span>
													)}
												</li>
											))}
										</ul>
									)}
								</li>
							))}
						</ul>
					)}
					<div className="mt-2">
						{creating ? (
							<div className="rounded-md border border-border/60 bg-muted/30 p-2">
								<p className="mb-1.5 text-[11px] font-medium text-foreground">
									New template
								</p>
								<Field
									aria-label="Template name"
									placeholder="LandingHero"
									value={name}
									onChange={(e) => setName(e.target.value)}
								/>
								<ul className="mt-1.5 space-y-1.5">
									{slots.map((slot, index) => {
										const draftComponent = components.find(
											(entry) => entry.id === slot.componentId,
										);
										const draftVersions = draftComponent
											? pinnableVersions(draftComponent)
											: [];
										return (
											<li
												key={slot.draftId}
												className="space-y-1 rounded-md bg-background/60 p-1.5"
											>
												<div className="flex items-center gap-1.5">
													<Choice
														aria-label={`Slot ${index} component`}
														value={slot.componentId}
														onChange={(e) => {
															const componentId = e.target.value;
															setSlots((current) =>
																current.map((entry, i) =>
																	i === index
																		? {
																				...entry,
																				componentId,
																				versionId: "",
																			}
																		: entry,
																),
															);
														}}
														className="flex-1"
													>
														<option value="">Pick a component…</option>
														{components.map((entry) => (
															<option key={entry.id} value={entry.id}>
																{componentLabel(entry)}
															</option>
														))}
													</Choice>
													{slots.length > 1 && (
														<Trash2IconButton
															label={`Remove slot ${index}`}
															onClick={() =>
																setSlots((current) =>
																	current.filter((_, i) => i !== index),
																)
															}
														/>
													)}
												</div>
												<Choice
													aria-label={`Slot ${index} version`}
													value={slot.versionId}
													onChange={(e) => {
														const versionId = e.target.value;
														setSlots((current) =>
															current.map((entry, i) =>
																i === index ? { ...entry, versionId } : entry,
															),
														);
													}}
													disabled={
														!draftComponent || draftVersions.length === 0
													}
												>
													<option value="">Pick a published version…</option>
													{draftVersions.map((version) => (
														<option key={version.id} value={version.id}>
															v{version.version}
														</option>
													))}
												</Choice>
												<Field
													aria-label={`Slot ${index} overrides JSON`}
													placeholder='{"heading":"Hi"} (optional)'
													value={slot.overrides}
													onChange={(e) => {
														const overrides = e.target.value;
														setSlots((current) =>
															current.map((entry, i) =>
																i === index ? { ...entry, overrides } : entry,
															),
														);
													}}
													className="font-mono"
												/>
											</li>
										);
									})}
								</ul>
								<Button
									type="button"
									variant="ghost"
									size="xs"
									onClick={() =>
										setSlots((current) => [...current, newSlotDraft()])
									}
								>
									<PlusIcon data-icon="inline-start" />
									Add slot
								</Button>
								{formError && (
									<p className="mt-1.5 text-[11px] text-destructive">
										{formError}
									</p>
								)}
								<div className="mt-2 flex gap-1.5">
									<Button
										type="button"
										size="xs"
										disabled={busy}
										onClick={() => void submitCreate()}
									>
										{busy ? (
											<Loader2Icon className="size-3 animate-spin" />
										) : (
											"Create template"
										)}
									</Button>
									<Button
										type="button"
										variant="ghost"
										size="xs"
										disabled={busy}
										onClick={() => setCreating(false)}
									>
										Cancel
									</Button>
								</div>
							</div>
						) : (
							<Button
								type="button"
								variant="outline"
								size="xs"
								onClick={() => setCreating(true)}
							>
								<PlusIcon data-icon="inline-start" />
								New template
							</Button>
						)}
					</div>
					{deleteError && (
						<p className="mt-1.5 text-[11px] text-destructive">{deleteError}</p>
					)}
				</>
			)}
			<Dialog
				open={deleting !== null}
				onOpenChange={(open) => {
					if (!open) setDeleting(null);
				}}
			>
				<DialogContent className="sm:max-w-xs">
					<DialogTitle>Delete template?</DialogTitle>
					<DialogDescription>
						Templates that page blocks instantiate cannot be deleted — remove
						those blocks first.
					</DialogDescription>
					{deleteError && (
						<p className="text-xs text-destructive">{deleteError}</p>
					)}
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => setDeleting(null)}
							disabled={remove.isPending}
						>
							Cancel
						</Button>
						<Button
							type="button"
							variant="destructive"
							size="sm"
							disabled={remove.isPending}
							onClick={async () => {
								if (!deleting) return;
								setDeleteError(null);
								try {
									await remove.mutateAsync(deleting);
									setDeleting(null);
									if (selectedId === deleting) setSelectedId(null);
								} catch (e) {
									setDeleteError(
										e instanceof Error
											? e.message
											: "Delete failed — try again",
									);
								}
							}}
						>
							{remove.isPending ? "Deleting…" : "Delete"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</section>
	);
}

// ---------------------------------------------------------------------------
// Flows panel: create (with steps) / inspect / delete. Steps are edited as
// ordered page refs with entry/exit actions; the write is defineFlow's
// upsert-by-name replace-all.
// ---------------------------------------------------------------------------

/**
 * Unsaved step drafts — like slot drafts, keyed by a local id so reorder
 * state stays stable (steps have no identity until the flow is saved).
 */
type StepDraft = {
	draftId: string;
	pageId: string;
	entryAction: string;
	exitTarget: string;
};

function newStepDraft(): StepDraft {
	return {
		draftId: crypto.randomUUID(),
		pageId: "",
		entryAction: "",
		exitTarget: "",
	};
}

function FlowsPanel({
	projectId,
	onOpenElementChat,
}: {
	projectId: string;
	onOpenElementChat?: (session: OpenElementChat) => void;
}) {
	const { data, isPending, error } = useProjectFlows(projectId);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [editingName, setEditingName] = useState<string | null>(null);
	const [deleteError, setDeleteError] = useState<string | null>(null);
	const [deleting, setDeleting] = useState<string | null>(null);
	const remove = useDeleteFlow(projectId);
	const flows = data?.flows ?? [];
	const pages = data?.pages ?? [];
	const selected = flows.find((entry) => entry.id === selectedId) ?? null;

	return (
		<section className="flex-1">
			<PanelHeading title="Flows" count={flows.length} />
			{isPending ? (
				<p className="text-xs text-muted-foreground">Loading…</p>
			) : error ? (
				<p className="text-xs text-destructive">{error.message}</p>
			) : (
				<>
					{flows.length === 0 ? (
						<p className="text-xs text-muted-foreground">
							No flows yet — create the first one below.
						</p>
					) : (
						<ul className="space-y-1.5">
							{flows.map((flow) => (
								<li key={flow.id}>
									<div className="flex items-center gap-1">
										<button
											type="button"
											onClick={() =>
												setSelectedId((current) =>
													current === flow.id ? null : flow.id,
												)
											}
											aria-expanded={selected?.id === flow.id}
											className="min-w-0 flex-1 rounded-md px-1.5 py-1 text-left text-xs transition-colors hover:bg-muted/50"
										>
											<span className="flex items-center gap-2">
												<span className="flex-1 truncate font-medium text-foreground">
													{flow.name}
												</span>
												<span className="shrink-0 text-muted-foreground">
													{flow.steps.length} step
													{flow.steps.length === 1 ? "" : "s"}
												</span>
											</span>
										</button>
										<ElementChatButton
											projectId={projectId}
											elementType="flow"
											elementId={flow.id}
											elementName={flow.name}
											onOpenElementChat={onOpenElementChat}
										/>
										<Trash2IconButton
											label={`Delete flow ${flow.name}`}
											disabled={remove.isPending}
											onClick={() => setDeleting(flow.id)}
										/>
										<Button
											type="button"
											variant="ghost"
											size="xs"
											className="h-6 px-2 text-[11px]"
											onClick={() =>
												setEditingName((current) =>
													current === flow.name ? null : flow.name,
												)
											}
										>
											Edit
										</Button>
									</div>
									{selected?.id === flow.id && editingName !== flow.name && (
										<ol className="mt-1 space-y-1 pl-3">
											{flow.steps.map((step) => (
												<li
													key={step.id}
													className="text-[11px] text-muted-foreground"
												>
													<span className="font-mono">{step.ordinal}</span>{" "}
													<span className="text-foreground">
														{step.pagePath}
													</span>
													{step.entryAction && (
														<span title={`enter: ${step.entryAction}`}>
															{" "}
															· enters via “{step.entryAction}”
														</span>
													)}
													{step.exitTarget && (
														<span title={`exit: ${step.exitTarget}`}>
															{" "}
															· exits via “{step.exitTarget}”
														</span>
													)}
												</li>
											))}
										</ol>
									)}
									{editingName === flow.name && (
										<FlowForm
											projectId={projectId}
											pages={pages}
											flow={flow}
											takenNames={flows.map((entry) => entry.name)}
											onDone={() => setEditingName(null)}
										/>
									)}
								</li>
							))}
						</ul>
					)}
					<div className="mt-2">
						<FlowForm
							projectId={projectId}
							pages={pages}
							flow={null}
							takenNames={flows.map((entry) => entry.name)}
							onDone={() => undefined}
						/>
					</div>
					{deleteError && (
						<p className="mt-1.5 text-[11px] text-destructive">{deleteError}</p>
					)}
				</>
			)}
			<Dialog
				open={deleting !== null}
				onOpenChange={(open) => {
					if (!open) setDeleting(null);
				}}
			>
				<DialogContent className="sm:max-w-xs">
					<DialogTitle>Delete flow?</DialogTitle>
					<DialogDescription>
						The flow and its steps are removed; the pages themselves stay.
					</DialogDescription>
					{deleteError && (
						<p className="text-xs text-destructive">{deleteError}</p>
					)}
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => setDeleting(null)}
							disabled={remove.isPending}
						>
							Cancel
						</Button>
						<Button
							type="button"
							variant="destructive"
							size="sm"
							disabled={remove.isPending}
							onClick={async () => {
								if (!deleting) return;
								setDeleteError(null);
								try {
									await remove.mutateAsync(deleting);
									setDeleting(null);
									if (selectedId === deleting) setSelectedId(null);
								} catch (e) {
									setDeleteError(
										e instanceof Error
											? e.message
											: "Delete failed — try again",
									);
								}
							}}
						>
							{remove.isPending ? "Deleting…" : "Delete"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</section>
	);
}

function FlowForm({
	projectId,
	pages,
	flow,
	takenNames,
	onDone,
}: {
	projectId: string;
	pages: Array<{ id: string; path: string; title: string }>;
	/** Existing flow to edit (prefilled), or null to create a new one. */
	flow: {
		name: string;
		steps: Array<{
			pageId: string;
			entryAction: string | null;
			exitTarget: string | null;
		}>;
	} | null;
	/** Every flow name that already exists in the project (for create-mode
	 * collision rejection — flows are identified by (project, name)). */
	takenNames: string[];
	onDone: () => void;
}) {
	const define = useDefineFlow(projectId);
	const editing = flow !== null;
	const [name, setName] = useState(flow?.name ?? "");
	const [steps, setSteps] = useState<StepDraft[]>(() =>
		flow
			? flow.steps.map((step) => ({
					draftId: crypto.randomUUID(),
					pageId: step.pageId,
					entryAction: step.entryAction ?? "",
					exitTarget: step.exitTarget ?? "",
				}))
			: [newStepDraft()],
	);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function submit() {
		setError(null);
		// Flows are identified by (project, name) — the write behind this
		// form is a full replace-all of the named flow's steps, so a name
		// change in edit mode would create a clone (or overwrite another
		// flow), and a create-mode collision would silently restomp an
		// existing flow. Freeze the name when editing; reject collisions
		// before any write.
		const finalName = name.trim();
		if (!editing && takenNames.includes(finalName)) {
			setError(
				`A flow named “${finalName}” already exists — edit it instead of redefining it.`,
			);
			return;
		}
		const prepared: Array<{
			path: string;
			entryAction?: string;
			exitTarget?: string;
		}> = [];
		for (const [index, step] of steps.entries()) {
			const page = pages.find((entry) => entry.id === step.pageId);
			if (!page) {
				setError(`Step ${index}: pick a page.`);
				return;
			}
			prepared.push({
				path: page.path,
				...(step.entryAction.trim() !== ""
					? { entryAction: step.entryAction }
					: {}),
				...(step.exitTarget.trim() !== ""
					? { exitTarget: step.exitTarget }
					: {}),
			});
		}
		setBusy(true);
		try {
			await define.mutateAsync({ name, steps: prepared });
			setName("");
			setSteps([newStepDraft()]);
			onDone();
		} catch (e) {
			setError(e instanceof Error ? e.message : "Save failed — try again");
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="mt-1.5 rounded-md border border-border/60 bg-muted/30 p-2">
			<p className="mb-1.5 text-[11px] font-medium text-foreground">
				{flow ? `Edit ${flow.name}` : "New flow"}
			</p>
			<Field
				aria-label="Flow name"
				placeholder="Onboarding"
				value={name}
				disabled={editing}
				title={
					editing
						? "Flow names are fixed once created — flows are identified by name"
						: undefined
				}
				onChange={(e) => setName(e.target.value)}
			/>
			<ul className="mt-1.5 space-y-1.5">
				{steps.map((step, index) => (
					<li
						key={step.draftId}
						className="space-y-1 rounded-md bg-background/60 p-1.5"
					>
						<div className="flex items-center gap-1">
							<Choice
								aria-label={`Step ${index} page`}
								value={step.pageId}
								onChange={(e) => {
									const pageId = e.target.value;
									setSteps((current) =>
										current.map((entry, i) =>
											i === index ? { ...entry, pageId } : entry,
										),
									);
								}}
								className="flex-1"
							>
								<option value="">Pick a page…</option>
								{pages.map((page) => (
									<option key={page.id} value={page.id}>
										{page.path} — {page.title}
									</option>
								))}
							</Choice>
							<MoveIconButton
								label={`Move step ${index} up`}
								direction="up"
								disabled={index === 0}
								onClick={() =>
									setSteps((current) => {
										const next = [...current];
										const [moved] = next.splice(index, 1);
										next.splice(index - 1, 0, moved);
										return next;
									})
								}
							/>
							<MoveIconButton
								label={`Move step ${index} down`}
								direction="down"
								disabled={index === steps.length - 1}
								onClick={() =>
									setSteps((current) => {
										const next = [...current];
										const [moved] = next.splice(index, 1);
										next.splice(index + 1, 0, moved);
										return next;
									})
								}
							/>
							<Trash2IconButton
								label={`Remove step ${index}`}
								disabled={steps.length === 1}
								onClick={() =>
									setSteps((current) => current.filter((_, i) => i !== index))
								}
							/>
						</div>
						<div className="flex gap-1.5">
							<Field
								aria-label={`Step ${index} entry action`}
								placeholder="entry action (optional)"
								value={step.entryAction}
								onChange={(e) => {
									const entryAction = e.target.value;
									setSteps((current) =>
										current.map((entry, i) =>
											i === index ? { ...entry, entryAction } : entry,
										),
									);
								}}
								className="flex-1"
							/>
							<Field
								aria-label={`Step ${index} exit target`}
								placeholder="exit action (optional)"
								value={step.exitTarget}
								onChange={(e) => {
									const exitTarget = e.target.value;
									setSteps((current) =>
										current.map((entry, i) =>
											i === index ? { ...entry, exitTarget } : entry,
										),
									);
								}}
								className="flex-1"
							/>
						</div>
					</li>
				))}
			</ul>
			<Button
				type="button"
				variant="ghost"
				size="xs"
				onClick={() => setSteps((current) => [...current, newStepDraft()])}
			>
				<PlusIcon data-icon="inline-start" />
				Add step
			</Button>
			{error && <p className="mt-1.5 text-[11px] text-destructive">{error}</p>}
			<div className="mt-2 flex gap-1.5">
				<Button
					type="button"
					size="xs"
					disabled={busy || name.trim() === ""}
					onClick={() => void submit()}
				>
					{busy ? (
						<Loader2Icon className="size-3 animate-spin" />
					) : flow ? (
						"Save flow"
					) : (
						"Create flow"
					)}
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="xs"
					disabled={busy}
					onClick={() => {
						setName("");
						setSteps([newStepDraft()]);
						onDone();
					}}
				>
					{flow ? "Cancel" : "Clear"}
				</Button>
			</div>
		</div>
	);
}
