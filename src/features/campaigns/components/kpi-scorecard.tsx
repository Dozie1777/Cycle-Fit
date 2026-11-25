import { useState } from "react";
import type {
	CampaignKpiResult,
	CampaignKpiWithLatestResult,
	CampaignReportSummary,
} from "@/client/api-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { KpiResultDialog } from "./kpi-result-dialog";

const STATUS_COLORS: Record<string, string> = {
	pending: "bg-muted text-muted-foreground",
	not_met: "bg-destructive/10 text-destructive",
	partial: "bg-amber-500/10 text-amber-600",
	met: "bg-emerald-500/10 text-emerald-600",
	exceeded: "bg-sky-500/10 text-sky-600",
};

const STATUS_LABELS: Record<string, string> = {
	pending: "Pending",
	not_met: "Not met",
	partial: "Partial",
	met: "Met",
	exceeded: "Exceeded",
};

function targetSummary(kpi: CampaignKpiWithLatestResult): string {
	switch (kpi.kind) {
		case "number":
			return kpi.targetNumber != null
				? `${kpi.targetNumber}${kpi.unit ? ` ${kpi.unit}` : ""}`
				: "No target";
		case "boolean":
			return kpi.targetBoolean === true
				? "Yes"
				: kpi.targetBoolean === false
					? "No"
					: "No target";
		case "qualitative":
			return kpi.targetText ?? "No target";
	}
}

function actualSummary(kpi: CampaignKpiWithLatestResult): string | null {
	const result = kpi.results[0];
	if (!result) return null;
	switch (kpi.kind) {
		case "number":
			return result.actualNumber != null
				? `${result.actualNumber}${kpi.unit ? ` ${kpi.unit}` : ""}`
				: "—";
		case "boolean":
			return result.actualBoolean === true
				? "Yes"
				: result.actualBoolean === false
					? "No"
					: "—";
		case "qualitative":
			return result.actualText ?? "—";
	}
}

function shortDate(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "";
	return date.toISOString().slice(0, 10);
}

/**
 * Color-coded scorecard of campaign KPIs with their latest result (KUK-896).
 * Each KPI keeps its own chosen display color on the left border; the status
 * badge uses a friendly traffic-light palette so over/under-performance is
 * obvious at a glance.
 */
