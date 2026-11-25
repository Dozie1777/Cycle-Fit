"use client";

import { cn } from "cn";
import { CodeIcon, EyeIcon } from "lucide-react";
import { useState } from "react";
import { CodeBlock } from "@/components/ai-elements/code-block";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

export type DesignProposalProps = {
	name?: string;
	html: string;
	previewUrl: string;
	className?: string;
};

export function DesignProposal({
	name,
	html,
	previewUrl,
	className,
}: DesignProposalProps) {
	const [mode, setMode] = useState<"preview" | "code">("preview");

	return (
		<Card
			className={cn(
				"w-full overflow-hidden border-border/50 bg-card/50 shadow-none",
				className,
			)}
		>
			<CardHeader className="flex-row items-center justify-between gap-4 pb-3">
				<div className="min-w-0">
					<CardTitle className="text-sm font-medium">
						{name ? `Proposed design: ${name}` : "Proposed design"}
					</CardTitle>
					<CardDescription className="text-xs">
						Review the rendered preview or the HTML source.
					</CardDescription>
				</div>
				<div className="flex shrink-0 items-center gap-1 rounded-lg border bg-muted/30 p-0.5">
					<Button
						size="xs"
						variant={mode === "preview" ? "secondary" : "ghost"}
						onClick={() => setMode("preview")}
						aria-pressed={mode === "preview"}
					>
						<EyeIcon className="size-3.5" />
						<span>Preview</span>
					</Button>
					<Button
						size="xs"
						variant={mode === "code" ? "secondary" : "ghost"}
						onClick={() => setMode("code")}
						aria-pressed={mode === "code"}
					>
						<CodeIcon className="size-3.5" />
						<span>Code</span>
					</Button>
				</div>
			</CardHeader>
			<CardContent className="pt-0">
				{mode === "preview" ? (
					<div className="overflow-hidden rounded-lg border bg-background">
						<iframe
							title={name ? `Preview of ${name}` : "Design preview"}
							src={previewUrl}
							className="h-96 w-full"
							sandbox="allow-scripts"
						/>
					</div>
				) : (
					<div className="max-h-96 overflow-auto rounded-lg border">
						<CodeBlock
							code={html}
							language="html"
							showLineNumbers
							className="m-0 rounded-none border-0"
						/>
					</div>
				)}
			</CardContent>
		</Card>
	);
}
