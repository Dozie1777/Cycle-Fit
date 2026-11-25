/**
 * Minimal UI event bus (KUK-916): the command palette triggers actions that
 * live inside page components — e.g. "New project" must open the
 * CreateProjectDialog owned by the projects list. Module-level pub/sub,
 * same pattern as the toast (KUK-905): no context, no prop threading, no
 * URL params to clean up.
 */

export type UiEvent = "new-project";

const listeners = new Set<(event: UiEvent) => void>();

export function emitUiEvent(event: UiEvent): void {
	for (const listener of listeners) listener(event);
}

export function onUiEvent(
	event: UiEvent,
	handler: (event: UiEvent) => void,
): () => void {
	const wrapped = (e: UiEvent) => {
		if (e === event) handler(e);
	};
	listeners.add(wrapped);
	return () => {
		listeners.delete(wrapped);
	};
}
