/**
 * Canonical skeleton for `tb-*` custom elements, embedded verbatim in the
 * design-agent prompt (see KUK-919). Every component the agent authors must
 * follow these conventions:
 *
 * - light DOM: render into `this` (no shadow root), style only with
 *   var(--tb-…) tokens so the host page controls theming.
 * - `data-ssr` hydration guard: server-rendered markup ships with the
 *   `data-ssr` attribute; connectedCallback must return early instead of
 *   re-rendering over it.
 * - structured data travels as a JSON child
 *   (`<script type="application/json" slot="data">…</script>`), never as
 *   attribute soup.
 * - attribute-driven re-renders via observedAttributes /
 *   attributeChangedCallback, gated until the element owns its DOM.
 */
export const TB_COMPONENT_SKELETON = `// Canonical tb-* component skeleton (light DOM, token styles).
// Render into \`this\`; style only with var(--tb-…) tokens.
const escapeHtml = (value) =>
	String(value).replace(/[&<>"']/g, (c) => ({
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		'"': "&quot;",
		"'": "&#39;",
	})[c] ?? c);

class TbWidget extends HTMLElement {
	static observedAttributes = ["heading"]; // attributes that re-render

	#ready = false; // true once the element owns its DOM
	#data = {}; // structured data from the JSON child

	connectedCallback() {
		// SSR hydration guard: the server already rendered this instance and
		// marked it data-ssr. Adopt the markup — never re-render over it.
		if (this.hasAttribute("data-ssr")) {
			this.removeAttribute("data-ssr");
			this.#ready = true;
			return;
		}
		// Complex data travels as a JSON child, never as attribute soup.
		const dataEl = this.querySelector(
			'script[type="application/json"][slot="data"]',
		);
		if (dataEl) {
			try {
				this.#data = JSON.parse(dataEl.textContent ?? "{}");
			} catch {
				this.#data = {};
			}
		}
		this.#render();
		this.#ready = true;
	}

	attributeChangedCallback(_name, _oldValue, _newValue) {
		// Ignore attribute churn while the page is still parsing.
		if (this.#ready) this.#render();
	}

	#render() {
		const heading = this.getAttribute("heading") ?? this.#data.heading ?? "";
		this.innerHTML = \`
			<span class="tb-widget__heading" style="color: var(--tb-text-primary)">\${escapeHtml(heading)}</span>
			<slot></slot>
		\`;
	}
}

customElements.define("tb-widget", TbWidget);
`;
