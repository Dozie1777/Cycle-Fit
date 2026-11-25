import { createFileRoute, notFound } from "@tanstack/react-router";
import { createIsomorphicFn } from "@tanstack/react-start";
import { CampaignSharePage } from "@/features/campaigns/pages/campaign-share-page";
import { loadCampaignShareSnapshot } from "@/server/data/campaign-share-page";
import { getWorkerEnv } from "../../server/worker-env";

/**
 * Public campaign share page (KUK-876). No admin middleware — the slug is the
 * bearer: valid slug renders the snapshot, missing/revoked/rotated slugs 404.
 * The snapshot is compiled on the server (Prisma); the browser never calls an
 * admin API.
 *
 * Client branch: there is no public JSON endpoint for the snapshot, and
 * nothing in the app links here (visitors arrive by URL), so a client-side
 * navigation degrades to the not-found view rather than wiring an admin
 * fetch.
 */
const loadCampaignShare = createIsomorphicFn()
	.server((slug: string) => {
		const env = getWorkerEnv();
		if (!env) throw new Error("worker env unavailable");
		return loadCampaignShareSnapshot(env, slug);
	})
	.client(async () => null);

export const Route = createFileRoute("/share/campaign/$slug")({
	loader: async ({ params }) => {
		const snapshot = await loadCampaignShare(params.slug);
		if (!snapshot) throw notFound();
		return snapshot;
	},
	head: ({ loaderData }) => ({
		meta: [
			{
				title: `${loaderData?.name.slice(0, 80) ?? "Campaign"} — OpenCraft.studio`,
			},
		],
	}),
	component: ShareCampaignRoute,
	notFoundComponent: () => <p className="p-8">Campaign not found.</p>,
});

function ShareCampaignRoute() {
	const snapshot = Route.useLoaderData();
	return <CampaignSharePage snapshot={snapshot} />;
}
