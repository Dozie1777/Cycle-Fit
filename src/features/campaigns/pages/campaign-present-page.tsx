import { useCampaign, useCampaignAssets } from "@/client/queries";
import { Button } from "@/components/ui/button";
import { CampaignPresentRunner } from "@/features/campaigns/components/campaign-present-runner";

/**
 * Present page (/campaigns/:id/present, KUK-877): full-screen runner
 * chaining the campaign's published assets in sequence. Renders from the
 * same assets + detail queries the dashboard uses, so the chain always
 * matches what the control tower gallery shows as Published.
 */
export function CampaignPresentPage({
	id,
	onExit,
}: {
	id: string;
	/** Esc / Exit — back to the campaign dashboard. */
	onExit: () => void;
}) {
	const { data: detail, isPending, error } = useCampaign(id);
	const assetsQuery = useCampaignAssets(id);

	if (error) {
		return (
			<div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background p-6 text-center">
				<p className="text-destructive">Failed to load the campaign.</p>
				<p className="text-sm text-muted-foreground">{error.message}</p>
				<Button type="button" onClick={onExit}>
					Back to dashboard
				</Button>
			</div>
		);
	}

	if (isPending || !detail || assetsQuery.isPending || !assetsQuery.data) {
		return (
			<div className="fixed inset-0 z-50 flex items-center justify-center bg-background text-muted-foreground">
				Loading present view…
			</div>
		);
	}

	if (assetsQuery.error) {
		return (
			<div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background p-6 text-center">
				<p className="text-destructive">
					Failed to load assets: {assetsQuery.error.message}
				</p>
				<Button type="button" onClick={onExit}>
					Back to dashboard
				</Button>
			</div>
		);
	}

	return (
		<CampaignPresentRunner
			assets={assetsQuery.data}
			events={detail.events}
			onExit={onExit}
		/>
	);
}
