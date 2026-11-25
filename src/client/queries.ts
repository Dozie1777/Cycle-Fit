// TanStack Query hooks over the tRPC client (src/trpc.ts). Query keys are
// namespaced by resource; mutations invalidate the affected lists so detail
// views, badges and counts stay live without manual refetching.
//
// The hook signatures are the app's client contract (components and tests
// depend on them); only the transport underneath changed — every call is a
// fully typed tRPC procedure against AppRouter, batched over /api/trpc.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SkillCategory } from "@/features/skills";
import type {
	BrandKitInput,
	GithubSkillImportPreview,
	GithubSkillImportResult,
} from "./api-types";
import { asJson, isTrpcNotFound, trpc } from "./trpc";

const keys = {
	agents: ["agents"] as const,
	admins: ["admins"] as const,
	designs: ["designs"] as const,
	design: (id: string) => ["design", id] as const,
	designVersions: (id: string) => ["design", id, "versions"] as const,
	projects: ["projects"] as const,
	project: (id: string) => ["project", id] as const,
	// Campaign lists nest under the project prefix so ["project"]
	// invalidations refresh both the project detail and its campaign list.
	campaigns: ["campaigns"] as const,
	campaign: (id: string) => ["campaign", id] as const,
	projectCampaigns: (id: string) => ["project", id, "campaigns"] as const,
	// Brand kit (KUK-900) — nests under the project prefix so ["project"]
	// invalidations refresh it alongside the detail and campaigns.
	projectBrandKit: (id: string) => ["project", id, "brand-kit"] as const,
	// Global channel enumeration (KUK-890) — shared by calendar/brief selects
	// and the manage-channels dialog.
	channels: ["channels"] as const,
	// Studio skills (KUK-891) — shared by the "/" slash menu and the
	// manage-skills dialog.
	skills: ["skills"] as const,
	// Component library (KUK-927) — nests under the project prefix so
	// ["project"] invalidations refresh it alongside the detail.
	projectComponents: (id: string) => ["project", id, "components"] as const,
	// Studio building blocks (KUK-928) — the page composer is scoped to a
	// design (["design", designId, "pages"], invalidated alongside the
	// component-library payload since both carry the design's pages);
	// data/templates/flows are project-scoped.
	projectPages: (designId: string) => ["design", designId, "pages"] as const,
	projectData: (id: string) => ["project", id, "data"] as const,
	projectTemplates: (id: string) => ["project", id, "templates"] as const,
	projectFlows: (id: string) => ["project", id, "flows"] as const,
	// Campaign KPIs (KUK-896) — nest under the campaign key so detail
	// invalidations refresh the scorecard and result history together.
	campaignKpis: (id: string) => [...keys.campaign(id), "kpis"] as const,
	campaignKpiResults: (id: string) =>
		[...keys.campaign(id), "kpi-results"] as const,
};

export function useAgents() {
	return useQuery({
		queryKey: keys.agents,
		queryFn: () => asJson(trpc.agents.list.query()),
	});
}

export function useAdmins() {
	return useQuery({
		queryKey: keys.admins,
		queryFn: () => asJson(trpc.admins.list.query()),
	});
}

export function useDesigns() {
	return useQuery({
		queryKey: keys.designs,
		queryFn: () => asJson(trpc.designs.list.query()),
	});
}

export function useDesign(
	projectId: string,
	options: { enabled?: boolean; live?: boolean } = {},
) {
	return useQuery({
		queryKey: keys.design(projectId),
		queryFn: () => asJson(trpc.designs.get.query({ projectId })),
		enabled: options.enabled ?? true,
		// The studio invalidates this explicitly when turns settle; background
		// refetches on focus/reconnect just hit the worker for no benefit now
		// that the 4-second polling has been removed.
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		// While a turn is in flight the studio polls for the status so a
		// remount mid-turn can recover the finished transcript (the remount
		// never sees the stream, so only a status transition can tell it the
		// turn settled — mirrors useCampaign's live poll). Poll only while
		// chatting.
		refetchInterval: options.live
			? (query) => (query.state.data?.status === "chatting" ? 4000 : false)
			: false,
	});
}

export function useDesignVersions(projectId: string) {
	return useQuery({
		queryKey: keys.designVersions(projectId),
		queryFn: () => asJson(trpc.designs.listVersions.query({ projectId })),
	});
}

export function useRestoreDesignVersion() {
	const invalidate = useInvalidate();
	return useMutation({
		mutationFn: (input: { projectId: string; version: number }) =>
			asJson(
				trpc.designs.restoreVersion.mutate({
					projectId: input.projectId,
					n: input.version,
				}),
			),
		// Restoring rewrites the live keys, so both the detail (drives the
		// preview revision) and the version list need a refresh.
		onSuccess: (_data, input) =>
			invalidate(
				keys.design(input.projectId),
				keys.designVersions(input.projectId),
			),
	});
}

function useInvalidate() {
	const qc = useQueryClient();
	return (...keyList: readonly (readonly string[])[]) =>
		Promise.all(keyList.map((key) => qc.invalidateQueries({ queryKey: key })));
}

export function useCreateDesign() {
	const invalidate = useInvalidate();
	return useMutation({
		mutationFn: (input: { prompt: string; projectId: string }) =>
			asJson(trpc.designs.create.mutate(input)),
		// The new design changes the container's composition.
		onSuccess: (_data, input) =>
			invalidate(keys.designs, keys.projects, keys.project(input.projectId)),
	});
}

// ---------------------------------------------------------------------------
// Project containers
// ---------------------------------------------------------------------------

