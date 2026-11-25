import { useState } from "react";
import { useCampaign, useInvalidateCampaign } from "@/client/queries";
import { CommandPalette } from "@/components/app-shell/command-palette";
import { Button } from "@/components/ui/button";
import { CampaignDashboard } from "@/features/campaigns/components/campaign-dashboard";
import type { StudioDocTab } from "@/features/campaigns/components/campaign-studio-layout";
import { CampaignStudioLayout } from "@/features/campaigns/components/campaign-studio-layout";

/**
 * Campaign detail page (/campaigns/:id): lands on the control tower
 * dashboard (KUK-875) with a switch into the studio workspace (KUK-874).
 * Both views render from the same campaign detail query — the dashboard's
 * quick edits and the studio's agent turns share one source of truth, so
 * every settled turn invalidates the detail for both.
 */
export function CampaignStudioPage({
	id,
	onClose,
}: {
	id: string;
	onClose: () => void;
}) {
	const { data: detail, isPending, error } = useCampaign(id, { live: true });
	const invalidateCampaign = useInvalidateCampaign();
	const [mode, setMode] = useState<"overview" | "studio">("overview");
	const [studioTab, setStudioTab] = useState<StudioDocTab>("brief");

	/** Enter the studio, optionally opening a specific document panel. */
	function openStudio(tab: StudioDocTab = "brief"): void {
		setStudioTab(tab);
		setMode("studio");
	}

	if (error) {
		return (
			<div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background p-6 text-center">
				<p className="text-destructive">Failed to load campaign.</p>
				<p className="text-sm text-muted-foreground">{error.message}</p>
				<Button type="button" onClick={onClose}>
					Back to campaigns
				</Button>
			</div>
		);
	}

	if (isPending || !detail) {
		return (
			<div className="fixed inset-0 z-50 flex items-center justify-center bg-background text-muted-foreground">
				Loading campaign…
			</div>
		);
	}

	if (mode === "studio") {
		return (
			<>
				{/* Full-screen surfaces without AppLayout still get the
				    palette (KUK-916). */}
				<CommandPalette />
				<CampaignStudioLayout
					detail={detail}
					initialTab={studioTab}
					onClose={() => setMode("overview")}
					onTurnSettled={() => invalidateCampaign(id)}
				/>
			</>
		);
	}

	return (
		<>
			<CommandPalette />
			<CampaignDashboard
				detail={detail}
				onOpenStudio={openStudio}
				onClose={onClose}
			/>
		</>
	);
}
