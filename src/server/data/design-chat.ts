import { z } from "zod";
import { isDesignId } from "@/features/design-studio/assets/design-files";
import {
	DESIGN_CHAT_CONFLICT_ERROR,
	DESIGN_CHAT_PUBLIC_ERROR,
	DesignChatTurnConflictError,
	runDesignChatTurn,
} from "@/features/design-studio/chat/design-chat";
import { getPrisma } from "@/lib/db";
import { resolveChatAssets } from "./design-assets";

const chatBody = z.object({
	message: z.string().trim().min(1).max(8000),
	section: z.string().trim().min(1).max(60).optional(),
	// Any string is accepted and coerced to a working default server-side —
	// a hard enum here would 400 stale clients that still send removed ids.
	model: z.string().max(120).optional(),
	assets: z.array(z.string()).max(5).optional(),
});

export async function chatDesign(input: {
	request: Request;
	env: Env;
	projectId: string;
	adminUserId: string;
	waitUntil: (promise: Promise<unknown>) => void;
}): Promise<Response> {
	const { request, env, projectId, adminUserId, waitUntil } = input;
	if (!isDesignId(projectId)) {
		return Response.json({ error: "invalid project id" }, { status: 400 });
	}
	const raw = await request.json().catch(() => null);
	const parsed = chatBody.safeParse(raw ?? {});
	if (!parsed.success) {
		return Response.json(
			{ error: parsed.error.issues[0]?.message ?? "invalid body" },
			{ status: 400 },
		);
	}
	const project = await getPrisma(env).design.findUnique({
		where: { id: projectId },
	});
	if (!project) {
		return Response.json({ error: "not found" }, { status: 404 });
	}
	const origin = new URL(request.url).origin;
	let assets: import("@/features/design-studio/assets/design-assets").AssetRef[] =
		[];
	if (parsed.data.assets && parsed.data.assets.length > 0) {
		const resolved = await resolveChatAssets(
			env,
			projectId,
			parsed.data.assets,
			origin,
			adminUserId,
		);
		if (!resolved.ok) {
			return Response.json({ error: resolved.error }, { status: 400 });
		}
		assets = resolved.assets;
	}
	try {
		return await runDesignChatTurn(env, projectId, {
			message: parsed.data.message,
			section: parsed.data.section,
			model: parsed.data.model,
			assets,
			origin,
			waitUntil,
		});
	} catch (error) {
		if (error instanceof DesignChatTurnConflictError) {
			return Response.json(
				{ error: DESIGN_CHAT_CONFLICT_ERROR },
				{ status: 409 },
			);
		}
		console.log(`[designs] chat turn failed for ${projectId}:`, error);
		return Response.json({ error: DESIGN_CHAT_PUBLIC_ERROR }, { status: 502 });
	}
}
