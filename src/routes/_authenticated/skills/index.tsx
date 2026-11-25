import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/app-shell/layout";
import { SkillsPage } from "@/features/skills/pages/skills-page";

export const Route = createFileRoute("/_authenticated/skills/")({
	component: SkillsRoute,
});

function SkillsRoute() {
	return (
		<AppLayout title="Skills">
			<SkillsPage />
		</AppLayout>
	);
}
