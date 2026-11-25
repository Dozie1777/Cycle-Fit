import { useEffect, useState } from "react";
import type {
	CampaignKpiResult,
	CampaignReportSummary,
	KpiKind,
	KpiStatus,
} from "@/client/api-types";
import {
	useCreateCampaignKpiResult,
	useUpdateCampaignKpiResult,
} from "@/client/queries";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
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
import { deriveKpiStatus } from "@/features/campaigns/kpis/kpi-status";

const STATUS_LABELS: Record<KpiStatus, string> = {
	pending: "Pending",
	not_met: "Not met",
	partial: "Partial",
	met: "Met",
	exceeded: "Exceeded",
};

function formatDatetimeLocal(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "";
	const pad = (n: number) => n.toString().padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toIso(datetimeLocal: string): string {
	if (!datetimeLocal) return "";
	const date = new Date(datetimeLocal);
	if (Number.isNaN(date.getTime())) return "";
	return date.toISOString();
}

type ResultForm = {
	actualNumber: string;
	actualBoolean: "true" | "false" | "";
	actualText: string;
	status: KpiStatus | "";
	reportId: string | "none";
	recordedAt: string;
};

/**
 * Dialog to record or edit a KPI result (KUK-896). The status can be left on
 * "Auto" for number KPIs so the server derives met/partial/exceeded from the
 * target; otherwise the user can override explicitly.
 */
export function KpiResultDialog({
	open,
	onOpenChange,
	campaignId,
	kpiId,
	kind,
	kpiName,
	targetNumber,
	result,
	reports,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	campaignId: string;
	kpiId: string;
	kind: KpiKind;
	kpiName: string;
	targetNumber: number | null;
	result?: CampaignKpiResult | null;
	reports: CampaignReportSummary[];
}) {
	const create = useCreateCampaignKpiResult(campaignId);
	const update = useUpdateCampaignKpiResult(campaignId);

	const [form, setForm] = useState<ResultForm>({
		actualNumber: "",
		actualBoolean: "",
		actualText: "",
		status: "",
		reportId: "none",
		recordedAt: formatDatetimeLocal(new Date().toISOString()),
	});
	const [formError, setFormError] = useState<string | null>(null);

	useEffect(() => {
		if (!open) return;
		setFormError(null);
		if (result) {
			setForm({
				actualNumber: result.actualNumber?.toString() ?? "",
				actualBoolean:
					result.actualBoolean === true
						? "true"
						: result.actualBoolean === false
							? "false"
							: "",
				actualText: result.actualText ?? "",
				status: result.status,
				reportId: result.reportId ?? "none",
				recordedAt: formatDatetimeLocal(result.recordedAt),
			});
		} else {
			setForm({
				actualNumber: "",
				actualBoolean: "",
				actualText: "",
				status: "",
				reportId: "none",
				recordedAt: formatDatetimeLocal(new Date().toISOString()),
			});
		}
	}, [open, result]);

	function actualNumberValue(): number | null {
		const trimmed = form.actualNumber.trim();
		if (trimmed === "") return null;
		const n = Number(trimmed);
		return Number.isFinite(n) ? n : null;
	}

	function derivedStatus(): KpiStatus | undefined {
		if (form.status) return form.status;
		if (kind === "number" && targetNumber != null) {
			const actual = actualNumberValue();
			if (actual != null)
				return deriveKpiStatus({ target: targetNumber, actual });
		}
		return undefined;
	}

	async function handleSubmit(event: React.FormEvent) {
		event.preventDefault();
		setFormError(null);

		const body = {
			kpiId,
			actualNumber: kind === "number" ? actualNumberValue() : null,
			actualBoolean:
				kind === "boolean"
					? form.actualBoolean === "true"
						? true
						: form.actualBoolean === "false"
							? false
							: null
					: null,
			actualText:
				kind === "qualitative" ? form.actualText.trim() || null : null,
			status: derivedStatus(),
			reportId: form.reportId === "none" ? null : form.reportId,
			recordedAt: toIso(form.recordedAt) || undefined,
		};

		try {
			if (result) {
				await update.mutateAsync({ resultId: result.id, ...body });
			} else {
				await create.mutateAsync(body);
			}
			onOpenChange(false);
		} catch (e) {
			setFormError(e instanceof Error ? e.message : "Save failed");
		}
	}

	const submitting = create.isPending || update.isPending;

	function renderActualInput() {
		switch (kind) {
			case "number":
				return (
					<div className="space-y-1.5">
						<Label htmlFor="result-actual-number">Actual number</Label>
						<Input
							id="result-actual-number"
							type="number"
							value={form.actualNumber}
							onChange={(e) =>
								setForm((prev) => ({ ...prev, actualNumber: e.target.value }))
							}
							placeholder="0"
						/>
					</div>
				);
			case "boolean":
				return (
					<div className="space-y-1.5">
						<Label htmlFor="result-actual-boolean">Actual</Label>
						<Select
							value={form.actualBoolean || "none"}
							onValueChange={(value) =>
								setForm((prev) => ({
									...prev,
									actualBoolean:
										value === "none" ? "" : (value as "true" | "false"),
								}))
							}
						>
							<SelectTrigger id="result-actual-boolean" className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="none">No selection</SelectItem>
								<SelectItem value="true">Yes</SelectItem>
								<SelectItem value="false">No</SelectItem>
							</SelectContent>
						</Select>
					</div>
				);
			case "qualitative":
				return (
					<div className="space-y-1.5">
						<Label htmlFor="result-actual-text">Actual outcome</Label>
						<Input
							id="result-actual-text"
							value={form.actualText}
							onChange={(e) =>
								setForm((prev) => ({ ...prev, actualText: e.target.value }))
							}
							maxLength={2000}
							placeholder="e.g. Covered in TechCrunch and The Verge"
						/>
					</div>
				);
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>{result ? "Edit result" : "Record result"}</DialogTitle>
					<DialogDescription>
						{result
							? "Update the recorded outcome for"
							: "Record the outcome for"}{" "}
						<strong>{kpiName}</strong>.
					</DialogDescription>
				</DialogHeader>
				<form onSubmit={handleSubmit} className="space-y-4">
					{renderActualInput()}
					<div className="space-y-1.5">
						<Label htmlFor="result-status">Status</Label>
						<Select
							value={form.status || "auto"}
							onValueChange={(value) =>
								setForm((prev) => ({
									...prev,
									status: value === "auto" ? "" : (value as KpiStatus),
								}))
							}
						>
							<SelectTrigger id="result-status" className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="auto">Auto (from target)</SelectItem>
								{(Object.keys(STATUS_LABELS) as KpiStatus[]).map((status) => (
									<SelectItem key={status} value={status}>
										{STATUS_LABELS[status]}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor="result-report">Linked report (optional)</Label>
						<Select
							value={form.reportId || "none"}
							onValueChange={(value) =>
								setForm((prev) => ({
									...prev,
									reportId: value as string | "none",
								}))
							}
						>
							<SelectTrigger id="result-report" className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="none">None</SelectItem>
								{reports.map((report) => (
									<SelectItem key={report.id} value={report.id}>
										{report.title}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor="result-recorded-at">Recorded at</Label>
						<Input
							id="result-recorded-at"
							type="datetime-local"
							value={form.recordedAt}
							onChange={(e) =>
								setForm((prev) => ({ ...prev, recordedAt: e.target.value }))
							}
						/>
					</div>
					{formError && <p className="text-sm text-destructive">{formError}</p>}
					<DialogFooter>
						<Button type="submit" disabled={submitting}>
							{submitting ? (
								<>
									<Spinner /> Saving…
								</>
							) : result ? (
								"Update result"
							) : (
								"Record result"
							)}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
