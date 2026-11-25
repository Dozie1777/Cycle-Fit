import { useState } from "react";
import { Streamdown } from "streamdown";
import type { CampaignReportSummary } from "@/client/api-types";
import { useCampaignReport, useCreateCampaignReport } from "@/client/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** "Mar 2 – Mar 8" period label; "—" halves when a bound is missing. */
function periodLabel(start: string | null, end: string | null): string {
	const format = (value: string) => {
		const date = new Date(value);
		return Number.isNaN(date.getTime()) ? "—" : date.toISOString().slice(0, 10);
	};
	if (!start && !end) return "no period";
	return `${start ? format(start) : "—"} – ${end ? format(end) : "—"}`;
}

function ReportView({
	campaignId,
	reportId,
}: {
	campaignId: string;
	reportId: string;
}) {
	const {
		data: report,
		isPending,
		error,
		refetch,
	} = useCampaignReport(campaignId, reportId);

	if (isPending) {
		return (
			<div className="space-y-3 p-4">
				<Skeleton className="h-4 w-1/2" />
				<Skeleton className="h-4 w-3/4" />
				<Skeleton className="h-24 w-full" />
			</div>
		);
	}
	if (error) {
		return (
			<div className="p-4">
				<p className="text-sm text-destructive">
					Failed to load report: {errorMessage(error)}
				</p>
				<Button
					type="button"
					variant="outline"
					size="sm"
					className="mt-2"
					onClick={() => void refetch()}
				>
					Retry
				</Button>
			</div>
		);
	}
	if (!report) return null;
	return (
		<div className="space-y-4 p-4">
			<p className="text-xs text-muted-foreground">
				{periodLabel(report.periodStart, report.periodEnd)}
			</p>
			{report.summary && (
				<div className="typeset rounded-md border bg-muted/40 p-3 text-sm">
					<Streamdown>{report.summary}</Streamdown>
				</div>
			)}
			{report.metrics && (
				<div className="typeset text-sm">
					<Streamdown>{report.metrics}</Streamdown>
				</div>
			)}
			<div className="typeset text-sm">
				<Streamdown>{report.body}</Streamdown>
			</div>
		</div>
	);
}

function NewReportForm({ campaignId }: { campaignId: string }) {
	const createReport = useCreateCampaignReport(campaignId);
	const [open, setOpen] = useState(false);
	const [title, setTitle] = useState("");
	const [periodStart, setPeriodStart] = useState("");
	const [periodEnd, setPeriodEnd] = useState("");
	const [body, setBody] = useState("");
	const [error, setError] = useState<string | null>(null);

	async function handleCreate(event: React.FormEvent) {
		event.preventDefault();
		if (!title.trim() || !body.trim()) return;
		setError(null);
		try {
			await createReport.mutateAsync({
				title: title.trim(),
				body: body.trim(),
				periodStart: periodStart || null,
				periodEnd: periodEnd || null,
			});
			setTitle("");
			setPeriodStart("");
			setPeriodEnd("");
			setBody("");
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
				New report
			</Button>
		);
	}
	return (
		<form onSubmit={handleCreate} className="space-y-2 rounded-md border p-3">
			<div className="grid gap-2 sm:grid-cols-3">
				<div className="space-y-1">
					<Label htmlFor="new-report-title">Title</Label>
					<Input
						id="new-report-title"
						value={title}
						onChange={(e) => setTitle(e.target.value)}
						required
						maxLength={200}
						placeholder="e.g. Week 1 performance"
					/>
				</div>
				<div className="space-y-1">
					<Label htmlFor="new-report-start">Period start</Label>
					<Input
						id="new-report-start"
						type="date"
						value={periodStart}
						onChange={(e) => setPeriodStart(e.target.value)}
					/>
				</div>
				<div className="space-y-1">
					<Label htmlFor="new-report-end">Period end</Label>
					<Input
						id="new-report-end"
						type="date"
						value={periodEnd}
						onChange={(e) => setPeriodEnd(e.target.value)}
					/>
				</div>
			</div>
			<div className="space-y-1">
				<Label htmlFor="new-report-body">Report body (markdown)</Label>
				<Textarea
					id="new-report-body"
					value={body}
					onChange={(e) => setBody(e.target.value)}
					rows={6}
					required
					placeholder="## Summary&#10;## What worked&#10;## Next steps"
				/>
			</div>
			<div className="flex gap-2">
				<Button type="submit" size="sm" disabled={createReport.isPending}>
					{createReport.isPending ? <Spinner /> : "Create report"}
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
			{(error || createReport.isError) && (
				<p className="text-xs text-destructive">
					{error ?? errorMessage(createReport.error)}
				</p>
			)}
		</form>
	);
}

/**
 * Reports panel: a tab per saved report (summaries from the campaign
 * detail), each rendered as Streamdown markdown; the selected tab's full
 * body is fetched from the documents route. New reports are created
 * manually with a title and period.
 */
export function CampaignReportsPanel({
	campaignId,
	reports,
}: {
	campaignId: string;
	reports: CampaignReportSummary[];
}) {
	if (reports.length === 0) {
		return (
			<div className="space-y-4 p-4">
				<NewReportForm campaignId={campaignId} />
				<div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
					No reports yet — reports land here as the campaign runs; ask the agent
					in chat for a performance recap, or create one above.
				</div>
			</div>
		);
	}
	return (
		<div className="space-y-4 p-4">
			<NewReportForm campaignId={campaignId} />
			<Tabs defaultValue={reports[0]?.id}>
				<TabsList className="max-w-full flex-wrap">
					{reports.map((report) => (
						<TabsTrigger key={report.id} value={report.id}>
							{report.title}
							<span className="ml-1.5 text-xs font-normal text-muted-foreground">
								{periodLabel(report.periodStart, report.periodEnd)}
							</span>
						</TabsTrigger>
					))}
				</TabsList>
				{reports.map((report) => (
					<TabsContent key={report.id} value={report.id}>
						<ReportView campaignId={campaignId} reportId={report.id} />
					</TabsContent>
				))}
			</Tabs>
		</div>
	);
}
