import type { Design } from "@/client/api-types";
import { DesignChat } from "./DesignChat";
import type { OpenElementChat } from "./element-chat-panel";

export function StudioChat({
	project,
	onTurnSettled,
	selectedSection,
	onClearSection,
	onOpenElementChat,
}: {
	project: Design;
	onTurnSettled: () => void;
	selectedSection?: string | null;
	onClearSection?: () => void;
	/**
	 * Orchestrator handoff (KUK-944): opens the focused element-chat panel
	 * for the session the design chat's open_element_chat tool created.
	 */
	onOpenElementChat?: (session: OpenElementChat) => void;
}) {
	return (
		<div className="flex h-full w-full min-w-0 flex-col">
			<div className="flex h-12 flex-shrink-0 items-center justify-between border-b border-border px-4">
				<div className="flex items-center gap-2">
					<span className="text-sm font-semibold text-foreground">
						Designer
					</span>
					<span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
						GLM-5.3
					</span>
				</div>
			</div>
			<div className="flex flex-1 min-h-0 p-3">
				<DesignChat
					projectId={project.id}
					prompt={project.prompt}
					status={project.status}
					onTurnSettled={onTurnSettled}
					autoBrief={project.remixedFromId == null}
					selectedSection={selectedSection}
					onClearSection={onClearSection}
					onOpenElementChat={onOpenElementChat}
				/>
			</div>
		</div>
	);
}
