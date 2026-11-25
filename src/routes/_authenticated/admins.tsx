import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/app-shell/layout";
import { AdminsPage } from "@/features/console/pages/admins-page";

export const Route = createFileRoute("/_authenticated/admins")({
	component: AdminsRoute,
});

function AdminsRoute() {
	return (
		<AppLayout title="Admins">
			<AdminsPage />
		</AppLayout>
	);
}
