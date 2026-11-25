import { createFileRoute, useRouteContext } from "@tanstack/react-router";
import { Chat } from "@/features/console/components/chat/chat";

export const Route = createFileRoute("/_authenticated/chat")({
	component: ChatRoute,
});

function ChatRoute() {
	const { session } = useRouteContext({ from: "/_authenticated" });
	return (
		<Chat
			actorName="chat"
			actorKey={["user", session.user.id]}
			title="Your chat"
		/>
	);
}
