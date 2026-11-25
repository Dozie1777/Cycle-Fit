import { useEffect, useState } from "react";
import { Streamdown } from "streamdown";
import type { CampaignBrief, TargetAudience } from "@/client/api-types";
import { useChannels, useSaveCampaignBrief } from "@/client/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { CampaignAudienceEditor } from "./audience-editor";
import { ChannelDot } from "./channel-select";
import { CampaignKpiEditor } from "./kpi-editor";
import { ManageChannelsDialog } from "./manage-channels-dialog";

type BriefFields = {
	objective: string | null;
	keyMessage: string | null;
	tone: string | null;
	budget: string | null;
	body: string | null;
};

/** Client caps mirror the server schema so saves never 400 opaquely. */
const BRIEF_MAX: Record<keyof BriefFields, number> = {
	objective: 1_000,
	keyMessage: 4_000,
	tone: 1_000,
	budget: 1_000,
	body: 20_000,
};

/** A structured field row: label + single-line input. */
function BriefField({
	id,
	label,
	value,
	maxLength,
	onChange,
}: {
	id: string;
	label: string;
	value: string;
	maxLength: number;
	onChange: (value: string) => void;
}) {
	return (
		<div className="space-y-1.5">
			<Label htmlFor={id}>{label}</Label>
			<Input
				id={id}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				maxLength={maxLength}
			/>
		</div>
	);
}

/**
 * Channel-mix multi-select (KUK-890): toggle chips bound to the
 * CampaignChannel join — a real M:N link, not free text. Saving replaces the
 * whole set atomically (server-side), so the full selection is sent every
 * time. "+ New channel" opens the admin-side manage dialog.
 */
