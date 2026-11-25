// Shared API type contract. These describe the JSON wire shapes the tRPC
// endpoints return (Prisma rows serialized to JSON — Dates become ISO
// strings). The tRPC server lives in src/server/trpc/; the typed client
// proxy is src/trpc.ts; the react-query hooks over it are src/queries.ts.

import type {
	BrandColorRole,
	BrandTypographyRole,
} from "@/features/projects/brand-kit/brand-kit";
import type { SkillCategory } from "@/features/skills";

export type Credential = {
	id: string;
	agentId: string;
	provider: string;
	externalId: string | null;
	envelope: string;
	keyVersion: number;
	status: string;
	lastUsedAt: string | null;
	createdAt: string;
	updatedAt: string;
};

export type Agent = {
	id: string;
	name: string;
	email: string;
	createdAt: string;
	credentials: Credential[];
};

export type AdminUser = {
	id: string;
	name: string;
	email: string;
	createdAt: string;
};

export type Design = {
	id: string;
	prompt: string;
	status: string;
	error: string | null;
	liveTurnId: string | null;
	/** Owning project container — always present; every design is filed. */
	projectId: string;
	/** Set when this project is a public-share remix fork. */
	remixedFromId: string | null;
	createdAt: string;
	updatedAt: string;
};

export type DesignChatMessage = {
	id: string;
	role: string;
	content: string;
	/** Raw JSON array of the assistant turn's UI parts (reasoning + tool calls); null on user rows and pre-feature rows. */
	parts: string | null;
	attachments: DesignChatAssetRef[];
	createdAt: string;
};

/** Snapshot of an asset attached to a chat message (from D1 or optimistic send). */
export type DesignChatAssetRef = {
	id: string;
	kind: "image" | "video";
	filename: string;
	contentType: string;
	description: string | null;
	width: number | null;
	height: number | null;
	durationSec: number | null;
	url: string;
};

/** An uploaded reference asset (image or video) in the design's library. */
export type DesignAsset = DesignChatAssetRef & {
	projectId: string | null;
	designId: string | null;
	r2Key: string;
	sizeBytes: number;
	descriptionStatus:
		| "pending"
		| "ready"
		| "failed"
		| "needs_description"
		| "manual";
	descriptionError: string | null;
	uploadedById: string;
	createdAt: string;
};

export type DesignFileEntry = {
	path: string;
	size: number;
	lastModified: string;
};

export type DesignDetail = Design & {
	hasIndex: boolean;
	hasPreview: boolean;
	/** Section draft names from preview_section (drafts/<name>.html). */
	sections: string[];
	files: DesignFileEntry[];
	/**
	 * Latest publication snapshot (KUK-927) — version + createdAt, with the
	 * time-travel view at /designs/:id/publication/:version. Null on legacy
	 * designs without Publication rows (KUK-930 contract). Absent on the
	 * designs embedded in a project detail (that payload carries no
	 * publication lookup).
	 */
	publication?: DesignPublicationRef | null;
};

/** Latest publication pointer from the design detail payload. */
export type DesignPublicationRef = {
	version: number;
	createdAt: string;
};

/** Version snapshot: `versions/<n>/index.html` in R2 (newest first from the API). */
export type DesignVersion = {
	n: number;
	createdAt: string;
	hasPreview: boolean;
};

// ------------------------------------------------------------------
// Component library (KUK-927) — GET /projects/:projectId/components
// (full version timelines per component; ?designId= adds the design's
// pages + pinned blocks) and the one-block re-pin POST response.
// ------------------------------------------------------------------

export type LibraryVersion = {
	id: string;
	version: number;
	status: "draft" | "published" | "retired";
	changeNote: string | null;
	createdAt: string;
	/** Chat turn that authored the version (opaque — show a short id). */
	createdTurnId: string | null;
	/** A rendered PNG preview exists in R2 (draft saves don't write one). */
	hasPngPreview: boolean;
	/** Demo-document URL under the queried design's drafts, when present. */
	demoDocUrl: string | null;
	/** PageBlocks pinning this exact version (pins never move on their own). */
	pinCount: number;
};

export type LibraryComponent = {
	id: string;
	name: string;
	kind: string;
	tagName: string;
	publishedVersionId: string | null;
	publishedVersion: number | null;
	/** Highest draft version, when the component has one. */
	draftVersion: number | null;
	/** Full timeline, newest first. */
	versions: LibraryVersion[];
};

