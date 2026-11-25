/**
 * Shared chat-turn limits (extracted from design-chat.ts / campaign-chat.ts
 * so the element chat pipeline reuses the same numbers — KUK-941).
 *
 * Invariant: the turn deadline must stay under the abandoned-lease reclaim
 * window (a live turn always settles before a successor could lazily steal
 * its lease), and the actor actionTimeout must exceed the deadline.
 */

/**
 * Hard deadline for a whole chat turn (model stream + tool loop). Turns may
 * legitimately run very long (browser research, many tool rounds), so the
 * default allows up to 40 minutes; it exists only as a backstop for a truly
 * hung Workers AI stream or tool. Overridable per chat via env (ms).
 */
export const DEFAULT_TURN_TIMEOUT_MS = 40 * 60 * 1000;

/**
 * Lazy abandoned-turn reclaim window. A successor turn may steal the lease
 * only once the previous claim is older than this. Must exceed the turn
 * deadline so a live turn always settles first.
 */
export const ABANDONED_LEASE_MS = 45 * 60 * 1000;

/** Integer env override (ms) for a timeout knob; falls back on any invalid value. */
export function timeoutMs(env: Env, name: string, fallback: number): number {
	const raw = Number((env as unknown as Record<string, unknown>)[name]);
	return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}
