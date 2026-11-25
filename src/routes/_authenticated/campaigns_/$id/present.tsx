import {
	ClientOnly,
	createFileRoute,
	useNavigate,
} from "@tanstack/react-router";
import { lazy, Suspense } from "react";

const CampaignPresentPage = lazy(() =>
	import("@/features/campaigns/pages/campaign-present-page").then((module) => ({
		default: module.CampaignPresentPage,
	})),
);

// The present runner (KUK-877) chains the campaign's published assets
// full-screen from /campaigns/:id/present — the dashboard header's
// Present button lands here. It nests under the campaign detail route
// (same structure as before the folder-routes migration).
export const Route = createFileRoute("/_authenticated/campaigns_/$id/present")({
	component: CampaignPresentRoute,
});

function CampaignPresentRoute() {
	const { id } = Route.useParams();
	const navigate = useNavigate();
	const loading = (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-background text-muted-foreground">
			Loading present view…
		</div>
	);

	return (
		<ClientOnly fallback={loading}>
			<Suspense fallback={loading}>
				<CampaignPresentPage
					id={id}
					onExit={() => navigate({ to: "/campaigns/$id", params: { id } })}
				/>
			</Suspense>
		</ClientOnly>
	);
}
