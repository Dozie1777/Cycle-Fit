import { useState } from "react";
import type { CampaignKpi, KpiKind } from "@/client/api-types";
import {
	useCampaignKpis,
	useCreateCampaignKpi,
	useDeleteCampaignKpi,
	useUpdateCampaignKpi,
} from "@/client/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";

const KIND_LABELS: Record<KpiKind, string> = {
	number: "Number",
	boolean: "Yes / No",
	qualitative: "Qualitative",
};

const DEFAULT_COLOR = "#3b82f6";

type KpiForm = {
	name: string;
	kind: KpiKind;
	targetNumber: string;
	targetBoolean: "true" | "false" | "";
	targetText: string;
	unit: string;
	color: string;
	sortOrder: string;
};

function emptyForm(): KpiForm {
	return {
		name: "",
		kind: "number",
		targetNumber: "",
		targetBoolean: "",
		targetText: "",
		unit: "",
		color: DEFAULT_COLOR,
		sortOrder: "0",
	};
}

function kpiToForm(kpi: CampaignKpi): KpiForm {
	return {
		name: kpi.name,
		kind: kpi.kind,
		targetNumber: kpi.targetNumber?.toString() ?? "",
		targetBoolean:
			kpi.targetBoolean === true
				? "true"
				: kpi.targetBoolean === false
					? "false"
					: "",
		targetText: kpi.targetText ?? "",
		unit: kpi.unit ?? "",
		color: kpi.color ?? DEFAULT_COLOR,
		sortOrder: kpi.sortOrder.toString(),
	};
}

