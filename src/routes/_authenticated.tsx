"use client";

import {
	createFileRoute,
	Outlet,
	redirect,
	useNavigate,
	useRouter,
} from "@tanstack/react-router";
import { authClient } from "@/client/auth-client";
import { Button } from "../components/ui/button";
import { getAdminSession } from "../server/admin-session";

// Pathless layout guarding the console: every child route requires a session,
// and non-admin roles get a read-only explanation with a sign-out action.
export const Route = createFileRoute("/_authenticated")({
	beforeLoad: async ({ location }) => {
		const session = await getAdminSession();
		if (!session) {
			// Return to the intended page after sign-in (e.g. a public-share
			// remix that deep-links into the admin-only studio).
			throw redirect({
				to: "/login",
				search: { redirect: location.href },
			});
		}
		return { session };
	},
	component: AuthenticatedLayout,
});

export function AdminRoleRequired({
	user,
	onSignOut,
}: {
	user: { email: string; role?: string | null };
	onSignOut: () => void;
}) {
	return (
		<main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
			<p>
				Signed in as <strong>{user.email}</strong> (role: {user.role ?? "user"})
				— admin role required.
			</p>
			<Button type="button" variant="secondary" onClick={onSignOut}>
				Sign out
			</Button>
		</main>
	);
}

function AuthenticatedLayout() {
	const { session } = Route.useRouteContext();
	const navigate = useNavigate();
	const router = useRouter();

	if (session.user.role !== "admin") {
		return (
			<AdminRoleRequired
				user={session.user}
				onSignOut={async () => {
					await authClient.signOut();
					await router.invalidate();
					await navigate({ to: "/login" });
				}}
			/>
		);
	}

	return <Outlet />;
}