export function KpiScorecard({
	kpis,
	reports,
	campaignId,
	onOpenStudio,
}: {
	kpis: CampaignKpiWithLatestResult[];
	reports: CampaignReportSummary[];
	campaignId: string;
	onOpenStudio: () => void;
}) {
	const [activeKpi, setActiveKpi] =
		useState<CampaignKpiWithLatestResult | null>(null);
	const [activeResult, setActiveResult] = useState<CampaignKpiResult | null>(
		null,
	);

	if (kpis.length === 0) {
		return (
			<div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
				No KPIs yet — define targets in the brief panel so you can record
				results here.
				<div className="mt-2">
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={onOpenStudio}
					>
						Open studio
					</Button>
				</div>
			</div>
		);
	}

	return (
		<>
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{kpis.map((kpi) => {
					const result = kpi.results[0];
					const status = result?.status ?? "pending";
					const statusClass = STATUS_COLORS[status] ?? STATUS_COLORS.pending;
					const actual = actualSummary(kpi);
					// KUK-990: progress ring + result-history sparkline + delta.
					const ring =
						kpi.kind === "number" &&
						kpi.targetNumber != null &&
						kpi.targetNumber > 0 &&
						result?.actualNumber != null
							? (() => {
									const pct = Math.max(
										0,
										Math.min(
											100,
											(result.actualNumber / kpi.targetNumber) * 100,
										),
									);
									const ringColor =
										status === "not_met"
											? "#dc2626"
											: status === "partial"
												? "#d98a00"
												: status === "exceeded"
													? "#0284c7"
													: "#0f9b6c";
									const R = 18;
									const C = 2 * Math.PI * R;
									return (
										<div
											role="progressbar"
											aria-label={`${kpi.name} progress toward target`}
											aria-valuenow={Math.round(pct)}
											aria-valuemin={0}
											aria-valuemax={100}
											className="ml-auto shrink-0"
											title={`${Math.round(pct)}% of target`}
										>
											<svg width="48" height="48" viewBox="0 0 48 48">
												<title>{`${kpi.name}: ${Math.round(pct)}% of target`}</title>
												<circle
													cx="24"
													cy="24"
													r={R}
													fill="none"
													stroke="currentColor"
													strokeWidth="5"
													className="text-muted"
												/>
												<circle
													cx="24"
													cy="24"
													r={R}
													fill="none"
													stroke={ringColor}
													strokeWidth="5"
													strokeLinecap="round"
													strokeDasharray={C}
													strokeDashoffset={C * (1 - pct / 100)}
													transform="rotate(-90 24 24)"
												/>
												<text
													x="24"
													y="27"
													textAnchor="middle"
													fontSize="10"
													fontWeight="700"
													fill="currentColor"
												>
													{Math.round(pct)}%
												</text>
											</svg>
										</div>
									);
								})()
							: null;

					const history = kpi.results
						.map((row) => row.actualNumber)
						.filter((value): value is number => value != null);
					const sparkline =
						history.length >= 2 && kpi.kind === "number"
							? (() => {
									const W = 120;
									const H = 30;
									const min = Math.min(...history);
									const max = Math.max(...history);
									const span = max - min || 1;
									const pts = history
										.map((value, index) => {
											const x = (index / (history.length - 1)) * (W - 4) + 2;
											const y = H - 3 - ((value - min) / span) * (H - 6);
											return `${x.toFixed(1)},${y.toFixed(1)}`;
										})
										.join(" ");
									return (
										<svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
											<title>{`${kpi.name} over time`}</title>
											<polyline
												points={pts}
												fill="none"
												stroke="#015150"
												strokeWidth="1.8"
											/>
										</svg>
									);
								})()
							: null;

					const deltaLine =
						history.length >= 2 &&
						((kpi.results[0]?.actualNumber ?? 0) !== 0 ||
							(kpi.results[1]?.actualNumber ?? 0) !== 0)
							? (() => {
									const prev = kpi.results[1]?.actualNumber ?? 0;
									const latest = kpi.results[0]?.actualNumber ?? 0;
									const delta =
										prev === 0
											? latest > 0
												? 100
												: 0
											: Math.round(((latest - prev) / prev) * 100);
									return (
										<span
											className={
												delta >= 0
													? "font-medium text-emerald-600"
													: "font-medium text-destructive"
											}
										>
											{delta >= 0 ? "↑" : "↓"} {Math.abs(delta)}% since last
											record
										</span>
									);
								})()
							: null;
					return (
						<Card
							key={kpi.id}
							className="overflow-hidden bg-card/50"
							style={{
								borderLeftWidth: "4px",
								borderLeftColor: kpi.color ?? "transparent",
							}}
						>
							<CardContent className="space-y-2 p-4">
								<div className="flex items-start justify-between gap-2">
									<div className="min-w-0">
										<p
											className="truncate text-sm font-medium"
											title={kpi.name}
										>
											{kpi.name}
										</p>
										<p className="text-xs text-muted-foreground">
											Target: {targetSummary(kpi)}
										</p>
									</div>
									<Badge
										variant="secondary"
										className={`shrink-0 text-[10px] ${statusClass}`}
									>
										{STATUS_LABELS[status]}
									</Badge>
								</div>
								<div className="flex items-center gap-3">
									<div className="min-w-0">
										<p className="text-xs text-muted-foreground">Actual</p>
										<p className="text-sm font-semibold">
											{actual ??
												"No result yet — record actuals once this KPI starts"}
										</p>
									</div>
									{ring}
								</div>
								{sparkline && (
									<div>
										{sparkline}
										{deltaLine && (
											<p className="mt-1 text-xs text-muted-foreground">
												{deltaLine}
											</p>
										)}
									</div>
								)}

								{result?.report && (
									<p className="text-xs text-muted-foreground">
										From report: {result.report.title}
									</p>
								)}
								{result?.recordedAt && (
									<p className="text-xs text-muted-foreground">
										Recorded {shortDate(result.recordedAt)}
									</p>
								)}
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="mt-1 h-7 px-2"
									onClick={() => {
										setActiveKpi(kpi);
										setActiveResult(result ?? null);
									}}
								>
									{result ? "Update result" : "Record result"}
								</Button>
							</CardContent>
						</Card>
					);
				})}
			</div>
			{activeKpi && (
				<KpiResultDialog
					open={activeKpi != null}
					onOpenChange={(open) => {
						if (!open) {
							setActiveKpi(null);
							setActiveResult(null);
						}
					}}
					campaignId={campaignId}
					kpiId={activeKpi.id}
					kind={activeKpi.kind}
					kpiName={activeKpi.name}
					targetNumber={activeKpi.targetNumber}
					result={activeResult}
					reports={reports}
				/>
			)}
		</>
	);
}
