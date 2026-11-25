import { createFileRoute } from "@tanstack/react-router";
import { useProject } from "@/client/queries";
import { AppLayout } from "@/components/app-shell/layout";
import { ProjectDetailPage } from "@/features/projects/pages/projects-detail-page";

/**
 * Project detail route (KUK-910): the header previously showed a generic
 * "Project" title derived from the pathname — it never said which project
 * you were in. The H1 is now the project's actual name with a Projects /
 * <name> breadcrumb trail while the detail loads.
 */
export const Route = createFileRoute("/_authenticated/projects/$id")({
	component: ProjectDetailRoute,
});

function ProjectDetailRoute() {
	const { id } = Route.useParams();
	return <ProjectDetailRouteContent projectId={id} />;
}

function ProjectDetailRouteContent({ projectId }: { projectId: string }) {
	const { data: project } = useProject(projectId);
	const name = project?.name ?? "Project";
	return (
		<AppLayout
			breadcrumbs={[{ label: "Projects", to: "/projects" }, { label: name }]}
			title={name}
		>
			<ProjectDetailPage projectId={projectId} />
		</AppLayout>
	);
}
