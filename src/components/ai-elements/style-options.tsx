"use client";

import { CheckIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "@/client/utils";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

export type StylePaletteOption = {
	name: string;
	colors: string[];
	rationale?: string;
};

export type StyleFontOption = {
	name: string;
	heading: string;
	body: string;
	rationale?: string;
};

export type StyleOptionsProps = {
	palettes: StylePaletteOption[];
	fonts: StyleFontOption[];
	disabled?: boolean;
	onApply: (message: string) => void;
	className?: string;
};

/**
 * Interactive style pickers rendered for the model's `style_options` tool
 * call: color palettes as swatch rows, font pairings as live type samples.
 * The user selects one per group and applies; the pick is sent back as the
 * next user message (same channel as ask_user's buttons).
 */
export function StyleOptions({
	palettes,
	fonts,
	disabled,
	onApply,
	className,
}: StyleOptionsProps) {
	const [paletteIndex, setPaletteIndex] = useState<number | null>(null);
	const [fontIndex, setFontIndex] = useState<number | null>(null);
	const [applied, setApplied] = useState(false);

	const locked = disabled || applied;
	const ready =
		(palettes.length === 0 || paletteIndex !== null) &&
		(fonts.length === 0 || fontIndex !== null);

	const apply = () => {
		const parts: string[] = [];
		const palette = paletteIndex !== null ? palettes[paletteIndex] : undefined;
		if (palette) {
			parts.push(`Palette: "${palette.name}" (${palette.colors.join(", ")})`);
		}
		const font = fontIndex !== null ? fonts[fontIndex] : undefined;
		if (font) {
			parts.push(
				`Typography: headings in ${font.heading}, body in ${font.body}`,
			);
		}
		if (parts.length === 0) return;
		setApplied(true);
		onApply(`${parts.join(". ")}.`);
	};

	return (
		<Card
			className={cn(
				"w-full overflow-hidden border-border/50 bg-card/50 shadow-none",
				className,
			)}
		>
			<CardHeader className="pb-3">
				<CardTitle className="text-sm font-medium">Style direction</CardTitle>
				<CardDescription className="text-xs">
					Pick a palette and a font pairing, then apply your choices.
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4 pt-0">
				{palettes.length > 0 && (
					<section className="flex flex-col gap-2">
						<p className="text-xs font-medium text-muted-foreground">
							Color palette
						</p>
						<div className="grid gap-2 sm:grid-cols-2">
							{palettes.map((palette, i) => {
								const selected = paletteIndex === i;
								return (
									<button
										type="button"
										key={palette.name}
										disabled={locked}
										onClick={() => setPaletteIndex(i)}
										className={cn(
											"flex flex-col gap-2 rounded-lg border p-3 text-left transition-colors hover:bg-muted/50 disabled:opacity-60",
											selected &&
												"border-primary bg-primary/5 ring-1 ring-primary",
										)}
									>
										<span className="flex items-center gap-2 text-sm font-medium">
											{selected && (
												<CheckIcon className="size-3.5 text-primary" />
											)}
											{palette.name}
										</span>
										<span className="flex h-6 overflow-hidden rounded-md border border-border/50">
											{palette.colors.map((color) => (
												<span
													key={color}
													className="flex-1"
													style={{ backgroundColor: color }}
												/>
											))}
										</span>
										{palette.rationale && (
											<span className="text-xs text-muted-foreground">
												{palette.rationale}
											</span>
										)}
									</button>
								);
							})}
						</div>
					</section>
				)}
				{fonts.length > 0 && (
					<section className="flex flex-col gap-2">
						<p className="text-xs font-medium text-muted-foreground">
							Typography
						</p>
						<div className="grid gap-2 sm:grid-cols-2">
							{fonts.map((font, i) => {
								const selected = fontIndex === i;
								return (
									<button
										type="button"
										key={font.name}
										disabled={locked}
										onClick={() => setFontIndex(i)}
										className={cn(
											"flex flex-col gap-1.5 rounded-lg border p-3 text-left transition-colors hover:bg-muted/50 disabled:opacity-60",
											selected &&
												"border-primary bg-primary/5 ring-1 ring-primary",
										)}
									>
										<span className="flex items-center gap-2 text-sm font-medium">
											{selected && (
												<CheckIcon className="size-3.5 text-primary" />
											)}
											{font.name}
										</span>
										<span
											className="truncate text-lg"
											style={{ fontFamily: font.heading }}
										>
											Headline sample
										</span>
										<span
											className="truncate text-xs"
											style={{ fontFamily: font.body }}
										>
											Body text sample for reading copy.
										</span>
										{font.rationale && (
											<span className="text-xs text-muted-foreground">
												{font.rationale}
											</span>
										)}
									</button>
								);
							})}
						</div>
					</section>
				)}
				<Button
					size="sm"
					className="w-fit"
					disabled={locked || !ready}
					onClick={apply}
				>
					{applied ? "Applied" : "Apply choices"}
				</Button>
			</CardContent>
		</Card>
	);
}
