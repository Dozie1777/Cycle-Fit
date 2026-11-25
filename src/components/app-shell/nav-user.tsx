"use client";

import { useNavigate, useRouter } from "@tanstack/react-router";
import { LogOutIcon } from "lucide-react";
import { authClient } from "@/client/auth-client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	useSidebar,
} from "@/components/ui/sidebar";

function initialsFromEmail(email: string): string {
	return email
		.split("@")[0]
		.split(/[._-]/)
		.map((part) => part.charAt(0).toUpperCase())
		.slice(0, 2)
		.join("");
}

export function NavUser({
	user,
}: {
	user: {
		email: string;
		name?: string;
	};
}) {
	const { isMobile } = useSidebar();
	const navigate = useNavigate();
	const router = useRouter();
	const displayName = user.name || user.email.split("@")[0];

	async function signOut() {
		await authClient.signOut();
		await router.invalidate();
		await navigate({ to: "/login" });
	}

	return (
		<SidebarMenu>
			<SidebarMenuItem>
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<SidebarMenuButton
								size="lg"
								className="aria-expanded:bg-sidebar-accent"
							/>
						}
					>
						<Avatar className="size-8 rounded-lg">
							<AvatarFallback className="rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
								{initialsFromEmail(user.email) || "A"}
							</AvatarFallback>
						</Avatar>
						<div className="grid flex-1 text-left text-sm leading-tight">
							<span className="truncate font-medium">{displayName}</span>
							<span className="truncate text-xs">{user.email}</span>
						</div>
					</DropdownMenuTrigger>
					<DropdownMenuContent
						className="w-fit min-w-56"
						side={isMobile ? "bottom" : "right"}
						align="end"
						sideOffset={4}
					>
						<DropdownMenuGroup>
							<DropdownMenuLabel className="p-0 font-normal">
								<div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
									<Avatar className="size-8 rounded-lg">
										<AvatarFallback className="rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
											{initialsFromEmail(user.email) || "A"}
										</AvatarFallback>
									</Avatar>
									<div className="grid flex-1 text-left text-sm leading-tight">
										<span className="truncate font-medium">{displayName}</span>
										<span className="truncate text-xs">{user.email}</span>
									</div>
								</div>
							</DropdownMenuLabel>
							<DropdownMenuSeparator />
							<DropdownMenuItem onClick={() => void signOut()}>
								<LogOutIcon />
								Sign out
							</DropdownMenuItem>
						</DropdownMenuGroup>
					</DropdownMenuContent>
				</DropdownMenu>
			</SidebarMenuItem>
		</SidebarMenu>
	);
}