export type PinnedBlock = {
	id: string;
	ordinal: number;
	kind: "component" | "template" | "html";
	componentVersionId: string | null;
	componentId: string | null;
	componentName: string | null;
	tagName: string | null;
	version: number | null;
	versionStatus: "draft" | "published" | "retired" | null;
};

export type DesignPagePins = {
	id: string;
	path: string;
	title: string;
	status: string;
	blocks: PinnedBlock[];
};

export type ComponentLibrary = {
	components: LibraryComponent[];
	/** Scoped to a design when the request carried ?designId=; else null. */
	pages: DesignPagePins[] | null;
};

/** The re-pin POST response: the updated block's pin pointer. */
export type RepinBlockResult = {
	id: string;
	pageId: string;
	ordinal: number;
	componentVersionId: string;
	version: number;
	componentName: string;
	tagName: string;
};

/** Publish/restore response (KUK-921): the version that became published. */
export type ComponentPublishResult = {
	componentId: string;
	versionId: string;
	version: number;
	/** The version row this publish retired (null when nothing was live). */
	retiredVersionId: string | null;
};

/** Retire response: the version row that was live, now retired. */
export type ComponentRetireResult = {
	componentId: string;
	retiredVersionId: string;
};

// ------------------------------------------------------------------
// Studio building blocks (KUK-928) — the page composer, data
// collections, templates and flows views.
// ------------------------------------------------------------------

/** One composer block with its full source detail (editable round-trip). */
export type ComposerBlock = {
	id: string;
	ordinal: number;
	kind: "component" | "template" | "html";
	/** Component blocks: the exact pinned version. */
	componentVersionId: string | null;
	componentId: string | null;
	componentName: string | null;
	tagName: string | null;
	version: number | null;
	versionStatus: "draft" | "published" | "retired" | null;
	/** Template blocks. */
	templateId: string | null;
	templateName: string | null;
	/** HTML blocks. */
	sourceHtml: string | null;
	/** Parsed JSON (null when absent or malformed). */
	propsOverrides: Record<string, unknown> | null;
	dataBindings: Record<string, unknown> | null;
};

export type ComposerPage = {
	id: string;
	path: string;
	title: string;
	status: string;
	blocks: ComposerBlock[];
};

/** GET /projects/:projectId/designs/:designId/pages payload. */
export type DesignPages = {
	pages: ComposerPage[];
};

export type PageRef = {
	id: string;
	path: string;
	title: string;
	status: string;
};

/** Page create/rename response. */
export type PageMutation = { page: PageRef };

/** One block pin of the blocks-replacement response. */
export type ReplacedBlockPin =
	| {
			ordinal: number;
			kind: "component";
			component: string;
			tagName: string;
			version: number;
	  }
	| { ordinal: number; kind: "template"; template: string }
	| { ordinal: number; kind: "html" };

export type DataCollectionDetail = {
	id: string;
	name: string;
	/** Raw JSON-as-TEXT bodies in ordinal order (the UI round-trips them). */
	records: Array<{ id: string; ordinal: number; data: string }>;
};

export type DataCollections = { collections: DataCollectionDetail[] };

export type CollectionRef = { id: string; name: string };

export type TemplateSlotDetail = {
	id: string;
	ordinal: number;
	componentVersionId: string | null;
	componentName: string | null;
	tagName: string | null;
	version: number | null;
	versionStatus: "draft" | "published" | "retired" | null;
	propsOverrides: Record<string, unknown> | null;
};

export type TemplateDetail = {
	id: string;
	name: string;
	slots: TemplateSlotDetail[];
};

export type Templates = { templates: TemplateDetail[] };

export type FlowStepDetail = {
	id: string;
	ordinal: number;
	pageId: string;
	pagePath: string;
	pageTitle: string;
	entryAction: string | null;
	exitTarget: string | null;
};

export type FlowDetail = {
	id: string;
	name: string;
	steps: FlowStepDetail[];
};

/** GET /projects/:projectId/flows payload (pages feed the step picker). */
export type Flows = {
	flows: FlowDetail[];
	pages: Array<{ id: string; path: string; title: string }>;
};

/** Template create/slot-replacement response. */
export type TemplateUpsert = {
	template: { id: string; name: string; slotCount: number };
};

