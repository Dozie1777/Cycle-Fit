import { describe, expect, it } from "vitest";
import { TB_COMPONENT_SKELETON } from "./component-skeleton";
import {
	RESERVED_TB_TAG_NAMES,
	validateComponentDraft,
} from "./component-validate";

const VALID_JS = `class TbThing extends HTMLElement {
	connectedCallback() {
		// SSR hydration guard: keep server-rendered markup.
		if (this.hasAttribute("data-ssr")) {
			this.removeAttribute("data-ssr");
			return;
		}
		this.innerHTML = "<b>hi</b>";
	}
}
customElements.define("tb-thing", TbThing);
`;

function draft(
	overrides?: Partial<Parameters<typeof validateComponentDraft>[0]>,
) {
	return {
		tagName: "tb-thing",
		js: VALID_JS,
		...overrides,
	};
}

describe("validateComponentDraft — accepted drafts", () => {
	it("accepts a minimal valid draft", () => {
		expect(validateComponentDraft(draft())).toEqual({ ok: true });
	});

	it("accepts shadowMode light and open", () => {
		expect(validateComponentDraft(draft({ shadowMode: "light" }))).toEqual({
			ok: true,
		});
		expect(validateComponentDraft(draft({ shadowMode: "open" }))).toEqual({
			ok: true,
		});
	});

	it("accepts html containing the JSON data-child script and unique ids", () => {
		const html = `<div id="thing-root">
	<span slot="label">Hello</span>
	<script type="application/json" slot="data">{"items":["a"]}</script>
</div>`;
		expect(validateComponentDraft(draft({ html }))).toEqual({ ok: true });
	});

	it("accepts string apiSchema and matching string-valued defaults", () => {
		const result = validateComponentDraft(
			draft({
				apiSchema: JSON.stringify({
					attributes: {
						title: { type: "string", description: "Card title" },
					},
					slots: ["actions"],
					events: ["item-selected"],
				}),
				defaults: JSON.stringify({ title: "Featured" }),
			}),
		);
		expect(result).toEqual({ ok: true });
	});
});

describe("TB_COMPONENT_SKELETON passes its own gate", () => {
	it("validates as a complete draft around the canonical skeleton", () => {
		const result = validateComponentDraft({
			tagName: "tb-widget",
			js: TB_COMPONENT_SKELETON,
			html: '<span class="tb-widget__heading"></span><slot></slot>',
			shadowMode: "light",
			apiSchema: JSON.stringify({
				attributes: {
					heading: { type: "string", description: "Heading text" },
				},
				slots: [],
				events: [],
			}),
			defaults: JSON.stringify({ heading: "Hello" }),
		});
		expect(result).toEqual({ ok: true });
	});

	it("registers the tag its own source declares", () => {
		expect(TB_COMPONENT_SKELETON).toContain(
			'customElements.define("tb-widget"',
		);
	});
});

describe("tagName rules", () => {
	it("rejects a missing tb- prefix", () => {
		const result = validateComponentDraft(draft({ tagName: "hero-card" }));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.join(" ")).toContain('"tb-" prefix');
		}
	});

	it("rejects uppercase tag names", () => {
		const result = validateComponentDraft(draft({ tagName: "tb-HeroCard" }));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.join(" ")).toContain("all lowercase");
		}
	});

	it("rejects invalid characters", () => {
		const result = validateComponentDraft(draft({ tagName: "tb-hero card!" }));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.join(" ")).toContain("invalid characters");
		}
	});

	it("rejects a bare tb- prefix with no name", () => {
		const result = validateComponentDraft(draft({ tagName: "tb-" }));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.join(" ")).toContain('after the "tb-" prefix');
		}
	});

	it("rejects excessively long tag names", () => {
		const result = validateComponentDraft(
			draft({ tagName: `tb-${"a".repeat(64)}` }),
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.join(" ")).toContain("too long");
		}
	});

	it("rejects every reserved tag name", () => {
		for (const tagName of RESERVED_TB_TAG_NAMES) {
			const result = validateComponentDraft(draft({ tagName }));
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.errors.join(" ")).toContain("reserved by the platform");
			}
		}
	});
});

