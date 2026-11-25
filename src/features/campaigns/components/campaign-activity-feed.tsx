import type { CampaignDetail, CampaignMessage } from "@/client/api-types";
import { useCampaignMessages } from "@/client/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function shortDateTime(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "";
	return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

type ActivityEntry = {
	key: string;
	at: string;
	kind: string;
	text: string;
};

/** Compact "what the agent has been doing" list: chat turns + document writes. */
function buildEntries(
	detail: CampaignDetail,
	messages: CampaignMessage[],
): ActivityEntry[] {
	const entries: ActivityEntry[] = [];
	for (const message of messages) {
		entries.push({
			key: `msg-${message.id}`,
			at: message.createdAt,
			kind: message.role === "user" ? "You" : "Agent",
			text:
				message.content.length > 90
					? `${message.content.slice(0, 90)}…`
					: message.content,
		});
	}
	if (detail.brief) {
		entries.push({
			key: "brief",
			at: detail.brief.updatedAt,
			kind: "Brief",
			text: detail.brief.objective ?? "Brief updated",
		});
	}
	for (const plan of detail.plans) {
		entries.push({
			key: `plan-${plan.id}`,
			at: plan.updatedAt,
			kind: "Plan",
			text: `${plan.name} (${plan.phases.length} phase${plan.phases.length === 1 ? "" : "s"})`,
		});
	}
	for (const event of detail.events) {
		entries.push({
			key: `event-${event.id}`,
			at: event.updatedAt,
			kind: "Calendar",
			text: event.title,
		});
	}
	for (const report of detail.reports) {
		entries.push({
			key: `report-${report.id}`,
			at: report.createdAt,
			kind: "Report",
			text: report.title,
		});
	}
	return entries
		.filter((entry) => entry.at !== "")
		.sort((a, b) => b.at.localeCompare(a.at))
		.slice(0, 12);
}

/**
 * Activity feed: recent chat messages (GET /campaigns/:id/messages) merged
 * with document write timestamps — the one-glance answer to "what has the
 * agent been doing?".
 */
export function CampaignActivityFeed({
	detail,
	onOpenStudio,
}: {
	detail: CampaignDetail;
	onOpenStudio: (tab?: "brief" | "plan" | "calendar" | "reports") => void;
}) {
	const messagesQuery = useCampaignMessages(detail.id);
	const entries = buildEntries(detail, messagesQuery.data ?? []);

	return (
		<section aria-label="Activity">
			<div className="mb-2 flex items-center justify-between">
				<h2 className="text-sm font-semibold">Activity</h2>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onClick={() => onOpenStudio("brief")}
				>
					Open studio
				</Button>
			</div>
			{messagesQuery.error ? (
				<p className="text-sm text-destructive">
					Failed to load activity: {errorMessage(messagesQuery.error)}
				</p>
			) : entries.length === 0 ? (
				<div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
					No activity yet — start a conversation in the studio and the agent's
					work shows up here.
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
				<ul className="divide-y rounded-lg border">
					{entries.map((entry) => (
						<li
							key={entry.key}
							className="flex items-center gap-3 px-3 py-2 text-sm"
						>
							<Badge
								variant={entry.kind === "Agent" ? "default" : "outline"}
								className="shrink-0"
							>
								{entry.kind}
							</Badge>
							<span className="min-w-0 flex-1 truncate" title={entry.text}>
								{entry.text}
							</span>
							<span className="shrink-0 text-xs text-muted-foreground">
								{shortDateTime(entry.at)}
							</span>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
