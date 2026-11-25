import { Link } from "@tanstack/react-router";
import { Fragment } from "react";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

export type SiteBreadcrumb = {
	label: string;
	/** Omit for the current (non-linkable) crumb. */
	to?: string;
};

export function SiteHeader({
	title,
	breadcrumbs,
}: {
	title: string;
	breadcrumbs?: SiteBreadcrumb[];
}) {
	return (
		// Grows by the notch inset under viewport-fit=cover so the controls
		// clear the status bar; desktop (inset 0) stays exactly h-14.
		<header className="flex h-[calc(3.5rem+env(safe-area-inset-top))] shrink-0 items-center gap-2 border-b border-border px-4 pt-[env(safe-area-inset-top)] transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
			<div className="flex min-w-0 items-center gap-2">
				<SidebarTrigger className="-ml-1" />
				<Separator orientation="vertical" className="mr-2 h-4" />
				{breadcrumbs && breadcrumbs.length > 0 ? (
					<nav
						aria-label="Breadcrumb"
						className="flex min-w-0 items-center gap-1.5 text-sm"
					>
						{breadcrumbs.map((crumb, index) => {
							const isLast = index === breadcrumbs.length - 1;
							return (
								<Fragment key={`${crumb.label}|${crumb.to ?? "current"}`}>
									{index > 0 && (
										<span
											aria-hidden="true"
											className="text-muted-foreground/60"
										>
											/
										</span>
									)}
									{crumb.to && !isLast ? (
										<Link
											className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
											to={crumb.to}
										>
											{crumb.label}
										</Link>
									) : (
										<h1
											className={
												isLast
													? "truncate font-semibold"
													: "shrink-0 text-muted-foreground"
											}
										>
											{crumb.label}
										</h1>
									)}
								</Fragment>
							);
						})}
					</nav>
				) : (
					<h1 className="truncate text-sm font-semibold">{title}</h1>
				)}
			</div>
		</header>
	);
}
