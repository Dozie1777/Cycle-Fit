import { StrictMode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import type { Skill } from "@/client/api-types";
import {
	filterSkillsForSlash,
	isSlashDraft,
	SkillSlashMenu,
} from "./skill-slash-menu";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SKILLS: Skill[] = [
	{
		id: "skill-campaign-basics",
		slug: "campaign-basics",
		name: "Campaign basics",
		description: "A guided tour of the studio.",
		content: "# Campaign basics",
		category: "campaign",
		builtin: true,
		enabled: true,
		createdAt: "",
		updatedAt: "",
	},
	{
		id: "skill-draft-a-brief",
		slug: "draft-a-brief",
		name: "Draft a brief",
		description: "Brief negotiation playbook.",
		content: "# Draft a brief",
		category: "campaign",
		builtin: true,
		enabled: true,
		createdAt: "",
		updatedAt: "",
	},
];

describe("isSlashDraft", () => {
	it("matches a bare slash invocation and not normal prose", () => {
		expect(isSlashDraft("/")).toBe(true);
		expect(isSlashDraft("/draft-a-brief")).toBe(true);
		expect(isSlashDraft("")).toBe(false);
		expect(isSlashDraft("hello")).toBe(false);
		expect(isSlashDraft("/draft-a-brief and then")).toBe(false);
		expect(isSlashDraft("see /draft")).toBe(false);
		expect(isSlashDraft("/two words")).toBe(false);
	});
});

describe("filterSkillsForSlash", () => {
	it("matches all skills on an empty query and filters by slug/name", () => {
		expect(filterSkillsForSlash(SKILLS, "")).toEqual(SKILLS);
		expect(filterSkillsForSlash(SKILLS, "draft").map((s) => s.slug)).toEqual([
			"draft-a-brief",
		]);
		expect(filterSkillsForSlash(SKILLS, "BRIEF").map((s) => s.slug)).toEqual([
			"draft-a-brief",
		]);
		expect(filterSkillsForSlash(SKILLS, "basics").map((s) => s.slug)).toEqual([
			"campaign-basics",
		]);
		expect(filterSkillsForSlash(SKILLS, "nope")).toEqual([]);
	});
});

describe("SkillSlashMenu", () => {
	async function renderMenu(props: {
		skills?: Skill[];
		query?: string;
		onSelect?: (skill: Skill) => void;
	}): Promise<ReactTestRenderer> {
		let captured: ReactTestRenderer | undefined;
		await act(async () => {
			captured = await create(
				<StrictMode>
					<SkillSlashMenu
						onSelect={props.onSelect ?? (() => {})}
						query={props.query ?? ""}
						skills={props.skills ?? SKILLS}
					/>
				</StrictMode>,
			);
		});
		if (!captured) throw new Error("test renderer did not mount");
		return captured;
	}

	function options(renderer: ReactTestRenderer) {
		return renderer.root.findAll(
			(node) =>
				typeof node.type === "string" &&
				node.type === "button" &&
				node.props.role === "option",
		);
	}

	it("lists each skill with its /slug and description", async () => {
		const renderer = await renderMenu({});
		const opts = options(renderer);
		expect(opts).toHaveLength(2);
		const text = JSON.stringify(renderer.toJSON());
		// JSX renders the "/" and the slug as adjacent text nodes.
		expect(text).toContain("/campaign-basics");
		expect(text).toContain("A guided tour of the studio.");
		expect(text).toContain("/draft-a-brief");
	});

	it("filters by the query and hides with no matches", async () => {
		const filtered = await renderMenu({ query: "brief" });
		expect(options(filtered)).toHaveLength(1);
		const empty = await renderMenu({ query: "nope" });
		expect(empty.toJSON()).toBeNull();
	});

	it("caps its height and scrolls when the library overflows", async () => {
		// 29 builtin skills (KUK-917…930's onboarding skill made it 29):
		// the menu opens upward from the input, so an uncapped list grows
		// off the top of the viewport with no way to reach the rest.
		const renderer = await renderMenu({});
		const listbox = renderer.root.find(
			(node) =>
				typeof node.type === "string" &&
				node.type === "div" &&
				node.props.role === "listbox",
		);
		expect(listbox.props.className).toContain("max-h-[min(24rem,60dvh)]");
		expect(listbox.props.className).toContain("overflow-y-auto");
		expect(listbox.props.className).toContain("overscroll-contain");
		// The old overflow-hidden must be gone — it clipped content
		// without letting the user reach it.
		expect(listbox.props.className).not.toContain("overflow-hidden");
	});

	it("selects on mouse down without stealing textarea focus", async () => {
		const onSelect = vi.fn();
		const renderer = await renderMenu({ onSelect });
		const option = options(renderer)[0];
		let prevented = false;
		await act(async () => {
			option.props.onMouseDown({ preventDefault: () => (prevented = true) });
		});
		expect(prevented).toBe(true);
		expect(onSelect).toHaveBeenCalledWith(SKILLS[0]);
	});
});
