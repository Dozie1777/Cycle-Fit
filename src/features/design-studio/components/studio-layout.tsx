"use client";

import { useEffect, useRef, useState } from "react";
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";
import type { Design, DesignDetail } from "@/client/api-types";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ElementChatPanel, type OpenElementChat } from "./element-chat-panel";
import { StudioChat } from "./studio-chat";
import { StudioInspector } from "./studio-inspector";
import { designRevision, StudioPreview } from "./studio-preview";
import { StudioTopBar } from "./studio-top-bar";

/**
 * Client-only media query. Unlike `useMediaQuery`, this reads the live value
 * synchronously on first render so the studio layout doesn't render a
 * mobile-first snapshot and then flip to desktop after hydration. That flip
 * was remounting the resizable panels (and therefore the chat) on every
 * studio page load.
 */
function useIsDesktop() {
	const [matches, setMatches] = useState(() =>
		typeof window !== "undefined"
			? window.matchMedia("(min-width: 1024px)").matches
			: false,
	);
	useEffect(() => {
		const media = window.matchMedia("(min-width: 1024px)");
		const handler = (event: MediaQueryListEvent) => setMatches(event.matches);
		media.addEventListener("change", handler);
		return () => media.removeEventListener("change", handler);
	}, []);
	return matches;
}

