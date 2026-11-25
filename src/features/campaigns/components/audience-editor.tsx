import { useState } from "react";
import type { TargetAudience } from "@/client/api-types";
import {
	useCreateCampaignAudience,
	useDeleteCampaignAudience,
	useUpdateCampaignAudience,
} from "@/client/queries";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

type AudienceForm = {
	name: string;
	demographics: string;
	psychographics: string;
	buyingStage: string;
	body: string;
};

/** Client caps mirror the server schema so saves never 400 opaquely. */
const AUDIENCE_MAX = {
	name: 200,
	demographics: 4_000,
	psychographics: 4_000,
	buyingStage: 120,
	body: 20_000,
} as const;

function emptyForm(): AudienceForm {
	return {
		name: "",
		demographics: "",
		psychographics: "",
		buyingStage: "",
		body: "",
	};
}

function audienceToForm(audience: TargetAudience): AudienceForm {
	return {
		name: audience.name,
		demographics: audience.demographics ?? "",
		psychographics: audience.psychographics ?? "",
		buyingStage: audience.buyingStage ?? "",
		body: audience.body ?? "",
	};
}

/** One-line summary under the audience name in the card list. */
function audienceSummary(audience: TargetAudience): string {
	const parts = [
		audience.demographics ? "demographics" : null,
		audience.psychographics ? "psychographics" : null,
		audience.buyingStage,
	].filter((entry): entry is string => entry !== null);
	return parts.length > 0 ? parts.join(" · ") : "No segmentation detail yet";
}

/**
 * Inline editor for the campaign's target audiences: per-campaign structured
 * segmentation rows (a campaign can hold several — ICP, secondary
 * segments). Replaces the deprecated free-text CampaignBrief.audience
 * markdown field, exactly like the KPI editor replaced CampaignBrief.kpis.
 */
