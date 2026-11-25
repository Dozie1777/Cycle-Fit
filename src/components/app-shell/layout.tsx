import { useRouteContext, useRouterState } from "@tanstack/react-router";
import type * as React from "react";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/toast";
import { AppSidebar } from "./app-sidebar";
import { CommandPalette } from "./command-palette";
import { type SiteBreadcrumb, SiteHeader } from "./site-header";

export type Page =
	| "designs"
	| "campaigns"
	| "projects"
	| "skills"
	| "agents"
	| "admins"
	| "chat";

function useActivePage(): Page {
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});
	if (pathname.startsWith("/agents")) return "agents";
	if (pathname.startsWith("/admins")) return "admins";
	if (pathname.startsWith("/skills")) return "skills";
	if (pathname.startsWith("/chat")) return "chat";
	// Designs live under the projects section — check it before the
	// generic projects prefix.
	if (pathname.startsWith("/projects/designs")) return "designs";
	// Campaigns have their own hub outside the projects prefix.
	if (pathname.startsWith("/campaigns")) return "campaigns";
	if (pathname.startsWith("/projects")) return "projects";
	return "designs";
}

export function AppLayout({
	children,
	title,
	breadcrumbs,
}: {
	children: React.ReactNode;
	title: string;
	/** Optional breadcrumb trail; when set it replaces the plain title. */
	breadcrumbs?: SiteBreadcrumb[];
}) {
	const { session } = useRouteContext({ from: "/_authenticated" });
	const activePage = useActivePage();

	return (
		<SidebarProvider>
			<AppSidebar activePage={activePage} user={session.user} />
			<SidebarInset className="min-w-0">
				<SiteHeader breadcrumbs={breadcrumbs} title={title} />
				<main className="p-3 sm:p-4 md:p-6">{children}</main>
				<Toaster />
				<CommandPalette />
			</SidebarInset>
		</SidebarProvider>
	);
}
