import { createFileRoute, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { trpc } from "@/client/trpc";
import { Button } from "@/components/ui/button";
import { loadShareProject } from "../../server/share-document";

export const Route = createFileRoute("/share/$projectId")({
	loader: async ({ params }) => {
		const project = await loadShareProject(params.projectId);
		if (!project) throw notFound();
		return project;
	},
	head: ({ loaderData }) => ({
		meta: [
			{
				title: `${loaderData?.prompt.slice(0, 80) ?? "Shared design"} — OpenCraft.studio`,
			},
		],
	}),
	component: SharePage,
	notFoundComponent: () => <p>Shared design not found.</p>,
});

function SharePage() {
	const { projectId, prompt } = Route.useLoaderData();
	const [remixing, setRemixing] = useState(false);
	const [forkProjectId, setForkProjectId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const title = prompt.length > 80 ? `${prompt.slice(0, 80)}…` : prompt;

	async function remix() {
		setRemixing(true);
		setError(null);
		try {
			const { projectId: forkId } = await trpc.share.remix.mutate({
				projectId,
			});
			// Stay on the public page: the fork's published site renders
			// anonymously below. The studio is admin-only, so instead of a
			// login dead-end the visitor gets the fork view plus a sign-in
			// link that returns straight into the fork's studio.
			setForkProjectId(forkId);
		} catch (remixError) {
			setError(
				remixError instanceof Error
					? remixError.message
					: "Remix failed — try again",
			);
		} finally {
			setRemixing(false);
		}
	}

	const viewId = forkProjectId ?? projectId;
	const signInToEdit = forkProjectId
		? `/login?redirect=${encodeURIComponent(`/studio/${forkProjectId}`)}`
		: null;

	return (
		<div className="flex h-dvh flex-col bg-[#f6f7f9] font-sans text-black">
			<div className="flex items-center gap-3 border-b border-[#e2e4e8] bg-white pt-[max(0.625rem,env(safe-area-inset-top))] pb-2.5 pr-4 pl-4">
				<span className="shrink-0 text-sm font-bold">
					OpenCraft<span className="text-blue-600">.</span>studio
				</span>
				<span className="hidden min-[360px]:block min-[360px]:min-w-0 min-[360px]:flex-1 truncate text-xs text-gray-500">
					{forkProjectId ? `Your remix of: ${title}` : title}
				</span>
				{forkProjectId && signInToEdit ? (
					<a
						href={signInToEdit}
						className="inline-flex h-8 shrink-0 items-center rounded-lg bg-blue-600 px-3 text-[0.8rem] font-medium whitespace-nowrap text-white hover:bg-blue-700"
					>
						Sign in to edit
					</a>
				) : (
					<Button
						type="button"
						size="sm"
						className="shrink-0 bg-blue-600 text-white hover:bg-blue-700"
						disabled={remixing}
						onClick={remix}
					>
						{remixing ? "Remixing…" : "Remix"}
					</Button>
				)}
			</div>
			{error ? (
				<p role="alert" className="bg-red-50 px-4 py-2 text-sm text-red-700">
					{error}
				</p>
			) : null}
			<iframe
				key={viewId}
				src={`/designs/${viewId}/site`}
				title="published design"
				sandbox=""
				className="min-h-0 w-full flex-1 border-0"
			/>
		</div>
	);
}
