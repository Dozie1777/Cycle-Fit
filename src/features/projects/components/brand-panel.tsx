import { useEffect, useState } from "react";
import type {
	AdoptBrandKitResponse,
	BrandKit,
	BrandKitInput,
	DesignDetail,
} from "@/client/api-types";
import {
	useAdoptBrandKit,
	useBrandKit,
	useDeleteBrandKit,
	useProject,
	useUpsertBrandKit,
} from "@/client/queries";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
	BRAND_COLOR_ROLES,
	BRAND_TYPOGRAPHY_ROLES,
	type BrandColorRole,
	type BrandTypographyRole,
	googleFontsUrl,
	REQUIRED_LIGHT_ROLES,
} from "@/features/projects/brand-kit/brand-kit";

// ---------------------------------------------------------------------------
// Draft model: raw input strings ("" = role not set). The full-replace PUT
// body is built from the draft at save time — empty roles and blank palettes
// are simply not sent (the API drops absent palettes).
// ---------------------------------------------------------------------------

type DraftPalette = Record<BrandColorRole, string>;

type DraftFont = {
	/** Stable row identity for React keys (server font id, or a random id). */
	rowId: string;
	family: string;
	source: "system" | "google" | "url";
	url: string;
	weights: string;
	italic: boolean;
};

type Draft = {
	name: string;
	light: DraftPalette;
	/** null until the admin opts into dark; seeded from light on first visit. */
	dark: DraftPalette | null;
	typography: Record<BrandTypographyRole, string>;
	fonts: DraftFont[];
};

// Light palette roles the API requires once a light palette exists —
// REQUIRED_LIGHT_ROLES from lib/brand-kit (the server PUT/adopt validation
// shares the same constant).

/** #rgb or #rrggbb — same shape the API validates. */
const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Neutral shadcn-ish zinc light set for the create-from-empty defaults. */
const DEFAULT_LIGHT: DraftPalette = {
	background: "#ffffff",
	foreground: "#09090b",
	primary: "#18181b",
	"primary-foreground": "#fafafa",
	muted: "#f4f4f5",
	border: "#e4e4e7",
	accent: "#f4f4f5",
};

const COLOR_ROLE_LABELS: Record<BrandColorRole, string> = {
	background: "Background",
	foreground: "Foreground",
	primary: "Primary",
	"primary-foreground": "Primary foreground",
	muted: "Muted",
	border: "Border",
	accent: "Accent",
};

const TYPOGRAPHY_ROLE_LABELS: Record<BrandTypographyRole, string> = {
	heading: "Heading",
	body: "Body",
	display: "Display",
};

function emptyDraft(): Draft {
	return {
		name: "Brand kit",
		light: { ...DEFAULT_LIGHT },
		dark: null,
		typography: { heading: "", body: "", display: "" },
		fonts: [],
	};
}

function paletteOf(kit: BrandKit, mode: string): DraftPalette {
	const palette = kit.palettes.find((entry) => entry.mode === mode);
	return Object.fromEntries(
		BRAND_COLOR_ROLES.map((role) => [
			role,
			palette?.colors.find((color) => color.role === role)?.value ?? "",
		]),
	) as DraftPalette;
}

function draftFromKit(kit: BrandKit): Draft {
	return {
		name: kit.name,
		light: paletteOf(kit, "light"),
		dark: kit.palettes.some((entry) => entry.mode === "dark")
			? paletteOf(kit, "dark")
			: null,
		typography: Object.fromEntries(
			BRAND_TYPOGRAPHY_ROLES.map((role) => [
				role,
				kit.typography.find((entry) => entry.role === role)?.stack ?? "",
			]),
		) as Record<BrandTypographyRole, string>,
		fonts: kit.fonts.map((font) => ({
			rowId: font.id,
			family: font.family,
			source:
				font.source === "system" || font.source === "url"
					? font.source
					: "google",
			url: font.url ?? "",
			weights: font.weights ?? "",
			italic: font.italic ?? false,
		})),
	};
}

