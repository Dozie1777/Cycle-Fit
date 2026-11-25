import { useState } from "react";
import type {
	CampaignDetail,
	CampaignPlanDetail,
	CampaignPlanPhase,
} from "@/client/api-types";
import { useUpdateCampaignPhase } from "@/client/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * The plan shown as current (KUK-984): prefer a `final` plan, else the most
 * recently updated one. Near-duplicate drafts from iterative agent turns are
 * collapsed behind a disclosure instead of stacking.
 */
function pickCurrentPlan(plans: CampaignPlanDetail[]): CampaignPlanDetail {
	const finalPlans = plans.filter((plan) => plan.status === "final");
	const pool = finalPlans.length > 0 ? finalPlans : plans;
	return [...pool].sort(
		(a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
	)[0];
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function day(iso: string | null): string {
	if (!iso) return "";
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "";
	return date.toISOString().slice(0, 10);
}

function PhaseChip({
	campaignId,
	phase,
	isLast,
	expanded,
	isNow,
	onToggle,
}: {
	campaignId: string;
	phase: CampaignPlanPhase;
	isLast: boolean;
	/** Today falls inside this phase's date range (KUK-992). */
	isNow: boolean;
	expanded: boolean;
	onToggle: () => void;
}) {
	const updatePhase = useUpdateCampaignPhase(campaignId);
	const [error, setError] = useState<string | null>(null);

	async function move(direction: -1 | 1): Promise<void> {
		setError(null);
		try {
			// Same renumbering semantics as the studio plan panel: move to the
			// neighbour slot; the plan is renumbered server-side.
			await updatePhase.mutateAsync({
				phaseId: phase.id,
				position: phase.position + direction,
			});
		} catch (e) {
			setError(errorMessage(e));
		}
	}

	return (
		<div className="min-w-0 flex-1">
			<button
				type="button"
				aria-expanded={expanded}
				aria-current={isNow ? "step" : undefined}
				onClick={onToggle}
				className={`relative w-full rounded-md border p-3 text-left transition-colors hover:bg-accent/40 ${
					expanded ? "border-primary/50 bg-accent/30" : ""
				} ${isNow ? "border-primary/60 bg-accent/20" : ""}`}
			>
				{isNow && (
					<span className="absolute -top-2 left-2 rounded bg-primary px-1.5 py-px text-[8.5px] font-bold tracking-wider text-primary-foreground">
						YOU ARE HERE
					</span>
				)}
				<p className="truncate text-sm font-medium">
					{phase.position + 1}. {phase.name}
				</p>
				{(phase.startsAt || phase.endsAt) && (
					<p className="text-xs text-muted-foreground">
						{day(phase.startsAt) || "…"} – {day(phase.endsAt) || "…"}
					</p>
				)}
			</button>
			{expanded && (
				<div className="mt-1 space-y-2 rounded-md border bg-card/50 p-3">
					<p className="text-sm">
						{phase.objective ?? "No objective yet — edit it in the studio."}
					</p>
					<div className="flex items-center gap-1">
						<Button
							type="button"
							variant="outline"
							size="sm"
							aria-label={`Move ${phase.name} up`}
							disabled={phase.position === 0 || updatePhase.isPending}
							onClick={() => void move(-1)}
						>
							← Earlier
						</Button>
						<Button
							type="button"
							variant="outline"
							size="sm"
							aria-label={`Move ${phase.name} down`}
							disabled={isLast || updatePhase.isPending}
							onClick={() => void move(1)}
						>
							Later →
						</Button>
					</div>
					{error && <p className="text-xs text-destructive">{error}</p>}
				</div>
			)}
		</div>
	);
}

/**
 * The phase strip for one plan (KUK-984): chips shared by the current plan
 * and the collapsed older versions.
 */
function PlanPhases({
	plan,
	detail,
	expandedId,
	setExpandedId,
}: {
	plan: CampaignPlanDetail;
	detail: CampaignDetail;
	expandedId: string | null;
	setExpandedId: (updater: (prev: string | null) => string | null) => void;
}) {
	if (plan.phases.length === 0) {
		return (
			<p className="text-xs text-muted-foreground">
				No phases in this plan yet.
			</p>
		);
	}
	// KUK-992: highlight the phase whose date range contains today. A phase
	// with no start date can't claim the marker — otherwise an open-ended
	// "… – Dec 20" phase lights up alongside the real current one.
	const nowMs = Date.now();
	const isNow = (phase: CampaignPlanPhase) => {
		if (!phase.startsAt) return false;
		const start = new Date(phase.startsAt).getTime();
		const end = phase.endsAt ? new Date(phase.endsAt).getTime() : null;
		return start <= nowMs && (end === null || end >= nowMs);
	};
	return (
		<div className="flex flex-col gap-2 sm:flex-row sm:gap-2">
			{plan.phases.map((phase, index) => (
				<PhaseChip
					key={phase.id}
					campaignId={detail.id}
					phase={phase}
					isLast={index === plan.phases.length - 1}
					isNow={isNow(phase)}
					expanded={expandedId === phase.id}
					onToggle={() =>
						setExpandedId((prev) => (prev === phase.id ? null : phase.id))
					}
				/>
			))}
		</div>
	);
}

/**
 * Plan timeline: one plan presented as current (KUK-984), older versions
 * collapsed behind a disclosure. Click a chip to expand its objective and
 * reorder buttons; reorder patches the phase position with the same
 * renumbering semantics the studio plan panel uses.
 */
export function CampaignPlanTimeline({
	detail,
	onOpenStudio,
}: {
	detail: CampaignDetail;
	onOpenStudio: (tab?: "brief" | "plan" | "calendar" | "reports") => void;
}) {
	const [expandedId, setExpandedId] = useState<string | null>(null);

	if (detail.plans.length === 0) {
		return (
			<section aria-label="Plan">
				<h2 className="mb-2 text-sm font-semibold">Plan</h2>
				<div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
					No plan yet — ask the agent in the studio to break the campaign into
					phases.
					<div className="mt-2">
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => onOpenStudio("plan")}
						>
							Open studio
						</Button>
					</div>
				</div>
			</section>
		);
	}

	return (
		<section aria-label="Plan">
			<div className="mb-2 flex items-center justify-between">
				<h2 className="text-sm font-semibold">Plan</h2>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onClick={() => onOpenStudio("plan")}
				>
					Edit plan
				</Button>
			</div>
			<div className="space-y-4">
				{/* KUK-984: one plan presented as current; older/draft versions stay
					available behind a disclosure so near-duplicates don't stack. */}
				{(() => {
					const current = pickCurrentPlan(detail.plans);
					const others = detail.plans
						.filter((plan) => plan.id !== current.id)
						.sort(
							(a, b) =>
								new Date(b.updatedAt).getTime() -
								new Date(a.updatedAt).getTime(),
						);
					return (
						<>
							<div className="space-y-2">
								<div className="flex items-center gap-2">
									<p className="truncate text-sm font-medium">{current.name}</p>
									<Badge
										variant={current.status === "final" ? "default" : "outline"}
									>
										Current plan
									</Badge>
								</div>
								<PlanPhases
									plan={current}
									detail={detail}
									expandedId={expandedId}
									setExpandedId={setExpandedId}
								/>
							</div>
							{others.length > 0 && (
								<details className="rounded-md border border-dashed p-2">
									<summary className="cursor-pointer text-xs text-muted-foreground">
										{others.length} other plan version
										{others.length === 1 ? "" : "s"} (drafts and older edits)
									</summary>
									<div className="mt-2 space-y-4">
										{others.map((plan) => (
											<div key={plan.id} className="space-y-2">
												<div className="flex items-center gap-2">
													<p className="truncate text-sm font-medium">
														{plan.name}
													</p>
													<Badge variant="outline">{plan.status}</Badge>
												</div>
												<PlanPhases
													plan={plan}
													detail={detail}
													expandedId={expandedId}
													setExpandedId={setExpandedId}
												/>
											</div>
										))}
									</div>
								</details>
							)}
						</>
					);
				})()}
			</div>
		</section>
	);
}
