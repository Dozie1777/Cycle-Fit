import { useState } from "react";
import type { CalendarEventEntry } from "@/client/api-types";
import {
	useCreateCampaignEvent,
	useDeleteCampaignDocument,
	useUpdateCampaignEvent,
} from "@/client/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ChannelDot, ChannelPicker } from "./channel-select";

const EVENT_STATUSES = ["planned", "draft", "scheduled", "published"] as const;
type EventStatus = (typeof EVENT_STATUSES)[number];

/** Badge variant per calendar status: published pops, planned is quietest. */
const STATUS_VARIANT: Record<
	string,
	"default" | "secondary" | "outline" | "destructive"
> = {
	published: "default",
	scheduled: "secondary",
	draft: "outline",
	planned: "outline",
};

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function shortDate(iso: string | null): string {
	if (!iso) return "—";
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "—";
	return date.toISOString().slice(0, 10);
}

/**
 * Monday-anchored week bucket for grouping; UTC arithmetic keeps the
 * grouping stable regardless of the viewer's timezone (dates render as
 * stored ISO, matching the agent's scheduling).
 */
function weekStart(iso: string): Date | null {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return null;
	const day = (date.getUTCDay() + 6) % 7;
	date.setUTCDate(date.getUTCDate() - day);
	date.setUTCHours(0, 0, 0, 0);
	return date;
}

const weekLabelFormatter = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
	timeZone: "UTC",
});

function weekLabel(monday: Date): string {
	return `Week of ${weekLabelFormatter.format(monday)}`;
}

type WeekGroup = { label: string; events: CalendarEventEntry[] };

/** Group events by week (Monday-start); unscheduled slots go last. */
export function groupEventsByWeek(events: CalendarEventEntry[]): WeekGroup[] {
	const groups: Array<{
		start: Date;
		label: string;
		events: CalendarEventEntry[];
	}> = [];
	const unscheduled: CalendarEventEntry[] = [];
	for (const event of events) {
		const start = event.scheduledAt ? weekStart(event.scheduledAt) : null;
		if (!start) {
			unscheduled.push(event);
			continue;
		}
		let group = groups.find(
			(candidate) => candidate.start.getTime() === start.getTime(),
		);
		if (!group) {
			group = { start, label: weekLabel(start), events: [] };
			groups.push(group);
		}
		group.events.push(event);
	}
	groups.sort((a, b) => a.start.getTime() - b.start.getTime());
	const result: WeekGroup[] = groups.map(({ label, events: list }) => ({
		label,
		events: list,
	}));
	if (unscheduled.length > 0) {
		result.push({ label: "Unscheduled", events: unscheduled });
	}
	return result;
}

/** Display name for an event's channel: linked enumeration name, or the
 * legacy free-text fallback (rendered gray for unmigrated rows). */
function channelLabel(event: CalendarEventEntry): string | null {
	return event.linkedChannel?.name ?? event.channel;
}

function EventRow({
	campaignId,
	event,
}: {
	campaignId: string;
	event: CalendarEventEntry;
}) {
	const updateEvent = useUpdateCampaignEvent(campaignId);
	const deleteDocument = useDeleteCampaignDocument(campaignId);
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
	const [notes, setNotes] = useState(event.notes ?? "");
	const [actionError, setActionError] = useState<string | null>(null);

	async function handleSave(ev: React.FormEvent) {
		ev.preventDefault();
		setActionError(null);
		try {
			await updateEvent.mutateAsync({
				eventId: event.id,
				title: title.trim() || undefined,
				// "" = no channel → explicit null clears the link; the legacy
				// text column stays untouched either way.
				channelId: channelId === "" ? null : channelId,
				scheduledAt: scheduledAt || null,
				status,
				notes: notes.trim() === "" ? null : notes,
			});
			setEditing(false);
		} catch (e) {
			setActionError(errorMessage(e));
		}
	}

	async function handleDelete() {
		setActionError(null);
		try {
			await deleteDocument.mutateAsync({ kind: "event", id: event.id });
		} catch (e) {
			setActionError(errorMessage(e));
		}
	}

	const channel = channelLabel(event);

	return (
		<li className="space-y-1.5 rounded-md border p-3">
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0">
					<p className="truncate text-sm font-medium">{event.title}</p>
					<p className="flex items-center gap-1.5 text-xs text-muted-foreground">
						{shortDate(event.scheduledAt)}
						{channel && (
							<>
								{" · "}
								<span className="flex items-center gap-1">
									<ChannelDot color={event.linkedChannel?.color} />
									{channel}
								</span>
							</>
						)}
						{event.notes ? ` · ${event.notes}` : ""}
					</p>
				</div>
				<div className="flex shrink-0 items-center gap-1.5">
					{event.assetId && (
						<Badge variant="outline" title="Attached design asset">
							Asset {event.assetId.slice(0, 8)}
						</Badge>
					)}
					<Badge variant={STATUS_VARIANT[event.status] ?? "outline"}>
						{event.status}
					</Badge>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={() => setEditing((prev) => !prev)}
					>
						{editing ? "Close" : "Edit"}
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="text-destructive"
						onClick={() => void handleDelete()}
					>
						Delete
					</Button>
				</div>
			</div>
			{editing && (
				<form onSubmit={handleSave} className="space-y-2 border-t pt-2">
					<div className="grid gap-2 sm:grid-cols-2">
						<div className="space-y-1">
							<Label htmlFor={`event-title-${event.id}`}>Title</Label>
							<Input
								id={`event-title-${event.id}`}
								value={title}
								onChange={(e) => setTitle(e.target.value)}
								required
								maxLength={200}
							/>
						</div>
						<div className="space-y-1">
							<ChannelPicker
								id={`event-channel-${event.id}`}
								label="Channel"
								value={channelId}
								onChange={setChannelId}
								legacyName={event.channel}
							/>
						</div>
						<div className="space-y-1">
							<Label htmlFor={`event-date-${event.id}`}>Date</Label>
							<Input
								id={`event-date-${event.id}`}
								type="date"
								value={scheduledAt}
								onChange={(e) => setScheduledAt(e.target.value)}
							/>
						</div>
						<div className="space-y-1">
							<Label htmlFor={`event-status-${event.id}`}>Status</Label>
							<select
								id={`event-status-${event.id}`}
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
					<div className="space-y-1">
						<Label htmlFor={`event-notes-${event.id}`}>Notes (markdown)</Label>
						<Textarea
							id={`event-notes-${event.id}`}
							value={notes}
							onChange={(e) => setNotes(e.target.value)}
							rows={2}
						/>
					</div>
					<Button type="submit" size="sm" disabled={updateEvent.isPending}>
						{updateEvent.isPending ? <Spinner /> : "Save event"}
					</Button>
				</form>
			)}
			{actionError && <p className="text-xs text-destructive">{actionError}</p>}
		</li>
	);
}

