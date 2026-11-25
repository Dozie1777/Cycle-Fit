import {
	ClientOnly,
	createFileRoute,
	useNavigate,
	useSearch,
} from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { safeRedirectPath } from "@/client/redirect-target";

const CampaignStudioPage = lazy(() =>
	import("@/features/campaigns/pages/campaign-studio-page").then((module) => ({
		default: module.CampaignStudioPage,
	})),
);

// The campaign control tower lives at /campaigns/:id — the dashboard
// is the landing view (KUK-875) with a switch into the studio workspace
// (KUK-874). The `campaigns_` folder escapes the campaigns list route,
// which has no Outlet; it is also the path the create dialog navigates to.
//
// KUK-903: "Back" honors the ?from= origin path so entering a campaign from
// a project returns to that project, instead of always landing on the
// global campaigns hub — the dashboard's own breadcrumb already points
// there. No validateSearch (see the studio route) so Links elsewhere don't
// gain a required search param.
export const Route = createFileRoute("/_authenticated/campaigns_/$id")({
	component: CampaignDetailRoute,
});

function CampaignDetailRoute() {
	const { id } = Route.useParams();
	const search = useSearch({ strict: false }) as { from?: string };
	const from = search?.from ? safeRedirectPath(search.from) : null;
	const navigate = useNavigate();
	const loading = (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-background text-muted-foreground">
			Loading campaign…
		</div>
	);

	function handleClose() {
		if (from) {
			void navigate({ href: from });
			return;
		}
		void navigate({ to: "/campaigns" });
	}

	return (
		<ClientOnly fallback={loading}>
			<Suspense fallback={loading}>
				<CampaignStudioPage id={id} onClose={handleClose} />
			</Suspense>
		</ClientOnly>
	);
}
