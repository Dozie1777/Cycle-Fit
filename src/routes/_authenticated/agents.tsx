import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/app-shell/layout";
import { AgentsPage } from "@/features/console/pages/agents-page";

export const Route = createFileRoute("/_authenticated/agents")({
	component: AgentsRoute,
});

function AgentsRoute() {
	return (
		<AppLayout title="Agents">
			<AgentsPage />
		</AppLayout>
	);
}
