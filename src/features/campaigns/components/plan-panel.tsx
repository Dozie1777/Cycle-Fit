import { useState } from "react";
import type { CampaignPlanDetail } from "@/client/api-types";
import {
	useAddCampaignPhase,
	useCreateCampaignPlan,
	useDeleteCampaignDocument,
	useUpdateCampaignPhase,
	useUpdateCampaignPlan,
} from "@/client/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

function shortDate(iso: string | null): string {
	if (!iso) return "—";
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "—";
	return date.toISOString().slice(0, 10);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** One phase row: inline meta plus a collapsible editor and reorder arrows. */
function PhaseRow({
	campaignId,
	phase,
	isFirst,
	isLast,
}: {
	campaignId: string;
	phase: CampaignPlanDetail["phases"][number];
	isFirst: boolean;
	isLast: boolean;
}) {
	const updatePhase = useUpdateCampaignPhase(campaignId);
	const deleteDocument = useDeleteCampaignDocument(campaignId);
	const [editing, setEditing] = useState(false);
	const [name, setName] = useState(phase.name);
	const [objective, setObjective] = useState(phase.objective ?? "");
	const [startsAt, setStartsAt] = useState(
		phase.startsAt ? phase.startsAt.slice(0, 10) : "",
	);
	const [endsAt, setEndsAt] = useState(
		phase.endsAt ? phase.endsAt.slice(0, 10) : "",
	);
	const [body, setBody] = useState(phase.body ?? "");
	const [actionError, setActionError] = useState<string | null>(null);

	async function handleSave(event: React.FormEvent) {
		event.preventDefault();
		setActionError(null);
		try {
			await updatePhase.mutateAsync({
				phaseId: phase.id,
				name: name.trim() || undefined,
				objective: objective.trim() === "" ? null : objective,
				startsAt: startsAt || null,
				endsAt: endsAt || null,
				body: body.trim() === "" ? null : body,
			});
			setEditing(false);
		} catch (e) {
			setActionError(errorMessage(e));
		}
	}

	async function handleMove(direction: -1 | 1) {
		setActionError(null);
		try {
			await updatePhase.mutateAsync({
				phaseId: phase.id,
				position: phase.position + direction,
			});
		} catch (e) {
			setActionError(errorMessage(e));
		}
	}

	async function handleDelete() {
		setActionError(null);
		try {
			await deleteDocument.mutateAsync({ kind: "phase", id: phase.id });
		} catch (e) {
			setActionError(errorMessage(e));
		}
	}

	return (
		<li className="space-y-1.5 rounded-md border p-3">
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0">
					<p className="truncate text-sm font-medium">
						<span className="mr-1.5 text-muted-foreground">
							{phase.position + 1}.
						</span>
						{phase.name}
					</p>
					<p className="text-xs text-muted-foreground">
						{shortDate(phase.startsAt)} – {shortDate(phase.endsAt)}
						{phase.objective ? ` · ${phase.objective}` : ""}
					</p>
				</div>
				<div className="flex shrink-0 items-center gap-1">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						disabled={isFirst || updatePhase.isPending}
						aria-label={`Move ${phase.name} up`}
						onClick={() => void handleMove(-1)}
					>
						↑
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						disabled={isLast || updatePhase.isPending}
						aria-label={`Move ${phase.name} down`}
						onClick={() => void handleMove(1)}
					>
						↓
					</Button>
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
							<Label htmlFor={`phase-name-${phase.id}`}>Name</Label>
							<Input
								id={`phase-name-${phase.id}`}
								value={name}
								onChange={(e) => setName(e.target.value)}
								required
								maxLength={120}
							/>
						</div>
						<div className="space-y-1">
							<Label htmlFor={`phase-objective-${phase.id}`}>Objective</Label>
							<Input
								id={`phase-objective-${phase.id}`}
								value={objective}
								onChange={(e) => setObjective(e.target.value)}
								maxLength={2000}
							/>
						</div>
						<div className="space-y-1">
							<Label htmlFor={`phase-start-${phase.id}`}>Starts</Label>
							<Input
								id={`phase-start-${phase.id}`}
								type="date"
								value={startsAt}
								onChange={(e) => setStartsAt(e.target.value)}
							/>
						</div>
						<div className="space-y-1">
							<Label htmlFor={`phase-end-${phase.id}`}>Ends</Label>
							<Input
								id={`phase-end-${phase.id}`}
								type="date"
								value={endsAt}
								onChange={(e) => setEndsAt(e.target.value)}
							/>
						</div>
					</div>
					<div className="space-y-1">
						<Label htmlFor={`phase-body-${phase.id}`}>Detail (markdown)</Label>
						<Textarea
							id={`phase-body-${phase.id}`}
							value={body}
							onChange={(e) => setBody(e.target.value)}
							rows={3}
						/>
					</div>
					<Button type="submit" size="sm" disabled={updatePhase.isPending}>
						{updatePhase.isPending ? <Spinner /> : "Save phase"}
					</Button>
				</form>
			)}
			{actionError && <p className="text-xs text-destructive">{actionError}</p>}
		</li>
	);
}