/**
 * Builds an unsaved draft from an adoption response (KUK-901). A saved
 * adoption rehydrates from the returned kit; a not-saved one (missing
 * required roles) prefills the editor with exactly what was adopted so the
 * admin fills the gaps and saves through the normal PUT flow.
 */
function draftFromAdopted(result: AdoptBrandKitResponse): Draft {
	if (result.saved && result.kit) return draftFromKit(result.kit);
	const light = Object.fromEntries(
		BRAND_COLOR_ROLES.map((role) => [
			role,
			result.adopted.colors.find((color) => color.role === role)?.value ?? "",
		]),
	) as DraftPalette;
	return {
		name: "Brand kit",
		light,
		dark: null,
		typography: Object.fromEntries(
			BRAND_TYPOGRAPHY_ROLES.map((role) => [
				role,
				result.adopted.typography.find((entry) => entry.role === role)?.stack ??
					"",
			]),
		) as Record<BrandTypographyRole, string>,
		fonts: result.adopted.fonts.map((font, index) => ({
			rowId: `adopted-${index}`,
			family: font.family,
			source:
				font.source === "system" || font.source === "url"
					? font.source
					: "google",
			url: font.url ?? "",
			weights: font.weights ?? "",
			italic: font.italic ?? false,
		})),
	};
}

/** One line for the adopt summary: "3 colors, 1 font". */
function adoptedSummary(result: AdoptBrandKitResponse): string {
	const parts: string[] = [];
	if (result.adopted.colors.length > 0) {
		parts.push(`${result.adopted.colors.length} color(s)`);
	}
	if (result.adopted.typography.length > 0) {
		parts.push(`${result.adopted.typography.length} typography role(s)`);
	}
	if (result.adopted.fonts.length > 0) {
		parts.push(`${result.adopted.fonts.length} font(s)`);
	}
	return parts.length ? parts.join(", ") : "no mappable tokens";
}

/** A palette counts as present only when it carries at least one color. */
function hasColors(palette: DraftPalette | null): boolean {
	return (
		palette !== null &&
		BRAND_COLOR_ROLES.some((role) => (palette[role] ?? "").trim() !== "")
	);
}

function hexError(value: string): string | null {
	return value.trim() !== "" && !HEX_RE.test(value.trim())
		? "Use #rgb or #rrggbb (e.g. #0f172a)."
		: null;
}

function validColors(
	palette: DraftPalette,
): { role: BrandColorRole; value: string }[] {
	return BRAND_COLOR_ROLES.flatMap((role) => {
		const value = (palette[role] ?? "").trim();
		return HEX_RE.test(value) ? [{ role, value }] : [];
	});
}

/** A font row is sent only once it has any content; blank placeholders drop. */
function fontBlank(font: DraftFont): boolean {
	return (
		font.family.trim() === "" &&
		font.url.trim() === "" &&
		font.weights.trim() === "" &&
		!font.italic
	);
}

function fontError(font: DraftFont): string | null {
	if (fontBlank(font)) return null;
	if (font.family.trim() === "") return "Family is required.";
	if (font.source === "url" && !font.url.trim().startsWith("https://")) {
		return 'Source "URL" needs an https:// stylesheet URL.';
	}
	return null;
}

