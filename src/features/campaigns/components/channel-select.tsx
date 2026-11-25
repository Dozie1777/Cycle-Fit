import { useState } from "react";
import type { Channel } from "@/client/api-types";
import { useChannels } from "@/client/queries";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { ManageChannelsDialog } from "./manage-channels-dialog";

/**
 * Channel select for calendar quick-edit / event create (KUK-890). Pick-only:
 * channels are admin-owned, so the only creation path here is the compact
 * manage-channels dialog opened from the "+ New channel" item.
 *
 * `value` is a channelId or "" for none. A legacy free-text event (text set,
 * no link) renders its legacy name as a grayed "legacy" entry so the current
 * state is visible; picking a real channel links it (the legacy text column
 * is no longer written by any surface).
 */
export function ChannelSelect({
	id,
	value,
	onChange,
	channels,
	legacyName,
	emptyLabel = "No channel",
}: {
	id: string;
	/** channelId or "" for none. */
	value: string;
	onChange: (channelId: string) => void;
	channels: Channel[];
	/** Legacy free-text name shown when the row is not linked yet. */
	legacyName?: string | null;
	emptyLabel?: string;
}) {
	const [manageOpen, setManageOpen] = useState(false);
	const linked = channels.find((channel) => channel.id === value);
	const hasLegacy = !linked && legacyName != null && legacyName.trim() !== "";
	return (
		<div className="w-full">
			<Select
				value={value || undefined}
				onValueChange={(next) => {
					if (next === MANAGE_ITEM) setManageOpen(true);
					else onChange(next ?? "");
				}}
			>
				<SelectTrigger
					id={id}
					size="sm"
					className="w-full"
					aria-label="Channel"
				>
					<SelectValue placeholder="Pick a channel…">
						{linked ? (
							<span className="flex items-center gap-1.5">
								<ChannelDot color={linked.color} />
								{linked.name}
							</span>
						) : hasLegacy ? (
							<span className="flex items-center gap-1.5 text-muted-foreground">
								<ChannelDot color={null} />
								{legacyName} (legacy)
							</span>
						) : (
							emptyLabel
						)}
					</SelectValue>
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="">
						<span className="flex items-center gap-1.5">
							<ChannelDot color={null} />
							{emptyLabel}
						</span>
					</SelectItem>
					{channels.map((channel) => (
						<SelectItem key={channel.id} value={channel.id}>
							<span className="flex items-center gap-1.5">
								<ChannelDot color={channel.color} />
								{channel.name}
							</span>
						</SelectItem>
					))}
					<SelectItem value={MANAGE_ITEM}>
						<span className="text-muted-foreground">＋ New channel…</span>
					</SelectItem>
				</SelectContent>
			</Select>
			{hasLegacy && (
				// Unmigrated row: the current value is free text; picking a real
				// channel links it (the legacy text column is no longer written).
				<p className="mt-0.5 text-xs text-muted-foreground">
					Current: {legacyName} (legacy — pick a channel to link it)
				</p>
			)}
			<ManageChannelsDialog open={manageOpen} onOpenChange={setManageOpen} />
		</div>
	);
}

/** Select marker value that opens the manage-channels dialog. */
export const MANAGE_ITEM = "__manage__";

/**
 * Small color-coded dot used on channel pills/selects; gray when the channel
 * has no color or the row is legacy free-text.
 */
export function ChannelDot({ color }: { color: string | null | undefined }) {
	return (
		<span
			aria-hidden="true"
			className="inline-block h-2 w-2 shrink-0 rounded-full"
			style={{ backgroundColor: color ?? "#9ca3af" }}
		/>
	);
}

/**
 * Channel-picker wiring for panels: channels from the shared enumeration
 * query plus a labeled wrapper. Small convenience so calendar/brief panels
 * stay lean.
 */
export function ChannelPicker({
	id,
	label,
	value,
	onChange,
	legacyName,
}: {
	id: string;
	label: string;
	value: string;
	onChange: (channelId: string) => void;
	legacyName?: string | null;
}) {
	const { data: channels = [] } = useChannels();
	return (
		<div className="space-y-1">
			<Label htmlFor={id}>{label}</Label>
			<ChannelSelect
				id={id}
				value={value}
				onChange={onChange}
				channels={channels}
				legacyName={legacyName}
			/>
		</div>
	);
}
