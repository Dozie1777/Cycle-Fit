import { createInlineClient } from "@rivetkit/cloudflare-workers";
import type { UIMessageChunk } from "ai";
import { registry } from "../../src/server/rivet/registry";

// Shared harness for campaign chat tool tests: drives one turn through the
// real `campaignChat` RivetKit actor via the inline client (ACTOR_DO
// binding). The actor's request-less inline arm (synthetic http://actor
// origin) authenticates in-worker callers, so no session is needed. The
// actor lazy-loads @/lib/campaign-chat at action time, which is what lets
// the workers-ai-provider mock apply inside the workerd module graph.
const { client } = createInlineClient(registry);

export type CampaignActorTurn = {
	/** Every UI-message chunk the turn broadcast, in order. */
	chunks: UIMessageChunk[];
	/**
	 * JSON of the emitted chunks — the SSE-wire stand-in for the existing
	 * `toContain` assertions on tool inputs/outputs.
	 */
	wire: string;
	/** Public error text carried by the turnFailed event, if any. */
	failed: string | undefined;
};

export async function runCampaignActorTurn(
	campaignId: string,
	body: { message: string; model?: string; thinkingEffort?: string },
): Promise<CampaignActorTurn> {
	const handle = client.campaignChat.getOrCreate(["campaign", campaignId]);
	const conn = handle.connect();
	const chunks: UIMessageChunk[] = [];
	let failed: string | undefined;
	const unsubs = [
		conn.on("uiMessageChunk", (payload: unknown) => {
			const chunk =
				(payload as { chunk?: UIMessageChunk } | undefined)?.chunk ??
				(payload as UIMessageChunk);
			if (chunk) chunks.push(chunk);
		}),
		conn.on("turnFailed", (payload: unknown) => {
			failed = (payload as { error?: string } | undefined)?.error;
		}),
	];
	try {
		await conn.sendMessage(body);
	} finally {
		for (const unsub of unsubs) unsub();
		await conn.dispose().catch(() => {});
	}
	return { chunks, wire: JSON.stringify(chunks), failed };
}
