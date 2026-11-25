import { Link } from "@tanstack/react-router";
import { ArrowLeft, ExternalLink } from "lucide-react";
import type { Design, DesignDetail } from "@/client/api-types";
import { relativeTime } from "@/client/formatting";
import { cn } from "@/client/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function StudioTopBar({
	project,
	detail,
	onBack,
	projectLink,
	rightSlot,
}: {
	project: Design;
	detail: DesignDetail | null;
	onBack: () => void;
	/** Breadcrumb target when the design is filed into a container. */
	projectLink?: { id: string; name: string } | null;
	rightSlot?: React.ReactNode;
}) {
	const title =
		project.prompt.length > 70
			? `${project.prompt.slice(0, 70)}…`
			: project.prompt;
	const fileCount = detail?.files.length ?? 0;
	const isLive = project.status === "chatting";

	return (
		<header className="flex h-14 flex-shrink-0 items-center gap-2 border-b border-border bg-[#151519] px-4 md:gap-4">
			<Button
				type="button"
				variant="ghost"
				size="icon"
				onClick={onBack}
				aria-label="Back to designs"
			>
				<ArrowLeft className="size-4" />
			</Button>

			{projectLink && (
				<Link
					to="/projects/$id"
					params={{ id: projectLink.id }}
					className="hidden max-w-40 shrink-0 truncate rounded-md px-2 py-1 text-xs text-muted-foreground ring-1 ring-foreground/10 transition-colors outline-none hover:text-foreground hover:ring-foreground/25 focus-visible:ring-[3px] focus-visible:ring-ring/50 md:block"
				>
					{projectLink.name}
				</Link>
			)}

			<div className="flex min-w-0 flex-1 flex-col md:flex-none">
				<h1
					title={project.prompt}
					className="truncate text-sm font-semibold text-foreground"
				>
					{title}
				</h1>
				<p className="truncate text-xs text-muted-foreground">
					Created {relativeTime(project.createdAt)}
					{fileCount > 0
						? ` · ${fileCount} file${fileCount === 1 ? "" : "s"}`
						: ""}
				</p>
			</div>

			<div className="ml-auto flex items-center gap-2 md:gap-3">
				<Badge
					variant="secondary"
					className={cn(
						"gap-1.5",
						isLive && "bg-emerald-500/10 text-emerald-400",
					)}
				>
					<span
						className={cn(
							"size-1.5 rounded-full",
							isLive ? "bg-emerald-400 animate-pulse" : "bg-muted-foreground",
						)}
					/>
					{isLive ? "Live" : project.status}
				</Badge>

				<Button
					variant="ghost"
					size="sm"
					asChild
					className="hidden md:inline-flex"
				>
					<a
						href={`/designs/${project.id}/site`}
						target="_blank"
						rel="noreferrer"
					>
						Design <ExternalLink className="ml-1 size-3" />
					</a>
				</Button>
				<Button
					variant="ghost"
					size="sm"
					asChild
					className="hidden md:inline-flex"
				>
					<a
						href={`/designs/${project.id}/preview`}
						target="_blank"
						rel="noreferrer"
					>
						Preview <ExternalLink className="ml-1 size-3" />
					</a>
				</Button>
				{/* Mobile keeps one icon-sized entry point to the published site;
					the full Design/Preview pair returns at md+. */}
				<Button variant="ghost" size="icon" asChild className="md:hidden">
					<a
						href={`/designs/${project.id}/site`}
						target="_blank"
						rel="noreferrer"
						aria-label="Open published design"
					>
						<ExternalLink className="size-4" />
					</a>
				</Button>

				{rightSlot}

				<Badge className="hidden bg-accent text-accent-foreground md:inline-flex">
					Auto-published
				</Badge>
			</div>
		</header>
	);
}