export function useProjects() {
	return useQuery({
		queryKey: keys.projects,
		queryFn: () => asJson(trpc.projects.list.query()),
	});
}

export function useProject(projectId: string) {
	return useQuery({
		queryKey: keys.project(projectId),
		queryFn: () => asJson(trpc.projects.get.query({ projectId })),
	});
}

export function useCreateProject() {
	const invalidate = useInvalidate();
	return useMutation({
		mutationFn: (input: { name: string; description?: string }) =>
			asJson(trpc.projects.create.mutate(input)),
		onSuccess: () => invalidate(keys.projects),
	});
}

export function useUpdateProject() {
	const invalidate = useInvalidate();
	return useMutation({
		mutationFn: (input: {
			projectId: string;
			name?: string;
			description?: string | null;
		}) =>
			asJson(
				trpc.projects.update.mutate({
					projectId: input.projectId,
					name: input.name,
					description: input.description,
				}),
			),
		onSuccess: (_data, input) =>
			invalidate(keys.projects, keys.project(input.projectId)),
	});
}

export function useDeleteProject() {
	const invalidate = useInvalidate();
	return useMutation({
		mutationFn: (projectId: string) =>
			trpc.projects.delete.mutate({ projectId }),
		onSuccess: (_data, projectId) =>
			// The cascade unfiles nothing — it deletes the designs, so both
			// project lists and the all-designs view need a refresh.
			invalidate(keys.projects, keys.project(projectId), keys.designs),
	});
}

export function useCreateProjectDesign() {
	const invalidate = useInvalidate();
	return useMutation({
		mutationFn: (input: { projectId: string; prompt: string }) =>
			asJson(trpc.projects.createDesign.mutate(input)),
		onSuccess: (_data, input) =>
			invalidate(keys.projects, keys.project(input.projectId), keys.designs),
	});
}

/** Move a design into another project; unfile is not a thing anymore. */
export function useFileDesign() {
	const invalidate = useInvalidate();
	return useMutation({
		mutationFn: (input: { designId: string; projectId: string }) =>
			asJson(
				trpc.designs.file.mutate({
					designId: input.designId,
					targetProjectId: input.projectId,
				}),
			),
		onSuccess: (_data, _input) =>
			// Old and new containers both change composition; invalidate the
			// whole project-detail prefix instead of tracking the old id.
			invalidate(keys.designs, keys.projects, ["project"] as const),
	});
}

// ---------------------------------------------------------------------------
// Brand kit (KUK-900)
// ---------------------------------------------------------------------------

/** `data` is `null` when the project has no kit (NOT_FOUND = empty state). */
export function useBrandKit(projectId: string) {
	return useQuery({
		queryKey: keys.projectBrandKit(projectId),
		queryFn: async () => {
			try {
				return await asJson(trpc.projects.brandKit.get.query({ projectId }));
			} catch (error) {
				if (isTrpcNotFound(error)) return null;
				throw error;
			}
		},
	});
}

export function useUpsertBrandKit() {
	const invalidate = useInvalidate();
	return useMutation({
		mutationFn: (input: { projectId: string; body: BrandKitInput }) =>
			asJson(trpc.projects.brandKit.upsert.mutate(input)),
		// Full-replace upsert: the kit only renders on the project detail,
		// so the ["project"] prefix covers the brand-kit key, the detail
		// and the campaign list in one shot.
		onSuccess: () => invalidate(["project"] as const),
	});
}

export function useDeleteBrandKit() {
	const invalidate = useInvalidate();
	return useMutation({
		mutationFn: (projectId: string) =>
			trpc.projects.brandKit.delete.mutate({ projectId }),
		// Same prefix as the upsert — it also refetches the (now 404ing,
		// i.e. null) brand-kit query so the panel flips to its empty state.
		onSuccess: () => invalidate(["project"] as const),
	});
}

/**
 * Seed the kit from a published design (KUK-901). The response carries the
 * adopted values (and, when `saved: false`, the missing required roles) for
 * the panel's summary/prefill; the invalidation refreshes the saved kit.
 */
export function useAdoptBrandKit() {
	const invalidate = useInvalidate();
	return useMutation({
		mutationFn: (input: { projectId: string; designId: string }) =>
			asJson(trpc.projects.brandKit.adopt.mutate(input)),
		// Adoption replaces the kit content — the ["project"] prefix covers
		// the brand-kit key, the detail and the campaign list in one shot.
		onSuccess: () => invalidate(["project"] as const),
	});
}

// ---------------------------------------------------------------------------
// Campaigns (KUK-868 API, KUK-873 UI)
// ---------------------------------------------------------------------------

export function useCampaigns() {
	return useQuery({
		queryKey: keys.campaigns,
		queryFn: () => asJson(trpc.campaigns.list.query({})),
	});
}

export function useProjectCampaigns(projectId: string) {
	return useQuery({
		queryKey: keys.projectCampaigns(projectId),
		queryFn: () => asJson(trpc.campaigns.list.query({ projectId })),
	});
}

export function useCreateCampaign() {
	const invalidate = useInvalidate();
	return useMutation({
		mutationFn: (input: {
			projectId: string;
			name: string;
			briefPrompt?: string;
		}) => asJson(trpc.campaigns.create.mutate(input)),
		// The new campaign changes the container's composition.
		onSuccess: () =>
			invalidate(keys.campaigns, keys.projects, ["project"] as const),
	});
}

export function useCreateProjectCampaign() {
	const invalidate = useInvalidate();
	return useMutation({
		mutationFn: (input: {
			projectId: string;
			name: string;
			briefPrompt?: string;
		}) =>
			asJson(
				trpc.campaigns.create.mutate({
					projectId: input.projectId,
					name: input.name,
					briefPrompt: input.briefPrompt,
				}),
			),
		onSuccess: () =>
			invalidate(keys.campaigns, keys.projects, ["project"] as const),
	});
}

