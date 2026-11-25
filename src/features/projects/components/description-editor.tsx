import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ShareMarkdown } from "@/features/campaigns/components/share/markdown";

/**
 * Markdown description editor (KUK-897): a Write/Preview toggle around a
 * plain textarea. Write shows a monospace textarea; Preview renders the same
 * markdown pipeline the campaign share page uses (ShareMarkdown). Callers
 * own the value and the surrounding <Label htmlFor>, so the id stays
 * associated with the textarea in Write mode.
 */
export function DescriptionEditor({
	id,
	value,
	onChange,
	maxLength = 5000,
	rows = 4,
}: {
	id: string;
	value: string;
	onChange: (value: string) => void;
	maxLength?: number;
	rows?: number;
}) {
	const [previewing, setPreviewing] = useState(false);

	return (
		<div className="space-y-2">
			<fieldset
				aria-label="Edit or preview description"
				className="flex w-fit gap-1 rounded-md border-0 bg-muted p-0.5"
			>
				<legend className="sr-only">Edit or preview description</legend>
				<Button
					aria-pressed={!previewing}
					onClick={() => setPreviewing(false)}
					size="sm"
					type="button"
					variant={previewing ? "ghost" : "outline"}
				>
					Write
				</Button>
				<Button
					aria-pressed={previewing}
					onClick={() => setPreviewing(true)}
					size="sm"
					type="button"
					variant={previewing ? "outline" : "ghost"}
				>
					Preview
				</Button>
			</fieldset>
			{previewing ? (
				value.trim() ? (
					<div className="min-h-24 rounded-md border bg-muted/30 p-3 text-sm">
						<ShareMarkdown text={value} />
					</div>
				) : (
					<p className="min-h-24 rounded-md border border-dashed bg-muted/30 p-3 text-sm text-muted-foreground">
						Nothing to preview yet.
					</p>
				)
			) : (
				<Textarea
					className="font-mono text-sm"
					id={id}
					maxLength={maxLength}
					onChange={(e) => onChange(e.target.value)}
					placeholder="Description (markdown — optional)"
					rows={rows}
					value={value}
				/>
			)}
		</div>
	);
}
