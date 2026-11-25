import { useState } from "react";
import type { CalendarEventEntry } from "@/client/api-types";
import { useUpdateCampaignEvent } from "@/client/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChannelDot, ChannelPicker } from "./channel-select";

const EVENT_STATUSES = ["planned", "draft", "scheduled", "published"] as const;
type EventStatus = (typeof EVENT_STATUSES)[number];

const STRIP_DAYS = 21;

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

const dayLabelFormatter = new Intl.DateTimeFormat("en-US", {
	weekday: "short",
	month: "short",
	day: "numeric",
	timeZone: "UTC",
});

function dayLabel(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "—";
	return dayLabelFormatter.format(date);
}

/** UTC midnight of today — the strip window is stable across timezones. */
function utcToday(): Date {
	const now = new Date();
	const start = new Date(now);
	start.setUTCHours(0, 0, 0, 0);
	return start;
}

type Strip = {
	lanes: Array<{
		/** Linked channel name, or the legacy free-text fallback. */
		channel: string;
		/** Channel color when the lane maps to a linked channel row. */
		color: string | null;
		events: CalendarEventEntry[];
	}>;
	earlierCount: number;
	laterCount: number;
};

/**
 * Upcoming strip: events scheduled within the next three weeks, grouped
 * into channel swimlanes (null channel → "No channel"), date-sorted.
 * Grouping prefers the linked channel name (KUK-890) and falls back to the
 * legacy free-text for unmigrated rows.
 */
export function upcomingStrip(events: CalendarEventEntry[]): Strip {
	const start = utcToday();
	const end = new Date(start);
	end.setUTCDate(end.getUTCDate() + STRIP_DAYS);
	const byChannel = new Map<
		string,
		{ color: string | null; events: CalendarEventEntry[] }
	>();
	let earlierCount = 0;
	let laterCount = 0;
	for (const event of events) {
		if (!event.scheduledAt) continue;
		const at = new Date(event.scheduledAt);
		if (Number.isNaN(at.getTime())) continue;
		if (at < start) {
			earlierCount += 1;
			continue;
		}
		if (at >= end) {
			laterCount += 1;
			continue;
		}
		const channel = event.linkedChannel?.name ?? event.channel ?? "No channel";
		const lane = byChannel.get(channel);
		if (lane) lane.events.push(event);
		else
			byChannel.set(channel, {
				color: event.linkedChannel?.color ?? null,
				events: [event],
			});
	}
	const lanes = [...byChannel.entries()]
		.map(([channel, lane]) => ({
			channel,
			color: lane.color,
			events: lane.events.sort(
				(a, b) =>
					new Date(a.scheduledAt ?? 0).getTime() -
					new Date(b.scheduledAt ?? 0).getTime(),
			),
		}))
		.sort((a, b) => a.channel.localeCompare(b.channel));
	return { lanes, earlierCount, laterCount };
}