function PlanCard({
	campaignId,
	plan,
}: {
	campaignId: string;
	plan: CampaignPlanDetail;
}) {
	const updatePlan = useUpdateCampaignPlan(campaignId);
	const addPhase = useAddCampaignPhase(campaignId);
	const deleteDocument = useDeleteCampaignDocument(campaignId);
	const [editing, setEditing] = useState(false);
	const [name, setName] = useState(plan.name);
	const [addingPhase, setAddingPhase] = useState(false);
	const [newPhaseName, setNewPhaseName] = useState("");
	const [newPhaseObjective, setNewPhaseObjective] = useState("");
	const [actionError, setActionError] = useState<string | null>(null);

	async function handleRename(event: React.FormEvent) {
		event.preventDefault();
		setActionError(null);
		try {
			await updatePlan.mutateAsync({ planId: plan.id, name: name.trim() });
			setEditing(false);
		} catch (e) {
			setActionError(errorMessage(e));
		}
	}

	async function handleStatusToggle() {
		setActionError(null);
		try {
			await updatePlan.mutateAsync({
				planId: plan.id,
				status: plan.status === "final" ? "draft" : "final",
			});
		} catch (e) {
			setActionError(errorMessage(e));
		}
	}

	async function handleDelete() {
		setActionError(null);
		try {
			await deleteDocument.mutateAsync({ kind: "plan", id: plan.id });
		} catch (e) {
			setActionError(errorMessage(e));
		}
	}

	async function handleAddPhase(event: React.FormEvent) {
		event.preventDefault();
		if (!newPhaseName.trim()) return;
		setActionError(null);
		try {
			await addPhase.mutateAsync({
				planId: plan.id,
				name: newPhaseName.trim(),
				objective: newPhaseObjective.trim() === "" ? null : newPhaseObjective,
			});
			setNewPhaseName("");
			setNewPhaseObjective("");
			setAddingPhase(false);
		} catch (e) {
			setActionError(errorMessage(e));
		}
	}

	return (
		<Card className="bg-card/50">
			<CardHeader className="gap-2 pb-2">
				<div className="flex items-start justify-between gap-2">
					{editing ? (
						<form onSubmit={handleRename} className="flex gap-2">
							<Input
								value={name}
								onChange={(e) => setName(e.target.value)}
								required
								maxLength={120}
								aria-label="Plan name"
							/>
							<Button type="submit" size="sm" disabled={updatePlan.isPending}>
								Save
							</Button>
						</form>
					) : (
						<CardTitle className="text-sm">{plan.name}</CardTitle>
					)}
					<div className="flex shrink-0 items-center gap-1">
						<Badge
							variant={plan.status === "final" ? "default" : "secondary"}
							className="cursor-pointer"
							title="Toggle draft / final"
						>
							<button type="button" onClick={() => void handleStatusToggle()}>
								{plan.status}
							</button>
						</Badge>
						{!editing && (
							<Button
								type="button"
								variant="ghost"
								size="sm"
								onClick={() => setEditing(true)}
							>
								Rename
							</Button>
						)}
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="text-destructive"
							onClick={() => void handleDelete()}
						>
							Delete plan
						</Button>
					</div>
				</div>
			</CardHeader>
			<CardContent className="space-y-2">
				{plan.phases.length === 0 && !addingPhase && (
					<p className="text-xs text-muted-foreground">
						No phases yet — ask the agent in chat, or add the first one.
					</p>
				)}
				<ul className="space-y-2">
					{plan.phases.map((phase, index) => (
						<PhaseRow
							key={phase.id}
							campaignId={campaignId}
							phase={phase}
							isFirst={index === 0}
							isLast={index === plan.phases.length - 1}
						/>
					))}
				</ul>
				{addingPhase ? (
					<form onSubmit={handleAddPhase} className="space-y-2">
						<Input
							value={newPhaseName}
							onChange={(e) => setNewPhaseName(e.target.value)}
							placeholder="Phase name, e.g. Teaser week"
							required
							maxLength={120}
							aria-label="New phase name"
						/>
						<Input
							value={newPhaseObjective}
							onChange={(e) => setNewPhaseObjective(e.target.value)}
							placeholder="Objective (optional)"
							maxLength={2000}
							aria-label="New phase objective"
						/>
						<div className="flex gap-2">
							<Button type="submit" size="sm" disabled={addPhase.isPending}>
								{addPhase.isPending ? <Spinner /> : "Add phase"}
							</Button>
							<Button
								type="button"
								size="sm"
								variant="ghost"
								onClick={() => setAddingPhase(false)}
							>
								Cancel
							</Button>
						</div>
					</form>
				) : (
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => setAddingPhase(true)}
					>
						Add phase
					</Button>
				)}
				{actionError && (
					<p className="text-xs text-destructive">{actionError}</p>
				)}
			</CardContent>
		</Card>
	);
}

