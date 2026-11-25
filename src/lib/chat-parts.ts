/**
 * Persisting the visible conversation, shared by the design, campaign, and
 * per-element chat pipelines (mirrors the shared Message table they write).
 *
 * The live transcript renders the full UI message stream — reasoning text
 * plus every tool call with its input and output — but the Message row only
 * carried the flat final `content` string, so a page refresh rebuilt the
 * conversation without thoughts or tool cards. `chatPartsFromSteps` +
 * `chatPartsPayload` rebuild a persistable parts array from the generation's
 * finished steps so the refresh path can restore what the live stream
 * showed. The client-side counterpart is `parseStoredParts`
 * (src/client/stored-parts.ts), which validates and re-renders the stored
 * shape.
 *
 * Degradation ladder for oversized turns (D1 caps strings at ~1MB, and a
 * failed fenced INSERT fails the whole turn): the full parts array first,
 * then a version with tool inputs/outputs stripped (part names, states, and
 * all text/reasoning survive — oversized tool payloads like full design HTML
 * are what typically overflow), then null — the client renders that as the
 * flat `content` text, the pre-feature behavior.
 */
import type { StepResult, ToolSet } from "ai";

/** The slice of a finished generation step the parts builder needs. */
export type BuildableStep = Pick<StepResult<ToolSet>, "content">;

/**
 * The stored tool-part shape — structurally the tool part the transcripts
 * render, with the call+result already merged. Kept as a plain type (not
 * the SDK's state-per-variant union) so the builder can complete parts in
 * place.
 */
export type StoredToolPart = {
	type: `tool-${string}` | "dynamic-tool";
	toolName?: string;
	toolCallId: string;
	state: "input-available" | "output-available" | "output-error";
	input?: unknown;
	output?: unknown;
	errorText?: string;
};

/** The stored part shape: text, reasoning, and finished tool calls. */
export type StoredChatPart =
	| { type: "text"; state: "done"; text: string }
	| { type: "reasoning"; state: "done"; text: string }
	| StoredToolPart;

function isDynamic(entry: { dynamic?: boolean | undefined }): boolean {
	return entry.dynamic === true;
}

function toolErrorText(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === "string" && error.trim() !== "") return error;
	return "Tool execution failed";
}

/**
 * Rebuilds the parts a refresh should render from the finished generation
 * steps: per-step text and reasoning parts, and tool parts merged from
 * their call + result/error content entries. `fallbackText` (the pipeline's
 * computed final text) is appended as a text part only when no streamed
 * text part exists — ask_user turns end with an empty text part, and the
 * folded question must survive the refresh.
 */
export function chatPartsFromSteps(
	steps: readonly BuildableStep[],
	fallbackText: string,
): StoredChatPart[] {
	const parts: StoredChatPart[] = [];
	// toolCallId → position of the seeded part, so the matching result or
	// error content entry completes it in place (order follows the calls).
	const callIndex = new Map<string, number>();

	for (const step of steps) {
		for (const entry of step.content) {
			if (entry.type === "text") {
				if (entry.text.trim() !== "") {
					parts.push({ type: "text", state: "done", text: entry.text });
				}
			} else if (entry.type === "reasoning") {
				if (entry.text.trim() !== "") {
					parts.push({ type: "reasoning", state: "done", text: entry.text });
				}
			} else if (entry.type === "tool-call") {
				callIndex.set(entry.toolCallId, parts.length);
				parts.push(
					isDynamic(entry)
						? {
								type: "dynamic-tool",
								toolName: entry.toolName,
								toolCallId: entry.toolCallId,
								state: "input-available",
								input: entry.input,
							}
						: {
								type: `tool-${entry.toolName}`,
								toolCallId: entry.toolCallId,
								state: "input-available",
								input: entry.input,
							},
				);
			} else if (entry.type === "tool-result") {
				const dynamic = isDynamic(entry);
				const completed: StoredToolPart = {
					type: dynamic ? "dynamic-tool" : `tool-${entry.toolName}`,
					...(dynamic ? { toolName: entry.toolName } : {}),
					toolCallId: entry.toolCallId,
					state: "output-available",
					input: entry.input,
					output: entry.output,
				};
				const seeded = callIndex.get(entry.toolCallId);
				if (seeded === undefined) {
					// A result without a preceding call entry — emit it directly.
					callIndex.set(entry.toolCallId, parts.length);
					parts.push(completed);
				} else {
					parts[seeded] = completed;
				}
			} else if (entry.type === "tool-error") {
				const part = parts[callIndex.get(entry.toolCallId) ?? -1] as
					| StoredToolPart
					| undefined;
				if (part) {
					part.state = "output-error";
					part.errorText = toolErrorText(entry.error);
				}
			}
			// source/file/tool-approval-request entries don't occur in these
			// chats and have no card renderer; skip them.
		}
	}

	const text = fallbackText.trim();
	if (
		text &&
		!parts.some((part) => part.type === "text" && part.text.trim() !== "")
	) {
		parts.push({ type: "text", state: "done", text });
	}
	return parts;
}

/** Parts JSON budget, in serialized UTF-8 bytes. Comfortably under D1's ~1MB string cap. */
const MAX_PARTS_JSON_BYTES = 800_000;

const utf8 = new TextEncoder();

/** Serialized UTF-8 byte length — D1 caps strings in bytes, not characters. */
function utf8Length(value: string): number {
	return utf8.encode(value).length;
}

/**
 * Appends `text` as a final text part unless a text part already carries it.
 * Used for notes that must survive a refresh on top of streamed parts (the
 * design chat's timeout continuation note).
 */
export function withTextPart(parts: StoredChatPart[], text: string): void {
	const trimmed = text.trim();
	if (!trimmed) return;
	if (parts.some((part) => part.type === "text" && part.text === trimmed)) {
		return;
	}
	parts.push({ type: "text", state: "done", text: trimmed });
}

/**
 * Fits the parts array into the storage budget: full JSON first, then with
 * tool inputs/outputs stripped, then null (the client's flat-text fallback).
 */
export function chatPartsPayload(parts: StoredChatPart[]): string | null {
	const length = (candidate: StoredChatPart[]) =>
		utf8Length(JSON.stringify(candidate));
	if (length(parts) <= MAX_PARTS_JSON_BYTES) {
		return JSON.stringify(parts);
	}
	const payloadStripped = parts.map((part) =>
		part.type.startsWith("tool-") || part.type === "dynamic-tool"
			? {
					...part,
					input: undefined,
					output:
						part.state === "output-error" ? undefined : { truncated: true },
				}
			: part,
	);
	if (length(payloadStripped) <= MAX_PARTS_JSON_BYTES) {
		return JSON.stringify(payloadStripped);
	}
	return null;
}

/** Convenience wrapper the pipelines call from onFinish/onAbort. */
export function chatPartsJson(
	steps: readonly BuildableStep[],
	fallbackText: string,
): string | null {
	return chatPartsPayload(chatPartsFromSteps(steps, fallbackText));
}