function ChannelMixSelect({
	selected,
	onToggle,
}: {
	selected: string[];
	onToggle: (channelId: string) => void;
}) {
	const [manageOpen, setManageOpen] = useState(false);
	const { data: channels = [] } = useChannels();
	return (
		<div className="space-y-1.5 sm:col-span-2">
			<div className="flex items-center justify-between">
				<Label>Channel mix</Label>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="h-6 px-2 text-xs text-muted-foreground"
					onClick={() => setManageOpen(true)}
				>
					+ New channel
				</Button>
			</div>
			{channels.length === 0 ? (
				<p className="text-xs text-muted-foreground">
					No channels yet — create one with “+ New channel”.
				</p>
			) : (
				<div className="flex flex-wrap gap-1.5">
					{channels.map((channel) => {
						const checked = selected.includes(channel.id);
						return (
							<label
								key={channel.id}
								className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
									checked
										? "border-primary bg-primary/10 text-foreground"
										: "text-muted-foreground hover:bg-accent/40"
								}`}
							>
								<input
									type="checkbox"
									className="sr-only"
									checked={checked}
									onChange={() => onToggle(channel.id)}
								/>
								<ChannelDot color={channel.color} />
								{channel.name}
							</label>
						);
					})}
				</div>
			)}
			<ManageChannelsDialog open={manageOpen} onOpenChange={setManageOpen} />
		</div>
	);
}

function BriefForm({
	campaignId,
	brief,
	channelIds,
	audiences,
}: {
	campaignId: string;
	brief: CampaignBrief | null;
	/** Current CampaignChannel link ids (KUK-890). */
	channelIds: string[];
	/** Current TargetAudience rows from the campaign detail. */
	audiences: TargetAudience[];
}) {
	const save = useSaveCampaignBrief(campaignId);
	const [fields, setFields] = useState<BriefFields>({
		objective: brief?.objective ?? "",
		keyMessage: brief?.keyMessage ?? "",
		tone: brief?.tone ?? "",
		budget: brief?.budget ?? "",
		body: brief?.body ?? "",
	});
	// The channel mix starts from the linked set; toggles change it and the
	// next save replaces the whole set server-side (atomic, KUK-890).
	const [channelMix, setChannelMix] = useState<string[]>(channelIds);
	const [saved, setSaved] = useState(false);

	useEffect(() => {
		if (!saved) return;
		const timer = setTimeout(() => setSaved(false), 2000);
		return () => clearTimeout(timer);
	}, [saved]);

	const set = (key: keyof BriefFields) => (value: string) =>
		setFields((prev) => ({ ...prev, [key]: value }));

	const toggleChannel = (channelId: string) =>
		setChannelMix((prev) =>
			prev.includes(channelId)
				? prev.filter((id) => id !== channelId)
				: [...prev, channelId],
		);

	// Empty input clears the stored field (null); absent stays untouched.
	// The channel mix is always sent as a full replace-set. The legacy
	// free-text `channels` column is NOT edited from the UI anymore.
	async function handleSave(event: React.FormEvent) {
		event.preventDefault();
		const patch: Record<string, string | null | string[]> = {};
		for (const [key, value] of Object.entries(fields)) {
			patch[key] = value != null && value.trim() === "" ? null : value;
		}
		patch.channelIds = channelMix;
		try {
			await save.mutateAsync(patch);
			setSaved(true);
		} catch {
			// error text renders from the mutation state below
		}
	}

	return (
		<form onSubmit={handleSave} className="space-y-4 p-4">
			<p className="text-xs text-muted-foreground">
				{brief
					? "Edits here patch the brief rows the agent reads on its next turn."
					: "No brief yet — ask the agent in chat to draft one, or fill this in and save."}
			</p>
			<div className="grid gap-4 sm:grid-cols-2">
				<BriefField
					id="brief-objective"
					label="Objective"
					value={fields.objective ?? ""}
					maxLength={BRIEF_MAX.objective}
					onChange={set("objective")}
				/>
				<BriefField
					id="brief-key-message"
					label="Key message"
					value={fields.keyMessage ?? ""}
					maxLength={BRIEF_MAX.keyMessage}
					onChange={set("keyMessage")}
				/>
				<BriefField
					id="brief-tone"
					label="Tone"
					value={fields.tone ?? ""}
					maxLength={BRIEF_MAX.tone}
					onChange={set("tone")}
				/>
				<ChannelMixSelect selected={channelMix} onToggle={toggleChannel} />
				<BriefField
					id="brief-budget"
					label="Budget"
					value={fields.budget ?? ""}
					maxLength={BRIEF_MAX.budget}
					onChange={set("budget")}
				/>
			</div>
			<div className="space-y-3">
				<CampaignAudienceEditor campaignId={campaignId} audiences={audiences} />
				{/* The deprecated markdown always stays visible in the admin
				    studio — rows may have been created later by the agent or
				    by hand, so presence of structured rows must not hide
				    legacy content (lossless-fallback contract). */}
				{brief?.audience?.trim() && (
					<details className="rounded-md border p-3 text-xs text-muted-foreground">
						<summary className="cursor-pointer">
							Legacy audience markdown (deprecated)
						</summary>
						<p className="mt-2 whitespace-pre-wrap">{brief.audience}</p>
					</details>
				)}
			</div>
			<CampaignKpiEditor campaignId={campaignId} />
			<div className="space-y-1.5">
				<Label htmlFor="brief-body">Context (markdown)</Label>
				<Tabs defaultValue="preview">
					<TabsList>
						<TabsTrigger value="preview">Preview</TabsTrigger>
						<TabsTrigger value="raw">Raw</TabsTrigger>
					</TabsList>
					<TabsContent value="preview">
						<div className="typeset rounded-md border p-3 text-sm">
							{fields.body?.trim() ? (
								<Streamdown>{fields.body}</Streamdown>
							) : (
								<p className="text-muted-foreground">Nothing written yet.</p>
							)}
						</div>
					</TabsContent>
					<TabsContent value="raw">
						<Textarea
							id="brief-body"
							value={fields.body ?? ""}
							onChange={(e) => set("body")(e.target.value)}
							maxLength={BRIEF_MAX.body}
							rows={8}
						/>
					</TabsContent>
				</Tabs>
			</div>
			<div className="flex items-center gap-3">
				<Button type="submit" disabled={save.isPending}>
					{save.isPending ? (
						<>
							<Spinner /> Saving…
						</>
					) : (
						"Save brief"
					)}
				</Button>
				{saved && !save.isPending && !save.isError && (
					<span className="text-xs text-muted-foreground">Saved.</span>
				)}
				{save.isError && (
					<span className="text-xs text-destructive">
						{save.error instanceof Error ? save.error.message : "Save failed"}
					</span>
				)}
			</div>
		</form>
	);
}

/**
 * Brief panel: form-style editor over the CampaignBrief structured fields
 * plus a markdown context area with a Streamdown preview. The brief row may
 * not exist yet — first save upserts it. The form remounts on every server
 * refresh (keyed by updatedAt) so agent-written fields land mid-chat. The
 * channel mix is a real M:N select bound to CampaignChannel (KUK-890) — the
 * legacy free-text `channels` column is no longer edited from the UI.
 */
export function CampaignBriefPanel({
	campaignId,
	brief,
	channelIds,
	audiences,
}: {
	campaignId: string;
	brief: CampaignBrief | null;
	/** Current CampaignChannel link ids from the campaign detail. */
	channelIds: string[];
	/** Current TargetAudience rows from the campaign detail. */
	audiences: TargetAudience[];
}) {
	return (
		<BriefForm
			key={brief?.updatedAt ?? "new"}
			campaignId={campaignId}
			brief={brief}
			channelIds={channelIds}
			audiences={audiences}
		/>
	);
}