/** Plan panel: plans with ordered phase timelines, reorderable by position. */
export function CampaignPlanPanel({
	campaignId,
	plans,
}: {
	campaignId: string;
	plans: CampaignPlanDetail[];
}) {
	const createPlan = useCreateCampaignPlan(campaignId);
	const [creating, setCreating] = useState(false);
	const [name, setName] = useState("");
	const [error, setError] = useState<string | null>(null);

	async function handleCreatePlan(event: React.FormEvent) {
		event.preventDefault();
		if (!name.trim()) return;
		setError(null);
		try {
			await createPlan.mutateAsync({ name: name.trim() });
			setName("");
			setCreating(false);
		} catch (e) {
			setError(errorMessage(e));
		}
	}

	return (
		<div className="space-y-4 p-4">
			<div className="flex items-center gap-2">
				{creating ? (
					<form onSubmit={handleCreatePlan} className="flex gap-2">
						<Input
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="Plan name, e.g. Q1 launch plan"
							required
							maxLength={120}
							aria-label="New plan name"
						/>
						<Button type="submit" size="sm" disabled={createPlan.isPending}>
							{createPlan.isPending ? <Spinner /> : "Create"}
						</Button>
						<Button
							type="button"
							size="sm"
							variant="ghost"
							onClick={() => setCreating(false)}
						>
							Cancel
						</Button>
					</form>
				) : (
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => setCreating(true)}
					>
						New plan
					</Button>
				)}
			</div>
			{plans.length === 0 ? (
				<div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
					No plans yet — ask the agent in chat to plan the campaign, or create
					one with New plan.
				</div>
			) : (
				plans.map((plan) => (
					<PlanCard key={plan.id} campaignId={campaignId} plan={plan} />
				))
			)}
			{error && <p className="text-xs text-destructive">{error}</p>}
		</div>
	);
}
