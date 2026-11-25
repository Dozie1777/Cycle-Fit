import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/app-shell/layout";
import { ProjectsListPage } from "@/features/projects/pages/projects-list-page";

export const Route = createFileRoute("/_authenticated/projects/")({
	component: ProjectsRoute,
});

function ProjectsRoute() {
	return (
		<AppLayout title="Projects">
			<ProjectsListPage />
		</AppLayout>
	);
}