export function CampaignAudienceEditor({
	campaignId,
	audiences,
}: {
	campaignId: string;
	/** Current audience rows from the campaign detail payload. */
	audiences: TargetAudience[];
}) {
	const create = useCreateCampaignAudience(campaignId);
	const update = useUpdateCampaignAudience(campaignId);
	const remove = useDeleteCampaignAudience(campaignId);

	const [isAdding, setIsAdding] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [form, setForm] = useState(emptyForm());
	const [deleteId, setDeleteId] = useState<string | null>(null);
	const [formError, setFormError] = useState<string | null>(null);

	function startAdd() {
		setForm(emptyForm());
		setFormError(null);
		setIsAdding(true);
		setEditingId(null);
	}

	function startEdit(audience: TargetAudience) {
		setForm(audienceToForm(audience));
		setFormError(null);
		setEditingId(audience.id);
		setIsAdding(false);
	}

	function cancel() {
		setIsAdding(false);
		setEditingId(null);
		setFormError(null);
	}

	async function handleSubmit(event: React.FormEvent) {
		event.preventDefault();
		setFormError(null);
		const name = form.name.trim();
		if (!name) {
			setFormError("Name is required");
			return;
		}
		const body = {
			name,
			// Empty input clears the stored field (null); absent stays untouched.
			demographics: form.demographics.trim() || null,
			psychographics: form.psychographics.trim() || null,
			buyingStage: form.buyingStage.trim() || null,
			body: form.body.trim() || null,
		};
		try {
			if (editingId) {
				await update.mutateAsync({ audienceId: editingId, ...body });
			} else {
				await create.mutateAsync(body);
			}
			cancel();
		} catch (e) {
			setFormError(e instanceof Error ? e.message : "Save failed");
		}
	}

	const submitting = create.isPending || update.isPending;

	return (
		<div className="space-y-4 p-4">
			<div className="flex items-center justify-between">
				<div>
					<h3 className="text-sm font-semibold">Target audiences</h3>
					<p className="text-xs text-muted-foreground">
						Who this campaign speaks to — one segment per row.
					</p>
				</div>
				{!isAdding && !editingId && (
					<Button type="button" size="sm" onClick={startAdd}>
						Add audience
					</Button>
				)}
			</div>

			{audiences.length === 0 && !isAdding && !editingId ? (
				<div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
					No target audiences yet — add the segments this campaign targets.
				</div>
			) : (
				<div className="space-y-2">
					{audiences.map((audience) => (
						<div
							key={audience.id}
							className="flex items-start gap-3 rounded-lg border p-3"
						>
							<div className="min-w-0 flex-1">
								<p className="truncate text-sm font-medium">{audience.name}</p>
								<p className="truncate text-xs text-muted-foreground">
									{audienceSummary(audience)}
								</p>
							</div>
							<div className="flex items-center gap-1">
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="h-7 px-2"
									onClick={() => startEdit(audience)}
								>
									Edit
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="h-7 px-2 text-destructive"
									onClick={() => setDeleteId(audience.id)}
								>
									Delete
								</Button>
							</div>
						</div>
					))}
				</div>
			)}

			{(isAdding || editingId) && (
				<form
					onSubmit={handleSubmit}
					className="space-y-3 rounded-lg border p-3"
				>
					<div className="space-y-1.5">
						<Label htmlFor="audience-name">Name</Label>
						<Input
							id="audience-name"
							value={form.name}
							onChange={(e) =>
								setForm((prev) => ({ ...prev, name: e.target.value }))
							}
							maxLength={AUDIENCE_MAX.name}
							placeholder="e.g. Gen Z shoppers"
						/>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor="audience-demographics">
							Demographics (markdown — roles, industries, size, geo)
						</Label>
						<Textarea
							id="audience-demographics"
							value={form.demographics}
							onChange={(e) =>
								setForm((prev) => ({ ...prev, demographics: e.target.value }))
							}
							maxLength={AUDIENCE_MAX.demographics}
							rows={3}
						/>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor="audience-psychographics">
							Psychographics (markdown — pain points, motivations, objections)
						</Label>
						<Textarea
							id="audience-psychographics"
							value={form.psychographics}
							onChange={(e) =>
								setForm((prev) => ({ ...prev, psychographics: e.target.value }))
							}
							maxLength={AUDIENCE_MAX.psychographics}
							rows={3}
						/>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor="audience-stage">Buying stage</Label>
						<Input
							id="audience-stage"
							value={form.buyingStage}
							onChange={(e) =>
								setForm((prev) => ({ ...prev, buyingStage: e.target.value }))
							}
							maxLength={AUDIENCE_MAX.buyingStage}
							placeholder="e.g. awareness, decision-makers"
						/>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor="audience-notes">Notes (markdown)</Label>
						<Textarea
							id="audience-notes"
							value={form.body}
							onChange={(e) =>
								setForm((prev) => ({ ...prev, body: e.target.value }))
							}
							maxLength={AUDIENCE_MAX.body}
							rows={4}
						/>
					</div>
					{formError && <p className="text-sm text-destructive">{formError}</p>}
					<div className="flex items-center gap-2">
						<Button type="submit" disabled={submitting} size="sm">
							{submitting ? (
								<>
									<Spinner /> Saving…
								</>
							) : editingId ? (
								"Update audience"
							) : (
								"Add audience"
							)}
						</Button>
						<Button type="button" variant="ghost" size="sm" onClick={cancel}>
							Cancel
						</Button>
					</div>
				</form>
			)}

			<ConfirmDialog
				open={deleteId != null}
				onOpenChange={(open) => !open && setDeleteId(null)}
				title="Delete audience?"
				description="This segment is removed from the campaign. This cannot be undone."
				confirmLabel="Delete"
				pending={remove.isPending}
				onConfirm={async () => {
					if (!deleteId) return;
					await remove.mutateAsync(deleteId);
					setDeleteId(null);
				}}
			/>
		</div>
	);
}
