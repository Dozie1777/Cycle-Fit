import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppLayout } from "@/components/app-shell/layout";
import { DesignsListPage } from "@/features/design-studio/pages/designs-list-page";

export const Route = createFileRoute("/_authenticated/projects/designs")({
	component: DesignsRoute,
});

function DesignsRoute() {
	const navigate = useNavigate();
	return (
		<AppLayout title="Designs">
			<DesignsListPage
				onOpenStudio={(id) => navigate({ to: "/studio/$id", params: { id } })}
			/>
		</AppLayout>
	);
}
