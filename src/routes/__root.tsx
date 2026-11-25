import type { QueryClient } from "@tanstack/react-query";
import { QueryClientProvider } from "@tanstack/react-query";
import {
	createRootRouteWithContext,
	HeadContent,
	Scripts,
	useNavigate,
} from "@tanstack/react-router";
import { type ReactNode, useEffect } from "react";
import { mapLegacyAdminHash } from "@/client/legacy-routes";
import RivetActorProvider from "@/client/rivet-actor-context";
import "../styles.css";

export const Route = createRootRouteWithContext<{
	queryClient: QueryClient;
}>()({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			// viewport-fit=cover lets env(safe-area-inset-*) report real notch /
			// home-indicator insets; fixed surfaces pad themselves with them.
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1, viewport-fit=cover",
			},
			{ name: "theme-color", content: "#0a0a0d" },
			{ title: "Code Review Bot" },
		],
	}),
	shellComponent: RootDocument,
});

function LegacyHashRedirect() {
	const navigate = useNavigate();

	useEffect(() => {
		const pathname = mapLegacyAdminHash(window.location.hash);
		if (!pathname) return;
		if (pathname.startsWith("/studio/")) {
			void navigate({
				to: "/studio/$id",
				params: { id: pathname.slice("/studio/".length) },
				replace: true,
			});
			return;
		}
		void navigate({
			to: pathname as "/projects/designs" | "/agents" | "/admins",
			replace: true,
		});
	}, [navigate]);

	return null;
}

function RootDocument({ children }: { children: ReactNode }) {
	const { queryClient } = Route.useRouteContext();

	return (
		<QueryClientProvider client={queryClient}>
			<RivetActorProvider>
				<html lang="en" className="dark">
					<head>
						<HeadContent />
					</head>
					<body>
						<LegacyHashRedirect />
						{children}
						<Scripts />
					</body>
				</html>
			</RivetActorProvider>
		</QueryClientProvider>
	);
}
