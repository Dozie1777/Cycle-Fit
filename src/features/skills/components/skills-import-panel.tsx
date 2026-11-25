import { useState } from "react";
import type {
	GithubSkillImportCandidate,
	GithubSkillImportResult,
} from "@/client/api-types";
import {
	useGithubSkillImportPreview,
	useImportGithubSkills,
} from "@/client/queries";
import { Button } from "@/components/ui/button";
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
import { SKILL_CATEGORIES, type SkillCategory } from "@/features/skills";

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * GitHub import flow: paste a repo / tree / SKILL.md URL (any public repo
 * following the skills/<name>/SKILL.md layout), scan it, multi-select the
 * skills to bring in, pick a studio category and a conflict policy, and
 * import. Each imported skill becomes a plain (non-builtin) row — editable
 * and deletable like any admin-created skill.
 */
export function SkillsImportPanel() {
	const [source, setSource] = useState("");
	const [scanned, setScanned] = useState("");
	const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
	const [category, setCategory] = useState<SkillCategory>("marketing");
	const [conflict, setConflict] = useState<"skip" | "overwrite">("skip");
	const [result, setResult] = useState<GithubSkillImportResult | null>(null);
	const [error, setError] = useState<string | null>(null);

	const preview = useGithubSkillImportPreview(scanned, scanned.length > 0);
	const importSkills = useImportGithubSkills();

	const candidates: GithubSkillImportCandidate[] =
		preview.data?.candidates ?? [];
	// Count only conflicts among the checked rows — the overwrite notice is
	// about what the import will actually clobber.
	const conflictedCount = candidates.filter(
		(candidate) => candidate.conflict && selectedPaths.has(candidate.path),
	).length;

	function handleScan(event: React.FormEvent) {
		event.preventDefault();
		setError(null);
		setResult(null);
		setSelectedPaths(new Set());
		setScanned(source.trim());
	}

	function togglePath(path: string, checked: boolean) {
		setSelectedPaths((prev) => {
			const next = new Set(prev);
			if (checked) {
				next.add(path);
			} else {
				next.delete(path);
			}
			return next;
		});
	}

	async function handleImport() {
		setError(null);
		setResult(null);
		try {
			const outcome = await importSkills.mutateAsync({
				source: scanned,
				category,
				paths: [...selectedPaths],
				conflict,
			});
			setResult(outcome);
			setSelectedPaths(new Set());
		} catch (e) {
			setError(errorMessage(e));
		}
	}

	return (
		<div className="flex max-w-3xl flex-col gap-4">
			<p className="text-sm text-muted-foreground">
				Seed the library from any public GitHub repo that follows the
				agent-skills layout — one folder per skill with a{" "}
				<code className="font-mono text-xs">SKILL.md</code> at its root (e.g.{" "}
				<a
					className="underline underline-offset-2"
					href="https://github.com/coreyhaines31/marketingskills"
					rel="noreferrer"
					target="_blank"
				>
					coreyhaines31/marketingskills
				</a>
				). Paste a repo URL, a <code className="font-mono text-xs">/tree/</code>{" "}
				subfolder, or a single SKILL.md file URL.
			</p>
			<form className="flex items-end gap-2" onSubmit={handleScan}>
				<div className="min-w-0 flex-1 space-y-1">
					<Label htmlFor="skills-import-source">
						GitHub repo or SKILL.md URL
					</Label>
					<Input
						id="skills-import-source"
						onChange={(e) => setSource(e.target.value)}
						placeholder="https://github.com/owner/repo (or owner/repo)"
						value={source}
					/>
				</div>
				<Button
					disabled={source.trim().length === 0 || preview.isFetching}
					size="sm"
					type="submit"
				>
					{preview.isFetching ? <Spinner /> : "Scan"}
				</Button>
			</form>

			{preview.error && (
				<p className="text-xs text-destructive">
					{errorMessage(preview.error)}
				</p>
			)}
			{preview.data?.truncated && (
				<p className="text-xs text-amber-600">
					This repo is huge — GitHub truncated the file listing, so some skills
					may be missing from the results below.
				</p>
			)}
			{preview.data && preview.data.candidates.length === 0 && (
				<p className="text-xs text-muted-foreground">
					No SKILL.md files found at that ref and path. Note: GitHub tree URLs
					can't express branch names containing "/" (e.g. feature/import) — for
					those, paste the bare repo URL and scan from the root.
				</p>
			)}

			{candidates.length > 0 && (
				<div className="space-y-3">
					<div className="flex flex-wrap items-end gap-2">
						<div className="w-40 space-y-1">
							<Label htmlFor="skills-import-category">Studio</Label>
							<Select
								onValueChange={(value) => setCategory(value as SkillCategory)}
								value={category}
							>
								<SelectTrigger id="skills-import-category" size="sm">
									<SelectValue />
								</SelectTrigger>
								<SelectContent className="max-h-72">
									{SKILL_CATEGORIES.map((option) => (
										<SelectItem key={option} value={option}>
											{option}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="w-48 space-y-1">
							<Label htmlFor="skills-import-conflict">If slug exists</Label>
							<Select
								onValueChange={(value) =>
									setConflict(value as "skip" | "overwrite")
								}
								value={conflict}
							>
								<SelectTrigger id="skills-import-conflict" size="sm">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="skip">Skip existing</SelectItem>
									<SelectItem value="overwrite">Overwrite content</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<Button
							disabled={
								selectedPaths.size === 0 ||
								importSkills.isPending ||
								preview.isFetching
							}
							onClick={() => void handleImport()}
							size="sm"
							type="button"
						>
							{importSkills.isPending ? (
								<Spinner />
							) : (
								`Import ${selectedPaths.size} skill${selectedPaths.size === 1 ? "" : "s"}`
							)}
						</Button>
					</div>
					<ul
						aria-label="Importable skills"
						className="max-h-[50vh] overflow-y-auto rounded-md border"
					>
						{candidates.map((candidate) => {
							const tooBig = candidate.slug === null;
							return (
								<li
									className="flex items-center gap-2 border-b px-3 py-2 last:border-b-0"
									key={candidate.path}
								>
									<input
										aria-label={`Import ${candidate.slug ?? candidate.path}`}
										checked={selectedPaths.has(candidate.path)}
										className="size-4"
										disabled={tooBig}
										onChange={(e) =>
											togglePath(candidate.path, e.target.checked)
										}
										type="checkbox"
									/>
									<div className="min-w-0 flex-1">
										<p className="truncate text-sm">
											<span className="font-mono text-xs text-muted-foreground">
												/{candidate.slug ?? "?"}
											</span>{" "}
											{candidate.conflict && (
												<span className="rounded bg-amber-100 px-1 py-0.5 text-[10px] uppercase tracking-wide text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
													exists — {conflict}
												</span>
											)}
										</p>
										<p className="truncate font-mono text-xs text-muted-foreground">
											{candidate.path}
										</p>
									</div>
									<span className="shrink-0 text-xs text-muted-foreground">
										{tooBig
											? "no folder name"
											: `${(candidate.size / 1024).toFixed(0)}k`}
									</span>
								</li>
							);
						})}
					</ul>
					{conflictedCount > 0 && conflict === "overwrite" && (
						<p className="text-xs text-muted-foreground">
							{conflictedCount} selected slug{conflictedCount === 1 ? "" : "s"}{" "}
							will have its content overwritten.
						</p>
					)}
				</div>
			)}

			{result && (
				<div className="space-y-1 rounded-md border p-3 text-sm">
					<p className="font-medium">
						Imported {result.imported.length}, skipped {result.skipped.length},
						failed {result.failed.length}.
					</p>
					{result.imported.map((entry) => (
						<p className="text-xs text-muted-foreground" key={entry.slug}>
							/{entry.slug} — {entry.action}
							{entry.warnings.length > 0
								? ` (${entry.warnings.join("; ")})`
								: ""}
						</p>
					))}
					{result.skipped.map((entry) => (
						<p
							className="text-xs text-muted-foreground"
							key={entry.slug ?? "?"}
						>
							{entry.slug ?? "unknown"} — skipped: {entry.reason}
						</p>
					))}
					{result.failed.map((entry) => (
						<p className="text-xs text-destructive" key={entry.path}>
							{entry.path} — {entry.error}
						</p>
					))}
				</div>
			)}

			{error && <p className="text-xs text-destructive">{error}</p>}
		</div>
	);
}
