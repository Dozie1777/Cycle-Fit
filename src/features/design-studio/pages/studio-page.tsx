import { useState } from "react";
import { useDesign, useInvalidateDesign, useProjects } from "@/client/queries";
import { CommandPalette } from "@/components/app-shell/command-palette";
import type { OpenElementChat } from "@/features/design-studio/components/element-chat-panel";
import { BlockSelectionProvider } from "@/features/design-studio/components/selection-bridge";
import { StudioLayout } from "@/features/design-studio/components/studio-layout";

export function StudioPage({
	id,
	onClose,
}: {
	id: string;
	onClose: () => void;
}) {
	const { data: detail, error } = useDesign(id, { live: true });
	const { data: projects } = useProjects();
	const invalidateDesign = useInvalidateDesign();
	// Orchestrator handoff (KUK-944): the open_element_chat affordance in
	// the main chat mounts the focused element-chat panel until closed.
	const [elementChat, setElementChat] = useState<OpenElementChat | null>(null);

	// Breadcrumb back to the filing container (filed designs only).
	const projectLink =
		detail?.projectId && projects
			? (() => {
					const container = projects.find(
						(project) => project.id === detail.projectId,
					);
					return container ? { id: container.id, name: container.name } : null;
				})()
			: null;

	if (error) {
		return (
			<div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background p-6 text-center">
				<p className="text-destructive">Failed to load design.</p>
				<p className="text-sm text-muted-foreground">{error.message}</p>
				<button
					type="button"
					onClick={onClose}
					className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
				>
					Back to designs
				</button>
			</div>
		);
	}

	if (!detail) {
		return (
			<div className="fixed inset-0 z-50 flex items-center justify-center bg-background text-muted-foreground">
				Loading studio…
			</div>
		);
	}

	return (
		<>
			{/* The studio is a full-screen surface without AppLayout — the
			    palette still needs to be reachable from inside it (KUK-916).
			    The selection provider scopes the preview ↔ inspector block
			    selection (KUK-929); context reaches the mobile Sheet's portal
			    through the React tree. */}
			<BlockSelectionProvider>
				<CommandPalette />
				<StudioLayout
					project={detail}
					detail={detail}
					onBack={onClose}
					onTurnSettled={() => invalidateDesign(id)}
					projectLink={projectLink}
					onOpenElementChat={setElementChat}
					elementChat={elementChat}
					onCloseElementChat={() => setElementChat(null)}
				/>
			</BlockSelectionProvider>
		</>
	);
}
