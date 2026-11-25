import { createFileRoute, redirect } from "@tanstack/react-router";
import { getAdminSession } from "../server/admin-session";

export const Route = createFileRoute("/")({
	beforeLoad: async () => {
		// The console's landing redirect: signed-in admins go to designs,
		// everyone else to sign-in. The auth gate itself lives on the
		// pathless /_authenticated layout.
		const session = await getAdminSession();
		if (!session) throw redirect({ to: "/login" });
		throw redirect({ to: "/projects/designs" });
	},
});
