"use client";

import { cn } from "cn";
import {
	AlertTriangleIcon,
	CheckCircle2Icon,
	ExternalLinkIcon,
	RotateCwIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

/**
 * Guards: pure so they can be unit-tested without a WindowProxy.
 *
 * The frame check is required, not paranoia: any window can `postMessage`
 * at this window, and a message that only claims `source: "tb-harness"`
 * would otherwise inject errors into (or resize) every mounted test drive.
 * An origin check cannot work here — the sandboxed preview has an opaque
 * origin — so the sender's WindowProxy identity is the only trustworthy
 * signal.
 */
export function isHarnessFrameEvent(
	event: MessageEvent,
	contentWindow: Window | null | undefined,
): boolean {
	return contentWindow != null && event.source === contentWindow;
}

/** Clamps a harness-reported document height to the card's bounds. */
export function clampHarnessHeight(height: number): number {
	if (!Number.isFinite(height)) return DEFAULT_HEIGHT;
	return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(height) + 32));
}

/** Renders one harness error entry as a single display line. */
export function harnessErrorLine(
	entry: HarnessError | undefined | null,
): string | null {
	if (!entry?.message) return null;
	return `${entry.kind === "console" ? "console.error: " : "Runtime error: "}${entry.message}`;
}

export type ComponentTestDriveProps = {
	name?: string;
	tagName?: string;
	previewUrl: string;
	/** true when the tool result came from save_component (vs test_component). */
	saved?: boolean;
	/** Server-side smoke verdict: ok (default) | skipped (with reason). */
	smokePassed?: boolean;
	smokeSkipped?: boolean;
	smokeReason?: string;
	/** Runtime errors reported by the tool result itself (pre-rendered list). */
	initialErrors?: string[];
	className?: string;
};

type HarnessError = { kind?: string; message?: string; stack?: string };

type HarnessMessage =
	| { source: "tb-harness"; type: "error"; error: HarnessError }
	| { source: "tb-harness"; type: "height"; height: number }
	| {
			source: "tb-harness";
			type: "ready";
			height: number;
			errors: number;
	  };

const MIN_HEIGHT = 240;
const MAX_HEIGHT = 720;
const DEFAULT_HEIGHT = 320;

/**
 * Interactive test drive for a `tb-*` component draft (KUK-926). The harness
 * document is served from R2 under the drafts route's `allow-scripts`
 * sandbox CSP and reports runtime errors + document height back to this
 * card via postMessage, so a component that breaks on interaction shows the
 * failure inline instead of the user discovering it on a published page.
 */