export function StudioLayout({
	project,
	detail,
	onBack,
	onTurnSettled,
	projectLink,
	onOpenElementChat,
	elementChat,
	onCloseElementChat,
}: {
	project: Design;
	detail: DesignDetail | null;
	onBack: () => void;
	onTurnSettled: () => void;
	/** Breadcrumb target when the design is filed into a container. */
	projectLink?: { id: string; name: string } | null;
	/** Orchestrator handoff (KUK-944): mounts the element-chat panel. */
	onOpenElementChat?: (session: OpenElementChat) => void;
	/** The open element-chat session; null keeps the panel empty. */
	elementChat: OpenElementChat | null;
	onCloseElementChat: () => void;
}) {
	const [inspectorOpen, setInspectorOpen] = useState(false);
	const [selectedSection, setSelectedSection] = useState<string | null>(null);
	const [mobileTab, setMobileTab] = useState<"preview" | "chat" | "element">(
		"preview",
	);
	const isDesktop = useIsDesktop();
	const chatPanelRef = usePanelRef();
	const previewPanelRef = usePanelRef();
	const inspectorPanelRef = usePanelRef();
	const elementPanelRef = usePanelRef();
	const desktopSizesRef = useRef({
		chat: 24,
		preview: 48,
		inspector: 14,
		element: 14,
	});

	useEffect(() => {
		const chatPanel = chatPanelRef.current;
		const previewPanel = previewPanelRef.current;
		const inspectorPanel = inspectorPanelRef.current;
		const elementPanel = elementPanelRef.current;
		if (isDesktop) {
			chatPanel?.expand();
			previewPanel?.expand();
			inspectorPanel?.expand();
			elementPanel?.expand();
			chatPanel?.resize(`${desktopSizesRef.current.chat}%`);
			previewPanel?.resize(`${desktopSizesRef.current.preview}%`);
			inspectorPanel?.resize(`${desktopSizesRef.current.inspector}%`);
			elementPanel?.resize(`${desktopSizesRef.current.element}%`);
			return;
		}
		chatPanel?.collapse();
		previewPanel?.collapse();
		inspectorPanel?.collapse();
		elementPanel?.collapse();
		const activePanel =
			mobileTab === "chat"
				? chatPanel
				: mobileTab === "element"
					? elementPanel
					: previewPanel;
		activePanel?.expand();
		activePanel?.resize("100%");
	}, [
		chatPanelRef,
		inspectorPanelRef,
		isDesktop,
		mobileTab,
		previewPanelRef,
		elementPanelRef,
	]);

	// Opening a session reveals the element panel: on mobile the tab must
	// switch to Element and the inspector sheet must close, or the open
	// action appears to do nothing behind the current view (KUK-945 review).
	useEffect(() => {
		if (!elementChat) return;
		if (!isDesktop) setMobileTab("element");
		setInspectorOpen(false);
	}, [elementChat, isDesktop]);

	return (
		// Safe-area insets keep the fixed studio clear of the notch (top) and
		// the home indicator (bottom, where the chat composer sits).
		<div className="fixed inset-0 z-50 flex flex-col bg-background pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
			<StudioTopBar
				project={project}
				detail={detail}
				onBack={onBack}
				projectLink={projectLink}
				rightSlot={
					<div className="lg:hidden">
						<Sheet open={inspectorOpen} onOpenChange={setInspectorOpen}>
							<SheetTrigger
								render={<Button type="button" variant="outline" size="sm" />}
							>
								Inspector
							</SheetTrigger>
							<SheetContent
								side="right"
								className="w-[min(85vw,320px)]! p-0 sm:w-[280px]!"
							>
								<StudioInspector
									project={project}
									detail={detail}
									className="p-4"
								/>
							</SheetContent>
						</Sheet>
					</div>
				}
			/>
			<div className="flex min-h-0 min-w-0 flex-1 flex-col">
				{!isDesktop && (
					<Tabs
						value={mobileTab}
						onValueChange={setMobileTab}
						className="shrink-0 gap-0"
					>
						<TabsList className="mx-4 mt-3 w-auto justify-start">
							<TabsTrigger value="preview">Preview</TabsTrigger>
							<TabsTrigger value="chat">Chat</TabsTrigger>
							<TabsTrigger value="element">Element</TabsTrigger>
						</TabsList>
					</Tabs>
				)}
				<Group
					orientation={isDesktop ? "horizontal" : "vertical"}
					className="flex min-h-0 min-w-0 flex-1"
				>
					<Panel
						panelRef={chatPanelRef}
						collapsible={!isDesktop}
						collapsedSize="0"
						defaultSize="24"
						minSize="20"
						maxSize={isDesktop ? "45" : "100"}
						onResize={(size) => {
							if (isDesktop) desktopSizesRef.current.chat = size.asPercentage;
						}}
						className={
							isDesktop
								? "min-w-0 border-r border-border bg-[#151519]"
								: mobileTab === "chat"
									? "min-w-0 flex-1 bg-[#151519]"
									: "hidden"
						}
					>
						<StudioChat
							project={project}
							onTurnSettled={onTurnSettled}
							selectedSection={selectedSection}
							onClearSection={() => setSelectedSection(null)}
							onOpenElementChat={onOpenElementChat}
						/>
					</Panel>
					<Separator
						className={
							isDesktop
								? "group relative w-px cursor-col-resize bg-border hover:bg-muted-foreground/50 focus-visible:bg-muted-foreground/50 focus-visible:outline-none transition-colors"
								: "hidden"
						}
					>
						<div className="absolute left-1/2 top-1/2 h-8 w-4 -translate-x-1/2 -translate-y-1/2" />
						<div className="absolute left-1/2 top-1/2 h-8 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground/20 transition-colors group-hover:bg-muted-foreground/50" />
					</Separator>
					<Panel
						panelRef={previewPanelRef}
						collapsible={!isDesktop}
						collapsedSize="0"
						defaultSize="48"
						minSize="30"
						onResize={(size) => {
							if (isDesktop)
								desktopSizesRef.current.preview = size.asPercentage;
						}}
						className={
							isDesktop
								? "min-w-0"
								: mobileTab === "preview"
									? "min-w-0 flex-1"
									: "hidden"
						}
					>
						<StudioPreview
							projectId={project.id}
							hasIndex={detail?.hasIndex ?? false}
							revision={designRevision(detail)}
							onSelectSection={setSelectedSection}
						/>
					</Panel>
					<Separator
						className={
							isDesktop
								? "group relative w-px cursor-col-resize bg-border hover:bg-muted-foreground/50 focus-visible:bg-muted-foreground/50 focus-visible:outline-none transition-colors"
								: "hidden"
						}
					>
						<div className="absolute left-1/2 top-1/2 h-8 w-4 -translate-x-1/2 -translate-y-1/2" />
						<div className="absolute left-1/2 top-1/2 h-8 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground/20 transition-colors group-hover:bg-muted-foreground/50" />
					</Separator>
					<Panel
						panelRef={inspectorPanelRef}
						collapsible={!isDesktop}
						collapsedSize="0"
						defaultSize="14"
						minSize="12"
						maxSize="30"
						onResize={(size) => {
							if (isDesktop)
								desktopSizesRef.current.inspector = size.asPercentage;
						}}
						className={
							isDesktop
								? "min-w-0 border-l border-border bg-background"
								: "hidden"
						}
					>
						<StudioInspector
							project={project}
							detail={detail}
							onOpenElementChat={onOpenElementChat}
						/>
					</Panel>
					<Separator
						className={
							isDesktop
								? "group relative w-px cursor-col-resize bg-border hover:bg-muted-foreground/50 focus-visible:bg-muted-foreground/50 focus-visible:outline-none transition-colors"
								: "hidden"
						}
					>
						<div className="absolute left-1/2 top-1/2 h-8 w-4 -translate-x-1/2 -translate-y-1/2" />
						<div className="absolute left-1/2 top-1/2 h-8 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground/20 transition-colors group-hover:bg-muted-foreground/50" />
					</Separator>
					{/* Element chat panel (KUK-945): the focused chat for one
					    design element — opened from the orchestrator's
					    open_element_chat affordance or a building-block row's
					    Chat action. Empty placeholder until a session opens. */}
					<Panel
						panelRef={elementPanelRef}
						collapsible={!isDesktop}
						collapsedSize="0"
						defaultSize="14"
						minSize="12"
						maxSize={isDesktop ? "45" : "100"}
						onResize={(size) => {
							if (isDesktop)
								desktopSizesRef.current.element = size.asPercentage;
						}}
						className={
							isDesktop
								? "min-w-0 border-l border-border bg-background"
								: mobileTab === "element"
									? "min-w-0 flex-1 bg-background"
									: "hidden"
						}
					>
						{elementChat && project.projectId ? (
							<ElementChatPanel
								// Keyed by session: mount-only state (history cache seed,
								// bootstrapped ref, transport) must reset when switching
								// directly between two element chats — an unkeyed panel would
								// keep the previous chat's transcript/transport.
								key={elementChat.elementChatId}
								projectId={project.projectId}
								session={elementChat}
								onClose={onCloseElementChat}
							/>
						) : (
							<div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-xs text-muted-foreground">
								<p className="text-sm font-medium text-foreground">
									Element chat
								</p>
								<p>
									Ask the designer to open an element's chat, or use the Chat
									action on a building block.
								</p>
							</div>
						)}
					</Panel>
				</Group>
			</div>
		</div>
	);
}
