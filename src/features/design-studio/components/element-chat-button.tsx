import { useState } from "react";
import { useCreateElementChat } from "@/client/queries";
import { Button } from "@/components/ui/button";
import type { OpenElementChat } from "./element-chat-panel";

/**
 * Per-row "Chat" action for building-block panels (KUK-945): creates (or
 * reopens) the element's scoped chat session — idempotent, context reseeded
 * server-side — and hands it to the studio, which opens the element panel.
 */
export function ElementChatButton({
	projectId,
	elementType,
	elementId,
	elementName,
	onOpenElementChat,
}: {
	projectId: string;
	elementType: "component" | "page" | "template" | "data" | "flow";
	elementId: string;
	elementName: string;
	onOpenElementChat?: (session: OpenElementChat) => void;
}) {
	const create = useCreateElementChat();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function handleClick() {
		if (busy) return;
		setError(null);
		setBusy(true);
		try {
			const session = await create.mutateAsync({
				projectId,
				elementType,
				elementId,
			});
			onOpenElementChat?.({
				elementChatId: session.id,
				elementType,
				elementName,
				note: null,
			});
		} catch (e) {
			setError(e instanceof Error ? e.message : "failed to open chat");
		} finally {
			setBusy(false);
		}
	}

	return (
		<span className="flex items-center gap-1">
			<Button
				type="button"
				variant="ghost"
				size="sm"
				className="h-7 px-2"
				disabled={busy}
				onClick={() => void handleClick()}
				title={`Open the focused chat for this ${elementType}`}
			>
				{busy ? "Opening…" : "Chat"}
			</Button>
			{error && (
				<span className="text-[10px] text-destructive" role="alert">
					{error}
				</span>
			)}
		</span>
	);
}