function targetSummary(kpi: CampaignKpi): string {
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

function parseNumber(value: string): number | null {
	const trimmed = value.trim();
	if (trimmed === "") return null;
	const n = Number(trimmed);
	return Number.isFinite(n) ? n : null;
}

/**
 * Inline structured KPI editor for the brief panel (KUK-896). Replaces the
 * deprecated free-text CampaignBrief.kpis markdown field. Users can add,
 * reorder, edit and delete per-campaign KPI targets.
 */
export function CampaignKpiEditor({ campaignId }: { campaignId: string }) {
	const { data: kpis = [], isPending } = useCampaignKpis(campaignId);
	const create = useCreateCampaignKpi(campaignId);
	const update = useUpdateCampaignKpi(campaignId);
	const remove = useDeleteCampaignKpi(campaignId);

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

	function startEdit(kpi: CampaignKpi) {
		setForm(kpiToForm(kpi));
		setFormError(null);
		setEditingId(kpi.id);
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
			kind: form.kind,
			targetNumber: parseNumber(form.targetNumber),
			targetBoolean:
				form.targetBoolean === "true"
					? true
					: form.targetBoolean === "false"
						? false
						: null,
			targetText: form.targetText.trim() || null,
			unit: form.unit.trim() || null,
			color: form.color || null,
			sortOrder: Number(form.sortOrder) || 0,
		};
		try {
			if (editingId) {
				await update.mutateAsync({ kpiId: editingId, ...body });
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
					<h3 className="text-sm font-semibold">KPIs</h3>
					<p className="text-xs text-muted-foreground">
						Structured targets for this campaign.
					</p>
				</div>
				{!isAdding && !editingId && (
					<Button type="button" size="sm" onClick={startAdd}>
						Add KPI
					</Button>
				)}
			</div>

			{isPending ? (
				<div className="text-sm text-muted-foreground">Loading KPIs…</div>
			) : kpis.length === 0 && !isAdding && !editingId ? (
				<div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
					No KPIs yet — add the targets you want to track.
				</div>
			) : (
				<div className="space-y-2">
					{kpis.map((kpi) => (
						<div
							key={kpi.id}
							className="flex items-start gap-3 rounded-lg border p-3"
							style={{
								borderLeftWidth: "4px",
								borderLeftColor: kpi.color ?? "transparent",
							}}
						>
							<div className="min-w-0 flex-1">
								<div className="flex items-center gap-2">
									<p className="truncate text-sm font-medium">{kpi.name}</p>
									<Badge variant="secondary" className="text-[10px]">
										{KIND_LABELS[kpi.kind]}
									</Badge>
								</div>
								<p className="text-xs text-muted-foreground">
									Target: {targetSummary(kpi)}
								</p>
							</div>
							<div className="flex items-center gap-1">
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="h-7 px-2"
									onClick={() => startEdit(kpi)}
								>
									Edit
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="h-7 px-2 text-destructive"
									onClick={() => setDeleteId(kpi.id)}
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
						<Label htmlFor="kpi-name">Name</Label>
						<Input
							id="kpi-name"
							value={form.name}
							onChange={(e) =>
								setForm((prev) => ({ ...prev, name: e.target.value }))
							}
							maxLength={200}
							placeholder="e.g. Newsletter signups"
						/>
					</div>
					<div className="grid gap-3 sm:grid-cols-2">
						<div className="space-y-1.5">
							<Label htmlFor="kpi-kind">Type</Label>
							<Select
								value={form.kind}
								onValueChange={(value) =>
									setForm((prev) => ({ ...prev, kind: value as KpiKind }))
								}
							>
								<SelectTrigger id="kpi-kind" className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="number">Number</SelectItem>
									<SelectItem value="boolean">Yes / No</SelectItem>
									<SelectItem value="qualitative">Qualitative</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="kpi-color">Color</Label>
							<div className="flex items-center gap-2">
								<input
									id="kpi-color"
									type="color"
									value={form.color}
									onChange={(e) =>
										setForm((prev) => ({ ...prev, color: e.target.value }))
									}
									className="h-8 w-8 cursor-pointer rounded border bg-transparent p-0.5"
								/>
								<span className="text-xs text-muted-foreground">
									{form.color}
								</span>
							</div>
						</div>
					</div>
					{form.kind === "number" && (
						<div className="grid gap-3 sm:grid-cols-2">
							<div className="space-y-1.5">
								<Label htmlFor="kpi-target-number">Target number</Label>
								<Input
									id="kpi-target-number"
									type="number"
									value={form.targetNumber}
									onChange={(e) =>
										setForm((prev) => ({
											...prev,
											targetNumber: e.target.value,
										}))
									}
									placeholder="0"
								/>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="kpi-unit">Unit (optional)</Label>
								<Input
									id="kpi-unit"
									value={form.unit}
									onChange={(e) =>
										setForm((prev) => ({ ...prev, unit: e.target.value }))
									}
									maxLength={50}
									placeholder="e.g. %, signups"
								/>
							</div>
						</div>
					)}
					{form.kind === "boolean" && (
						<div className="space-y-1.5">
							<Label htmlFor="kpi-target-boolean">Target</Label>
							<Select
								value={form.targetBoolean || "none"}
								onValueChange={(value) =>
									setForm((prev) => ({
										...prev,
										targetBoolean: (value === "none"
											? ""
											: value) as KpiForm["targetBoolean"],
									}))
								}
							>
								<SelectTrigger id="kpi-target-boolean" className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="none">No target</SelectItem>
									<SelectItem value="true">Yes</SelectItem>
									<SelectItem value="false">No</SelectItem>
								</SelectContent>
							</Select>
						</div>
					)}
					{form.kind === "qualitative" && (
						<div className="space-y-1.5">
							<Label htmlFor="kpi-target-text">Target description</Label>
							<Input
								id="kpi-target-text"
								value={form.targetText}
								onChange={(e) =>
									setForm((prev) => ({ ...prev, targetText: e.target.value }))
								}
								maxLength={2000}
								placeholder="e.g. Positive coverage in 3 tier-1 outlets"
							/>
						</div>
					)}
					<div className="space-y-1.5">
						<Label htmlFor="kpi-order">Sort order</Label>
						<Input
							id="kpi-order"
							type="number"
							value={form.sortOrder}
							onChange={(e) =>
								setForm((prev) => ({ ...prev, sortOrder: e.target.value }))
							}
							min={0}
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
								"Update KPI"
							) : (
								"Add KPI"
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
				title="Delete KPI?"
				description="This also deletes every recorded result for this KPI. This cannot be undone."
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
