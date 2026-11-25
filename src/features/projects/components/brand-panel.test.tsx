import { type ReactNode, StrictMode } from "react";
import {
	act,
	create,
	type ReactTestInstance,
	type ReactTestRenderer,
} from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import type {
	AdoptBrandKitResponse,
	BrandKit,
	DesignDetail,
	ProjectDetail,
} from "@/client/api-types";
import { BrandPanel } from "./brand-panel";

// ---------------------------------------------------------------------------
// Mocks: queries + the Base UI Select primitive (needs a DOM).
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
	useBrandKit: vi.fn(),
	useUpsertBrandKit: vi.fn(),
	useDeleteBrandKit: vi.fn(),
	useProject: vi.fn(),
	useAdoptBrandKit: vi.fn(),
}));

vi.mock("@/client/queries", () => mocks);

vi.mock("@/components/ui/select", () => ({
	Select: (props: { children?: ReactNode }) => <div>{props.children}</div>,
	SelectTrigger: (props: { children?: ReactNode }) => (
		<div>{props.children}</div>
	),
	SelectValue: ({ children }: { children?: ReactNode }) => <>{children}</>,
	SelectContent: (props: { children?: ReactNode }) => (
		<div>{props.children}</div>
	),
	SelectItem: (props: { value: string; children?: ReactNode }) => (
		<div data-select-item={props.value}>{props.children}</div>
	),
}));

const KIT: BrandKit = {
	id: "brandkit-p1",
	projectId: "p1",
	name: "Spring brand",
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-02T00:00:00.000Z",
	palettes: [
		{
			id: "brandkit-p1-light",
			kitId: "brandkit-p1",
			mode: "light",
			colors: [
				{
					id: "c1",
					paletteId: "brandkit-p1-light",
					role: "background",
					value: "#ffffff",
				},
				{
					id: "c2",
					paletteId: "brandkit-p1-light",
					role: "foreground",
					value: "#09090b",
				},
				{
					id: "c3",
					paletteId: "brandkit-p1-light",
					role: "primary",
					value: "#18181b",
				},
			],
		},
	],
	typography: [
		{
			id: "t1",
			kitId: "brandkit-p1",
			role: "heading",
			stack: "ui-serif, Georgia",
		},
	],
	fonts: [
		{
			id: "f1",
			kitId: "brandkit-p1",
			family: "Inter",
			source: "google",
			url: null,
			weights: "400;700",
			italic: false,
			createdAt: "2026-01-01T00:00:00.000Z",
		},
	],
};

const KIT_WITH_DARK: BrandKit = {
	...KIT,
	palettes: [
		...KIT.palettes,
		{
			id: "brandkit-p1-dark",
			kitId: "brandkit-p1",
			mode: "dark",
			colors: [
				{
					id: "c4",
					paletteId: "brandkit-p1-dark",
					role: "background",
					value: "#0b0b0f",
				},
			],
		},
	],
};

function mutationStub(overrides: Record<string, unknown> = {}) {
	return {
		mutate: vi.fn(),
		mutateAsync: vi.fn(() => Promise.resolve(KIT)),
		isPending: false,
		isError: false,
		error: null,
		...overrides,
	};
}

// KUK-901 fixtures: a published design of the project + adopt responses.
const DESIGN: DesignDetail = {
	id: "d1",
	prompt: "A warm editorial landing page",
	status: "done",
	error: null,
	liveTurnId: "turn-1",
	projectId: "p1",
	remixedFromId: null,
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
	hasIndex: true,
	hasPreview: true,
	sections: [],
	files: [],
	publication: null,
};

function projectWith(designs: DesignDetail[]): { data: ProjectDetail } {
	return {
		data: {
			id: "p1",
			name: "P",
			description: null,
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			designs,
			campaignCount: 0,
			hasBrandKit: false,
		},
	};
}

const ADOPTED_KIT: BrandKit = {
	id: "brandkit-p1",
	projectId: "p1",
	name: "Adopted brand kit",
	createdAt: "2026-01-03T00:00:00.000Z",
	updatedAt: "2026-01-03T00:00:00.000Z",
	palettes: [
		{
			id: "brandkit-p1-light",
			kitId: "brandkit-p1",
			mode: "light",
			colors: [
				{
					id: "a1",
					paletteId: "brandkit-p1-light",
					role: "background",
					value: "#f6eddd",
				},
				{
					id: "a2",
					paletteId: "brandkit-p1-light",
					role: "foreground",
					value: "#111111",
				},
				{
					id: "a3",
					paletteId: "brandkit-p1-light",
					role: "primary",
					value: "#2563eb",
				},
			],
		},
	],
	typography: [
		{
			id: "t2",
			kitId: "brandkit-p1",
			role: "heading",
			stack: "Georgia, serif",
		},
	],
	fonts: [
		{
			id: "f2",
			kitId: "brandkit-p1",
			family: "Space Grotesk",
			source: "google",
			url: null,
			weights: "300..700",
			italic: false,
			createdAt: "2026-01-03T00:00:00.000Z",
		},
	],
};

