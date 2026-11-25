import type { StoredChatPart } from "@/client/api-types";

/**
 * Validates the persisted assistant-turn parts JSON (Message.parts, written
 * by the chat pipelines' chatPartsJson) into the parts the transcript
 * renderers rebuild from. Anything malformed — a pre-feature row, a
 * truncated row, an unknown future part shape — is dropped, and an empty
 * result leaves the caller's flat-`content` text fallback in charge.
 */
export function parseStoredParts(
	json: string | null | undefined,
): StoredChatPart[] {
	if (!json) return [];
	let raw: unknown;
	try {
		raw = JSON.parse(json);
	} catch {
		return [];
	}
	if (!Array.isArray(raw)) return [];

	const parts: StoredChatPart[] = [];
	for (const candidate of raw) {
		if (candidate == null || typeof candidate !== "object") continue;
		const part = candidate as Record<string, unknown>;
		if (typeof part.type !== "string") continue;

		if (part.type === "text" || part.type === "reasoning") {
			if (typeof part.text === "string" && part.text.trim() !== "") {
				parts.push({ type: part.type, state: "done", text: part.text });
			}
			continue;
		}

		const isToolPart =
			part.type === "dynamic-tool" || part.type.startsWith("tool-");
		if (!isToolPart) continue;
		// tool-approval-request and other non-invocation tool shapes carry no
		// renderable state — the state check rejects them.
		const state = part.state;
		if (
			state !== "input-available" &&
			state !== "output-available" &&
			state !== "output-error"
		) {
			continue;
		}
		if (typeof part.toolCallId !== "string") continue;
		// dynamic-tool parts render by name; without one the card is useless.
		if (part.type === "dynamic-tool" && typeof part.toolName !== "string") {
			continue;
		}
		parts.push({
			type: part.type,
			...(typeof part.toolName === "string" ? { toolName: part.toolName } : {}),
			toolCallId: part.toolCallId,
			state,
			...(part.input !== undefined ? { input: part.input } : {}),
			...(part.output !== undefined ? { output: part.output } : {}),
			...(typeof part.errorText === "string"
				? { errorText: part.errorText }
				: {}),
		} as StoredChatPart);
	}
	return parts;
}
