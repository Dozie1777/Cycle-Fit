import {
	createFileRoute,
	useNavigate,
	useRouter,
	useSearch,
} from "@tanstack/react-router";
import { safeRedirectPath } from "@/client/redirect-target";
import { LoginPage } from "@/components/app-shell/login-page";

export const Route = createFileRoute("/login")({
	validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
		redirect: typeof search.redirect === "string" ? search.redirect : undefined,
	}),
	component: LoginRoute,
});

function LoginRoute() {
	const navigate = useNavigate();
	const router = useRouter();
	const search = useSearch({ from: "/login" });

	return (
		<LoginPage
			onSignedIn={() => {
				void (async () => {
					await router.invalidate();
					const target = safeRedirectPath(search.redirect);
					await navigate({ href: target ?? "/projects/designs" });
				})();
			}}
		/>
	);
}
