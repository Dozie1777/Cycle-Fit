// Selection bridge (KUK-929): the wire protocol between the rendered page
// preview (the studio's sandboxed iframe) and the studio chrome, plus the
// shared block-selection state both ends consume.
//
// Two directions, one file so the protocol cannot drift:
//
// - Preview → inspector: the preview iframe injects SELECTION_BRIDGE (see
//   server/handlers/design-files.ts, which only serves it when
//   `?selectable=1`). A click on any element carrying the block marker
//   posts a BLOCK_SELECT message to the parent; the empty page background
//   posts null (deselect). The studio resolves the id against the design's
//   blocks (stale ids — block deleted while the preview is open — simply
//   match nothing and are ignored).
// - Inspector → preview: the parent posts a BLOCK_HIGHLIGHT message into
//   the iframe; the bridge scrolls the marker element into view and
//   outlines it. The outline is runtime-only inline styling applied by the
//   injected bridge — it is never persisted into publication HTML (the
//   bridge itself is injected only for selectable requests, and the marker
//   attribute is the only stamped trace in composed markup — see
//   lib/compose.ts `data-block-id`).
//
// The injected script deliberately mirrors this module's message keys; the
// unit tests assert the string so a rename here fails loudly. The closing
// script tag is split at the end (`</scr` + `ipt>`) so this source file
// never carries a literal close tag.

import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";

/**
 * The marker attribute composePage stamps on every PageBlock's rendered
 * element (component blocks get it on the custom element, one-off html
 * blocks on their wrapper DIV, template slots on none — slots are not
 * PageBlocks). The DOM maps 1:1 to blocks through it.
 */
export const BLOCK_MARKER = "data-block-id";

/** Preview iframe → parent: the clicked block id, or null (deselect). */
export type BlockSelectMessage = { __designBlockSelect: string | null };

/** Parent → preview iframe: the block id to scroll to + outline, or null. */
export type BlockHighlightMessage = { __designBlockHighlight: string | null };

export function blockSelectMessage(blockId: string | null): BlockSelectMessage {
	return { __designBlockSelect: blockId };
}

export function blockHighlightMessage(
	blockId: string | null,
): BlockHighlightMessage {
	return { __designBlockHighlight: blockId };
}

export function isBlockSelectMessage(
	data: unknown,
): data is BlockSelectMessage {
	if (typeof data !== "object" || data === null) return false;
	const record = data as Record<string, unknown>;
	if (!("__designBlockSelect" in record)) return false;
	const value = record.__designBlockSelect;
	return typeof value === "string" || value === null;
}

export function isBlockHighlightMessage(
	data: unknown,
): data is BlockHighlightMessage {
	if (typeof data !== "object" || data === null) return false;
	const record = data as Record<string, unknown>;
	if (!("__designBlockHighlight" in record)) return false;
	const value = record.__designBlockHighlight;
	return typeof value === "string" || value === null;
}

/**
 * Parent-side preview message dispatch: routes one `message` event payload
 * to the section handler (legacy `data-section` bridge) and/or the block
 * handler (KUK-929). Unknown payloads are ignored; malformed values (e.g. a
 * non-string block id) are dropped rather than propagated.
 */
export type PreviewMessageHandlers = {
	onSection: (section: string | null) => void;
	onBlock: (blockId: string | null) => void;
};

export function applyPreviewMessage(
	data: unknown,
	handlers: PreviewMessageHandlers,
): void {
	if (typeof data !== "object" || data === null) return;
	const record = data as Record<string, unknown>;
	if ("__designSelect" in record) {
		const value = record.__designSelect;
		if (typeof value === "string" || value === null) {
			handlers.onSection(value);
		}
	}
	if (isBlockSelectMessage(record)) {
		handlers.onBlock(record.__designBlockSelect);
	}
}

/**
 * Inspector → preview: posts the highlight message into the iframe window.
 * No-op when the frame is not mounted yet; `targetOrigin` is "*" because
 * the preview runs under a sandboxed (opaque) origin.
 */
export function postBlockHighlight(
	target:
		| { postMessage: (message: unknown, targetOrigin: string) => void }
		| null
		| undefined,
	blockId: string | null,
): void {
	target?.postMessage(blockHighlightMessage(blockId), "*");
}

