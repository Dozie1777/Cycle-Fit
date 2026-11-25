import { useEffect, useState } from "react";
import {
	useChannels,
	useCreateChannel,
	useUpdateChannel,
} from "@/client/queries";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { ChannelDot } from "./channel-select";

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Compact manage-channels dialog (KUK-890): the admin-side owner of the
 * channel enumeration. Create new channels (name + optional color) and
 * rename/recolor existing ones. Reachable from the calendar/brief channel
 * selects ("＋ New channel…") and the dashboard.
 */
export function ManageChannelsDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const { data: channels = [], isPending } = useChannels();
	const createChannel = useCreateChannel();
	const updateChannel = useUpdateChannel();
	const [newName, setNewName] = useState("");
	const [newColor, setNewColor] = useState("");
	const [error, setError] = useState<string | null>(null);
	/** Per-row edit drafts, keyed by channel id. */
	const [drafts, setDrafts] = useState<
		Record<string, { name: string; color: string } | undefined>
	>({});

	useEffect(() => {
		if (open) return;
		// Reset drafts/errors when the dialog closes.
		setNewName("");
		setNewColor("");
		setError(null);
		setDrafts({});
	}, [open]);

	async function handleCreate(event: React.FormEvent) {
		event.preventDefault();
		if (!newName.trim()) return;
		setError(null);
		try {
			await createChannel.mutateAsync({
				name: newName.trim(),
				color: newColor.trim() || undefined,
			});
			setNewName("");
			setNewColor("");
		} catch (e) {
			setError(errorMessage(e));
		}
	}

	async function handleSave(channelId: string) {
		const draft = drafts[channelId];
		if (!draft) return;
		setError(null);
		try {
			await updateChannel.mutateAsync({
				channelId,
				name: draft.name.trim() || undefined,
				color: draft.color.trim() === "" ? null : draft.color.trim(),
			});
			setDrafts((prev) => ({ ...prev, [channelId]: undefined }));
		} catch (e) {
			setError(errorMessage(e));
		}
	}

	function draftFor(id: string, name: string, color: string | null) {
		return (
			drafts[id] ?? {
				name,
				color: color ?? "",
			}
		);
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Channels</DialogTitle>
					<DialogDescription>
						The shared channel list for calendars and briefs. Rename or recolor
						existing channels, or add a new one.
					</DialogDescription>
				</DialogHeader>
				<form onSubmit={handleCreate} className="space-y-2">
					<div className="flex items-end gap-2">
						<div className="min-w-0 flex-1 space-y-1">
							<Label htmlFor="new-channel-name">New channel</Label>
							<Input
								id="new-channel-name"
								value={newName}
								onChange={(e) => setNewName(e.target.value)}
								placeholder="e.g. Newsletter"
								maxLength={100}
							/>
						</div>
						<div className="w-28 space-y-1">
							<Label htmlFor="new-channel-color">Color</Label>
							<Input
								id="new-channel-color"
								value={newColor}
								onChange={(e) => setNewColor(e.target.value)}
								placeholder="#3b82f6"
								maxLength={32}
							/>
						</div>
						<Button
							type="submit"
							size="sm"
							disabled={createChannel.isPending || !newName.trim()}
						>
							{createChannel.isPending ? <Spinner /> : "Add"}
						</Button>
					</div>
				</form>
				{isPending ? (
					<p className="py-2 text-sm text-muted-foreground">Loading…</p>
				) : channels.length === 0 ? (
					<p className="py-2 text-sm text-muted-foreground">
						No channels yet — add the first one above.
					</p>
				) : (
					<ul className="space-y-2">
						{channels.map((channel) => {
							const draft = draftFor(channel.id, channel.name, channel.color);
							const changed =
								draft.name !== channel.name ||
								draft.color !== (channel.color ?? "");
							return (
								<li
									key={channel.id}
									className="flex items-end gap-2 rounded-md border p-2"
								>
									<ChannelDot color={channel.color} />
									<div className="min-w-0 flex-1 space-y-1">
										<Label
											htmlFor={`channel-name-${channel.id}`}
											className="sr-only"
										>
											Name
										</Label>
										<Input
											id={`channel-name-${channel.id}`}
											value={draft.name}
											onChange={(e) =>
												setDrafts((prev) => ({
													...prev,
													[channel.id]: {
														...(prev[channel.id] ?? draft),
														name: e.target.value,
													},
												}))
											}
											maxLength={100}
										/>
									</div>
									<div className="w-24 space-y-1">
										<Label
											htmlFor={`channel-color-${channel.id}`}
											className="sr-only"
										>
											Color
										</Label>
										<Input
											id={`channel-color-${channel.id}`}
											value={draft.color}
											onChange={(e) =>
												setDrafts((prev) => ({
													...prev,
													[channel.id]: {
														...(prev[channel.id] ?? draft),
														color: e.target.value,
													},
												}))
											}
											placeholder="#3b82f6"
											maxLength={32}
										/>
									</div>
									<Button
										type="button"
										variant="ghost"
										size="sm"
										disabled={!changed || updateChannel.isPending}
										onClick={() => void handleSave(channel.id)}
									>
										{updateChannel.isPending ? <Spinner /> : "Save"}
									</Button>
								</li>
							);
						})}
					</ul>
				)}
				{error && <p className="text-xs text-destructive">{error}</p>}
			</DialogContent>
		</Dialog>
	);
}