/** The full-replace PUT body, or null when the draft fails validation. */
function buildBody(draft: Draft): BrandKitInput | null {
	const lightColors = validColors(draft.light);
	const darkColors =
		draft.dark && hasColors(draft.dark) ? validColors(draft.dark) : [];
	if (lightColors.length === 0 && darkColors.length === 0) return null;
	if (
		lightColors.length > 0 &&
		REQUIRED_LIGHT_ROLES.some(
			(role) => !lightColors.some((color) => color.role === role),
		)
	) {
		return null;
	}
	const name = draft.name.trim();
	if (!name || name.length > 200) return null;
	if (draft.fonts.some((font) => fontError(font) !== null)) return null;

	const body: BrandKitInput = { name, palettes: [] };
	if (lightColors.length > 0) {
		body.palettes.push({ mode: "light", colors: lightColors });
	}
	if (darkColors.length > 0) {
		body.palettes.push({ mode: "dark", colors: darkColors });
	}
	const typography = BRAND_TYPOGRAPHY_ROLES.flatMap((role) => {
		const stack = draft.typography[role].trim();
		return stack ? [{ role, stack }] : [];
	});
	if (typography.length > 0) body.typography = typography;
	const fonts = draft.fonts
		.filter((font) => !fontBlank(font))
		.map((font) => ({
			family: font.family.trim(),
			source: font.source,
			...(font.source === "url" && font.url.trim()
				? { url: font.url.trim() }
				: {}),
			...(font.weights.trim() ? { weights: font.weights.trim() } : {}),
			...(font.italic ? { italic: true } : {}),
		}));
	if (fonts.length > 0) body.fonts = fonts;
	return body;
}

/**
 * Inline adopt design-picker (KUK-901): one row per published design of the
 * project; picking one runs the adoption endpoint. Deliberately inline (not
 * a Dialog) so it stays testable in the node-env component tests.
 */
function AdoptPicker(props: {
	designs: DesignDetail[];
	pending: boolean;
	onPick: (designId: string) => void;
}) {
	return (
		<div className="w-full space-y-2 rounded-lg border p-3 text-left">
			<p className="text-xs text-muted-foreground">
				Pick a published design — its `:root` tokens and Google Fonts links seed
				the kit.
			</p>
			{props.designs.map((design) => (
				<div key={design.id} className="flex items-center gap-2">
					<span className="min-w-0 flex-1 truncate text-xs">
						{design.prompt}
					</span>
					<Button
						disabled={props.pending}
						onClick={() => props.onPick(design.id)}
						size="sm"
						type="button"
						variant="outline"
					>
						{props.pending ? "Adopting…" : "Adopt"}
					</Button>
				</div>
			))}
		</div>
	);
}

/** The "Adopt from design…" trigger — disabled with a hint when the project has no published designs. */
function AdoptTrigger(props: {
	disabled: boolean;
	onToggle: () => void;
	pending: boolean;
}) {
	const noDesigns = props.disabled;
	return (
		<Button
			disabled={noDesigns || props.pending}
			onClick={props.onToggle}
			title={
				noDesigns ? "No published designs — publish a design first." : undefined
			}
			type="button"
			variant="outline"
		>
			Adopt from design…
		</Button>
	);
}

/**
 * Brand kit editor on the project detail page (KUK-900): color rows per
 * shadcn role (per active mode), typography stacks, font rows with a live
 * Google Fonts URL preview, full-replace save and a delete-with-confirm.
 * GET 404 (no kit) renders the empty state; "Create" opens the editor with
 * a neutral light palette prefilled. KUK-901 adds "Adopt from design…",
 * which seeds the kit from a published design's tokens and fonts.
 */