/**
 * The script serveDesignFile injects before `</body>` for selectable HTML
 * (legacy `data-section` behavior kept byte-for-byte, PageBlock selection
 * added). Blocks win over sections on nested overlap. The highlight
 * listener ignores stale ids (element gone) and echoes of the iframe's own
 * click (already outlined — re-scrolling to center on every click would
 * fight the reader).
 */
export const SELECTION_BRIDGE =
	`
<script>
(function () {
  var sectionCurrent = null;
  var blockCurrent = null;
  function clearBlock() {
    if (blockCurrent) {
      blockCurrent.style.outline = "";
      blockCurrent.style.outlineOffset = "";
      blockCurrent = null;
    }
  }
  function findBlock(id) {
    var all = document.querySelectorAll("[data-block-id]");
    for (var i = 0; i < all.length; i++) {
      if (all[i].getAttribute("data-block-id") === id) return all[i];
    }
    return null;
  }
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (!t || typeof t.closest !== "function") return;
    var blockEl = t.closest("[data-block-id]");
    if (blockEl) {
      e.preventDefault();
      e.stopPropagation();
      if (blockCurrent && blockCurrent !== blockEl) {
        blockCurrent.style.outline = "";
        blockCurrent.style.outlineOffset = "";
      }
      blockCurrent = blockEl;
      blockEl.style.outline = "2px solid #2563eb";
      blockEl.style.outlineOffset = "2px";
      if (sectionCurrent) {
        sectionCurrent.style.outline = "";
        sectionCurrent = null;
      }
      parent.postMessage({ __designBlockSelect: blockEl.getAttribute("data-block-id") }, "*");
      parent.postMessage({ __designSelect: null }, "*");
      return;
    }
    var sectionEl = t.closest("[data-section]");
    if (sectionCurrent) sectionCurrent.style.outline = "";
    clearBlock();
    if (!sectionEl) {
      sectionCurrent = null;
      parent.postMessage({ __designBlockSelect: null }, "*");
      parent.postMessage({ __designSelect: null }, "*");
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    sectionCurrent = sectionEl;
    sectionEl.style.outline = "2px dashed #2563eb";
    sectionEl.style.outlineOffset = "2px";
    parent.postMessage({ __designSelect: sectionEl.getAttribute("data-section") }, "*");
    parent.postMessage({ __designBlockSelect: null }, "*");
  }, true);
  window.addEventListener("message", function (e) {
    var data = e.data;
    if (!data || typeof data !== "object" || !("__designBlockHighlight" in data)) return;
    var id = data.__designBlockHighlight;
    if (typeof id !== "string" || id === "") {
      clearBlock();
      return;
    }
    if (blockCurrent && blockCurrent.getAttribute("data-block-id") === id) return;
    var el = findBlock(id);
    clearBlock();
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    blockCurrent = el;
    el.style.outline = "2px solid #2563eb";
    el.style.outlineOffset = "2px";
  });
})();
</scr` + `ipt>`;

// ---------------------------------------------------------------------------
// Shared selection state (studio chrome side)
// ---------------------------------------------------------------------------

export type BlockSelection = {
	/** The selected PageBlock id, null when nothing is selected. */
	selectedBlockId: string | null;
	/** Select a block (or pass null to deselect). Toggling is the caller's call. */
	selectBlock: (blockId: string | null) => void;
};

const BlockSelectionContext = createContext<BlockSelection | null>(null);

const NO_BLOCK_SELECTION: BlockSelection = {
	selectedBlockId: null,
	selectBlock: () => {},
};

/**
 * Studio-scoped selection shared by the preview (writes from iframe
 * messages, reads for highlight posts) and the inspector's block list
 * (writes from row clicks, reads for row highlighting). Falls back to an
 * inert selection outside a provider so panels render standalone (tests,
 * future routes) without crashing.
 */
export function BlockSelectionProvider({ children }: { children: ReactNode }) {
	const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
	const selectBlock = useCallback((blockId: string | null) => {
		setSelectedBlockId(blockId);
	}, []);
	const value = useMemo(
		() => ({ selectedBlockId, selectBlock }),
		[selectedBlockId, selectBlock],
	);
	return (
		<BlockSelectionContext.Provider value={value}>
			{children}
		</BlockSelectionContext.Provider>
	);
}

export function useBlockSelection(): BlockSelection {
	return useContext(BlockSelectionContext) ?? NO_BLOCK_SELECTION;
}
