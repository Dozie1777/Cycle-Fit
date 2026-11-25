import {
	ClientOnly,
	createFileRoute,
	useNavigate,
	useSearch,
} from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { safeRedirectPath } from "@/client/redirect-target";

const StudioPage = lazy(() =>
	import("@/features/design-studio/pages/studio-page").then((module) => ({
		default: module.StudioPage,
	})),
);

// KUK-903: closing the studio returns to where the user came from (the
// ?from= origin path, set by every entry point that navigates in) instead
// of always dumping them on the global all-designs page. Deliberately no
// validateSearch — declaring one makes `search` required on every Link to
// this route across the app; `useSearch({ strict: false })` stays loose.
export const Route = createFileRoute("/_authenticated/studio/$id")({
	component: StudioRoute,
});

function StudioRoute() {
	const { id } = Route.useParams();
	const search = useSearch({ strict: false }) as { from?: string };
	const from = search?.from ? safeRedirectPath(search.from) : null;
	const navigate = useNavigate();
	const loading = (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-background text-muted-foreground">
			Loading studio…
		</div>
	);

	function handleClose() {
		// Only honor validated same-origin paths; `href` bypasses typed-route
		// checking because `from` is an arbitrary path.
		if (from) {
			void navigate({ href: from });
			return;
		}
		void navigate({ to: "/projects/designs" });
	}

	return (
		<ClientOnly fallback={loading}>
			<Suspense fallback={loading}>
				<StudioPage id={id} onClose={handleClose} />
			</Suspense>
		</ClientOnly>
	);
}
