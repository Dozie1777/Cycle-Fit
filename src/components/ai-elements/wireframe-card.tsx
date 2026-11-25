"use client";

import { cn } from "cn";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

export type WireframeCardProps = {
	name?: string;
	previewUrl: string;
	note?: string;
	className?: string;
};

/**
 * Inline rendering of a low-fidelity SVG wireframe the model sketched with
 * the `wireframe` tool. The sketch is served from R2 as image/svg+xml under
 * a scriptless CSP `sandbox`, so nothing executes in any context: the
 * inline <img> never runs SVG scripts by spec, and the full-size link opens
 * an opaque-origin document where scripts are blocked by the serving policy.
 */
export function WireframeCard({
	name,
	previewUrl,
	note,
	className,
}: WireframeCardProps) {
	return (
		<Card
			className={cn(
				"w-full overflow-hidden border-border/50 bg-card/50 shadow-none",
				className,
			)}
		>
			<CardHeader className="pb-3">
				<CardTitle className="text-sm font-medium">
					{name ? `Wireframe: ${name}` : "Wireframe"}
				</CardTitle>
				<CardDescription className="text-xs">
					{note ?? "Low-fidelity concept — layout and content placement only."}
				</CardDescription>
			</CardHeader>
			<CardContent className="pt-0">
				<div className="overflow-hidden rounded-lg border bg-background">
					<a
						href={previewUrl}
						target="_blank"
						rel="noreferrer"
						className="block"
					>
						<img
							src={previewUrl}
							alt={name ? `Wireframe sketch of ${name}` : "Wireframe sketch"}
							className="w-full"
							loading="lazy"
						/>
					</a>
				</div>
			</CardContent>
		</Card>
	);
}
