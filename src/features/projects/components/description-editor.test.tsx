import { StrictMode } from "react";
import {
	act,
	create,
	type ReactTestInstance,
	type ReactTestRenderer,
} from "react-test-renderer";
import { describe, expect, it } from "vitest";
import { DescriptionEditor } from "./description-editor";

// No mocks needed: the editor is presentational (value/onChange) and
// ShareMarkdown renders plain React without a DOM.

function nativeButtons(renderer: ReactTestRenderer): ReactTestInstance[] {
	return renderer.root.findAll(
		(node) => typeof node.type === "string" && node.type === "button",
	);
}

function byId(instance: ReactTestInstance, id: string): ReactTestInstance {
	// Match the composite Textarea component (whose onChange is the raw
	// handler), not the DOM node (whose onChange is Base UI's merged handler
	// and needs a full synthetic event).
	return instance.find(
		(node) =>
			typeof node.type === "function" &&
			node.type.name === "Textarea" &&
			node.props.id === id,
	);
}

async function renderEditor(value = ""): Promise<ReactTestRenderer> {
	let captured: ReactTestRenderer | undefined;
	await act(async () => {
		captured = await create(
			<StrictMode>
				<DescriptionEditor
					id="project-description"
					onChange={() => {}}
					value={value}
				/>
			</StrictMode>,
		);
	});
	if (!captured) throw new Error("test renderer did not mount");
	return captured;
}

describe("DescriptionEditor", () => {
	it("renders a labeled textarea in Write mode and propagates changes", async () => {
		const changes: string[] = [];
		let captured: ReactTestRenderer | undefined;
		await act(async () => {
			captured = await create(
				<StrictMode>
					<DescriptionEditor
						id="project-description"
						onChange={(v) => changes.push(v)}
						value="Draft"
					/>
				</StrictMode>,
			);
		});
		const renderer = captured as ReactTestRenderer;

		const textarea = byId(renderer.root, "project-description");
		expect(typeof textarea.type).toBe("function");
		expect((textarea.type as () => unknown).name).toBe("Textarea");
		expect(textarea.props.value).toBe("Draft");
		expect(textarea.props.maxLength).toBe(5000);

		await act(async () => {
			textarea.props.onChange({ target: { value: "Draft v2" } });
		});
		expect(changes).toEqual(["Draft v2"]);
	});

	it("Write mode is pressed by default and Preview switches to rendered markdown", async () => {
		const renderer = await renderEditor("# Title\n\n**Bold** intro");
		const [write, preview] = nativeButtons(renderer);
		expect(write.props["aria-pressed"]).toBe(true);
		expect(preview.props["aria-pressed"]).toBe(false);

		await act(async () => {
			preview.props.onClick();
		});
		expect(preview.props["aria-pressed"]).toBe(true);
		expect(write.props["aria-pressed"]).toBe(false);

		// ShareMarkdown pipeline output: the heading text without the "#".
		const json = JSON.stringify(renderer.toJSON());
		expect(json).toContain("Title");
		expect(json).toContain("Bold");
		expect(json).not.toContain('"# Title');
		// The textarea is gone in Preview mode.
		expect(
			renderer.root.findAll(
				(node) => typeof node.type === "string" && node.type === "textarea",
			),
		).toHaveLength(0);
	});

	it("shows a placeholder preview when there is nothing to render", async () => {
		const renderer = await renderEditor("   ");
		await act(async () => {
			nativeButtons(renderer)[1].props.onClick();
		});
		expect(JSON.stringify(renderer.toJSON())).toContain(
			"Nothing to preview yet.",
		);
	});
});
