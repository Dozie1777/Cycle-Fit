import { createFileRoute, redirect } from "@tanstack/react-router";

// Designs now live under the projects section (/projects/designs);
// keep the old path working for bookmarks and in-flight sessions.
export const Route = createFileRoute("/_authenticated/designs")({
	beforeLoad: () => {
		throw redirect({ to: "/projects/designs", replace: true });
	},
});
