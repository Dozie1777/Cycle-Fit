import { ShareMarkdown } from "@/features/campaigns/components/share/markdown";
import type { CampaignShareSnapshot } from "@/server/data/campaign-share-page";

/**
 * Public campaign share page (KUK-876) — a compiled snapshot of a shared
 * campaign, not a live admin view. Light marketing theming to match the
 * public design share page (share.$projectId.tsx); the admin shell stays
 * dark and is never imported here. The component takes a plain snapshot
 * prop so it renders with no session, no admin API, and no route context.
 */

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

function formatDate(value: string | null): string {
	if (!value) return "—";
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? "—" : DATE_FORMAT.format(date);
}

function formatDateRange(range: {
	start: string | null;
	end: string | null;
}): string {
	if (!range.start && !range.end) return "Dates to be scheduled";
	if (range.start && range.end) {
		return `${formatDate(range.start)} – ${formatDate(range.end)}`;
	}
	return formatDate(range.start ?? range.end);
}

const STATUS_STYLES: Record<string, string> = {
	planned: "bg-amber-100 text-amber-800",
	draft: "bg-gray-100 text-gray-700",
	scheduled: "bg-blue-100 text-blue-800",
	published: "bg-green-100 text-green-800",
	final: "bg-green-100 text-green-800",
};

