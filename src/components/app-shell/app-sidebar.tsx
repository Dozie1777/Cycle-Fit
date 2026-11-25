"use client";

import { Link } from "@tanstack/react-router";
import {
	BotIcon,
	FolderOpenIcon,
	MegaphoneIcon,
	MessageSquareIcon,
	PaletteIcon,
	ShieldIcon,
	SparklesIcon,
} from "lucide-react";
import type * as React from "react";
import { useProjects } from "@/client/queries";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuSub,
	SidebarMenuSubButton,
	SidebarRail,
	useSidebar,
} from "@/components/ui/sidebar";
import type { Page } from "./layout";
import { NavUser } from "./nav-user";

/** Sidebar count pill (KUK-911) — muted, hidden while collapsed to icons. */
function CountPill({ value }: { value: number }) {
	if (value <= 0) return null;
	return (
		<span className="ml-auto rounded-full border border-sidebar-border bg-sidebar-accent px-1.5 text-[11px] leading-4 text-sidebar-foreground/60 group-data-[collapsible=icon]:hidden">
			{value}
		</span>
	);
}

const NAV_ITEMS: {
	page: Page;
	title: string;
	icon: React.ReactNode;
	to: "/projects" | "/agents" | "/skills" | "/admins" | "/chat";
}[] = [
	{
		page: "projects",
		title: "Projects",
		icon: <FolderOpenIcon />,
		to: "/projects",
	},
	{
		page: "chat",
		title: "Chat",
		icon: <MessageSquareIcon />,
		to: "/chat",
	},
	{
		page: "agents",
		title: "Agents",
		icon: <BotIcon />,
		to: "/agents",
	},
	{
		page: "skills",
		title: "Skills",
		icon: <SparklesIcon />,
		to: "/skills",
	},
	{
		page: "admins",
		title: "Admins",
		icon: <ShieldIcon />,
		to: "/admins",
	},
];

export function AppSidebar({
	activePage,
	user,
	...props
}: {
	activePage: Page;
	user?: { email: string; name?: string };
} & React.ComponentProps<typeof Sidebar>) {
	// Mobile: the sheet overlays the page — navigating must close it (F15).
	const { isMobile, setOpenMobile } = useSidebar();
	// Sub-entity counts from the projects query (KUK-911): the sidebar
	// should say what the workspace contains without opening anything.
	const { data: projects } = useProjects();
	const projectCount = projects?.length ?? 0;
	const designCount =
		projects?.reduce((sum, project) => sum + project.designCount, 0) ?? 0;
	const campaignCount =
		projects?.reduce((sum, project) => sum + project.campaignCount, 0) ?? 0;
	// Recent projects (KUK-916): the query is createdAt-desc already, so the
	// first three rows are the freshest containers.
	const recentProjects = (projects ?? []).slice(0, 3);

	const closeOnMobile = () => {
		if (isMobile) setOpenMobile(false);
	};

	return (
		<Sidebar collapsible="icon" {...props}>
			<SidebarHeader>
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton
							size="lg"
							render={<Link to="/projects/designs" />}
						>
							<div className="flex items-center gap-3 overflow-hidden">
								<div className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#2dd4bf] to-[#0ea5e9] text-[#0c0c0f] font-bold">
									A
								</div>
								<span className="truncate font-semibold text-sidebar-foreground">
									Aurora
								</span>
							</div>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarHeader>
			<SidebarContent>
				<SidebarMenu>
					{NAV_ITEMS.map((item) => (
						<SidebarMenuItem key={item.page}>
							<SidebarMenuButton
								tooltip={item.title}
								isActive={activePage === item.page}
								render={<Link to={item.to} />}
								onClick={closeOnMobile}
							>
								{item.icon}
								<span>{item.title}</span>
								{item.page === "projects" && <CountPill value={projectCount} />}
							</SidebarMenuButton>
							{item.page === "projects" && (
								// Designs and campaigns both live inside the projects
								// section: every design belongs to a project (or is
								// unfiled), and every campaign is always filed in one.
								<SidebarMenuSub>
									<li>
										<SidebarMenuSubButton
											render={
												<Link to="/projects/designs" onClick={closeOnMobile} />
											}
											isActive={activePage === "designs"}
										>
											<PaletteIcon className="size-4" />
											<span>All designs</span>
											<CountPill value={designCount} />
										</SidebarMenuSubButton>
									</li>
									<li>
										<SidebarMenuSubButton
											render={<Link to="/campaigns" onClick={closeOnMobile} />}
											isActive={activePage === "campaigns"}
										>
											<MegaphoneIcon className="size-4" />
											<span>Campaigns</span>
											<CountPill value={campaignCount} />
										</SidebarMenuSubButton>
									</li>
								</SidebarMenuSub>
							)}
							{item.page === "projects" && recentProjects.length > 0 && (
								// Recent projects (KUK-916): the freshest containers one
								// click away, without opening the projects list first.
								<SidebarMenuSub>
									<li
										aria-hidden="true"
										className="px-2 pt-1 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/50"
									>
										Recent projects
									</li>
									{recentProjects.map((project) => (
										<li key={project.id}>
											<SidebarMenuSubButton
												render={
													<Link
														onClick={closeOnMobile}
														to="/projects/$id"
														params={{ id: project.id }}
													/>
												}
											>
												<FolderOpenIcon className="size-4" />
												<span className="truncate">{project.name}</span>
												<CountPill value={project.designCount} />
											</SidebarMenuSubButton>
										</li>
									))}
								</SidebarMenuSub>
							)}
						</SidebarMenuItem>
					))}
				</SidebarMenu>
			</SidebarContent>
			<SidebarFooter>
				<NavUser user={user ?? { email: "" }} />
			</SidebarFooter>
			<SidebarRail />
		</Sidebar>
	);
}
