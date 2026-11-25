-- tb-* components skill: seed the new builtin skill into databases that
-- already applied 0020_knowledge_skills. Same deterministic id + INSERT OR
-- IGNORE convergence rules as 0020; the source of truth is
-- skills/builtin/design/tb-components.md (0020 is regenerated from all sources;
-- this migration only adds the one new row).
INSERT OR IGNORE INTO "Skill" ("id", "slug", "name", "description", "content", "builtin", "enabled", "category") VALUES (	'skill-tb-components',
			'tb-components',
			'tb-* components',
			'Author, debug, or improve reusable tb-* web components (building blocks) — custom element anatomy, lifecycle, hydration guard, data/slots/events, validation errors. Invoke with /tb-components or whenever save_component or test_component returns errors or a component misbehaves.',
			'
# tb-* components

Do not paste this document into chat — follow it. This is the deep reference
for building the studio''s reusable `tb-*` components. The **Building blocks**
section of your instructions carries the canonical skeleton and the compact
rules; this skill explains the web under them (standard custom elements, per
MDN''s Web Components guide) and how to debug drafts that fail validation or
the runtime check.

## When to use

Invoke with `/tb-components`, or treat as active when any of these happen:

- You are about to author or update a component (`save_component` /
  `test_component`) and want the conventions right the first time.
- A draft came back with validation errors or failed the runtime check.
- The user asks how a component works, or asks for slots, events, custom
  attributes, or data bindings on an existing one.

If the user is asking about the library model (versions, pins, publishing),
that is the versioning story — see `/design-studio-onboarding` for the mental
model and the studio tabs; this skill stays on the component itself.

## The platform is custom elements — with pinned conventions

A `tb-*` component is a standard **autonomous custom element**: a class that
extends `HTMLElement`, registered exactly once with
`customElements.define("<tag>", ClassName)`. MDN''s baseline applies —
lifecycle callbacks, attributes observed via `static observedAttributes`,
slots for composition. The studio pins four conventions on top:

1. **Light DOM.** Render into `this`; do not call `attachShadow`. The host
   page owns theming (that is why styling is `var(--tb-…)` tokens only) and
   the editor inspector needs direct DOM access. `shadowMode` may be
   `"open"` when true encapsulation is genuinely required; `"closed"` is
   rejected — it breaks the inspector.
2. **The `data-ssr` hydration guard.** Pages are server-rendered: markup
   ships with `data-ssr` on the element. `connectedCallback` must check
   `this.hasAttribute("data-ssr")` and return early (removing the attribute,
   then setting its ready flag) before any re-render — adopt the markup,
   never overwrite it.
3. **One element per draft.** Exactly one class and one
   `customElements.define`, with the tag as a literal string equal to the
   component''s `tagName` — validation and the runtime check resolve the
   element through that exact name.
4. **No dependencies inside the component.** Keep components dependency-free;
   the page that composes them carries any pinned CDN `<script>` include.

## Constructor vs connectedCallback (MDN rules, adapted)

- **Constructor:** call `super()` first; initialize private state and
  nothing else. Do not read attributes or children here — per the spec they
  are not available until the element is connected, and rendering in the
  constructor destroys light-DOM children (including slots).
- **`connectedCallback`:** the setup point. Mandatory order:
  1. `data-ssr` guard — check and return early if present.
  2. Read the JSON data child (below).
  3. Render.
  4. Set the ready flag (`#ready = true`).
- **`attributeChangedCallback`:** re-render **only when the ready flag is
  set**. During HTML parsing, observed attributes fire before the element''s
  children exist; rendering then would wipe slotted content — the classic
  custom-elements pitfall.
- `disconnectedCallback`: only if the element registers document-level
  listeners or timers it must clean up. Otherwise skip it.

## Naming the element

Valid custom element names are lowercase and contain a hyphen. On top of
that, validation enforces:

- Starts with `tb-` with a real name after it (`tb-pricing-card`, not `tb-`).
- Characters `a-z0-9._-`; at most 64 characters.
- `tb-font` and `tb-data` are reserved by the platform.
- Never duplicate an existing name or tag — call `list_components` first.

## Data in, data out

The component''s contract is `{ attributes, slots, events }`.

- **Attributes are strings.** Simple scalar or per-variant values go in
  attributes; declare each in `apiSchema.attributes` with a `type` and a
  short `description`. Declare `defaults` only for attributes that exist.
- **Complex/record data travels in the JSON child** — never attribute soup:

  ```html
  <tb-pricing-card heading="Starter">
    <script type="application/json" slot="data">
      { "plans": [{ "name": "Starter", "price": 9 }] }
    </script>
  </tb-pricing-card>
  ```

  Read it with
  `this.querySelector(''script[type="application/json"][slot="data"]'')` and
  `JSON.parse` inside a try/catch (fall back to `{}` — a parse failure must
  not throw, or the runtime check fails the draft).
- **Slots** are the light-DOM composition mechanism: declare names in
  `apiSchema.slots`, render `<slot name="…">fallback</slot>`, and keep a
  default `<slot></slot>` for unslotted children when the element takes any.
- **Events:** declare names in `apiSchema.events` and dispatch with
  `this.dispatchEvent(new CustomEvent("item-selected", { bubbles: true }))`
  so ancestors can listen.

## CSP and safety (these fail the draft)

The preview and published pages run sandboxed and CSP-restricted:

- No `eval`, `new Function`, or `document.write` — render into `this`.
- No inline event handler attributes (`onclick="…"` and any `on*`) in
  markup — attach listeners in `js` with `addEventListener`.
- No `<script>` tags in markup except the JSON data child.
- No duplicate `id` attributes in the markup snippet.
- Every dynamic string interpolated into HTML must be escaped (the
  skeleton''s `escapeHtml` helper) — user-visible data is untrusted.

## Debugging failed drafts

Validation errors come back verbatim and name what broke — fix every one and
re-save without narrating. Common ones, decoded:

| Error says | Actually wrong | Fix |
|------------|----------------|-----|
| "one class extends HTMLElement" / "define exactly once" | Skeleton drift: missing or duplicated class/registration | Copy the canonical skeleton structure; one class, one `define` |
| "tag name as a literal string … must match tagName" | `define("tb-foo", …)` vs component named `tb-card`, or a variable instead of a literal | Make the literal byte-equal to `tagName` |
| "data-ssr hydration convention" | Guard missing, or ordered after an `innerHTML` write | Guard first in `connectedCallback`; return early before any render |
| "inline event handler attributes" / "no `<script>` tags" | Markup carries behavior | Move to `addEventListener` in `js`; data goes in the JSON child |
| "defaults key … not declared in apiSchema.attributes" | Contract drift | Declare the attribute or drop the default |
| Runtime check: "never registers" or throws | Tag mismatch, JSON.parse outside try/catch, CSP-forbidden API | Fix the concrete throw; the check runs in a real headless browser — anything that logs `console.error` fails |

If several rounds of fixes keep failing, simplify to the skeleton and add
one behavior at a time — each re-save is a new draft version, so nothing is
lost by starting over.

## Tips

- **Read the library first** — `list_components` before authoring; adapt a
  near-duplicate instead of adding one.
- **Author against the skeleton**, then extend: guard, data child, render,
  ready flag, attribute callback — in that order.
- **Make validation errors a checklist**, not a puzzle: they are written to
  be self-correcting.
- **Preview before persisting** — `test_component` when the user wants to
  see it first; `save_component` to make it a draft version.
- **Keep components dumb.** Data shaping belongs in `seed_data` collections
  and `dataBindings`; the component renders what it is given.
',
			true,
			true,
			'design');