function StatusBadge({ status }: { status: string }) {
	return (
		<span
			className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[0.7rem] font-medium capitalize ${STATUS_STYLES[status] ?? "bg-gray-100 text-gray-700"}`}
		>
			{status}
		</span>
	);
}

function SectionCard({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<section className="rounded-xl border border-[#e2e4e8] bg-white p-5 shadow-sm sm:p-6">
			<h2 className="mb-4 text-sm font-semibold tracking-wide text-gray-500 uppercase">
				{title}
			</h2>
			{children}
		</section>
	);
}

export function CampaignSharePage({
	snapshot,
}: {
	snapshot: CampaignShareSnapshot;
}) {
	const { name, dateRange, brief, audiences, plans, events, assets, reports } =
		snapshot;
	// Structured audience rows are the source of truth; the deprecated
	// brief.audience markdown is the fallback for unmigrated campaigns.
	const audienceText =
		audiences.length > 0
			? audiences
					.map((audience) =>
						audience.buyingStage
							? `${audience.name} (${audience.buyingStage})`
							: audience.name,
					)
					.join(", ")
			: (brief?.audience ?? null);
	// Brief fields (when a brief row exists) plus the audience row, which
	// renders even when the campaign has audiences but no brief yet.
	const briefRows = [
		...(brief
			? [
					["Objective", brief.objective],
					["Key message", brief.keyMessage],
					["Tone", brief.tone],
					["Channels", brief.channels],
				]
			: []),
		["Audience", audienceText],
	].filter(([, value]) => Boolean(value));

	return (
		<div className="min-h-dvh bg-[#f6f7f9] font-sans text-black">
			<header className="border-b border-[#e2e4e8] bg-white pt-[max(0.625rem,env(safe-area-inset-top))] pb-2.5 pr-4 pl-4">
				<span className="text-sm font-bold">
					OpenCraft<span className="text-blue-600">.</span>studio
				</span>
				<span className="ml-3 text-xs text-gray-500">Shared campaign</span>
			</header>
			<main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
				<section className="rounded-xl border border-[#e2e4e8] bg-white p-6 shadow-sm sm:p-8">
					<p className="mb-2 text-xs font-medium tracking-wide text-blue-600 uppercase">
						Campaign
					</p>
					<h1 className="text-2xl font-bold sm:text-3xl">{name}</h1>
					<p className="mt-2 text-sm text-gray-500">
						{formatDateRange(dateRange)}
					</p>
					<p className="mt-4 text-xs text-gray-400">
						Read-only snapshot — shared from the campaign studio.
					</p>
				</section>

				{/* The section renders when there is anything to show: a brief
				    row, structured audience rows, or a legacy audience value. */}
				{(brief || audiences.length > 0) && briefRows.length > 0 ? (
					<SectionCard title="Brief">
						{briefRows.length > 0 ? (
							<dl className="grid gap-3 sm:grid-cols-2">
								{briefRows.map(([label, value]) => (
									<div key={label} className="min-w-0">
										<dt className="text-xs font-medium text-gray-500">
											{label}
										</dt>
										<dd className="mt-0.5 text-sm whitespace-pre-line">
											{value}
										</dd>
									</div>
								))}
							</dl>
						) : null}
						{brief?.body ? (
							<div className="prose prose-sm mt-4 max-w-none text-sm text-gray-800">
								<ShareMarkdown text={brief.body} />
							</div>
						) : null}
					</SectionCard>
				) : null}

				{plans.length > 0 ? (
					<SectionCard title="Plan">
						<div className="space-y-6">
							{plans.map((plan) => (
								<div key={plan.id}>
									<div className="mb-2 flex items-center gap-2">
										<h3 className="text-sm font-semibold">{plan.name}</h3>
										<StatusBadge status={plan.status} />
									</div>
									<ol className="space-y-3 border-l-2 border-gray-100 pl-4">
										{plan.phases.map((phase) => (
											<li key={phase.id}>
												<div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
													<span className="text-sm font-medium">
														{phase.name}
													</span>
													<span className="text-xs text-gray-500">
														{formatDate(phase.startsAt)} –{" "}
														{formatDate(phase.endsAt)}
													</span>
												</div>
												{phase.objective ? (
													<p className="mt-0.5 text-sm text-gray-600">
														{phase.objective}
													</p>
												) : null}
											</li>
										))}
									</ol>
								</div>
							))}
						</div>
					</SectionCard>
				) : null}

				{events.length > 0 ? (
					<SectionCard title="Content calendar">
						<ul className="divide-y divide-gray-100">
							{events.map((event) => (
								<li
									key={event.id}
									className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0"
								>
									<span className="min-w-0 flex-1 text-sm font-medium">
										{event.title}
									</span>
									{event.channel ? (
										<span className="text-xs text-gray-500">
											{event.channel}
										</span>
									) : null}
									<span className="text-xs text-gray-500">
										{formatDate(event.scheduledAt)}
									</span>
									<StatusBadge status={event.status} />
								</li>
							))}
						</ul>
					</SectionCard>
				) : null}

				{assets.length > 0 ? (
					<SectionCard title="Assets">
						<div className="space-y-4">
							{assets.map((asset) => (
								<figure key={asset.id} className="min-w-0">
									<iframe
										src={`/designs/${asset.id}/site`}
										title={asset.prompt}
										sandbox="allow-scripts allow-forms allow-popups"
										loading="lazy"
										className="aspect-video w-full rounded-lg border border-[#e2e4e8] bg-white"
									/>
									<figcaption className="mt-1.5 truncate text-xs text-gray-500">
										{asset.prompt}
									</figcaption>
								</figure>
							))}
						</div>
					</SectionCard>
				) : null}

				{reports ? (
					<SectionCard title="Reports & KPIs">
						<div className="space-y-5">
							{reports.map((report) => (
								<article key={report.id} className="min-w-0">
									<div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
										<h3 className="text-sm font-semibold">{report.title}</h3>
										<span className="text-xs text-gray-500">
											{formatDate(report.periodStart)} –{" "}
											{formatDate(report.periodEnd)}
										</span>
									</div>
									{report.summary ? (
										<p className="mt-1 text-sm text-gray-700">
											{report.summary}
										</p>
									) : null}
									{report.metrics ? (
										<div className="mt-3 rounded-lg bg-gray-50 p-3 text-sm text-gray-800">
											<ShareMarkdown text={report.metrics} />
										</div>
									) : null}
									<div className="prose prose-sm mt-3 max-w-none text-sm text-gray-800">
										<ShareMarkdown text={report.body} />
									</div>
								</article>
							))}
						</div>
					</SectionCard>
				) : null}
			</main>
		</div>
	);
}
