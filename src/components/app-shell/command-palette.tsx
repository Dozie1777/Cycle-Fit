import { useNavigate } from "@tanstack/react-router";
import {
	FolderOpenIcon,
	MegaphoneIcon,
	PaletteIcon,
	PlusIcon,
	SparklesIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { relativeTime } from "@/client/formatting";
import { useCampaigns, useDesigns, useProjects } from "@/client/queries";
import { emitUiEvent } from "@/client/ui-bus";
import {
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";

/**
 * Global ⌘K command palette (KUK-916, journey-review Option C): jump to any
 * project, design, or campaign, or trigger a create action — without
 * browsing the islands. Data comes from the existing TanStack queries, so
 * no new server endpoint is needed; navigation honors the KUK-903
 * ?from= return-to-origin convention.
 */
export function CommandPalette() {
	const navigate = useNavigate();
	const [open, setOpen] = useState(false);
	const { data: projects } = useProjects();
	const { data: designs } = useDesigns();
	const { data: campaigns } = useCampaigns();

	useEffect(() => {
		// Effects don't run during SSR, but tests run in a Node env where
		// effects do — bail out when there's no window to listen on.
		if (typeof window === "undefined") return;
		function onKeyDown(event: KeyboardEvent) {
			if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
				event.preventDefault();
				setOpen((current) => !current);
			}
		}
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);

	function close() {
		setOpen(false);
	}

	function go(href: string) {
		close();
		// `href` accepts arbitrary paths, matching the ?from= pattern.
		void navigate({ href });
	}

	function currentPath(): string {
		return window.location.pathname;
	}

	const projectRows = (projects ?? []).map((project) => ({
		key: `project-${project.id}`,
		value: `${project.name} project`,
		label: project.name,
		meta: `${project.designCount} design${project.designCount === 1 ? "" : "s"} · ${project.campaignCount} campaign${project.campaignCount === 1 ? "" : "s"}`,
		href: `/projects/${project.id}`,
	}));

	const designRows = (designs ?? []).map((design) => {
		const parent = projects?.find((p) => p.id === design.projectId);
		return {
			key: `design-${design.id}`,
			value: `${design.prompt} ${parent?.name ?? ""} design`,
			label: design.prompt,
			meta: `${parent ? `in ${parent.name} · ` : ""}${design.status} · ${relativeTime(design.createdAt)}`,
			href: `/studio/${design.id}?from=${encodeURIComponent(currentPath())}`,
		};
	});

	const campaignRows = (campaigns ?? []).map((campaign) => {
		const parent = projects?.find((p) => p.id === campaign.projectId);
		return {
			key: `campaign-${campaign.id}`,
			value: `${campaign.name} ${parent?.name ?? ""} campaign`,
			label: campaign.name,
			meta: `${parent ? `in ${parent.name} · ` : ""}${campaign.status}`,
			href: `/campaigns/${campaign.id}?from=${encodeURIComponent(currentPath())}`,
		};
	});

	return (
		<CommandDialog
			open={open}
			onOpenChange={setOpen}
			title="Command palette"
			description="Jump to a project, design, campaign, or action"
		>
			<CommandInput placeholder="Jump to a project, design, campaign, or action…" />
			<CommandList>
				<CommandEmpty>Nothing matches — try a different term.</CommandEmpty>
				{projectRows.length > 0 && (
					<CommandGroup heading="Projects">
						{projectRows.map((row) => (
							<CommandItem
								key={row.key}
								onSelect={() => go(row.href)}
								value={row.value}
							>
								<FolderOpenIcon aria-hidden="true" />
								<span className="truncate">{row.label}</span>
								<span className="ml-auto shrink-0 text-xs text-muted-foreground">
									{row.meta}
								</span>
							</CommandItem>
						))}
					</CommandGroup>
				)}
				{designRows.length > 0 && (
					<CommandGroup heading="Designs">
						{designRows.map((row) => (
							<CommandItem
								key={row.key}
								onSelect={() => go(row.href)}
								value={row.value}
							>
								<PaletteIcon aria-hidden="true" />
								<span className="truncate">{row.label}</span>
								<span className="ml-auto shrink-0 text-xs text-muted-foreground">
									{row.meta}
								</span>
							</CommandItem>
						))}
					</CommandGroup>
				)}
				{campaignRows.length > 0 && (
					<CommandGroup heading="Campaigns">
						{campaignRows.map((row) => (
							<CommandItem
								key={row.key}
								onSelect={() => go(row.href)}
								value={row.value}
							>
								<MegaphoneIcon aria-hidden="true" />
								<span className="truncate">{row.label}</span>
								<span className="ml-auto shrink-0 text-xs text-muted-foreground">
									{row.meta}
								</span>
							</CommandItem>
						))}
					</CommandGroup>
				)}
				<CommandGroup heading="Actions">
					<CommandItem
						onSelect={async () => {
							close();
							// Emit only after the projects page has mounted and
							// subscribed — emitting before navigate loses the event.
							await navigate({ href: "/projects" });
							emitUiEvent("new-project");
						}}
						value="new project create"
					>
						<PlusIcon aria-hidden="true" />
						New project
					</CommandItem>
					<CommandItem
						onSelect={() => go("/projects/designs")}
						value="new design create brief"
					>
						<PaletteIcon aria-hidden="true" />
						New design
					</CommandItem>
					<CommandItem
						onSelect={() => go("/campaigns")}
						value="new campaign create"
					>
						<MegaphoneIcon aria-hidden="true" />
						New campaign
					</CommandItem>
					<CommandItem
						onSelect={() => go("/skills")}
						value="skills manage import"
					>
						<SparklesIcon aria-hidden="true" />
						Manage skills
					</CommandItem>
				</CommandGroup>
			</CommandList>
		</CommandDialog>
	);
}