export function useUpdateCampaign() {
	const invalidate = useInvalidate();
	return useMutation({
		mutationFn: (input: {
			campaignId: string;
			name?: string;
			projectId?: string;
			targetEndDate?: string | null;
		}) =>
			asJson(
				trpc.campaigns.update.mutate({
					campaignId: input.campaignId,
					name: input.name,
					projectId: input.projectId,
					targetEndDate: input.targetEndDate,
				}),
			),
		onSuccess: (_data, input) =>
			invalidate(keys.campaigns, keys.campaign(input.campaignId), [
				"project",
			] as const),
	});
}
export function useDeleteCampaign() {
	const invalidate = useInvalidate();
	return useMutation({
		mutationFn: (campaignId: string) =>
			trpc.campaigns.delete.mutate({ campaignId }),
		onSuccess: () =>
			// The cascade unfiles the campaign's design assets, so designs and
			// project composition both need a refresh.
			invalidate(keys.campaigns, keys.designs, ["project"] as const),
	});
}

export function useCampaignKpis(campaignId: string) {
	return useQuery({
		queryKey: keys.campaignKpis(campaignId),
		queryFn: () => asJson(trpc.campaigns.kpis.list.query({ campaignId })),
	});
}

export function useCreateCampaignKpi(campaignId: string) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input: {
			name: string;
			kind: "number" | "boolean" | "qualitative";
			targetNumber?: number | null;
			targetBoolean?: boolean | null;
			targetText?: string | null;
			unit?: string | null;
			color?: string | null;
			sortOrder?: number;
		}) => asJson(trpc.campaigns.kpis.create.mutate({ campaignId, ...input })),
		onSuccess: () =>
			Promise.all([
				qc.invalidateQueries({ queryKey: keys.campaignKpis(campaignId) }),
				qc.invalidateQueries({ queryKey: keys.campaign(campaignId) }),
			]),
	});
}

export function useUpdateCampaignKpi(campaignId: string) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input: {
			kpiId: string;
			name?: string;
			kind?: "number" | "boolean" | "qualitative";
			targetNumber?: number | null;
			targetBoolean?: boolean | null;
			targetText?: string | null;
			unit?: string | null;
			color?: string | null;
			sortOrder?: number;
		}) => {
			const { kpiId, ...body } = input;
			return asJson(
				trpc.campaigns.kpis.update.mutate({ campaignId, kpiId, ...body }),
			);
		},
		onSuccess: () =>
			Promise.all([
				qc.invalidateQueries({ queryKey: keys.campaignKpis(campaignId) }),
				qc.invalidateQueries({ queryKey: keys.campaign(campaignId) }),
			]),
	});
}

export function useDeleteCampaignKpi(campaignId: string) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (kpiId: string) =>
			trpc.campaigns.kpis.delete.mutate({ campaignId, kpiId }),
		onSuccess: () =>
			Promise.all([
				qc.invalidateQueries({ queryKey: keys.campaignKpis(campaignId) }),
				qc.invalidateQueries({ queryKey: keys.campaign(campaignId) }),
			]),
	});
}

// Target audiences (per-campaign segmentation rows) — the detail payload
// carries them, so every mutation only refreshes the campaign detail.
export function useCreateCampaignAudience(campaignId: string) {
	const invalidate = useInvalidateCampaignDetail(campaignId);
	return useMutation({
		mutationFn: (input: {
			name: string;
			demographics?: string | null;
			psychographics?: string | null;
			buyingStage?: string | null;
			body?: string | null;
		}) =>
			asJson(trpc.campaigns.audiences.create.mutate({ campaignId, ...input })),
		onSuccess: invalidate,
	});
}

export function useUpdateCampaignAudience(campaignId: string) {
	const invalidate = useInvalidateCampaignDetail(campaignId);
	return useMutation({
		mutationFn: (input: {
			audienceId: string;
			name?: string;
			demographics?: string | null;
			psychographics?: string | null;
			buyingStage?: string | null;
			body?: string | null;
		}) => {
			const { audienceId, ...body } = input;
			return asJson(
				trpc.campaigns.audiences.update.mutate({
					campaignId,
					audienceId,
					...body,
				}),
			);
		},
		onSuccess: invalidate,
	});
}

export function useDeleteCampaignAudience(campaignId: string) {
	const invalidate = useInvalidateCampaignDetail(campaignId);
	return useMutation({
		mutationFn: (audienceId: string) =>
			trpc.campaigns.audiences.delete.mutate({ campaignId, audienceId }),
		onSuccess: invalidate,
	});
}

export function useCampaignKpiResults(campaignId: string) {
	return useQuery({
		queryKey: keys.campaignKpiResults(campaignId),
		queryFn: () => asJson(trpc.campaigns.kpiResults.list.query({ campaignId })),
	});
}

export function useCreateCampaignKpiResult(campaignId: string) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input: {
			kpiId: string;
			actualNumber?: number | null;
			actualBoolean?: boolean | null;
			actualText?: string | null;
			status?: "pending" | "not_met" | "partial" | "met" | "exceeded";
			reportId?: string | null;
			recordedAt?: string;
		}) =>
			asJson(trpc.campaigns.kpiResults.create.mutate({ campaignId, ...input })),
		onSuccess: () =>
			Promise.all([
				qc.invalidateQueries({ queryKey: keys.campaignKpiResults(campaignId) }),
				qc.invalidateQueries({ queryKey: keys.campaign(campaignId) }),
			]),
	});
}