describe("js rules", () => {
	it("rejects js without a class extending HTMLElement", () => {
		const js = `const TbThing = {}; customElements.define("tb-thing", TbThing);`;
		const result = validateComponentDraft(draft({ js }));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.join(" ")).toContain("extends HTMLElement");
		}
	});

	it("rejects js with more than one customElements.define", () => {
		const js = `${VALID_JS}
customElements.define("tb-thing-clone", TbThing);`;
		const result = validateComponentDraft(draft({ js }));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.join(" ")).toContain("exactly once (found 2 calls)");
		}
	});

	it("rejects js that registers a different tagName", () => {
		const js = VALID_JS.replace('"tb-thing"', '"tb-other"');
		const result = validateComponentDraft(draft({ js }));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.join(" ")).toContain("must match exactly");
		}
	});

	it("rejects js without a literal tag name in customElements.define", () => {
		const js = `class TbThing extends HTMLElement {}
customElements.define(TAG_NAME, TbThing);`;
		const result = validateComponentDraft(draft({ js }));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.join(" ")).toContain("literal string");
		}
	});

	it("rejects js that unconditionally re-renders in connectedCallback", () => {
		const js = `class TbThing extends HTMLElement {
	connectedCallback() {
		this.innerHTML = "<b>fresh render</b>";
	}
}
customElements.define("tb-thing", TbThing);`;
		const result = validateComponentDraft(draft({ js }));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.join(" ")).toContain(
				"data-ssr hydration convention",
			);
		}
	});

	it("rejects a data-ssr guard that comes after the re-render", () => {
		const js = `class TbThing extends HTMLElement {
	connectedCallback() {
		this.innerHTML = "<b>fresh render</b>";
		if (this.hasAttribute("data-ssr")) return;
	}
}
customElements.define("tb-thing", TbThing);`;
		const result = validateComponentDraft(draft({ js }));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.join(" ")).toContain(
				"data-ssr hydration convention",
			);
		}
	});

	it("rejects document.write", () => {
		const js = `${VALID_JS}
document.write("<p>nope</p>");`;
		const result = validateComponentDraft(draft({ js }));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.join(" ")).toContain("document.write");
		}
	});

	it("rejects eval", () => {
		const js = `${VALID_JS}
const value = eval("1 + 1");`;
		const result = validateComponentDraft(draft({ js }));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.join(" ")).toContain("eval");
		}
	});

	it("rejects new Function", () => {
		const js = `${VALID_JS}
const fn = new Function("return 1");`;
		const result = validateComponentDraft(draft({ js }));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.join(" ")).toContain("new Function");
		}
	});
});

describe("html rules", () => {
	it("rejects inline event handler attributes", () => {
		const html = `<button onclick="alert('hi')">Click</button>`;
		const result = validateComponentDraft(draft({ html }));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.join(" ")).toContain("inline event handler");
		}
	});

	it("rejects executable <script> tags", () => {
		const html = `<div><script>alert("boom")</script></div>`;
		const result = validateComponentDraft(draft({ html }));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.join(" ")).toContain("<script>");
		}
	});

	it("rejects duplicate id attributes", () => {
		const html = `<div id="row"><span id="row">text</span></div>`;
		const result = validateComponentDraft(draft({ html }));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.join(" ")).toContain(
				'duplicate id attributes: "row"',
			);
		}
	});
});

describe("shadowMode rules", () => {
	it("rejects closed shadow roots", () => {
		const result = validateComponentDraft(draft({ shadowMode: "closed" }));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.join(" ")).toContain("editor inspector");
		}
	});

	it("rejects unknown shadowMode values", () => {
		const result = validateComponentDraft(draft({ shadowMode: "yes" }));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.join(" ")).toContain('"light" or "open"');
		}
	});
});

describe("apiSchema rules", () => {
	it("rejects invalid JSON", () => {
		const result = validateComponentDraft(draft({ apiSchema: "{attributes:" }));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.join(" ")).toContain("apiSchema must be valid JSON");
		}
	});

	it("rejects unknown top-level keys", () => {
		const result = validateComponentDraft(
			draft({ apiSchema: JSON.stringify({ attributes: {}, methods: [] }) }),
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.join(" ")).toContain(
				"unknown top-level keys: methods",
			);
		}
	});

	it("rejects attribute definitions without a string type", () => {
		const result = validateComponentDraft(
			draft({
				apiSchema: JSON.stringify({
					attributes: { title: { description: "no type" } },
				}),
			}),
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.join(" ")).toContain("attributes.title.type");
		}
	});

	it("rejects non-object attribute definitions", () => {
		const result = validateComponentDraft(
			draft({ apiSchema: JSON.stringify({ attributes: { title: "string" } }) }),
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.join(" ")).toContain(
				"attributes.title must be an object",
			);
		}
	});

	it("rejects slots that are not arrays of strings", () => {
		const result = validateComponentDraft(
			draft({ apiSchema: JSON.stringify({ slots: [1, 2] }) }),
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.join(" ")).toContain(
				"slots must be an array of slot name strings",
			);
		}
	});

	it("rejects events that are not arrays of strings", () => {
		const result = validateComponentDraft(
			draft({ apiSchema: JSON.stringify({ events: ["click", 42] }) }),
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.join(" ")).toContain(
				"events must be an array of event name strings",
			);
		}
	});
});

describe("defaults rules", () => {
	it("rejects invalid JSON", () => {
		const result = validateComponentDraft(draft({ defaults: "{title:" }));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.join(" ")).toContain("defaults must be valid JSON");
		}
	});

	it("rejects non-object defaults", () => {
		const result = validateComponentDraft(draft({ defaults: '["title"]' }));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.join(" ")).toContain(
				"defaults must be a JSON object",
			);
		}
	});

	it("rejects keys missing from apiSchema.attributes", () => {
		const result = validateComponentDraft(
			draft({
				apiSchema: JSON.stringify({
					attributes: { title: { type: "string" } },
				}),
				defaults: JSON.stringify({ heading: "Wrong key" }),
			}),
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.join(" ")).toContain(
				'"heading" is not declared in apiSchema.attributes',
			);
		}
	});

	it("rejects non-string default values", () => {
		const result = validateComponentDraft(
			draft({
				apiSchema: JSON.stringify({
					attributes: { count: { type: "number" } },
				}),
				defaults: JSON.stringify({ count: 3 }),
			}),
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.join(" ")).toContain(
				"defaults.count must be a string",
			);
		}
	});
});