const ADOPT_SAVED: AdoptBrandKitResponse = {
	adopted: {
		colors: [
			{ role: "background", value: "#f6eddd" },
			{ role: "foreground", value: "#111111" },
			{ role: "primary", value: "#2563eb" },
		],
		typography: [{ role: "heading", stack: "Georgia, serif" }],
		fonts: [
			{
				family: "Space Grotesk",
				source: "google",
				url: null,
				weights: "300..700",
				italic: false,
			},
		],
	},
	skipped: ["--paper"],
	missing: [],
	saved: true,
	kit: ADOPTED_KIT,
};

const ADOPT_MISSING: AdoptBrandKitResponse = {
	adopted: {
		colors: [{ role: "background", value: "#f6eddd" }],
		typography: [],
		fonts: [],
	},
	skipped: ["--paper", "--primary"],
	missing: ["foreground", "primary"],
	saved: false,
	kit: null,
};

// Defaults for the two KUK-901 hooks; adopt tests override per scenario.
mocks.useProject.mockReturnValue({ data: null, isPending: false });
mocks.useAdoptBrandKit.mockReturnValue(mutationStub());

function byId(instance: ReactTestInstance, id: string): ReactTestInstance {
	// Match the composite Input component (whose onChange is the raw
	// handler), not the DOM node.
	return instance.find((node) => {
		const name = typeof node.type === "function" ? node.type.name : "";
		return name === "Input" && node.props.id === id;
	});
}

function nativeButtons(renderer: ReactTestRenderer): ReactTestInstance[] {
	return renderer.root.findAll(
		(node) => typeof node.type === "string" && node.type === "button",
	);
}

function buttonByText(
	renderer: ReactTestRenderer,
	text: string,
): ReactTestInstance {
	const button = nativeButtons(renderer).find(
		(node) => node.children[0] === text,
	);
	if (!button) throw new Error(`no button labelled "${text}"`);
	return button;
}

async function renderPanel(): Promise<ReactTestRenderer> {
	let captured: ReactTestRenderer | undefined;
	await act(async () => {
		captured = await create(
			<StrictMode>
				<BrandPanel projectId="p1" />
			</StrictMode>,
		);
	});
	if (!captured) throw new Error("test renderer did not mount");
	return captured;
}

