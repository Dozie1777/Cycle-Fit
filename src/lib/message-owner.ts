/**
 * Exactly-one chat-message ownership invariant, shared by the design,
 * campaign, and per-element chat pipelines. Mirrors the DB CHECK constraint
 * (0016 for two owners, widened to three by 0025_element_chats): a Message
 * row belongs to exactly one of a design, a campaign, or an element chat
 * session — never more than one, never none.
 *
 * Throws on violation so a pipeline fails fast with a clear error instead of
 * surfacing a raw constraint failure, and returns the ownership narrowed for
 * direct use in Prisma inserts.
 */
export type MessageOwner =
	| { designId: string; campaignId: null; elementId: null }
	| { designId: null; campaignId: string; elementId: null }
	| { designId: null; campaignId: null; elementId: string };

export function validateMessageOwner(owner: {
	designId?: string | null;
	campaignId?: string | null;
	elementId?: string | null;
}): MessageOwner {
	const designId = owner.designId ?? null;
	const campaignId = owner.campaignId ?? null;
	const elementId = owner.elementId ?? null;
	const setCount =
		(designId != null ? 1 : 0) +
		(campaignId != null ? 1 : 0) +
		(elementId != null ? 1 : 0);
	if (setCount !== 1) {
		throw new Error(
			"message ownership invariant violated: exactly one of designId/campaignId/elementId must be set",
		);
	}
	if (designId != null) return { designId, campaignId: null, elementId: null };
	if (campaignId != null)
		return { designId: null, campaignId, elementId: null };
	return { designId: null, campaignId: null, elementId: elementId as string };
}
