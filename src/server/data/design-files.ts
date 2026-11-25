import { z } from "zod";
import {
	designResponseHeaders,
	designsKey,
	isDesignId,
	parseRelPath,
} from "@/features/design-studio/assets/design-files";
import {
	createDesignUploadUrl,
	uploadTokenMatches,
} from "@/features/design-studio/assets/design-upload";
// The injectable selection bridge lives in the studio's selection-bridge
// module (KUK-929) so the preview UI, the injected script, and the message
// protocol share one source of truth and one set of tests.
import { SELECTION_BRIDGE } from "@/features/design-studio/components/selection-bridge";
import { getLiveDesignFile } from "@/features/design-studio/publish/design-publish";
import { getPrisma } from "@/lib/db";

const uploadUrlBody = z.object({
	token: z.string().min(1).max(256),
	path: z.string().min(1).max(200),
});

export async function createUploadUrl(input: {
	request: Request;
	env: Env;
	projectId: string;
}): Promise<Response> {
	const { request, env, projectId } = input;
	if (!isDesignId(projectId)) {
		return Response.json({ error: "invalid project id" }, { status: 400 });
	}
	const raw = await request.json().catch(() => null);
	const parsed = uploadUrlBody.safeParse(raw ?? {});
	if (!parsed.success) {
		return Response.json({ error: "invalid body" }, { status: 400 });
	}
	const project = await getPrisma(env).design.findUnique({
		where: { id: projectId },
	});
	if (!project) {
		return Response.json({ error: "not found" }, { status: 404 });
	}
	if (
		!project.uploadToken ||
		!(await uploadTokenMatches(parsed.data.token, project.uploadToken))
	) {
		return Response.json({ error: "unauthorized" }, { status: 401 });
	}
	const rel = parseRelPath(parsed.data.path.split("/"));
	if (!rel) {
		return Response.json({ error: "invalid file path" }, { status: 400 });
	}
	const uploadPath =
		project.liveTurnId &&
		(rel === "index.html" || rel === "preview.png" || rel === "tokens.json")
			? `turns/${project.liveTurnId}/${rel}`
			: rel;
	try {
		return Response.json(
			await createDesignUploadUrl(env, designsKey(projectId, uploadPath)),
		);
	} catch (error) {
		console.log(`[designs] upload-url mint failed for ${projectId}:`, error);
		return Response.json(
			{ error: "uploads unavailable — S3 credentials not provisioned" },
			{ status: 500 },
		);
	}
}

export async function serveDesignFile(input: {
	request: Request;
	env: Env;
	projectId: string;
	path: string;
}): Promise<Response> {
	const { request, env, projectId, path } = input;
	const rel = parseRelPath(path.split("/"));
	if (!rel) {
		return Response.json({ error: "invalid file path" }, { status: 400 });
	}
	const object =
		rel === "index.html" || rel === "preview.png" || rel === "tokens.json"
			? await getLiveDesignFile(env, projectId, rel)
			: await env.DESIGNS.get(designsKey(projectId, rel));
	// Legacy vs new-model branch (KUK-930): getLiveDesignFile falls back to
	// the root-level object when Design.liveTurnId is null — legacy designs
	// (no Page/Publication rows) keep serving today's monolithic bucket-root
	// artifacts byte-for-byte; converted designs serve their composed
	// publication from turns/<publicationId>/ (KUK-921/922).
	if (!object) {
		return new Response("not found", { status: 404 });
	}
	const selectable =
		new URL(request.url).searchParams.get("selectable") === "1" &&
		rel.endsWith(".html");
	const body = selectable
		? (await object.text()).replace(/<\/body>/i, `${SELECTION_BRIDGE}</body>`)
		: object.body;
	return new Response(body, {
		status: 200,
		headers: designResponseHeaders(rel),
	});
}