describe("BrandPanel", () => {
	it("renders a row per role from the lib role lists", async () => {
		mocks.useBrandKit.mockReturnValue({ data: KIT, isPending: false });
		mocks.useUpsertBrandKit.mockReturnValue(mutationStub());
		mocks.useDeleteBrandKit.mockReturnValue(mutationStub());
		const renderer = await renderPanel();
		const text = JSON.stringify(renderer.toJSON());
		// Color roles (BRAND_COLOR_ROLES)…
		for (const label of [
			"Background",
			"Foreground",
			"Primary foreground",
			"Muted",
			"Border",
			"Accent",
		]) {
			expect(text).toContain(label);
		}
		// …typography roles (BRAND_TYPOGRAPHY_ROLES)…
		for (const label of ["Heading", "Body", "Display"]) {
			expect(text).toContain(label);
		}
		// …and the Google Fonts URL preview generated from the lib.
		expect(text).toContain(
			"https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap",
		);
	});

	it("maps a 404 (no kit) to the empty state and creates with defaults", async () => {
		mocks.useBrandKit.mockReturnValue({ data: null, isPending: false });
		mocks.useUpsertBrandKit.mockReturnValue(mutationStub());
		mocks.useDeleteBrandKit.mockReturnValue(mutationStub());
		const renderer = await renderPanel();
		expect(JSON.stringify(renderer.toJSON())).toContain(
			"No brand kit yet — designs derive style from the page.",
		);

		await act(async () => {
			buttonByText(renderer, "Create brand kit").props.onClick();
		});
		const text = JSON.stringify(renderer.toJSON());
		expect(text).toContain("Brand kit"); // default name
		expect(
			byId(renderer.root, "brand-kit-color-light-background").props.value,
		).toBe("#ffffff");
		expect(
			byId(renderer.root, "brand-kit-color-light-foreground").props.value,
		).toBe("#09090b");
		expect(
			byId(renderer.root, "brand-kit-color-light-primary").props.value,
		).toBe("#18181b");
		// A fresh unsaved draft is dirty from the start.
		expect(buttonByText(renderer, "Create kit").props.disabled).toBe(false);
	});

	it("saves a dirty draft with the full-replace body", async () => {
		mocks.useBrandKit.mockReturnValue({ data: KIT, isPending: false });
		const upsert = mutationStub();
		mocks.useUpsertBrandKit.mockReturnValue(upsert);
		mocks.useDeleteBrandKit.mockReturnValue(mutationStub());
		const renderer = await renderPanel();

		// Clean state: save disabled.
		expect(buttonByText(renderer, "Save").props.disabled).toBe(true);

		await act(async () => {
			byId(renderer.root, "brand-kit-color-light-primary").props.onChange({
				target: { value: "#ff0000" },
			});
		});
		expect(buttonByText(renderer, "Save").props.disabled).toBe(false);

		await act(async () => {
			buttonByText(renderer, "Save").props.onClick();
		});

		expect(upsert.mutateAsync).toHaveBeenCalledWith({
			projectId: "p1",
			body: {
				name: "Spring brand",
				palettes: [
					{
						mode: "light",
						colors: [
							{ role: "background", value: "#ffffff" },
							{ role: "foreground", value: "#09090b" },
							{ role: "primary", value: "#ff0000" },
						],
					},
				],
				typography: [{ role: "heading", stack: "ui-serif, Georgia" }],
				fonts: [{ family: "Inter", source: "google", weights: "400;700" }],
			},
		});
	});

	it("drops a palette whose colors are all cleared (full-replace semantics)", async () => {
		mocks.useBrandKit.mockReturnValue({
			data: KIT_WITH_DARK,
			isPending: false,
		});
		const upsert = mutationStub();
		mocks.useUpsertBrandKit.mockReturnValue(upsert);
		mocks.useDeleteBrandKit.mockReturnValue(mutationStub());
		const renderer = await renderPanel();

		await act(async () => {
			buttonByText(renderer, "Dark").props.onClick();
		});
		await act(async () => {
			byId(renderer.root, "brand-kit-color-dark-background").props.onChange({
				target: { value: "" },
			});
		});

		await act(async () => {
			buttonByText(renderer, "Save").props.onClick();
		});

		const calls = upsert.mutateAsync.mock.calls as unknown as Array<
			[{ body: { palettes: { mode: string }[] } }]
		>;
		const call = calls[0]?.[0];
		expect(call).toBeDefined();
		expect(call?.body.palettes.map((palette) => palette.mode)).toEqual([
			"light",
		]);
	});

	it("surfaces validation errors inline and blocks saving", async () => {
		mocks.useBrandKit.mockReturnValue({ data: KIT, isPending: false });
		const upsert = mutationStub();
		mocks.useUpsertBrandKit.mockReturnValue(upsert);
		mocks.useDeleteBrandKit.mockReturnValue(mutationStub());
		const renderer = await renderPanel();

		await act(async () => {
			byId(renderer.root, "brand-kit-color-light-primary").props.onChange({
				target: { value: "not-a-hex" },
			});
		});
		expect(JSON.stringify(renderer.toJSON())).toContain("Use #rgb or #rrggbb");
		expect(buttonByText(renderer, "Save").props.disabled).toBe(true);
		expect(upsert.mutateAsync).not.toHaveBeenCalled();

		// Cancel reverts to the server state and clears the error.
		await act(async () => {
			buttonByText(renderer, "Cancel").props.onClick();
		});
		expect(
			byId(renderer.root, "brand-kit-color-light-primary").props.value,
		).toBe("#18181b");
		expect(JSON.stringify(renderer.toJSON())).not.toContain(
			"Use #rgb or #rrggbb",
		);
	});

	it("flags a light palette missing the required roles", async () => {
		const incomplete: BrandKit = {
			...KIT,
			palettes: [
				{
					...KIT.palettes[0],
					colors: KIT.palettes[0].colors.filter(
						(color) => color.role !== "background",
					),
				},
			],
		};
		mocks.useBrandKit.mockReturnValue({ data: incomplete, isPending: false });
		mocks.useUpsertBrandKit.mockReturnValue(mutationStub());
		mocks.useDeleteBrandKit.mockReturnValue(mutationStub());
		const renderer = await renderPanel();
		expect(JSON.stringify(renderer.toJSON())).toContain(
			"Light palette is missing required colors: background.",
		);
		expect(buttonByText(renderer, "Save").props.disabled).toBe(true);
	});

	it("surfaces the API error inline when the upsert rejects", async () => {
		mocks.useBrandKit.mockReturnValue({ data: KIT, isPending: false });
		const upsert = mutationStub({
			mutateAsync: vi.fn(() =>
				Promise.reject(
					new Error("light palette is missing required colors: background"),
				),
			),
		});
		mocks.useUpsertBrandKit.mockReturnValue(upsert);
		mocks.useDeleteBrandKit.mockReturnValue(mutationStub());
		const renderer = await renderPanel();

		await act(async () => {
			byId(renderer.root, "brand-kit-color-light-primary").props.onChange({
				target: { value: "#ff0000" },
			});
		});
		await act(async () => {
			buttonByText(renderer, "Save").props.onClick();
		});

		expect(JSON.stringify(renderer.toJSON())).toContain(
			"light palette is missing required colors: background",
		);
	});

	it("seeds a dark palette from light on first visit", async () => {
		mocks.useBrandKit.mockReturnValue({ data: KIT, isPending: false });
		mocks.useUpsertBrandKit.mockReturnValue(mutationStub());
		mocks.useDeleteBrandKit.mockReturnValue(mutationStub());
		const renderer = await renderPanel();

		await act(async () => {
			buttonByText(renderer, "Dark").props.onClick();
		});
		expect(
			byId(renderer.root, "brand-kit-color-dark-background").props.value,
		).toBe("#ffffff");
		expect(
			byId(renderer.root, "brand-kit-color-dark-foreground").props.value,
		).toBe("#09090b");
	});

	it("deletes the kit after confirm", async () => {
		mocks.useBrandKit.mockReturnValue({ data: KIT, isPending: false });
		mocks.useUpsertBrandKit.mockReturnValue(mutationStub());
		const remove = mutationStub();
		mocks.useDeleteBrandKit.mockReturnValue(remove);
		const confirm = vi
			.fn<(message?: string) => boolean>()
			.mockReturnValue(true);
		vi.stubGlobal("confirm", confirm);
		const renderer = await renderPanel();

		await act(async () => {
			buttonByText(renderer, "Delete kit").props.onClick();
		});

		expect(confirm).toHaveBeenCalledWith(
			expect.stringContaining('Delete the brand kit "Spring brand"'),
		);
		expect(remove.mutateAsync).toHaveBeenCalledWith("p1");

		vi.unstubAllGlobals();
	});

	it("does not delete when confirm is dismissed", async () => {
		mocks.useBrandKit.mockReturnValue({ data: KIT, isPending: false });
		mocks.useUpsertBrandKit.mockReturnValue(mutationStub());
		const remove = mutationStub();
		mocks.useDeleteBrandKit.mockReturnValue(remove);
		const confirm = vi
			.fn<(message?: string) => boolean>()
			.mockReturnValue(false);
		vi.stubGlobal("confirm", confirm);
		const renderer = await renderPanel();

		await act(async () => {
			buttonByText(renderer, "Delete kit").props.onClick();
		});

		expect(remove.mutateAsync).not.toHaveBeenCalled();
		vi.unstubAllGlobals();
	});

	// ---------------------------------------------------------------------
	// KUK-901: token adoption from a published design.
	// ---------------------------------------------------------------------

	it("disables the adopt action when the project has no published designs", async () => {
		mocks.useBrandKit.mockReturnValue({ data: KIT, isPending: false });
		mocks.useUpsertBrandKit.mockReturnValue(mutationStub());
		mocks.useDeleteBrandKit.mockReturnValue(mutationStub());
		mocks.useProject.mockReturnValue(
			projectWith([{ ...DESIGN, id: "d2", hasIndex: false }]),
		);
		const renderer = await renderPanel();

		const trigger = buttonByText(renderer, "Adopt from design…");
		expect(trigger.props.disabled).toBe(true);
		// ...and carries the hint for why.
		expect(trigger.props.title).toContain("No published designs");
	});

	it("adopts a published design and rehydrates the editor from the saved kit", async () => {
		mocks.useBrandKit.mockReturnValue({ data: KIT, isPending: false });
		mocks.useUpsertBrandKit.mockReturnValue(mutationStub());
		mocks.useDeleteBrandKit.mockReturnValue(mutationStub());
		mocks.useProject.mockReturnValue(projectWith([DESIGN]));
		const adopt = mutationStub({
			mutateAsync: vi.fn(() => Promise.resolve(ADOPT_SAVED)),
		});
		mocks.useAdoptBrandKit.mockReturnValue(adopt);
		const renderer = await renderPanel();

		// Open the picker — the published design is listed by prompt.
		await act(async () => {
			buttonByText(renderer, "Adopt from design…").props.onClick();
		});
		expect(JSON.stringify(renderer.toJSON())).toContain(
			"A warm editorial landing page",
		);

		await act(async () => {
			buttonByText(renderer, "Adopt").props.onClick();
		});

		expect(adopt.mutateAsync).toHaveBeenCalledWith({
			projectId: "p1",
			designId: "d1",
		});
		// The editor shows the adopted values + the result summary.
		expect(
			byId(renderer.root, "brand-kit-color-light-background").props.value,
		).toBe("#f6eddd");
		expect(
			byId(renderer.root, "brand-kit-color-light-primary").props.value,
		).toBe("#2563eb");
		const text = JSON.stringify(renderer.toJSON());
		expect(text).toContain("Saved — adopted 3 color(s)");
		expect(text).toContain("Skipped unmapped tokens: --paper");
		// A saved adoption is the new clean baseline — Save disabled.
		expect(buttonByText(renderer, "Save").props.disabled).toBe(true);
	});

	it("prefills an unsaved draft and reports missing roles when required colors are absent", async () => {
		mocks.useBrandKit.mockReturnValue({ data: KIT, isPending: false });
		mocks.useUpsertBrandKit.mockReturnValue(mutationStub());
		mocks.useDeleteBrandKit.mockReturnValue(mutationStub());
		mocks.useProject.mockReturnValue(projectWith([DESIGN]));
		const adopt = mutationStub({
			mutateAsync: vi.fn(() => Promise.resolve(ADOPT_MISSING)),
		});
		mocks.useAdoptBrandKit.mockReturnValue(adopt);
		const renderer = await renderPanel();

		await act(async () => {
			buttonByText(renderer, "Adopt from design…").props.onClick();
		});
		await act(async () => {
			buttonByText(renderer, "Adopt").props.onClick();
		});

		// Prefilled with what was adopted — background set, foreground empty.
		expect(
			byId(renderer.root, "brand-kit-color-light-background").props.value,
		).toBe("#f6eddd");
		expect(
			byId(renderer.root, "brand-kit-color-light-foreground").props.value,
		).toBe("");
		// The summary names the missing roles; nothing was saved server-side.
		const text = JSON.stringify(renderer.toJSON());
		expect(text).toContain("missing required colors: foreground, primary");
		expect(text).toContain("Skipped unmapped tokens: --paper, --primary");
		expect(adopt.mutateAsync).toHaveBeenCalledTimes(1);

		// The existing validation blocks saving until the roles are filled.
		expect(buttonByText(renderer, "Save").props.disabled).toBe(true);
		await act(async () => {
			byId(renderer.root, "brand-kit-color-light-foreground").props.onChange({
				target: { value: "#111111" },
			});
		});
		await act(async () => {
			byId(renderer.root, "brand-kit-color-light-primary").props.onChange({
				target: { value: "#2563eb" },
			});
		});
		expect(buttonByText(renderer, "Save").props.disabled).toBe(false);
	});

	it("surfaces the adopt API error inline", async () => {
		mocks.useBrandKit.mockReturnValue({ data: KIT, isPending: false });
		mocks.useUpsertBrandKit.mockReturnValue(mutationStub());
		mocks.useDeleteBrandKit.mockReturnValue(mutationStub());
		mocks.useProject.mockReturnValue(projectWith([DESIGN]));
		mocks.useAdoptBrandKit.mockReturnValue(
			mutationStub({
				mutateAsync: vi.fn(() =>
					Promise.reject(new Error("design has no published index.html")),
				),
			}),
		);
		const renderer = await renderPanel();

		await act(async () => {
			buttonByText(renderer, "Adopt from design…").props.onClick();
		});
		await act(async () => {
			buttonByText(renderer, "Adopt").props.onClick();
		});

		expect(JSON.stringify(renderer.toJSON())).toContain(
			"design has no published index.html",
		);
	});
});