function StripEvent({
	campaignId,
	event,
}: {
	campaignId: string;
	event: CalendarEventEntry;
}) {
	const updateEvent = useUpdateCampaignEvent(campaignId);
	const [editing, setEditing] = useState(false);
	const [title, setTitle] = useState(event.title);
	const [channelId, setChannelId] = useState(event.channelId ?? "");
	const [scheduledAt, setScheduledAt] = useState(
		event.scheduledAt ? event.scheduledAt.slice(0, 10) : "",
	);
	const [status, setStatus] = useState<EventStatus>(
		(EVENT_STATUSES as readonly string[]).includes(event.status)
			? (event.status as EventStatus)
			: "planned",
	);
	const [error, setError] = useState<string | null>(null);

	async function handleSave(ev: React.FormEvent): Promise<void> {
		ev.preventDefault();
		setError(null);
		try {
			await updateEvent.mutateAsync({
				eventId: event.id,
				title: title.trim() || event.title,
				// "" = no channel → explicit null clears the link; the legacy
				// text column stays untouched either way.
				channelId: channelId === "" ? null : channelId,
				scheduledAt: scheduledAt || null,
				status,
			});
			setEditing(false);
		} catch (e) {
			setError(errorMessage(e));
		}
	}

	if (editing) {
		return (
			<form
				onSubmit={handleSave}
				className="space-y-2 rounded-md border bg-card/50 p-3"
			>
				<div className="grid gap-2 sm:grid-cols-2">
					<div className="space-y-1">
						<Label htmlFor={`strip-title-${event.id}`}>Title</Label>
						<Input
							id={`strip-title-${event.id}`}
							value={title}
							onChange={(e) => setTitle(e.target.value)}
							required
							maxLength={200}
						/>
					</div>
					<div className="space-y-1">
						<ChannelPicker
							id={`strip-channel-${event.id}`}
							label="Channel"
							value={channelId}
							onChange={setChannelId}
							legacyName={event.channel}
						/>
					</div>
					<div className="space-y-1">
						<Label htmlFor={`strip-date-${event.id}`}>Date</Label>
						<Input
							id={`strip-date-${event.id}`}
							type="date"
							value={scheduledAt}
							onChange={(e) => setScheduledAt(e.target.value)}
						/>
					</div>
					<div className="space-y-1">
						<Label htmlFor={`strip-status-${event.id}`}>Status</Label>
						<select
							id={`strip-status-${event.id}`}
							value={status}
							onChange={(e) => setStatus(e.target.value as EventStatus)}
							className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none"
						>
							{EVENT_STATUSES.map((value) => (
								<option key={value} value={value}>
									{value}
								</option>
							))}
						</select>
					</div>
				</div>
				<div className="flex gap-2">
					<Button type="submit" size="sm" disabled={updateEvent.isPending}>
						{updateEvent.isPending ? "Saving…" : "Save event"}
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={() => setEditing(false)}
					>
						Cancel
					</Button>
				</div>
				{error && <p className="text-xs text-destructive">{error}</p>}
			</form>
		);
	}

	return (
		<button
			type="button"
			onClick={() => setEditing(true)}
			className="flex w-full items-center justify-between gap-2 rounded-md border p-2 text-left transition-colors hover:bg-accent/40"
			title="Click to quick-edit"
		>
			<span className="min-w-0">
				<span className="block truncate text-sm font-medium">
					{event.title}
				</span>
				<span className="block text-xs text-muted-foreground">
					{dayLabel(event.scheduledAt ?? "")}
				</span>
			</span>
			<Badge variant="outline">{event.status}</Badge>
		</button>
	);
}

/**
 * Calendar strip: the next three weeks of scheduled slots as channel
 * swimlanes. Click a slot to quick-edit (title/date/channel/status) through
 * the same document API the agent tools write; "View all" opens the studio
 * calendar panel.
 */
export function CampaignCalendarStrip({
	campaignId,
	events,
	onOpenStudio,
}: {
	campaignId: string;
	events: CalendarEventEntry[];
	onOpenStudio: (tab?: "brief" | "plan" | "calendar" | "reports") => void;
}) {
	const strip = upcomingStrip(events);

	return (
		<section aria-label="Calendar">
			<div className="mb-2 flex items-center justify-between">
				<h2 className="text-sm font-semibold">Next 3 weeks</h2>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onClick={() => onOpenStudio("calendar")}
				>
					View all
				</Button>
			</div>
			{strip.lanes.length === 0 ? (
				<div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
					Nothing scheduled in the next three weeks — ask the agent in the
					studio to plan the calendar.
					<div className="mt-2">
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => onOpenStudio("calendar")}
						>
							Open calendar
						</Button>
					</div>
				</div>
			) : (
				<div className="space-y-3">
					{strip.lanes.map((lane) => (
						<div
							key={lane.channel}
							className="rounded-lg border bg-card/50 p-3"
						>
							<h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
								<ChannelDot color={lane.color} />
								{lane.channel}
							</h3>
							<ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
								{lane.events.map((event) => (
									<li key={event.id}>
										<StripEvent campaignId={campaignId} event={event} />
									</li>
								))}
							</ul>
						</div>
					))}
					{(strip.earlierCount > 0 || strip.laterCount > 0) && (
						<p className="text-xs text-muted-foreground">
							{strip.earlierCount > 0 && `${strip.earlierCount} earlier · `}
							{strip.laterCount > 0 && `${strip.laterCount} later · `}
							Use View all for the full calendar.
						</p>
					)}
				</div>
			)}
		</section>
	);
}
