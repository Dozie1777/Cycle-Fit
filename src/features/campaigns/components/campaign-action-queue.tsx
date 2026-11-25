import type { CampaignDetail } from "@/client/api-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { daysUntil, deriveCampaignHealth } from "@/features/campaigns/health";

/** One ranked to-do item. */
export type ActionItem = {
	id: string;
	icon: string;
	title: string;
	subline: string;
	urgency: "urgent" | "soon" | "info";
	tab: "brief" | "plan" | "calendar" | "reports";
};

/**
 * Rank everything a marketer should look at for this campaign, most urgent
 * first (KUK-991). Pure function over the detail payload + health engine so
 * it is unit-testable and can never disagree with the hero CTA's logic.
 */
export function rankCampaignActions(
	detail: Pick<
		CampaignDetail,
		"status" | "targetEndDate" | "kpis" | "events" | "plans"
	>,
	now: Date = new Date(),
): ActionItem[] {
	const health = deriveCampaignHealth(detail, now);
	const items: ActionItem[] = [];

	if (health.draftEventCount > 0) {
		items.push({
			id: "approve-drafts",
			icon: "✎",
			title: `Approve ${health.draftEventCount} draft item${health.draftEventCount === 1 ? "" : "s"}`,
			subline: "Drafts need approval before they can go out on their date.",
			urgency: "urgent",
			tab: "calendar",
		});
	}
	if (health.pendingKpiCount > 0 && detail.kpis.length > 0) {
		items.push({
			id: "record-results",
			icon: "◷",
			title: `Record results for ${health.pendingKpiCount} KPI${health.pendingKpiCount === 1 ? "" : "s"}`,
			subline:
				"Actuals turn targets into progress you and stakeholders can see.",
			urgency: "soon",
			tab: "reports",
		});
	}
	if (!detail.plans.some((plan) => plan.status === "final")) {
		items.push({
			id: "finalize-plan",
			icon: "⚑",
			title: "Finalize the plan",
			subline: "A final plan marks this campaign as ready to execute.",
			urgency: "soon",
			tab: "plan",
		});
	}
	if (detail.status === "failed") {
		items.unshift({
			id: "check-failure",
			icon: "⚠",
			title: "Check the studio for the failed agent turn",
			subline: "The last agent run failed — the error is in the studio.",
			urgency: "urgent",
			tab: "brief",
		});
	}

	// Next dated calendar item reads as the upcoming decision/deadline.
	const upcoming = detail.events
		.filter((event) => event.scheduledAt != null)
		.sort(
			(a, b) =>
				new Date(a.scheduledAt ?? 0).getTime() -
				new Date(b.scheduledAt ?? 0).getTime(),
		)
		.find((event) => new Date(event.scheduledAt ?? 0) >= now);
	if (upcoming?.scheduledAt) {
		const days = daysUntil(upcoming.scheduledAt, now);
		if (days >= 0 && days <= 3) {
			items.push({
				id: "upcoming-item",
				icon: "◉",
				title: `“${upcoming.title}” goes out ${days === 0 ? "today" : `in ${days} day${days === 1 ? "" : "s"}`}`,
				subline: "Confirm the asset is attached and ready.",
				urgency: "info",
				tab: "calendar",
			});
		}
	}
	return items;
}

const URGENCY_BADGE: Record<
	ActionItem["urgency"],
	{ label: string; className: string }
> = {
	urgent: {
		label: "Urgent",
		className: "bg-destructive/10 text-destructive",
	},
	soon: {
		label: "This week",
		className: "bg-amber-500/10 text-amber-600",
	},
	info: {
		label: "FYI",
		className: "bg-muted text-muted-foreground",
	},
};

/**
 * Ranked next actions for the campaign home (KUK-991) — the hero keeps the
 * single primary CTA, this queue lists everything else in priority order.
 */
export function CampaignActionQueue({
	detail,
	onOpenStudio,
}: {
	detail: CampaignDetail;
	onOpenStudio: (tab?: "brief" | "plan" | "calendar" | "reports") => void;
}) {
	const items = rankCampaignActions(detail);
	return (
		<section aria-label="Action queue">
			<div className="mb-2 flex items-center justify-between">
				<h2 className="text-sm font-semibold">Action queue</h2>
				<span className="text-xs text-muted-foreground">
					{items.length === 0
						? "all clear"
						: `${items.length} open item${items.length === 1 ? "" : "s"}`}
				</span>
			</div>
			{items.length === 0 ? (
				<div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
					Nothing needs your attention right now — check the latest report for
					what moved this week.
				</div>
			) : (
				<ul className="divide-y rounded-lg border bg-card/50">
					{items.map((item) => (
						<li
							key={item.id}
							className="flex flex-wrap items-center gap-3 px-4 py-3"
						>
							<span
								aria-hidden="true"
								className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-sm"
							>
								{item.icon}
							</span>
							<div className="min-w-0 flex-1">
								<p className="truncate text-sm font-medium">{item.title}</p>
								<p className="truncate text-xs text-muted-foreground">
									{item.subline}
								</p>
							</div>
							<Badge
								variant="secondary"
								className={`shrink-0 text-[10px] ${URGENCY_BADGE[item.urgency].className}`}
							>
								{URGENCY_BADGE[item.urgency].label}
							</Badge>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								onClick={() => onOpenStudio(item.tab)}
							>
								Open
							</Button>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
