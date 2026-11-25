import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/app-shell/layout";
import { CampaignsPage } from "@/features/campaigns/pages/campaigns-page";

export const Route = createFileRoute("/_authenticated/campaigns/")({
	validateSearch: (search: Record<string, unknown>): { projectId?: string } => {
		const projectId = search.projectId;
		return typeof projectId === "string" && projectId.length > 0
			? { projectId }
			: {};
	},
	component: CampaignsRoute,
});

function CampaignsRoute() {
	const { projectId } = Route.useSearch();
	return (
		<AppLayout title="Campaigns">
			<CampaignsPage projectId={projectId} />
		</AppLayout>
	);
}
