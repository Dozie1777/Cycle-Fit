import type { CampaignDetail } from "@/client/api-types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { KpiScorecard } from "./kpi-scorecard";

function periodLabel(
	periodStart: string | null,
	periodEnd: string | null,
): string | null {
	if (!periodStart && !periodEnd) return null;
	return `${periodStart ? periodStart.slice(0, 10) : "…"} – ${periodEnd ? periodEnd.slice(0, 10) : "…"}`;
}

/**
 * Overview strip (KPI scorecard + latest report): shows the structured KPI
 * targets from Campaign.kpis with their latest recorded result, and the newest
 * CampaignReport summary. KPI cards are color-coded by display color and
 * status so over/under-performance is visible at a glance (KUK-896).
 */
export function CampaignOverviewStrip({
	detail,
	onOpenStudio,
}: {
	detail: CampaignDetail;
	onOpenStudio: (tab?: "brief" | "plan" | "calendar" | "reports") => void;
}) {
	const latestReport = detail.reports[0];
	const reportPeriod = latestReport
		? periodLabel(latestReport.periodStart, latestReport.periodEnd)
		: null;
	const hasContent = detail.kpis.length > 0 || latestReport != null;

	return (
		<section aria-label="Overview">
			<div className="mb-2 flex items-center justify-between">
				<h2 className="text-sm font-semibold">Overview</h2>
				{detail.kpis.length === 0 && (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={() => onOpenStudio("brief")}
					>
						Open brief
					</Button>
				)}
			</div>
			{!hasContent ? (
				<div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
					No KPIs or reports yet — define KPI targets in the brief, then record
					results here as the campaign runs.
					<div className="mt-2">
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => onOpenStudio("brief")}
						>
							Open studio
						</Button>
					</div>
				</div>
			) : (
				<div className="space-y-3">
					<KpiScorecard
						kpis={detail.kpis}
						reports={detail.reports}
						campaignId={detail.id}
						onOpenStudio={() => onOpenStudio("brief")}
					/>
					{latestReport && (
						<Card className="bg-card/50">
							<CardContent className="p-4">
								<p className="text-xs text-muted-foreground">Latest report</p>
								<p
									className="truncate text-sm font-medium"
									title={latestReport.title}
								>
									{latestReport.title}
								</p>
								{reportPeriod && (
									<p className="text-xs text-muted-foreground">
										{reportPeriod}
									</p>
								)}
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="mt-1 h-7 px-2"
									onClick={() => onOpenStudio("reports")}
								>
									View report
								</Button>
							</CardContent>
						</Card>
					)}
				</div>
			)}
		</section>
	);
}