export function useUpdateCampaignKpiResult(campaignId: string) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input: {
			resultId: string;
			actualNumber?: number | null;
			actualBoolean?: boolean | null;
			actualText?: string | null;
			status?: "pending" | "not_met" | "partial" | "met" | "exceeded";
			reportId?: string | null;
			recordedAt?: string;
		}) => {
			const { resultId, ...body } = input;
			return asJson(
				trpc.campaigns.kpiResults.update.mutate({
					campaignId,
					resultId,
					...body,
				}),
			);
		},
		onSuccess: () =>
			Promise.all([
				qc.invalidateQueries({ queryKey: keys.campaignKpiResults(campaignId) }),
				qc.invalidateQueries({ queryKey: keys.campaign(campaignId) }),
			]),
	});
}

export function useDeleteCampaignKpiResult(campaignId: string) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (resultId: string) =>
			trpc.campaigns.kpiResults.delete.mutate({ campaignId, resultId }),
		onSuccess: () =>
			Promise.all([
				qc.invalidateQueries({ queryKey: keys.campaignKpiResults(campaignId) }),
				qc.invalidateQueries({ queryKey: keys.campaign(campaignId) }),
			]),
	});
}

export function useCreateAgent() {
	const invalidate = useInvalidate();
	return useMutation({
		mutationFn: (input: { name: string; email: string }) =>
			asJson(trpc.agents.create.mutate(input)),
		onSuccess: () => invalidate(keys.agents),
	});
}

export function useCreateAdmin() {
	const invalidate = useInvalidate();
	return useMutation({
		mutationFn: (input: { name: string; email: string; password: string }) =>
			asJson(trpc.admins.create.mutate(input)),
		onSuccess: () => invalidate(keys.admins),
	});
}

// ---------------------------------------------------------------------------
// Channel enumeration (KUK-890)
// ---------------------------------------------------------------------------

export function useChannels() {
	return useQuery({
		queryKey: keys.channels,
		queryFn: () => asJson(trpc.channels.list.query()),
	});
}

export function useCreateChannel() {
	const invalidate = useInvalidate();
	return useMutation({
		mutationFn: (input: { name: string; color?: string }) =>
			asJson(trpc.channels.create.mutate(input)),
		onSuccess: () => invalidate(keys.channels),
	});
}

export function useUpdateChannel() {
	const invalidate = useInvalidate();
	return useMutation({
		mutationFn: (input: {
			channelId: string;
			name?: string;
			color?: string | null;
		}) =>
			asJson(
				trpc.channels.update.mutate({
					id: input.channelId,
					name: input.name,
					color: input.color,
				}),
			),
		onSuccess: () =>
			// Renames show up in every campaign's pills/swimlanes, so the
			// whole campaign cache is stale, not just one detail.
			invalidate(keys.channels, ["campaign"] as const),
	});
}

// ---------------------------------------------------------------------------
// Studio skills (KUK-891)
// ---------------------------------------------------------------------------

export function useSkills() {
	return useQuery({
		queryKey: keys.skills,
		queryFn: () => asJson(trpc.skills.list.query()),
	});
}

export function useCreateSkill() {
	const invalidate = useInvalidate();
	return useMutation({
		mutationFn: (input: {
			slug: string;
			name: string;
			description: string;
			content: string;
			category?: SkillCategory;
		}) => asJson(trpc.skills.create.mutate(input)),
		onSuccess: () => invalidate(keys.skills),
	});
}

export function useUpdateSkill() {
	const invalidate = useInvalidate();
	return useMutation({
		mutationFn: (input: {
			skillId: string;
			name?: string;
			description?: string;
			content?: string;
			enabled?: boolean;
		}) =>
			asJson(
				trpc.skills.update.mutate({
					id: input.skillId,
					name: input.name,
					description: input.description,
					content: input.content,
					enabled: input.enabled,
				}),
			),
		// Enable/disable changes the agent's Available skills prompt and the
		// "/" menu everywhere, so invalidate just the skills list — campaign
		// details never embed skill rows.
		onSuccess: () => invalidate(keys.skills),
	});
}

export function useDeleteSkill() {
	const invalidate = useInvalidate();
	return useMutation({
		mutationFn: (skillId: string) => trpc.skills.delete.mutate({ id: skillId }),
		onSuccess: () => invalidate(keys.skills),
	});
}

// GitHub skill import: the preview is an imperative probe of a pasted
// repo/SKILL.md URL (query keyed by source, enabled only while the URL
// passes a cheap client-side shape check), the import a mutation.

export function useGithubSkillImportPreview(source: string, enabled: boolean) {
	return useQuery({
		queryKey: [...keys.skills, "import-preview", source] as const,
		queryFn: () =>
			asJson(
				trpc.skills.importPreview.query({ source }),
			) as Promise<GithubSkillImportPreview>,
		enabled: enabled && source.trim().length > 0,
		// GitHub trees listings change constantly — never cache across sessions.
		staleTime: 0,
		gcTime: 0,
		retry: false,
	});
}

export function useImportGithubSkills() {
	const invalidate = useInvalidate();
	return useMutation({
		mutationFn: (input: {
			source: string;
			category: SkillCategory;
			paths: string[];
			conflict: "skip" | "overwrite";
		}) =>
			asJson(
				trpc.skills.importSkills.mutate({
					source: input.source,
					category: input.category,
					skills: input.paths.map((path) => ({ path })),
					conflict: input.conflict,
				}),
			) as Promise<GithubSkillImportResult>,
		onSuccess: () => invalidate(keys.skills),
	});
}