/** Flow create/step-replacement response. */
export type FlowUpsert = {
	flow: { id: string; name: string; stepCount: number };
};

export type Project = {
	id: string;
	name: string;
	description: string | null;
	createdAt: string;
	updatedAt: string;
};

/** listProjects row: project + its sub-entity composition (KUK-914). */
export type ProjectSummary = Project & {
	designCount: number;
	campaignCount: number;
	/** Presence flag — chips on cards/sidebar, not kit contents. */
	hasBrandKit: boolean;
};

/** getProject row: project + its designs (bucket-state enriched). */
export type ProjectDetail = Project & {
	designs: DesignDetail[];
	campaignCount: number;
	hasBrandKit: boolean;
};

// ------------------------------------------------------------------
// Brand kit (KUK-900) — one per project; GET 404s when the project
// has no kit (the client maps that to null = the empty state). PUT is
// a full replace of the kit's content.
// ------------------------------------------------------------------

export type BrandColorRow = {
	id: string;
	paletteId: string;
	role: string;
	value: string;
};

export type BrandPaletteRow = {
	id: string;
	kitId: string;
	/** 'light' | 'dark' */
	mode: string;
	colors: BrandColorRow[];
};

export type BrandTypographyRow = {
	id: string;
	kitId: string;
	role: string;
	stack: string;
};

export type BrandFontRow = {
	id: string;
	kitId: string;
	family: string;
	/** 'system' | 'google' | 'url' */
	source: string;
	/** For source 'url' — the https stylesheet URL. */
	url: string | null;
	/** Comma/semicolon-separated weights, e.g. "400;700" or "100..900". */
	weights: string | null;
	italic: boolean;
	createdAt: string;
};

export type BrandKit = {
	id: string;
	projectId: string;
	name: string;
	createdAt: string;
	updatedAt: string;
	palettes: BrandPaletteRow[];
	typography: BrandTypographyRow[];
	fonts: BrandFontRow[];
};

/** PUT body — full replace; palettes not present in the body are dropped.
 * Roles are the fixed brand taxonomies (lib/brand-kit) the server validates. */
export type BrandKitInput = {
	name: string;
	palettes: {
		mode: "light" | "dark";
		colors: { role: BrandColorRole; value: string }[];
	}[];
	typography?: { role: BrandTypographyRole; stack: string }[];
	fonts?: {
		family: string;
		source: "system" | "google" | "url";
		url?: string;
		weights?: string;
		italic?: boolean;
	}[];
};

// ------------------------------------------------------------------
// Brand kit adoption (KUK-901) — POST /projects/:id/brand-kit/adopt
// seeds the kit from a published design. `saved: false` means required
// light roles were missing from the extracted tokens: nothing was written
// (kit stays null) and the client prefills the editor instead.
// ------------------------------------------------------------------

/** What adoption extracted from the design's `:root` + font <head>.
 * Roles are the fixed brand taxonomies — extraction maps known variables
 * onto them (unknown ones land in `skipped`). */
export type AdoptedBrandKit = {
	colors: { role: BrandColorRole; value: string }[];
	typography: { role: BrandTypographyRole; stack: string }[];
	fonts: {
		family: string;
		source: string;
		url: string | null;
		weights: string | null;
		italic: boolean;
	}[];
};

export type AdoptBrandKitResponse = {
	adopted: AdoptedBrandKit;
	/** Extracted variable names that could not be mapped (capped sample). */
	skipped: string[];
	/** Required light roles absent from the extraction (empty when saved). */
	missing: string[];
	saved: boolean;
	/** The freshly saved kit when `saved` is true, else null. */
	kit: BrandKit | null;
};

// ------------------------------------------------------------------
// Campaigns (KUK-868)
// ------------------------------------------------------------------

export type Campaign = {
	id: string;
	name: string;
	briefPrompt: string | null;
	status: string;
	error: string | null;
	/** Owning project container — always present; campaigns are always filed. */
	projectId: string;
	shareSlug: string | null;
	shareRevokedAt: string | null;
	shareIncludeReports: boolean;
	/** Optional campaign target end date (KUK-896). */
	targetEndDate: string | null;
	createdAt: string;
	updatedAt: string;
};