export function ComponentTestDrive({
	name,
	tagName,
	previewUrl,
	saved,
	smokePassed,
	smokeSkipped,
	smokeReason,
	initialErrors,
	className,
}: ComponentTestDriveProps) {
	const [height, setHeight] = useState<number>(DEFAULT_HEIGHT);
	const [errors, setErrors] = useState<string[]>(initialErrors ?? []);
	const [reloadKey, setReloadKey] = useState(0);
	const heightRef = useRef(DEFAULT_HEIGHT);
	const iframeRef = useRef<HTMLIFrameElement | null>(null);

	// Content-based signature: the derived props object (and its error
	// array) is recreated on every parent render, so effects must not
	// depend on its identity.
	const initialSignature = initialErrors?.join("\n") ?? "";

	// Reset per draft: a new previewUrl is a new component attempt. Adjust
	// during render (React's derived-state pattern) so the reset lands
	// before the first paint of the new frame.
	const lastUrlRef = useRef(previewUrl);
	if (lastUrlRef.current !== previewUrl) {
		lastUrlRef.current = previewUrl;
		heightRef.current = DEFAULT_HEIGHT;
		setHeight(DEFAULT_HEIGHT);
	}

	// Tool output can stream in after the card mounts (errors land before
	// or after the preview URL) — resync from the output, content-keyed.
	useEffect(() => {
		setErrors(initialSignature === "" ? [] : initialSignature.split("\n"));
	}, [initialSignature]);

	useEffect(() => {
		const onMessage = (event: MessageEvent) => {
			// Identity check FIRST: only messages from this card's own preview
			// frame count (any window can postMessage at us; the sandboxed
			// frame has an opaque origin so source identity is the only
			// trustworthy signal). `frame` survives reloads: React reuses the
			// same element for the same key, and a remount swaps the ref
			// together with this effect's closure.
			const frame = iframeRef.current;
			if (!isHarnessFrameEvent(event, frame?.contentWindow)) return;
			const data = event.data as HarnessMessage | undefined;
			if (data?.source !== "tb-harness") return;
			if (data.type === "height") {
				const next = clampHarnessHeight(data.height);
				if (Math.abs(next - heightRef.current) > 4) {
					heightRef.current = next;
					setHeight(next);
				}
				return;
			}
			if (data.type === "error") {
				const line = harnessErrorLine(data.error);
				if (line) {
					// Dedup: attribute-driven re-renders repeat failures.
					setErrors((prev) => (prev.includes(line) ? prev : [...prev, line]));
				}
			}
		};
		window.addEventListener("message", onMessage);
		return () => window.removeEventListener("message", onMessage);
	}, []);

	const title = saved
		? name
			? `Saved draft: ${name}`
			: "Saved draft"
		: name
			? `Test drive: ${name}`
			: "Component test drive";
	const failed = errors.length > 0;

	return (
		<Card
			className={cn(
				"w-full overflow-hidden border-border/50 bg-card/50 shadow-none",
				className,
			)}
		>
			<CardHeader className="flex-row items-start justify-between gap-3 pb-3">
				<div className="min-w-0">
					<CardTitle className="flex items-center gap-1.5 text-sm font-medium">
						{title}
						{tagName != null && tagName !== "" && (
							<code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-muted-foreground">
								{tagName}
							</code>
						)}
					</CardTitle>
					<CardDescription className="text-xs">
						{failed
							? "Runtime errors — interact with the preview to reproduce; report what breaks."
							: saved
								? "Interact with the draft — it reports errors back as they happen."
								: "Interactive preview, nothing saved yet — approve it to keep it."}
					</CardDescription>
				</div>
				<div className="flex shrink-0 items-center gap-1.5">
					{smokeSkipped ? (
						<span
							className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
							title={smokeReason ?? undefined}
						>
							check skipped
						</span>
					) : failed ? (
						<span className="inline-flex items-center gap-1 rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">
							<AlertTriangleIcon className="size-3" />
							runtime errors
						</span>
					) : (
						smokePassed !== false && (
							<span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600">
								<CheckCircle2Icon className="size-3" />
								runs clean
							</span>
						)
					)}
					<button
						type="button"
						onClick={() => setReloadKey((key) => key + 1)}
						className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
						aria-label="Reload preview"
						title="Reload preview"
					>
						<RotateCwIcon className="size-3.5" />
					</button>
					<a
						href={previewUrl}
						target="_blank"
						rel="noreferrer"
						className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
						aria-label="Open preview in a new tab"
						title="Open in new tab"
					>
						<ExternalLinkIcon className="size-3.5" />
					</a>
				</div>
			</CardHeader>
			<CardContent className="pt-0">
				{failed && (
					<div className="mb-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2.5">
						<p className="mb-1 text-[11px] font-medium text-destructive">
							{errors.length} runtime {errors.length === 1 ? "error" : "errors"}
						</p>
						<ul className="max-h-32 space-y-1 overflow-auto font-mono text-[11px] text-destructive/90">
							{errors.slice(0, 10).map((error) => (
								<li key={error} className="break-words">
									{error}
								</li>
							))}
						</ul>
					</div>
				)}
				<div className="overflow-hidden rounded-lg border bg-background">
					<iframe
						key={reloadKey}
						ref={iframeRef}
						title={name ? `Test drive of ${name}` : "Component test drive"}
						src={previewUrl}
						className="w-full"
						style={{ height }}
						sandbox="allow-scripts allow-forms allow-popups"
					/>
				</div>
			</CardContent>
		</Card>
	);
}