export function useRegisterCredential() {
	const invalidate = useInvalidate();
	return useMutation({
		mutationFn: (input: {
			agentId: string;
			externalId: string;
			appId: string;
			envelope: "pusher" | "reviewer";
			privateKeyPem: string;
			expectedRepo?: string;
		}) =>
			asJson(
				trpc.agents.registerCredential.mutate({
					agentId: input.agentId,
					provider: "github_app",
					externalId: input.externalId,
					appId: input.appId,
					envelope: input.envelope,
					privateKeyPem: input.privateKeyPem,
					expectedRepository: input.expectedRepo,
				}),
			),
		onSuccess: () => invalidate(keys.agents),
	});
}

export function useUpdateCredential() {
	const invalidate = useInvalidate();
	return useMutation({
		mutationFn: (input: {
			agentId: string;
			credentialId: string;
			status?: "active" | "disabled";
			privateKeyPem?: string;
			appId?: string;
			envelope?: "pusher" | "reviewer";
		}) =>
			asJson(
				trpc.agents.updateCredential.mutate({
					agentId: input.agentId,
					credentialId: input.credentialId,
					status: input.status,
					privateKeyPem: input.privateKeyPem,
					appId: input.appId,
					envelope: input.envelope,
				}),
			),
		onSuccess: () => invalidate(keys.agents),
	});
}

/** Invalidate a design's detail after a settled chat turn (publish/draft). */
export function useInvalidateDesign() {
	const qc = useQueryClient();
	return (projectId: string) =>
		qc.invalidateQueries({ queryKey: keys.design(projectId) });
}

// ---------------------------------------------------------------------------
// Component library (KUK-927) — reads + lifecycle + re-pin
// ---------------------------------------------------------------------------

/**
 * The project's component library with full version timelines. Scoped to a
 * design when `designId` is given — the payload then also carries that
 * design's pages with their pinned blocks (the re-pin affordance data).
 */
export function useProjectComponents(projectId: string, designId?: string) {
	return useQuery({
		queryKey: [...keys.projectComponents(projectId), designId ?? null] as const,
		queryFn: () =>
			asJson(trpc.designs.components.list.query({ projectId, designId })),
	});
}

/**
 * Lifecycle mutations refresh the library — statuses, the published pointer
 * and the pages-with-pins view all live in that one payload. The design
 * detail carries no pin or version data, so it is not stale here.
 */
function useInvalidateComponents(projectId: string) {
	const qc = useQueryClient();
	return () =>
		qc.invalidateQueries({ queryKey: keys.projectComponents(projectId) });
}

export function usePublishComponentVersion(projectId: string) {
	const invalidate = useInvalidateComponents(projectId);
	return useMutation({
		mutationFn: (input: { componentId: string; versionId: string }) =>
			asJson(
				trpc.designs.components.publish.mutate({
					projectId,
					componentId: input.componentId,
					versionId: input.versionId,
				}),
			),
		onSuccess: invalidate,
	});
}

/** Restore republishes: a new draft copies the old version and publishes. */
export function useRestoreComponentVersion(projectId: string) {
	const invalidate = useInvalidateComponents(projectId);
	return useMutation({
		mutationFn: (input: { componentId: string; versionId: string }) =>
			asJson(
				trpc.designs.components.restore.mutate({
					projectId,
					componentId: input.componentId,
					versionId: input.versionId,
				}),
			),
		onSuccess: invalidate,
	});
}

export function useRetireComponent(projectId: string) {
	const invalidate = useInvalidateComponents(projectId);
	return useMutation({
		mutationFn: (componentId: string) =>
			asJson(
				trpc.designs.components.retire.mutate({
					projectId,
					componentId,
				}),
			),
		onSuccess: invalidate,
	});
}

/** One-block re-pin: the library payload and the pages view both go stale. */
export function useRepinBlock(projectId: string) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input: {
			designId: string;
			pageId: string;
			blockId: string;
			componentId: string;
		}) =>
			asJson(
				trpc.designs.components.repin.mutate({
					projectId,
					designId: input.designId,
					pageId: input.pageId,
					blockId: input.blockId,
					componentId: input.componentId,
				}),
			),
		onSuccess: (_result, input) =>
			Promise.all([
				qc.invalidateQueries({
					queryKey: keys.projectComponents(projectId),
				}),
				// The Pages composer reads the same pins; a stale copy there
				// would send the pre-repin componentVersionId back on its
				// next full-list block write and silently undo the re-pin.
				qc.invalidateQueries({
					queryKey: keys.projectPages(input.designId),
				}),
			]),
	});
}

// ---------------------------------------------------------------------------
// Studio building blocks (KUK-928) — page composer, data collections,
// templates and flows. Page/block mutations also invalidate the component
// library payload, which carries the design's pages with their pinned
// blocks, so a block write stales both.
// ---------------------------------------------------------------------------

/** The design's pages with their blocks' full source detail. */
export function useDesignPages(projectId: string, designId: string) {
	return useQuery({
		queryKey: keys.projectPages(designId),
		queryFn: () =>
			asJson(trpc.designs.pages.list.query({ projectId, designId })),
	});
}

function useInvalidatePagesAndLibrary(projectId: string, designId: string) {
	const qc = useQueryClient();
	return () =>
		Promise.all([
			qc.invalidateQueries({ queryKey: keys.projectPages(designId) }),
			qc.invalidateQueries({
				queryKey: keys.projectComponents(projectId),
			}),
			// Flows embed page paths (step targets + the step editor's
			// page picker), so page create/rename/delete stales them too.
			qc.invalidateQueries({ queryKey: keys.projectFlows(projectId) }),
		]);
}

