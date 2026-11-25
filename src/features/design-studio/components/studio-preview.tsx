import { Monitor, Smartphone, Tablet } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DesignDetail } from "@/client/api-types";
import { cn } from "@/client/utils";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	applyPreviewMessage,
	postBlockHighlight,
	useBlockSelection,
} from "./selection-bridge";

const VIEWPORTS = [
	{ label: "Desktop", width: 1440, icon: Monitor },
	{ label: "Tablet", width: 768, icon: Tablet },
	{ label: "Mobile", width: 390, icon: Smartphone },
] as const;

const ZOOM_OPTIONS = [
	{ label: "Fit", value: "fit" },
	{ label: "50%", value: "0.5" },
	{ label: "75%", value: "0.75" },
	{ label: "100%", value: "1" },
	{ label: "125%", value: "1.25" },
	{ label: "150%", value: "1.5" },
] as const;

export function designRevision(
	detail: Pick<DesignDetail, "files" | "liveTurnId"> | null | undefined,
): string | undefined {
	if (!detail) return undefined;
	const liveTimestamp = detail.liveTurnId
		? (detail.files.find(
				(file) => file.path === `turns/${detail.liveTurnId}/index.html`,
			)?.lastModified ?? "")
		: (detail.files.find((file) => file.path === "index.html")?.lastModified ??
			"");
	const liveRevision = detail.liveTurnId
		? `${detail.liveTurnId}:${liveTimestamp}`
		: liveTimestamp;
	const latestVersion = detail.files.reduce((latest, file) => {
		const match = /^versions\/(\d+)\/index\.html$/.exec(file.path);
		return match ? Math.max(latest, Number(match[1])) : latest;
	}, 0);
	return latestVersion > 0
		? `${latestVersion}:${liveRevision}`
		: liveRevision || undefined;
}

export function selectableDesignPreviewUrl(
	projectId: string,
	revision?: string,
): string {
	return `/designs/${projectId}/site?selectable=1&revision=${encodeURIComponent(revision ?? "")}`;
}

export function StudioPreview({
	projectId,
	hasIndex,
	revision,
	onSelectSection,
}: {
	projectId: string;
	hasIndex: boolean;
	revision?: string;
	onSelectSection: (section: string | null) => void;
}) {
	const [viewport, setViewport] =
		useState<(typeof VIEWPORTS)[number]["width"]>(1440);
	const [zoom, setZoom] =
		useState<(typeof ZOOM_OPTIONS)[number]["value"]>("fit");
	const containerRef = useRef<HTMLDivElement>(null);
	const frameRef = useRef<HTMLIFrameElement>(null);
	const [containerWidth, setContainerWidth] = useState(0);
	const autoViewportPicked = useRef(false);
	// KUK-929 selection bridge: clicks inside the iframe (on elements stamped
	// with data-block-id) select the PageBlock here; the inspector's selection
	// is posted back into the frame so it scrolls to and outlines the element.
	const { selectedBlockId, selectBlock } = useBlockSelection();

	const selected = VIEWPORTS.find((v) => v.width === viewport) ?? VIEWPORTS[0];

	useEffect(() => {
		const el = containerRef.current;
		if (!el) return;

		const update = () => setContainerWidth(el.clientWidth);
		update();

		const observer = new ResizeObserver(update);
		observer.observe(el);
		window.addEventListener("resize", update);
		return () => {
			observer.disconnect();
			window.removeEventListener("resize", update);
		};
	}, []);

	// Pick the largest of the three viewports that still fits on first
	// measurement, so phones don't boot a 1440px canvas squeezed to ~0.23×
	// (F6). One-shot: after this the user's explicit choice wins.
	useEffect(() => {
		if (autoViewportPicked.current || containerWidth === 0) return;
		autoViewportPicked.current = true;
		const available = containerWidth - 48; // p-6 padding on both sides
		if (available >= 1440) setViewport(1440);
		else if (available >= 768) setViewport(768);
		else setViewport(390);
	}, [containerWidth]);

	useEffect(() => {
		const handleSelection = (event: MessageEvent) => {
			if (event.source !== frameRef.current?.contentWindow) return;
			applyPreviewMessage(event.data, {
				onSection: onSelectSection,
				onBlock: selectBlock,
			});
		};
		window.addEventListener("message", handleSelection);
		return () => window.removeEventListener("message", handleSelection);
	}, [onSelectSection, selectBlock]);

	// Inspector → preview: mirror the selection into the iframe (the injected
	// bridge scrolls to and outlines the block). The frame reloads on revision
	// changes (keyed iframe) and re-posts via onLoad, since a fresh document
	// starts un-highlighted. Stale ids are ignored inside the bridge.
	const sendHighlight = useCallback(() => {
		postBlockHighlight(frameRef.current?.contentWindow, selectedBlockId);
	}, [selectedBlockId]);
	useEffect(() => {
		sendHighlight();
	}, [sendHighlight]);

	const viewportWidth =
		selected.width > 390 ? Math.min(selected.width, 1440) : 390;
	const scale =
		zoom === "fit"
			? Math.min(1, (containerWidth - 48) / viewportWidth)
			: Number(zoom);

	return (
		<div className="flex h-full flex-col bg-background">
			<div className="flex h-12 flex-shrink-0 items-center justify-center gap-2 border-b border-border">
				<div className="flex items-center gap-2">
					{VIEWPORTS.map((v) => {
						const Icon = v.icon;
						return (
							<Button
								key={v.label}
								type="button"
								variant={viewport === v.width ? "secondary" : "ghost"}
								size="sm"
								onClick={() => setViewport(v.width)}
								className="gap-1.5"
								aria-label={`${v.label} preview viewport`}
							>
								<Icon className="size-4" />
								<span className="hidden sm:inline">{v.label}</span>
							</Button>
						);
					})}

					<div className="mx-2 h-4 w-px bg-border" />
				</div>

				<Select value={zoom} onValueChange={(value) => setZoom(value ?? "fit")}>
					<SelectTrigger className="w-24" size="sm" aria-label="Preview zoom">
						<SelectValue placeholder="Zoom" />
					</SelectTrigger>
					<SelectContent>
						{ZOOM_OPTIONS.map((z) => (
							<SelectItem key={z.value} value={z.value}>
								{z.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			<div
				ref={containerRef}
				className="flex flex-1 items-start justify-center overflow-auto p-6"
			>
				{hasIndex ? (
					<div
						className={cn(
							"overflow-hidden rounded-lg border border-border bg-white shadow-xl",
							selected.width <= 390 && "phone-shell",
						)}
						style={{
							width: viewportWidth,
							height: "100%",
							transform: `scale(${scale})`,
							transformOrigin: "top center",
						}}
					>
						{selected.width <= 390 && <div className="phone-notch" />}
						<iframe
							key={revision}
							ref={frameRef}
							src={selectableDesignPreviewUrl(projectId, revision)}
							title="design preview"
							onLoad={sendHighlight}
							className={cn(
								"h-full w-full border-0",
								selected.width <= 390 && "phone-screen",
							)}
							style={
								selected.width > 390
									? { width: Math.min(selected.width, 1440) }
									: { width: 390 }
							}
						/>
					</div>
				) : (
					<div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground">
						<Monitor className="size-10 opacity-20" />
						<p className="max-w-xs text-sm">
							Nothing published yet. The preview fills in once the designer
							publishes the page.
						</p>
					</div>
				)}
			</div>
		</div>
	);
}
