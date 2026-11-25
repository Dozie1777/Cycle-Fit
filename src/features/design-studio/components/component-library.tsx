import { Loader2Icon, PinIcon, RotateCcwIcon } from "lucide-react";
import { useState } from "react";
import type {
	DesignPagePins,
	LibraryComponent,
	LibraryVersion,
} from "@/client/api-types";
import {
	useProjectComponents,
	usePublishComponentVersion,
	useRepinBlock,
	useRestoreComponentVersion,
	useRetireComponent,
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
import { ElementChatButton } from "./element-chat-button";
import type { OpenElementChat } from "./element-chat-panel";
import { useBlockSelection } from "./selection-bridge";

// ---------------------------------------------------------------------------
// Component library (KUK-927): the project's reusable building blocks with
// their version timelines and lifecycle actions, plus the current design's
// pinned blocks with a one-click re-pin. Rendered inside the studio
// inspector above the (design-level) version history.
// ---------------------------------------------------------------------------

function statusDotClass(status: LibraryVersion["status"]): string {
	if (status === "published") return "bg-emerald-400";
	if (status === "draft") return "bg-amber-400";
	return "bg-muted-foreground";
}

/** One-line state for the component list: published / draft / retired. */
function componentStatusLine(component: LibraryComponent): string {
	if (component.publishedVersion != null) {
		return `published v${component.publishedVersion}`;
	}
	if (component.draftVersion != null) {
		return `draft v${component.draftVersion}`;
	}
	const latest = component.versions[0];
	if (latest && latest.status === "retired") return "retired";
	return "no versions";
}

export function ComponentLibrary({
	projectId,
	designId,
	className,
	onOpenElementChat,
}: {
	projectId: string;
	designId: string;
	className?: string;
	/** A component row's Chat action opens the focused element chat. */
	onOpenElementChat?: (session: OpenElementChat) => void;
}) {
	const { data, isPending, error } = useProjectComponents(projectId, designId);
	const [selectedId, setSelectedId] = useState<string | null>(null);

	const components = data?.components ?? [];
	const selected =
		components.find((component) => component.id === selectedId) ?? null;

	return (
		<>
			<section className={cn("flex-1", className)}>
				<h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
					Components
					{components.length > 0 && (
						<span className="text-muted-foreground">({components.length})</span>
					)}
				</h3>
				{isPending ? (
					<p className="text-xs text-muted-foreground">Loading…</p>
				) : error ? (
					<p className="text-xs text-destructive">{error.message}</p>
				) : components.length === 0 ? (
					<p className="text-xs text-muted-foreground">
						No components yet — the designer saves reusable building blocks from
						chat.
					</p>
				) : (
					<>
						<ul className="space-y-1.5">
							{components.map((component) => (
								<li key={component.id} className="flex items-center gap-1">
									<button
										type="button"
										onClick={() =>
											setSelectedId((current) =>
												current === component.id ? null : component.id,
											)
										}
										aria-expanded={selected?.id === component.id}
										className="min-w-0 flex-1 rounded-md px-1.5 py-1 text-left text-xs transition-colors hover:bg-muted/50"
									>
										<span className="flex items-center gap-2">
											<span className="flex-1 truncate font-medium text-foreground">
												{component.name}
											</span>
											<span className="shrink-0 text-muted-foreground">
												{componentStatusLine(component)}
											</span>
										</span>
										<span className="block truncate font-mono text-[10px] text-muted-foreground">
											{component.tagName} · {component.kind}
										</span>
									</button>
									<ElementChatButton
										projectId={projectId}
										elementType="component"
										elementId={component.id}
										elementName={component.name}
										onOpenElementChat={onOpenElementChat}
									/>
								</li>
							))}
						</ul>
						{selected && (
							<ComponentTimeline projectId={projectId} component={selected} />
						)}
					</>
				)}
			</section>
			{!isPending && !error && data?.pages && (
				<PagePins
					projectId={projectId}
					designId={designId}
					pages={data.pages}
					components={components}
				/>
			)}
		</>
	);
}

/**
 * The selected component's full version timeline with its lifecycle actions:
 * publish the draft, restore (republish) an old version, retire the live one.
 * Restores never mutate old rows — they copy the source into a new version
 * and run the same publish flow, so the wording below matches the handler.
 */
function ComponentTimeline({
	projectId,
	component,
}: {
	projectId: string;
	component: LibraryComponent;
}) {
	const publish = usePublishComponentVersion(projectId);
	const restore = useRestoreComponentVersion(projectId);
	const retire = useRetireComponent(projectId);
	const [restoring, setRestoring] = useState<LibraryVersion | null>(null);
	const [retiring, setRetiring] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function run(
		action: () => Promise<unknown>,
		fallback: string,
	): Promise<boolean> {
		setError(null);
		try {
			await action();
			return true;
		} catch (e) {
			setError(e instanceof Error ? e.message : fallback);
			return false;
		}
	}

	return (
		<div className="mt-2 rounded-md border border-border/60 bg-muted/30 p-2">
			<div className="mb-1.5 flex items-center justify-between gap-2">
				<p className="truncate font-mono text-[10px] text-muted-foreground">
					{component.tagName}
				</p>
				{component.publishedVersionId && (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="h-6 px-2 text-[11px] text-destructive hover:text-destructive"
						disabled={retire.isPending}
						onClick={() => {
							setError(null);
							setRetiring(true);
						}}
					>
						Retire
					</Button>
				)}
			</div>
			<ul className="space-y-1">
				{component.versions.map((version) => (
					<li
						key={version.id}
						className="flex items-center gap-1.5 text-xs text-foreground"
					>
						<span
							className={cn(
								"size-1.5 shrink-0 rounded-full",
								statusDotClass(version.status),
							)}
							title={version.status}
						/>
						<span className="w-7 shrink-0 font-mono">v{version.version}</span>
						<span
							className="min-w-0 flex-1 truncate text-muted-foreground"
							title={
								version.changeNote ??
								`created ${new Date(version.createdAt).toLocaleString()}`
							}
						>
							{version.changeNote ?? version.status}
						</span>
						{version.createdTurnId && (
							<span
								className="shrink-0 font-mono text-[10px] text-muted-foreground"
								title={`authored by turn ${version.createdTurnId}`}
							>
								turn {version.createdTurnId.slice(0, 8)}
							</span>
						)}
						{version.pinCount > 0 && (
							<span
								className="shrink-0 text-[10px] text-muted-foreground"
								title={`${version.pinCount} page block(s) pin this version — pins never move automatically`}
							>
								{version.pinCount} pin{version.pinCount === 1 ? "" : "s"}
							</span>
						)}
						{version.demoDocUrl && (
							<a
								href={version.demoDocUrl}
								target="_blank"
								rel="noreferrer"
								className="shrink-0 text-[10px] text-primary hover:underline"
								title="Open this version's demo document"
							>
								demo
							</a>
						)}
						{version.status === "draft" && (
							<Button
								type="button"
								variant="ghost"
								size="sm"
								className="h-6 px-2 text-[11px]"
								disabled={publish.isPending}
								onClick={() => {
									void run(
										() =>
											publish.mutateAsync({
												componentId: component.id,
												versionId: version.id,
											}),
										"Publish failed — try again",
									);
								}}
							>
								{publish.isPending ? (
									<Loader2Icon className="size-3 animate-spin" />
								) : (
									"Publish"
								)}
							</Button>
						)}
						{version.status === "retired" && (
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								aria-label={`Restore version ${version.version}`}
								title={`Restore version ${version.version}`}
								disabled={restore.isPending}
								onClick={() => {
									setError(null);
									setRestoring(version);
								}}
							>
								<RotateCcwIcon className="size-3" />
							</Button>
						)}
					</li>
				))}
			</ul>
			{error && <p className="mt-1.5 text-[11px] text-destructive">{error}</p>}

			{/* Restore confirm: restore = republish (a NEW version copies the
			    old row; the live version, if any, is retired). */}
			<Dialog
				open={restoring !== null}
				onOpenChange={(open) => {
					if (!open) setRestoring(null);
				}}
			>
				<DialogContent className="sm:max-w-xs">
					<DialogTitle>Restore v{restoring?.version}?</DialogTitle>
					<DialogDescription>
						Restoring creates a new version with this content and publishes it.
						The currently published version (if any) is retired; pins stay where
						they are until you re-pin them.
					</DialogDescription>
					{error && <p className="text-xs text-destructive">{error}</p>}
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => setRestoring(null)}
							disabled={restore.isPending}
						>
							Cancel
						</Button>
						<Button
							type="button"
							size="sm"
							disabled={restore.isPending}
							onClick={async () => {
								if (!restoring) return;
								const done = await run(
									() =>
										restore.mutateAsync({
											componentId: component.id,
											versionId: restoring.id,
										}),
									"Restore failed — try again",
								);
								if (done) setRestoring(null);
							}}
						>
							{restore.isPending ? "Restoring…" : "Restore"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Retire confirm: destructive — nothing is live afterwards. */}
			<Dialog
				open={retiring}
				onOpenChange={(open) => {
					if (!open) setRetiring(false);
				}}
			>
				<DialogContent className="sm:max-w-xs">
					<DialogTitle>
						Retire {component.name} v{component.publishedVersion}?
					</DialogTitle>
					<DialogDescription>
						The published version is retired and nothing is live for this
						component. Pages keep rendering their pinned versions, but new
						blocks can&apos;t use it until something is published again.
					</DialogDescription>
					{error && <p className="text-xs text-destructive">{error}</p>}
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => setRetiring(false)}
							disabled={retire.isPending}
						>
							Cancel
						</Button>
						<Button
							type="button"
							variant="destructive"
							size="sm"
							disabled={retire.isPending}
							onClick={async () => {
								const done = await run(
									() => retire.mutateAsync(component.id),
									"Retire failed — try again",
								);
								if (done) setRetiring(false);
							}}
						>
							{retire.isPending ? "Retiring…" : "Retire"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}

/**
 * The design's pinned blocks with the one-click re-pin: a block whose pinned
 * version is not the component's currently published one (typically retired
 * by a newer publish) can be moved forward explicitly — pins never re-point
 * themselves (KUK-917 manual re-pin model).
 */
function PagePins({
	projectId,
	designId,
	pages,
	components,
}: {
	projectId: string;
	designId: string;
	pages: DesignPagePins[];
	components: LibraryComponent[];
}) {
	const repin = useRepinBlock(projectId);
	// KUK-929 selection bridge: a block row click selects it (the preview
	// scrolls to and outlines the element), and a selection made from the
	// preview highlights the row here. Stale ids (block deleted while the
	// preview was open) match no row and are ignored silently.
	const { selectedBlockId, selectBlock } = useBlockSelection();
	const [busyPage, setBusyPage] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const componentById = new Map(components.map((entry) => [entry.id, entry]));
	const stale = pages.map((page) => ({
		page,
		blocks: page.blocks.filter((block) => {
			if (block.kind !== "component" || !block.componentId) return false;
			const component = componentById.get(block.componentId);
			if (!component) return false;
			if (block.versionStatus === "retired") return true;
			return (
				component.publishedVersion != null &&
				block.version != null &&
				block.version !== component.publishedVersion
			);
		}),
	}));
	const actionable = stale.filter(({ blocks }) => blocks.length > 0);

	async function repinBlock(
		page: DesignPagePins,
		block: DesignPagePins["blocks"][number],
	): Promise<void> {
		if (!block.componentId) return;
		setError(null);
		try {
			await repin.mutateAsync({
				designId,
				pageId: page.id,
				blockId: block.id,
				componentId: block.componentId,
			});
		} catch (e) {
			setError(e instanceof Error ? e.message : "Re-pin failed — try again");
		}
	}

	if (pages.length === 0) return null;

	return (
		<section className="flex-1">
			<h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
				<PinIcon className="size-3.5" />
				Blocks
			</h3>
			{actionable.length === 0 ? (
				<p className="text-xs text-muted-foreground">
					All pinned blocks use the currently published versions.
				</p>
			) : (
				<ul className="space-y-2">
					{actionable.map(({ page, blocks }) => (
						<li key={page.id} className="text-xs">
							<div className="flex items-center justify-between gap-2">
								<p
									className="min-w-0 flex-1 truncate font-medium text-foreground"
									title={page.path}
								>
									{page.path}
								</p>
								{blocks.length > 1 && (
									<Button
										type="button"
										variant="outline"
										size="sm"
										className="h-6 px-2 text-[11px]"
										disabled={
											repin.isPending ||
											(busyPage !== null && busyPage !== page.id)
										}
										onClick={async () => {
											setBusyPage(page.id);
											for (const block of blocks) {
												await repinBlock(page, block);
											}
											setBusyPage(null);
										}}
									>
										Re-pin all ({blocks.length})
									</Button>
								)}
							</div>
							<ul className="mt-1 space-y-1">
								{blocks.map((block) => {
									const component = block.componentId
										? componentById.get(block.componentId)
										: undefined;
									const draftNote =
										component &&
										component.draftVersion != null &&
										component.publishedVersion != null &&
										component.draftVersion > component.publishedVersion
											? ` · draft v${component.draftVersion} in progress`
											: "";
									const target = component?.publishedVersion
										? `v${component.publishedVersion} published${draftNote}`
										: "nothing published";
									return (
										<li
											key={block.id}
											className={cn(
												"flex items-center gap-2 text-muted-foreground",
												selectedBlockId === block.id &&
													"rounded-md bg-primary/10 text-foreground",
											)}
										>
											<button
												type="button"
												onClick={() =>
													selectBlock(
														selectedBlockId === block.id ? null : block.id,
													)
												}
												aria-pressed={selectedBlockId === block.id}
												className="min-w-0 flex-1 truncate text-left hover:underline"
												title={`${component?.tagName ?? block.tagName ?? ""} v${block.version} pinned`}
											>
												{block.componentName ?? "component"} v{block.version} —{" "}
												{target}
											</button>
											<Button
												type="button"
												variant="outline"
												size="sm"
												className="h-6 shrink-0 px-2 text-[11px]"
												disabled={
													repin.isPending || component?.publishedVersion == null
												}
												onClick={() => {
													void repinBlock(page, block);
												}}
											>
												{component?.publishedVersion != null
													? `Re-pin to v${component.publishedVersion}`
													: "Can't re-pin"}
											</Button>
										</li>
									);
								})}
							</ul>
						</li>
					))}
				</ul>
			)}
			{error && <p className="mt-1.5 text-[11px] text-destructive">{error}</p>}
		</section>
	);
}