export function useCreatePage(projectId: string, designId: string) {
	const invalidate = useInvalidatePagesAndLibrary(projectId, designId);
	return useMutation({
		mutationFn: (input: { path: string; title: string }) =>
			asJson(
				trpc.designs.pages.create.mutate({ projectId, designId, ...input }),
			),
		onSuccess: invalidate,
	});
}

export function useUpdatePage(projectId: string, designId: string) {
	const invalidate = useInvalidatePagesAndLibrary(projectId, designId);
	return useMutation({
		mutationFn: (input: { pageId: string; path?: string; title?: string }) =>
			asJson(
				trpc.designs.pages.update.mutate({
					projectId,
					designId,
					pageId: input.pageId,
					path: input.path,
					title: input.title,
				}),
			),
		onSuccess: invalidate,
	});
}

export function useDeletePage(projectId: string, designId: string) {
	const invalidate = useInvalidatePagesAndLibrary(projectId, designId);
	return useMutation({
		mutationFn: (pageId: string) =>
			trpc.designs.pages.delete.mutate({ projectId, designId, pageId }),
		onSuccess: invalidate,
	});
}

export function useReplacePageBlocks(projectId: string, designId: string) {
	const invalidate = useInvalidatePagesAndLibrary(projectId, designId);
	return useMutation({
		mutationFn: (input: { pageId: string; blocks: unknown[] }) =>
			asJson(
				trpc.designs.pages.replaceBlocks.mutate({
					projectId,
					designId,
					pageId: input.pageId,
					blocks: input.blocks,
				}),
			),
		onSuccess: invalidate,
	});
}

function useInvalidateProjectKey(key: readonly string[]) {
	const qc = useQueryClient();
	return () => qc.invalidateQueries({ queryKey: key });
}

export function useProjectData(projectId: string) {
	return useQuery({
		queryKey: keys.projectData(projectId),
		queryFn: () => asJson(trpc.projects.data.list.query({ projectId })),
	});
}

export function useCreateDataCollection(projectId: string) {
	const invalidate = useInvalidateProjectKey(keys.projectData(projectId));
	return useMutation({
		mutationFn: (name: string) =>
			asJson(trpc.projects.data.create.mutate({ projectId, name })),
		onSuccess: invalidate,
	});
}

export function useRenameDataCollection(projectId: string) {
	const invalidate = useInvalidateProjectKey(keys.projectData(projectId));
	return useMutation({
		mutationFn: (input: { collectionId: string; name: string }) =>
			asJson(
				trpc.projects.data.rename.mutate({
					projectId,
					collectionId: input.collectionId,
					name: input.name,
				}),
			),
		onSuccess: invalidate,
	});
}

export function useDeleteDataCollection(projectId: string) {
	const invalidate = useInvalidateProjectKey(keys.projectData(projectId));
	return useMutation({
		mutationFn: (collectionId: string) =>
			trpc.projects.data.delete.mutate({ projectId, collectionId }),
		onSuccess: invalidate,
	});
}

export function useReplaceDataRecords(projectId: string) {
	const invalidate = useInvalidateProjectKey(keys.projectData(projectId));
	return useMutation({
		mutationFn: (input: { collectionId: string; records: unknown[] }) =>
			asJson(
				trpc.projects.data.replaceRecords.mutate({
					projectId,
					collectionId: input.collectionId,
					records: input.records,
				}),
			),
		onSuccess: invalidate,
	});
}

export function useProjectTemplates(projectId: string) {
	return useQuery({
		queryKey: keys.projectTemplates(projectId),
		queryFn: () => asJson(trpc.projects.templates.list.query({ projectId })),
	});
}

/** Create/slot-replacement (upsert by name). Pages keep their own pins, so
 * only the templates list goes stale. */
export function useDefineTemplate(projectId: string) {
	const invalidate = useInvalidateProjectKey(keys.projectTemplates(projectId));
	return useMutation({
		mutationFn: (body: {
			name: string;
			slots: {
				component: { name: string; version?: number };
				propsOverrides?: Record<string, unknown>;
			}[];
		}) => asJson(trpc.projects.templates.define.mutate({ projectId, body })),
		onSuccess: invalidate,
	});
}

export function useDeleteTemplate(projectId: string) {
	const invalidate = useInvalidateProjectKey(keys.projectTemplates(projectId));
	return useMutation({
		mutationFn: (templateId: string) =>
			trpc.projects.templates.delete.mutate({ projectId, templateId }),
		onSuccess: invalidate,
	});
}

export function useProjectFlows(projectId: string) {
	return useQuery({
		queryKey: keys.projectFlows(projectId),
		queryFn: () => asJson(trpc.projects.flows.list.query({ projectId })),
	});
}

/** Create/step-replacement (upsert by name). */
export function useDefineFlow(projectId: string) {
	const invalidate = useInvalidateProjectKey(keys.projectFlows(projectId));
	return useMutation({
		mutationFn: (body: {
			name: string;
			steps: {
				path: string;
				entryAction?: string;
				exitTarget?: string;
			}[];
		}) => asJson(trpc.projects.flows.define.mutate({ projectId, body })),
		onSuccess: invalidate,
	});
}

export function useDeleteFlow(projectId: string) {
	const invalidate = useInvalidateProjectKey(keys.projectFlows(projectId));
	return useMutation({
		mutationFn: (flowId: string) =>
			trpc.projects.flows.delete.mutate({ projectId, flowId }),
		onSuccess: invalidate,
	});
}