/** listCampaigns row: campaign + asset/event counts + latest report title. */
export type CampaignSummary = Campaign & {
	assetCount: number;
	eventCount: number;
	latestReportTitle: string | null;
	/** Health inputs (KUK-982/983) — feeds the derived triage states. */
	draftEventCount: number;
	hasFinalPlan: boolean;
	planCount: number;
	/** Earliest scheduled calendar item — the "launches on" signal. */
	nextScheduledAt: string | null;
	kpiCount: number;
	recordedKpiCount: number;
	missedKpiCount: number;
	partialKpiCount: number;
	/** First KPI with a target (else first defined) + its latest result. */
	primaryKpi: {
		name: string;
		unit: string | null;
		targetNumber: number | null;
		latestResult: { actualNumber: number | null; status: KpiStatus } | null;
	} | null;
};

/** getCampaign row: campaign + brief/plan/events/report summaries. */
export type CampaignDetail = Campaign & {
	brief: CampaignBrief | null;
	plans: CampaignPlanDetail[];
	events: CalendarEventEntry[];
	reports: CampaignReportSummary[];
	/** CampaignChannel link ids (KUK-890) — the brief's channel mix. */
	channelIds: string[];
	/** Structured KPI targets with their latest recorded result (KUK-896). */
	kpis: CampaignKpiWithLatestResult[];
	/** Per-campaign target audiences (structured segmentation rows). */
	audiences: TargetAudience[];
};

export type TargetAudience = {
	id: string;
	campaignId: string;
	/** Segment name, e.g. "Gen Z shoppers". */
	name: string;
	/** Demographics — roles, industries, company size, geo; markdown. */
	demographics: string | null;
	/** Psychographics — pain points, motivations, goals, objections; markdown. */
	psychographics: string | null;
	/** Funnel/buying stage, e.g. "awareness". Free text. */
	buyingStage: string | null;
	/** Freeform markdown notes for this segment. */
	body: string | null;
	createdAt: string;
	updatedAt: string;
};

export type CampaignBrief = {
	id: string;
	campaignId: string;
	objective: string | null;
	/** DEPRECATED legacy markdown — the source of truth is CampaignDetail.audiences. */
	audience: string | null;
	keyMessage: string | null;
	tone: string | null;
	channels: string | null;
	budget: string | null;
	kpis: string | null;
	body: string | null;
	createdAt: string;
	updatedAt: string;
};

// ------------------------------------------------------------------
// Campaign KPIs (KUK-896)
// ------------------------------------------------------------------

export type KpiKind = "number" | "boolean" | "qualitative";

export type KpiStatus = "pending" | "not_met" | "partial" | "met" | "exceeded";

export type CampaignKpi = {
	id: string;
	campaignId: string;
	name: string;
	kind: KpiKind;
	targetNumber: number | null;
	targetBoolean: boolean | null;
	targetText: string | null;
	unit: string | null;
	/** Display color for the KPI card, e.g. "#3b82f6". */
	color: string | null;
	sortOrder: number;
	createdAt: string;
	updatedAt: string;
};

export type CampaignKpiWithLatestResult = CampaignKpi & {
	results: CampaignKpiResult[];
};

export type CampaignKpiResult = {
	id: string;
	kpiId: string;
	actualNumber: number | null;
	actualBoolean: boolean | null;
	actualText: string | null;
	status: KpiStatus;
	reportId: string | null;
	recordedAt: string;
	createdAt: string;
	updatedAt: string;
	report: { id: string; title: string } | null;
};

export type CampaignKpiResultWithKpi = CampaignKpiResult & {
	kpi: { id: string; name: string; kind: KpiKind; unit: string | null };
};

export type CampaignPlanPhase = {
	id: string;
	planId: string;
	name: string;
	objective: string | null;
	startsAt: string | null;
	endsAt: string | null;
	position: number;
	body: string | null;
};

export type CampaignPlanDetail = {
	id: string;
	campaignId: string;
	name: string;
	status: string;
	createdAt: string;
	updatedAt: string;
	phases: CampaignPlanPhase[];
};

export type CalendarEventEntry = {
	id: string;
	campaignId: string;
	title: string;
	/** Legacy free-text channel — deprecated, display fallback only. */
	channel: string | null;
	/** Linked channel id (KUK-890); null for legacy text rows. */
	channelId: string | null;
	/** The linked Channel row (id/name/color) for color-coded pills. */
	linkedChannel: {
		id: string;
		name: string;
		color: string | null;
	} | null;
	scheduledAt: string | null;
	status: string;
	assetId: string | null;
	notes: string | null;
	createdAt: string;
	updatedAt: string;
};