export function BrandPanel({ projectId }: { projectId: string }) {
	const { data: kit, isPending } = useBrandKit(projectId);
	const upsert = useUpsertBrandKit();
	const removeKit = useDeleteBrandKit();
	const { data: project } = useProject(projectId);
	const adopt = useAdoptBrandKit();
	const [draft, setDraft] = useState<Draft | null>(null);
	const [baseline, setBaseline] = useState<string | null>(null);
	const [isNew, setIsNew] = useState(false);
	const [mode, setModeState] = useState<"light" | "dark">("light");
	const [actionError, setActionError] = useState<string | null>(null);
	// KUK-901: the adopt design-picker and its result summary.
	const [adoptOpen, setAdoptOpen] = useState(false);
	const [adoptNotice, setAdoptNotice] = useState<AdoptBrandKitResponse | null>(
		null,
	);

	// Published designs of this project — adoption seeds the kit from these.
	const publishedDesigns = (project?.designs ?? []).filter(
		(design) => design.hasIndex,
	);
	const noPublishedDesigns = publishedDesigns.length === 0;

	// Sync once when the kit first arrives; afterwards the editor is only
	// re-synced explicitly (save response, cancel, delete) so background
	// refetches never clobber in-progress edits.
	useEffect(() => {
		if (kit && draft === null) {
			const initial = draftFromKit(kit);
			setDraft(initial);
			setBaseline(JSON.stringify(initial));
		}
	}, [kit, draft]);

	if (isPending) {
		return (
			<Card>
				<CardContent className="space-y-3 p-6">
					<Skeleton className="h-5 w-40" />
					<Skeleton className="h-9 w-full" />
					<Skeleton className="h-40 w-full" />
				</CardContent>
			</Card>
		);
	}

	if (!draft) {
		return (
			<Card className="border-dashed shadow-none">
				<CardContent className="flex flex-col items-center gap-3 p-10 text-center">
					<p className="max-w-md text-sm text-muted-foreground">
						No brand kit yet — designs derive style from the page. Create one to
						lock in your brand.
					</p>
					<div className="flex items-center gap-2">
						<Button
							onClick={() => {
								setDraft(emptyDraft());
								setIsNew(true);
								setBaseline(null);
								setModeState("light");
								setActionError(null);
								setAdoptNotice(null);
							}}
						>
							Create brand kit
						</Button>
						<AdoptTrigger
							disabled={noPublishedDesigns}
							onToggle={() => setAdoptOpen((open) => !open)}
							pending={adopt.isPending}
						/>
					</div>
					{adoptOpen && (
						<AdoptPicker
							designs={publishedDesigns}
							onPick={(designId) => void handleAdopt(designId)}
							pending={adopt.isPending}
						/>
					)}
					{actionError && (
						<p className="text-sm text-destructive">{actionError}</p>
					)}
				</CardContent>
			</Card>
		);
	}

	const dirty = isNew || JSON.stringify(draft) !== baseline;

	const lightRoles = validColors(draft.light).map((color) => color.role);
	const lightMissing = lightRoles.length
		? REQUIRED_LIGHT_ROLES.filter((role) => !lightRoles.includes(role))
		: [];
	const noColors =
		lightRoles.length === 0 &&
		!BRAND_COLOR_ROLES.some((role) => (draft.dark?.[role] ?? "").trim() !== "");
	const nameMissing = draft.name.trim() === "";
	const blocked =
		nameMissing ||
		noColors ||
		lightMissing.length > 0 ||
		BRAND_COLOR_ROLES.some(
			(role) =>
				hexError(draft.light[role]) !== null ||
				hexError(draft.dark?.[role] ?? "") !== null,
		) ||
		draft.fonts.some((font) => fontError(font) !== null);

	const activePalette =
		mode === "light" ? draft.light : (draft.dark ?? draft.light);

	function setColor(role: BrandColorRole, value: string) {
		if (!draft) return;
		if (mode === "light") {
			setDraft({ ...draft, light: { ...draft.light, [role]: value } });
		} else {
			setDraft({
				...draft,
				dark: { ...(draft.dark ?? draft.light), [role]: value },
			});
		}
	}

	/** Switching to dark with no dark palette starts one from light. */
	function switchMode(next: "light" | "dark") {
		if (next === mode || !draft) return;
		if (next === "dark" && !hasColors(draft.dark)) {
			setDraft({ ...draft, dark: { ...draft.light } });
		}
		setModeState(next);
	}

	function setStack(role: BrandTypographyRole, stack: string) {
		if (!draft) return;
		setDraft({
			...draft,
			typography: { ...draft.typography, [role]: stack },
		});
	}

	function setFont(index: number, patch: Partial<DraftFont>) {
		if (!draft) return;
		setDraft({
			...draft,
			fonts: draft.fonts.map((font, i) =>
				i === index ? { ...font, ...patch } : font,
			),
		});
	}

	function addFont() {
		if (!draft) return;
		setDraft({
			...draft,
			fonts: [
				...draft.fonts,
				{
					rowId: crypto.randomUUID(),
					family: "",
					source: "google",
					url: "",
					weights: "",
					italic: false,
				},
			],
		});
	}

	function removeFont(index: number) {
		if (!draft) return;
		setDraft({
			...draft,
			fonts: draft.fonts.filter((_, i) => i !== index),
		});
	}

	async function handleSave() {
		if (!draft || !dirty || blocked) return;
		const body = buildBody(draft);
		if (!body) return;
		setActionError(null);
		try {
			const saved = await upsert.mutateAsync({ projectId, body });
			const settled = draftFromKit(saved);
			setDraft(settled);
			setBaseline(JSON.stringify(settled));
			setIsNew(false);
			setAdoptNotice(null);
		} catch (e) {
			setActionError(e instanceof Error ? e.message : String(e));
		}
	}

	/** Cancel reverts to server state (or closes the unsaved new-kit editor). */
	function handleCancel() {
		setAdoptNotice(null);
		if (isNew || !kit) {
			setDraft(null);
			setIsNew(false);
			setBaseline(null);
			return;
		}
		const server = draftFromKit(kit);
		setDraft(server);
		setBaseline(JSON.stringify(server));
	}

	async function handleDelete() {
		if (!kit) return;
		// globalThis.confirm (=== window.confirm in browsers) so the
		// node-env unit tests can stub it.
		if (
			!globalThis.confirm(
				`Delete the brand kit "${kit.name}"? Designs will derive style from the page again. This cannot be undone.`,
			)
		) {
			return;
		}
		setActionError(null);
		try {
			await removeKit.mutateAsync(projectId);
			setDraft(null);
			setIsNew(false);
			setBaseline(null);
			setAdoptNotice(null);
		} catch (e) {
			setActionError(e instanceof Error ? e.message : String(e));
		}
	}

	/**
	 * Adopt a published design's tokens (KUK-901). Saved → the editor
	 * rehydrates from the saved kit; not saved (missing required roles) →
	 * the editor prefills the adopted values, stays unsaved, and the
	 * summary names the roles still missing.
	 */
	async function handleAdopt(designId: string) {
		setActionError(null);
		try {
			const result = await adopt.mutateAsync({ projectId, designId });
			const next = draftFromAdopted(result);
			setDraft(next);
			if (result.saved) {
				setBaseline(JSON.stringify(next));
				setIsNew(false);
			} else {
				// Unsaved prefill: dirty from the start so Save is enabled once
				// the missing roles are filled; Cancel reverts to the server kit.
				setBaseline(null);
				setIsNew(!kit);
			}
			setModeState("light");
			setAdoptNotice(result);
			setAdoptOpen(false);
		} catch (e) {
			setActionError(e instanceof Error ? e.message : String(e));
		}
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-base">Brand kit</CardTitle>
				<CardDescription>
					Colors, typography and fonts locked here are applied to every design
					in this project.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-6">
				{adoptNotice && (
					<div className="space-y-1 rounded-md border p-3 text-xs">
						{adoptNotice.saved ? (
							<p>
								{`Saved — adopted ${adoptedSummary(adoptNotice)} from the design.`}
							</p>
						) : (
							<p className="text-destructive">
								{`Adopted ${adoptedSummary(adoptNotice)}, but the kit was not saved — missing required colors: ${adoptNotice.missing.join(", ")}. Fill them in and save.`}
							</p>
						)}
						{adoptNotice.skipped.length > 0 && (
							<p className="text-muted-foreground">
								{`Skipped unmapped tokens: ${adoptNotice.skipped.join(", ")}.`}
							</p>
						)}
					</div>
				)}
				<div className="space-y-2">
					<Label htmlFor="brand-kit-name">Kit name</Label>
					<Input
						id="brand-kit-name"
						maxLength={200}
						onChange={(e) =>
							setDraft(draft && { ...draft, name: e.target.value })
						}
						value={draft.name}
					/>
					{nameMissing && (
						<p className="text-xs text-destructive">Name is required.</p>
					)}
				</div>

				<section className="space-y-3">
					<fieldset
						aria-label="Palette mode"
						className="flex w-fit gap-1 rounded-md border-0 bg-muted p-0.5"
					>
						<legend className="sr-only">Palette mode</legend>
						<Button
							aria-pressed={mode === "light"}
							onClick={() => switchMode("light")}
							size="sm"
							type="button"
							variant={mode === "light" ? "outline" : "ghost"}
						>
							Light
						</Button>
						<Button
							aria-pressed={mode === "dark"}
							onClick={() => switchMode("dark")}
							size="sm"
							type="button"
							variant={mode === "dark" ? "outline" : "ghost"}
						>
							Dark
						</Button>
					</fieldset>

					<div className="space-y-2">
						{BRAND_COLOR_ROLES.map((role) => {
							const id = `brand-kit-color-${mode}-${role}`;
							const value = activePalette[role] ?? "";
							const error = hexError(value);
							return (
								<div key={role} className="space-y-1">
									<div className="flex items-center gap-2">
										<Label className="w-36 shrink-0" htmlFor={id}>
											{COLOR_ROLE_LABELS[role]}
										</Label>
										<Input
											className="max-w-32 font-mono text-sm"
											id={id}
											onChange={(e) => setColor(role, e.target.value)}
											placeholder="#rrggbb"
											value={value}
										/>
										<span
											aria-hidden="true"
											className="size-6 shrink-0 rounded-md border border-border/60"
											style={
												error ? undefined : { backgroundColor: value.trim() }
											}
										/>
									</div>
									{error && <p className="text-xs text-destructive">{error}</p>}
								</div>
							);
						})}
						{noColors && (
							<p className="text-xs text-destructive">
								A brand kit needs at least one color.
							</p>
						)}
						{lightMissing.length > 0 && (
							<p className="text-xs text-destructive">
								{`Light palette is missing required colors: ${lightMissing.join(", ")}.`}
							</p>
						)}
					</div>
				</section>

				<section className="space-y-2">
					<h3 className="text-sm font-medium">Typography</h3>
					{BRAND_TYPOGRAPHY_ROLES.map((role) => {
						const id = `brand-kit-typography-${role}`;
						return (
							<div key={role} className="space-y-1">
								<Label htmlFor={id}>{TYPOGRAPHY_ROLE_LABELS[role]}</Label>
								<Input
									className="font-mono text-sm"
									id={id}
									maxLength={500}
									onChange={(e) => setStack(role, e.target.value)}
									placeholder="ui-sans-serif, system-ui, sans-serif"
									value={draft.typography[role]}
								/>
							</div>
						);
					})}
					<p className="text-xs text-muted-foreground">
						Leave a stack empty to omit that role from the kit.
					</p>
				</section>

				<section className="space-y-3">
					<div className="flex items-center justify-between">
						<h3 className="text-sm font-medium">Fonts</h3>
						<Button onClick={addFont} size="sm" type="button" variant="outline">
							Add font
						</Button>
					</div>
					{draft.fonts.length === 0 && (
						<p className="text-xs text-muted-foreground">
							No fonts — designs fall back to the platform default stack.
						</p>
					)}
					{draft.fonts.map((font, index) => {
						const error = fontError(font);
						const familyId = `brand-kit-font-${index}-family`;
						return (
							<div key={font.rowId} className="space-y-2 rounded-lg border p-3">
								<div className="flex items-end gap-2">
									<div className="flex-1 space-y-1">
										<Label htmlFor={familyId}>Family</Label>
										<Input
											id={familyId}
											maxLength={120}
											onChange={(e) =>
												setFont(index, { family: e.target.value })
											}
											placeholder="Inter"
											value={font.family}
										/>
									</div>
									<div className="w-36 space-y-1">
										<Label htmlFor={`brand-kit-font-${index}-source`}>
											Source
										</Label>
										<Select
											onValueChange={(next) =>
												setFont(index, {
													source: next as DraftFont["source"],
												})
											}
											value={font.source}
										>
											<SelectTrigger
												id={`brand-kit-font-${index}-source`}
												aria-label={`Source for font ${index + 1}`}
											>
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="google">Google Fonts</SelectItem>
												<SelectItem value="system">System</SelectItem>
												<SelectItem value="url">URL</SelectItem>
											</SelectContent>
										</Select>
									</div>
									<Button
										aria-label={`Remove font ${index + 1}`}
										onClick={() => removeFont(index)}
										size="sm"
										type="button"
										variant="ghost"
										className="text-destructive"
									>
										Remove
									</Button>
								</div>
								<div className="flex items-end gap-2">
									{font.source === "url" && (
										<div className="flex-1 space-y-1">
											<Label htmlFor={`brand-kit-font-${index}-url`}>
												Stylesheet URL
											</Label>
											<Input
												className="font-mono text-sm"
												id={`brand-kit-font-${index}-url`}
												maxLength={2000}
												onChange={(e) =>
													setFont(index, { url: e.target.value })
												}
												placeholder="https://fonts.example.com/family.css"
												value={font.url}
											/>
										</div>
									)}
									<div className="w-40 space-y-1">
										<Label htmlFor={`brand-kit-font-${index}-weights`}>
											Weights
										</Label>
										<Input
											id={`brand-kit-font-${index}-weights`}
											maxLength={200}
											onChange={(e) =>
												setFont(index, { weights: e.target.value })
											}
											placeholder="400;700 or 100..900"
											value={font.weights}
										/>
									</div>
									<Button
										aria-pressed={font.italic}
										onClick={() => setFont(index, { italic: !font.italic })}
										size="sm"
										type="button"
										variant={font.italic ? "outline" : "ghost"}
									>
										Italic
									</Button>
								</div>
								{font.source === "google" && font.family.trim() !== "" && (
									<p className="break-all text-xs text-muted-foreground">
										Loads:{" "}
										{googleFontsUrl({
											family: font.family.trim(),
											source: "google",
											weights: font.weights,
											italic: font.italic,
										})}
									</p>
								)}
								{error && <p className="text-xs text-destructive">{error}</p>}
							</div>
						);
					})}
				</section>

				<div className="flex items-center gap-2">
					<Button
						disabled={!dirty || upsert.isPending || blocked}
						onClick={() => void handleSave()}
						type="button"
					>
						{upsert.isPending ? "Saving…" : isNew ? "Create kit" : "Save"}
					</Button>
					<Button
						disabled={upsert.isPending}
						onClick={handleCancel}
						type="button"
						variant="ghost"
					>
						Cancel
					</Button>
					<div className="ml-auto flex items-center gap-2">
						<AdoptTrigger
							disabled={noPublishedDesigns}
							onToggle={() => setAdoptOpen((open) => !open)}
							pending={adopt.isPending}
						/>
						{kit && !isNew && (
							<Button
								className="text-destructive"
								disabled={removeKit.isPending}
								onClick={() => void handleDelete()}
								type="button"
								variant="outline"
							>
								{removeKit.isPending ? "Deleting…" : "Delete kit"}
							</Button>
						)}
					</div>
				</div>
				{adoptOpen && (
					<AdoptPicker
						designs={publishedDesigns}
						onPick={(designId) => void handleAdopt(designId)}
						pending={adopt.isPending}
					/>
				)}
				{blocked && dirty && (
					<p className="text-xs text-destructive">
						Fix the highlighted errors before saving.
					</p>
				)}
				{actionError && (
					<p className="text-sm text-destructive">{actionError}</p>
				)}
			</CardContent>
		</Card>
	);
}
