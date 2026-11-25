import type { Skill } from "@/client/api-types";

/**
 * "/" skill suggestions for the campaign studio chat prompt (KUK-891).
 * Typing "/" at the start of the input opens the menu listing the enabled
 * skills; picking one inserts its "/slug " invocation which the chat
 * pipeline resolves server-side into that turn's context.
 *
 * Deliberately mouse-driven and keyboard-safe: the menu is a plain listbox
 * (no cmdk focus trap) so the textarea keeps every keystroke — Escape
 * closes it and typing filters it; sending "/slug …" works with Enter
 * either way because unknown invocations flow as plain text.
 */

/** True while the draft is a bare slash invocation: "/" plus at most one word. */
export function isSlashDraft(draft: string): boolean {
	return draft.startsWith("/") && !draft.includes(" ") && !draft.includes("\n");
}

/** Case-insensitive substring filter over slug and name ("", matches all). */
export function filterSkillsForSlash(skills: Skill[], query: string): Skill[] {
	const q = query.trim().toLowerCase();
	if (!q) return skills;
	return skills.filter(
		(skill) => skill.slug.includes(q) || skill.name.toLowerCase().includes(q),
	);
}

export function SkillSlashMenu({
	skills,
	query,
	onSelect,
}: {
	/** Enabled skills only — disabled ones are hidden from the menu. */
	skills: Skill[];
	/** The draft's query part: everything after the leading "/", maybe "". */
	query: string;
	onSelect: (skill: Skill) => void;
}) {
	const filtered = filterSkillsForSlash(skills, query);
	if (filtered.length === 0) return null;
	return (
		<div
			aria-label="Skill suggestions"
			// Capped + scrollable: the library is 29 skills and growing —
			// an uncapped list would grow past the viewport (and off the
			// top edge, since the menu opens upward from the input).
			className="absolute inset-x-0 bottom-full z-20 mb-2 max-h-[min(24rem,60dvh)] overflow-y-auto overscroll-contain rounded-xl border bg-popover text-popover-foreground shadow-md"
			role="listbox"
		>
			{filtered.map((skill) => (
				<button
					aria-selected="false"
					className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm outline-none hover:bg-accent"
					key={skill.id}
					onMouseDown={(event) => {
						// Keep textarea focus; click still fires the selection.
						event.preventDefault();
						onSelect(skill);
					}}
					role="option"
					type="button"
				>
					<span className="font-mono text-xs text-foreground">
						{`/${skill.slug}`}
					</span>
					<span className="text-xs text-muted-foreground">
						{skill.description}
					</span>
				</button>
			))}
		</div>
	);
}