/** Report summary (no body/metrics — full bodies come from report routes). */
export type CampaignReportSummary = {
	id: string;
	title: string;
	periodStart: string | null;
	periodEnd: string | null;
	createdAt: string;
};

/**
 * A UI message part rebuilt from the persisted assistant-turn parts JSON
 * (Message.parts) — the subset the chat transcripts render: text, reasoning,
 * and finished tool calls with their input/output. The client-side
 * parseStoredParts validates raw rows into this shape; structurally mirrors
 * the server's StoredChatPart (src/lib/chat-parts.ts).
 */
export type StoredChatPart =
	| { type: "text"; state: "done"; text: string }
	| { type: "reasoning"; state: "done"; text: string }
	| {
			type: `tool-${string}` | "dynamic-tool";
			toolName?: string;
			toolCallId: string;
			state: "input-available" | "output-available" | "output-error";
			input?: unknown;
			output?: unknown;
			errorText?: string;
	  };

/** Chat transcript row from GET /campaigns/:id/messages. */
export type CampaignMessage = {
	id: string;
	role: string;
	content: string;
	/** Raw JSON array of the assistant turn's UI parts; null on user rows and pre-feature rows. */
	parts: string | null;
	createdAt: string;
};

/** Full report row (GET /campaigns/:id/documents?reportId=…). */
export type CampaignReport = CampaignReportSummary & {
	campaignId: string;
	summary: string | null;
	metrics: string | null;
	body: string;
	updatedAt: string;
};

/** Global channel enumeration row (KUK-890) — admin-owned, agent pick-only. */
export type Channel = {
	id: string;
	name: string;
	color: string | null;
	createdAt: string;
};

/** Studio skill row (KUK-891) — admin-owned markdown playbooks. */
export type Skill = {
	id: string;
	slug: string;
	name: string;
	description: string;
	content: string;
	/** Studio surface: "design" or "campaign" / "marketing" / "sales". */
	category: SkillCategory;
	builtin: boolean;
	enabled: boolean;
	createdAt: string;
	updatedAt: string;
};

// GitHub skill import (skills.importPreview / skills.importSkills): the
// preview lists a repo's SKILL.md candidates without fetching content;
// import upserts only the selected ones as non-builtin rows.
export type GithubSkillImportCandidate = {
	/** SKILL.md repo path, verbatim. */
	path: string;
	/** Derived import slug (parent folder name); null when unusable. */
	slug: string | null;
	/** Blob size in bytes from the trees API. */
	size: number;
	/** True when the slug already exists in the library. */
	conflict: boolean;
};

export type GithubSkillImportPreview = {
	owner: string;
	repo: string;
	/** Branch/tag the scan resolved to (default branch when unpinned). */
	ref: string;
	path?: string;
	candidates: GithubSkillImportCandidate[];
	/** True when the git trees API truncated its listing (huge repos). */
	truncated: boolean;
};

export type GithubSkillImportResult = {
	imported: Array<{
		slug: string;
		name: string;
		action: "created" | "updated";
		warnings: string[];
	}>;
	skipped: Array<{ slug: string | null; reason: string }>;
	failed: Array<{ path: string; error: string }>;
};

/** A standalone plan row (create/update responses). */
export type CampaignPlanRow = {
	id: string;
	campaignId: string;
	name: string;
	status: string;
	createdAt: string;
	updatedAt: string;
};

// Campaign asset rows (GET /campaigns/:id/assets): an asset IS a filed
// Design linked to the campaign, so studio links are derivable client-side.
export type CampaignAssetSummary = {
	id: string;
	prompt: string;
	campaignId: string | null;
	projectId: string;
	status: string;
	createdAt: string;
	/** The live version is published (liveTurnId set) — /designs/:id/site works. */
	published: boolean;
};

/** Share-menu payload from the POST/PATCH /campaigns/:id/share routes. */
export type CampaignSharePayload = {
	shared: boolean;
	shareSlug: string | null;
	/** Public page path, e.g. /share/campaign/<slug>. */
	shareUrl: string | null;
	shareIncludeReports: boolean;
	shareRevokedAt: string | null;
};