function NewEventForm({ campaignId }: { campaignId: string }) {
	const createEvent = useCreateCampaignEvent(campaignId);
	const [open, setOpen] = useState(false);
	const [title, setTitle] = useState("");
	const [channelId, setChannelId] = useState("");
	const [scheduledAt, setScheduledAt] = useState("");
	const [status, setStatus] = useState<EventStatus>("planned");
	const [notes, setNotes] = useState("");
	const [error, setError] = useState<string | null>(null);

	async function handleCreate(ev: React.FormEvent) {
		ev.preventDefault();
		if (!title.trim()) return;
		setError(null);
		try {
			await createEvent.mutateAsync({
				title: title.trim(),
				channelId: channelId === "" ? null : channelId,
				scheduledAt: scheduledAt || null,
				status,
				notes: notes.trim() === "" ? null : notes,
			});
			setTitle("");
			setChannelId("");
			setScheduledAt("");
			setStatus("planned");
			setNotes("");
			setOpen(false);
		} catch (e) {
			setError(errorMessage(e));
		}
	}

	if (!open) {
		return (
			<Button
				type="button"
				variant="outline"
				size="sm"
				onClick={() => setOpen(true)}
			>
				New event
			</Button>
		);
	}
	return (
		<form onSubmit={handleCreate} className="space-y-2 rounded-md border p-3">
			<div className="grid gap-2 sm:grid-cols-2">
				<div className="space-y-1">
					<Label htmlFor="new-event-title">Title</Label>
					<Input
						id="new-event-title"
						value={title}
						onChange={(e) => setTitle(e.target.value)}
						required
						maxLength={200}
						placeholder="e.g. Launch email to waitlist"
					/>
				</div>
				<div className="space-y-1">
					<ChannelPicker
						id="new-event-channel"
						label="Channel"
						value={channelId}
						onChange={setChannelId}
					/>
				</div>
				<div className="space-y-1">
					<Label htmlFor="new-event-date">Date</Label>
					<Input
						id="new-event-date"
						type="date"
						value={scheduledAt}
						onChange={(e) => setScheduledAt(e.target.value)}
					/>
				</div>
				<div className="space-y-1">
					<Label htmlFor="new-event-status">Status</Label>
					<select
						id="new-event-status"
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
			<div className="space-y-1">
				<Label htmlFor="new-event-notes">Notes (markdown)</Label>
				<Textarea
					id="new-event-notes"
					value={notes}
					onChange={(e) => setNotes(e.target.value)}
					rows={2}
				/>
			</div>
			<div className="flex gap-2">
				<Button type="submit" size="sm" disabled={createEvent.isPending}>
					{createEvent.isPending ? <Spinner /> : "Add event"}
				</Button>
				<Button
					type="button"
					size="sm"
					variant="ghost"
					onClick={() => setOpen(false)}
				>
					Cancel
				</Button>
			</div>
			{(error || createEvent.isError) && (
				<p className="text-xs text-destructive">
					{error ?? errorMessage(createEvent.error)}
				</p>
			)}
		</form>
	);
}

/** Calendar panel: events grouped by week with status pills and quick-edit. */
export function CampaignCalendarPanel({
	campaignId,
	events,
}: {
	campaignId: string;
	events: CalendarEventEntry[];
}) {
	const weeks = groupEventsByWeek(events);
	return (
		<div className="space-y-4 p-4">
			<div className="flex items-center gap-2">
				<NewEventForm campaignId={campaignId} />
			</div>
			{events.length === 0 ? (
				<div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
					No calendar slots yet — ask the agent in chat to schedule the
					campaign, or add one with New event.
				</div>
			) : (
				weeks.map((week) => (
					<Card key={week.label} className="bg-card/50">
						<CardContent className="space-y-2 p-4">
							<h3 className="text-sm font-semibold">{week.label}</h3>
							<ul className="space-y-2">
								{week.events.map((event) => (
									<EventRow
										key={event.id}
										campaignId={campaignId}
										event={event}
									/>
								))}
							</ul>
						</CardContent>
					</Card>
				))
			)}
		</div>
	);
}