// ---------------------------------------------------------------------------
// Campaign studio documents (KUK-874)
// ---------------------------------------------------------------------------

export function useCampaign(
	campaignId: string,
	options: { live?: boolean } = {},
) {
	return useQuery({
		queryKey: keys.campaign(campaignId),
		queryFn: () => asJson(trpc.campaigns.get.query({ campaignId })),
		// While a turn is in flight the status badge must go live: if the
		// turn wedges server-side (stuck-chat bug), polling is what surfaces
		// the release/cancel state to the studio instead of a stale
		// "chatting" badge forever. Poll only while chatting.
		refetchInterval: options.live
			? (query) => (query.state.data?.status === "chatting" ? 4000 : false)
			: false,
	});
}

/** Refetch the campaign detail after a settled chat turn (agent tool writes). */
export function useInvalidateCampaign() {
	const qc = useQueryClient();
	return (campaignId: string) =>
		qc.invalidateQueries({ queryKey: keys.campaign(campaignId) });
}

/** Full report body for the selected reports-panel tab. */
export function useCampaignReport(campaignId: string, reportId: string) {
	return useQuery({
		queryKey: [...keys.campaign(campaignId), "report", reportId] as const,
		queryFn: () =>
			asJson(
				trpc.campaigns.documents.getReport.query({ campaignId, reportId }),
			),
	});
}

// Every document mutation refreshes the campaign detail — the panels render
// straight from it, so invalidation (not a cache write) keeps them live.
function useInvalidateCampaignDetail(campaignId: string) {
	const qc = useQueryClient();
	return () => qc.invalidateQueries({ queryKey: keys.campaign(campaignId) });
}

// ---------------------------------------------------------------------------
// Element chat sessions (KUK-940..945)
// ---------------------------------------------------------------------------

const elementChatKeys = {
	session: (id: string) => ["elementChat", id] as const,
};

/** The session row; `live` polls while a turn streams (remount recovery). */
export function useElementChat(
	elementChatId: string,
	options: { live?: boolean } = {},
) {
	return useQuery({
		queryKey: elementChatKeys.session(elementChatId),
		queryFn: () => asJson(trpc.elementChats.get.query({ elementChatId })),
		// Same live contract as useDesign/useCampaign: poll only while a
		// turn is in flight so a remount can observe the settle.
		refetchInterval: options.live
			? (query) => (query.state.data?.status === "chatting" ? 4000 : false)
			: false,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});
}

/**
 * Create-or-open an element chat session (idempotent, reseeds context) and
 * hand it to the studio's onOpenElementChat callback.
 */
export function useCreateElementChat() {
	return useMutation({
		mutationFn: (input: {
			projectId: string;
			elementType: "component" | "page" | "template" | "data" | "flow";
			elementId: string;
		}) =>
			asJson(
				trpc.elementChats.create.mutate({
					projectId: input.projectId,
					elementType: input.elementType,
					elementId: input.elementId,
				}),
			),
	});
}

export function useSaveCampaignBrief(campaignId: string) {
	const invalidate = useInvalidateCampaignDetail(campaignId);
	return useMutation({
		mutationFn: (
			fields: Partial<{
				objective: string | null;
				keyMessage: string | null;
				tone: string | null;
				channels: string | null;
				channelIds: string[];
				budget: string | null;
				kpis: string | null;
				body: string | null;
			}>,
		) =>
			asJson(trpc.campaigns.documents.saveBrief.mutate({ campaignId, fields })),
		// The channel mix also feeds the asset-context seeding, which reads
		// the join directly — but the detail invalidation covers the UI.
		onSuccess: invalidate,
	});
}

export function useCreateCampaignPlan(campaignId: string) {
	const invalidate = useInvalidateCampaignDetail(campaignId);
	return useMutation({
		mutationFn: (input: { name: string; status?: "draft" | "final" }) =>
			asJson(
				trpc.campaigns.documents.createPlan.mutate({ campaignId, ...input }),
			),
		onSuccess: invalidate,
	});
}

export function useUpdateCampaignPlan(campaignId: string) {
	const invalidate = useInvalidateCampaignDetail(campaignId);
	return useMutation({
		mutationFn: (input: {
			planId: string;
			name?: string;
			status?: "draft" | "final";
		}) =>
			asJson(
				trpc.campaigns.documents.updatePlan.mutate({
					campaignId,
					planId: input.planId,
					name: input.name,
					status: input.status,
				}),
			),
		onSuccess: invalidate,
	});
}

export function useAddCampaignPhase(campaignId: string) {
	const invalidate = useInvalidateCampaignDetail(campaignId);
	return useMutation({
		mutationFn: (input: {
			planId: string;
			name: string;
			objective?: string | null;
			startsAt?: string | null;
			endsAt?: string | null;
			body?: string | null;
		}) =>
			asJson(
				trpc.campaigns.documents.addPhase.mutate({ campaignId, ...input }),
			),
		onSuccess: invalidate,
	});
}

export function useUpdateCampaignPhase(campaignId: string) {
	const invalidate = useInvalidateCampaignDetail(campaignId);
	return useMutation({
		mutationFn: (input: {
			phaseId: string;
			name?: string;
			objective?: string | null;
			startsAt?: string | null;
			endsAt?: string | null;
			body?: string | null;
			position?: number;
		}) =>
			asJson(
				trpc.campaigns.documents.updatePhase.mutate({
					campaignId,
					phaseId: input.phaseId,
					name: input.name,
					objective: input.objective,
					startsAt: input.startsAt,
					endsAt: input.endsAt,
					body: input.body,
					position: input.position,
				}),
			),
		onSuccess: invalidate,
	});
}

