import { ExternalLink, History, RotateCcwIcon } from "lucide-react";
import { useState } from "react";
import type { Design, DesignDetail, DesignVersion } from "@/client/api-types";
import { formatBytes, relativeTime } from "@/client/formatting";
import { useDesignVersions, useRestoreDesignVersion } from "@/client/queries";
import { cn } from "@/client/utils";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogTitle,
} from "@/components/ui/dialog";
import { BuildingBlocks } from "./building-blocks";
import type { OpenElementChat } from "./element-chat-panel";

function fileDotClass(path: string): string {
	if (path === "preview.png") return "bg-accent";
	if (/\.(html|css|js|ts|jsx|tsx|json)$/.test(path)) return "bg-cyan-400";
	return "bg-muted-foreground";
}

export function StudioInspector({
	project,
	detail,
	className,
	onOpenElementChat,
}: {
	project: Design;
	detail: DesignDetail | null;
	className?: string;
	/** Orchestrator handoff (KUK-945): a building-block row's Chat action. */
	onOpenElementChat?: (session: OpenElementChat) => void;
}) {
	const files = detail?.files ?? [];
	const activity = [...files].sort(
		(a, b) =>
			new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime(),
	);

	return (
		<div
			className={cn(
				"flex h-full flex-col gap-4 overflow-y-auto bg-background p-3",
				className,
			)}
		>
			<section className="rounded-lg border border-border bg-card p-3">
				<h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
					Status
				</h3>
				<div className="flex items-center gap-2 text-sm text-foreground">
					<span
						className={cn(
							"size-2 rounded-full",
							project.status === "chatting"
								? "bg-emerald-400 animate-pulse"
								: project.status === "failed"
									? "bg-destructive"
									: "bg-primary",
						)}
					/>
					<span className="capitalize">{project.status}</span>
				</div>
				{project.error && (
					<p className="mt-2 text-xs text-destructive">{project.error}</p>
				)}
			</section>

			{/* KUK-928: tabbed building-block views — the KUK-927 component
			    library stays the default tab, plus the page composer, data
			    collections, templates and flows panels. */}
			<BuildingBlocks
				projectId={project.projectId}
				designId={project.id}
				onOpenElementChat={onOpenElementChat}
			/>

			<VersionHistory
				projectId={project.id}
				publication={detail?.publication ?? null}
			/>

			<section className="flex-1">
				<h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
					Files
					{files.length > 0 && (
						<span className="ml-1 text-muted-foreground">({files.length})</span>
					)}
				</h3>
				{files.length === 0 ? (
					<p className="text-xs text-muted-foreground">No files yet.</p>
				) : (
					<ul className="space-y-1.5">
						{files.map((file) => (
							<li key={file.path} className="flex items-center gap-2 text-xs">
								<span
									className={cn(
										"size-1.5 rounded-full",
										fileDotClass(file.path),
									)}
								/>
								<a
									href={`/designs/${project.id}/file/${file.path}`}
									target="_blank"
									rel="noreferrer"
									className="flex-1 truncate text-foreground hover:underline"
									title={file.path}
								>
									{file.path}
								</a>
								<span className="text-muted-foreground">
									{formatBytes(file.size)}
								</span>
							</li>
						))}
					</ul>
				)}
			</section>

			<section className="flex-1">
				<h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
					Activity
				</h3>
				{activity.length === 0 ? (
					<p className="text-xs text-muted-foreground">No activity yet.</p>
				) : (
					<ul className="space-y-2">
						{activity.slice(0, 8).map((file) => (
							<li key={file.path} className="text-xs">
								<p className="truncate text-foreground" title={file.path}>
									{file.path}
								</p>
								<p className="text-muted-foreground">
									{formatBytes(file.size)} · {relativeTime(file.lastModified)}
								</p>
							</li>
						))}
					</ul>
				)}
			</section>

			<div className="mt-auto" />
		</div>
	);
}

/**
 * Published-version snapshots with restore (F25). The versions/restore API
 * shipped server-side with no UI — a bad auto-publish was unrecoverable in
 * product. Restoring rewrites the live keys, so the preview picks the new
 * content up through the existing revision mechanism.
 */
function VersionHistory({
	projectId,
	publication,
}: {
	projectId: string;
	publication: DesignDetail["publication"];
}) {
	const { data: versions, isPending } = useDesignVersions(projectId);
	const [restoring, setRestoring] = useState<DesignVersion | null>(null);
	const restore = useRestoreDesignVersion();
	const [error, setError] = useState<string | null>(null);

	async function handleRestore() {
		if (!restoring) return;
		setError(null);
		try {
			await restore.mutateAsync({ projectId, version: restoring.n });
			setRestoring(null);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Restore failed — try again");
		}
	}

	return (
		<section className="flex-1">
			<h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
				<History className="size-3.5" />
				History
				{versions && versions.length > 0 && (
					<span className="text-muted-foreground">({versions.length})</span>
				)}
			</h3>
			{publication && (
				<div className="mb-2 flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-2 py-1.5 text-xs">
					<span className="min-w-0 flex-1 truncate text-foreground">
						Published v{publication.version} ·{" "}
						{relativeTime(publication.createdAt)}
					</span>
					<a
						href={`/designs/${projectId}/publication/${publication.version}`}
						target="_blank"
						rel="noreferrer"
						className="flex shrink-0 items-center gap-1 text-[11px] text-primary hover:underline"
						title="Open the published snapshot (time-travel view)"
					>
						<ExternalLink className="size-3" />
						Snapshot
					</a>
				</div>
			)}
			{isPending ? (
				<p className="text-xs text-muted-foreground">Loading…</p>
			) : !versions || versions.length === 0 ? (
				<p className="text-xs text-muted-foreground">
					No versions yet — snapshots appear each time the designer publishes.
				</p>
			) : (
				<ul className="space-y-1.5">
					{versions.slice(0, 10).map((version) => (
						<li
							key={version.n}
							className="flex items-center gap-2 text-xs text-foreground"
						>
							<span className="w-10 shrink-0 font-mono">v{version.n}</span>
							<span className="flex-1 truncate text-muted-foreground">
								{relativeTime(version.createdAt)}
							</span>
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								aria-label={`Restore version ${version.n}`}
								title={`Restore version ${version.n}`}
								onClick={() => {
									setError(null);
									setRestoring(version);
								}}
							>
								<RotateCcwIcon className="size-3.5" />
							</Button>
						</li>
					))}
				</ul>
			)}
			<Dialog
				open={restoring !== null}
				onOpenChange={(open) => {
					if (!open) setRestoring(null);
				}}
			>
				<DialogContent className="sm:max-w-xs">
					<DialogTitle>Restore version v{restoring?.n}?</DialogTitle>
					<DialogDescription>
						The current live page is replaced by this snapshot and saved as a
						new version, so this can be undone from the same list.
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
							onClick={handleRestore}
							disabled={restore.isPending}
						>
							{restore.isPending ? "Restoring…" : "Restore"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</section>
	);
}
