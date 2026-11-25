import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import type { CampaignDetail } from "@/client/api-types";
import { useMediaQuery } from "@/client/use-media-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { deriveLifecycle, lifecycleBadge } from "@/features/campaigns/health";
import { CampaignBriefPanel } from "./brief-panel";
import { CampaignCalendarPanel } from "./calendar-panel";
import { CampaignStudioChat } from "./campaign-studio-chat";
import { CampaignPlanPanel } from "./plan-panel";
import { CampaignReportsPanel } from "./reports-panel";

const DOC_TABS = ["brief", "plan", "calendar", "reports"] as const;
export type StudioDocTab = (typeof DOC_TABS)[number];
type DocTab = StudioDocTab;

function useIsDesktop() {
	return useMediaQuery("(min-width: 1024px)");
}

function documentPanel(detail: CampaignDetail, tab: DocTab) {
	switch (tab) {
		case "brief":
			return (
				<CampaignBriefPanel
					campaignId={detail.id}
					brief={detail.brief}
					channelIds={detail.channelIds}
					audiences={detail.audiences ?? []}
				/>
			);
		case "plan":
			return <CampaignPlanPanel campaignId={detail.id} plans={detail.plans} />;
		case "calendar":
			return (
				<CampaignCalendarPanel campaignId={detail.id} events={detail.events} />
			);
		case "reports":
			return (
				<CampaignReportsPanel campaignId={detail.id} reports={detail.reports} />
			);
	}
}

/**
 * Campaign studio shell (KUK-874): chat on the left, the campaign's
 * structured artifacts on the right — the same resizable two-panel layout
 * as the design studio. On mobile the panels collapse to tabs.
 */
export function CampaignStudioLayout({
	detail,
	onClose,
	onTurnSettled,
	initialTab,
}: {
	detail: CampaignDetail;
	onClose: () => void;
	onTurnSettled: () => void;
	/** Document tab to open first — the dashboard's "view all" deep-links. */
	initialTab?: StudioDocTab;
}) {
	const isDesktop = useIsDesktop();
	const [docTab, setDocTab] = useState<DocTab>(initialTab ?? "brief");
	const [mobileTab, setMobileTab] = useState("chat");

	return (
		<div className="fixed inset-0 z-50 flex flex-col bg-background pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
			<div className="flex items-center gap-3 border-b px-4 py-2.5">
				<Button type="button" variant="outline" size="sm" onClick={onClose}>
					Back
				</Button>
				<div className="min-w-0">
					<h1 className="truncate text-sm font-semibold">{detail.name}</h1>
					<Link
						to="/projects/$id"
						params={{ id: detail.projectId }}
						className="text-xs text-muted-foreground hover:underline"
					>
						Project
					</Link>
				</div>
				{(() => {
					// KUK-979: derived lifecycle label, not the raw chat-pipeline state.
					const badge = lifecycleBadge(
						deriveLifecycle({
							status: detail.status,
							targetEndDate: detail.targetEndDate,
							eventCount: detail.events.length,
						}),
					);
					return (
						<Badge
							variant={badge.variant}
							title="Calculated from the campaign's dates, plan and calendar"
						>
							{badge.label}
						</Badge>
					);
				})()}
				{detail.error && (
					<p className="truncate text-xs text-destructive">{detail.error}</p>
				)}
			</div>
			{isDesktop ? (
				<Group orientation="horizontal" className="flex min-h-0 min-w-0 flex-1">
					<Panel
						defaultSize="34"
						minSize="24"
						maxSize="50"
						className="min-w-0 border-r border-border bg-[#151519]"
					>
						<CampaignStudioChat
							campaignId={detail.id}
							briefPrompt={detail.briefPrompt}
							onTurnSettled={onTurnSettled}
							turnInProgress={detail.status === "chatting"}
						/>
					</Panel>
					<Separator className="group relative w-px cursor-col-resize bg-border hover:bg-muted-foreground/50 focus-visible:bg-muted-foreground/50 focus-visible:outline-none transition-colors">
						<div className="absolute left-1/2 top-1/2 h-8 w-4 -translate-x-1/2 -translate-y-1/2" />
						<div className="absolute left-1/2 top-1/2 h-8 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground/20 transition-colors group-hover:bg-muted-foreground/50" />
					</Separator>
					<Panel defaultSize="66" minSize="50" className="min-w-0">
						<Tabs
							value={docTab}
							onValueChange={(value) => setDocTab(value as DocTab)}
							className="flex h-full min-h-0 flex-col"
						>
							<TabsList className="shrink-0 justify-start border-b">
								<TabsTrigger value="brief">Brief</TabsTrigger>
								<TabsTrigger value="plan">Plan</TabsTrigger>
								<TabsTrigger value="calendar">Calendar</TabsTrigger>
								<TabsTrigger value="reports">Reports</TabsTrigger>
							</TabsList>
							{DOC_TABS.map((tab) => (
								<TabsContent
									key={tab}
									value={tab}
									className="min-h-0 flex-1 overflow-y-auto"
								>
									{documentPanel(detail, tab)}
								</TabsContent>
							))}
						</Tabs>
					</Panel>
				</Group>
			) : (
				<div className="flex min-h-0 min-w-0 flex-1 flex-col">
					<Tabs
						value={mobileTab}
						onValueChange={setMobileTab}
						className="flex min-h-0 flex-1 flex-col"
					>
						<TabsList className="mx-3 mt-2 w-auto shrink-0 justify-start">
							<TabsTrigger value="chat">Chat</TabsTrigger>
							{DOC_TABS.map((tab) => (
								<TabsTrigger key={tab} value={tab}>
									{tab[0].toUpperCase() + tab.slice(1)}
								</TabsTrigger>
							))}
						</TabsList>
						{mobileTab === "chat" ? (
							<div className="min-h-0 flex-1">
								<CampaignStudioChat
									campaignId={detail.id}
									briefPrompt={detail.briefPrompt}
									onTurnSettled={onTurnSettled}
									turnInProgress={detail.status === "chatting"}
								/>
							</div>
						) : (
							<div className="min-h-0 flex-1 overflow-y-auto">
								{documentPanel(detail, mobileTab as DocTab)}
							</div>
						)}
					</Tabs>
				</div>
			)}
		</div>
	);
}