export function useCreateCampaignEvent(campaignId: string) {
	const invalidate = useInvalidateCampaignDetail(campaignId);
	return useMutation({
		mutationFn: (input: {
			title: string;
			channelId?: string | null;
			scheduledAt?: string | null;
			status?: "planned" | "draft" | "scheduled" | "published";
			notes?: string | null;
		}) =>
			asJson(
				trpc.campaigns.documents.createEvent.mutate({ campaignId, ...input }),
			),
		onSuccess: invalidate,
	});
}

export function useUpdateCampaignEvent(campaignId: string) {
	const invalidate = useInvalidateCampaignDetail(campaignId);
	return useMutation({
		mutationFn: (input: {
			eventId: string;
			title?: string;
			/** Linked channel id (KUK-890); null clears the link. */
			channelId?: string | null;
			scheduledAt?: string | null;
			status?: "planned" | "draft" | "scheduled" | "published";
			notes?: string | null;
		}) =>
			asJson(
				trpc.campaigns.documents.updateEvent.mutate({
					campaignId,
					eventId: input.eventId,
					title: input.title,
					channelId: input.channelId,
					scheduledAt: input.scheduledAt,
					status: input.status,
					notes: input.notes,
				}),
			),
		onSuccess: invalidate,
	});
}

export function useCreateCampaignReport(campaignId: string) {
	const invalidate = useInvalidateCampaignDetail(campaignId);
	return useMutation({
		mutationFn: (input: {
			title: string;
			body: string;
			periodStart?: string | null;
			periodEnd?: string | null;
			summary?: string | null;
			metrics?: string | null;
		}) =>
			asJson(
				trpc.campaigns.documents.createReport.mutate({ campaignId, ...input }),
			),
		onSuccess: invalidate,
	});
}

export function useUpdateCampaignReport(campaignId: string) {
	const invalidate = useInvalidateCampaignDetail(campaignId);
	return useMutation({
		mutationFn: (input: {
			reportId: string;
			title?: string;
			body?: string;
			periodStart?: string | null;
			periodEnd?: string | null;
			summary?: string | null;
			metrics?: string | null;
		}) =>
			asJson(
				trpc.campaigns.documents.updateReport.mutate({
					campaignId,
					reportId: input.reportId,
					title: input.title,
					body: input.body,
					periodStart: input.periodStart,
					periodEnd: input.periodEnd,
					summary: input.summary,
					metrics: input.metrics,
				}),
			),
		onSuccess: invalidate,
	});
}

/** Delete any one plan / phase / event / report row. */
export function useDeleteCampaignDocument(campaignId: string) {
	const invalidate = useInvalidateCampaignDetail(campaignId);
	return useMutation({
		mutationFn: (input: {
			kind: "plan" | "phase" | "event" | "report";
			id: string;
		}) => trpc.campaigns.documents.delete.mutate({ campaignId, ...input }),
		onSuccess: invalidate,
	});
}

// ---------------------------------------------------------------------------
// Campaign dashboard (KUK-875) — assets, event slots, share menu
// ---------------------------------------------------------------------------

/** Asset rows nest under the campaign key, so detail invalidations refresh. */
export function useCampaignAssets(campaignId: string) {
	return useQuery({
		queryKey: [...keys.campaign(campaignId), "assets"] as const,
		queryFn: () => asJson(trpc.campaigns.listAssets.query({ campaignId })),
	});
}

/** Chat history for the dashboard activity feed (same rows as studio chat). */
export function useCampaignMessages(campaignId: string) {
	return useQuery({
		queryKey: [...keys.campaign(campaignId), "messages"] as const,
		queryFn: () => asJson(trpc.campaigns.listMessages.query({ campaignId })),
		// The feed refreshes through the campaign-detail invalidation every
		// settled turn fires (the key is nested under the campaign key), so
		// background refetches on focus/reconnect/remount just hit the worker
		// for no benefit — the transcript only changes through chat turns.
		staleTime: Infinity,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		refetchOnMount: false,
	});
}

/**
 * Attach / detach a design asset on a calendar slot. The campaign detail
 * carries the events (asset chips), so invalidating the detail is enough.
 */
export function useAttachCampaignEventAsset(campaignId: string) {
	const invalidate = useInvalidateCampaignDetail(campaignId);
	return useMutation({
		mutationFn: (input: { eventId: string; assetId: string | null }) =>
			asJson(
				trpc.campaigns.updateEventSlot.mutate({
					campaignId,
					eventId: input.eventId,
					assetId: input.assetId,
				}),
			),
		onSuccess: invalidate,
	});
}

// Share mutations all rewrite fields the campaign detail payload carries
// (shareSlug / shareRevokedAt / shareIncludeReports), so the menu re-renders
// from the detail invalidation alone.
function useCampaignShareMutation(
	campaignId: string,
	fn: () => Promise<unknown>,
) {
	const invalidate = useInvalidateCampaignDetail(campaignId);
	return useMutation({
		mutationFn: fn,
		onSuccess: invalidate,
	});
}

export function useGenerateCampaignShare(campaignId: string) {
	return useCampaignShareMutation(campaignId, () =>
		asJson(trpc.campaigns.share.generate.mutate({ campaignId })),
	);
}

export function useRotateCampaignShare(campaignId: string) {
	return useCampaignShareMutation(campaignId, () =>
		asJson(trpc.campaigns.share.update.mutate({ campaignId, rotate: true })),
	);
}

export function useRevokeCampaignShare(campaignId: string) {
	return useCampaignShareMutation(campaignId, () =>
		trpc.campaigns.share.revoke.mutate({ campaignId }),
	);
}
