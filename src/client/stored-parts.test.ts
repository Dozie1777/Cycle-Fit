import { describe, expect, it } from "vitest";
import { parseStoredParts } from "./stored-parts";

describe("parseStoredParts", () => {
	it("returns [] for null, empty, or malformed JSON", () => {
		expect(parseStoredParts(null)).toEqual([]);
		expect(parseStoredParts(undefined)).toEqual([]);
		expect(parseStoredParts("")).toEqual([]);
		expect(parseStoredParts("not json")).toEqual([]);
		expect(parseStoredParts('{"type":"text"}')).toEqual([]);
	});

	it("round-trips the parts the pipeline stored", () => {
		const stored = [
			{ type: "reasoning", state: "done", text: "thinking" },
			{
				type: "tool-save_component",
				toolCallId: "c1",
				state: "output-available",
				input: { name: "Card" },
				output: { ok: true, previewUrl: "/p" },
			},
			{ type: "text", state: "done", text: "Saved your card." },
		];
		const parsed = parseStoredParts(JSON.stringify(stored));
		expect(parsed).toEqual(stored);
	});

	it("drops malformed entries but keeps usable siblings", () => {
		const json = JSON.stringify([
			null,
			"junk",
			{ type: "text" }, // no text
			{ type: "text", text: "   " }, // blank text
			{ type: "tool-x", toolCallId: "t1" }, // no state
			{ type: "tool-approval-request", toolCallId: "t2" }, // no state
			{
				type: "dynamic-tool",
				toolCallId: "t3",
				state: "output-available",
			}, // dynamic without toolName
			{ type: "text", text: "kept" },
			{
				type: "tool-wireframe",
				toolCallId: "t4",
				state: "output-error",
				errorText: "boom",
			},
		]);
		expect(parseStoredParts(json)).toEqual([
			{ type: "text", state: "done", text: "kept" },
			{
				type: "tool-wireframe",
				toolCallId: "t4",
				state: "output-error",
				errorText: "boom",
			},
		]);
	});

	it("keeps a well-formed dynamic-tool part with its toolName", () => {
		const json = JSON.stringify([
			{
				type: "dynamic-tool",
				toolName: "mcpSearch",
				toolCallId: "d1",
				state: "output-available",
				input: { q: "x" },
				output: { hits: 1 },
			},
		]);
		expect(parseStoredParts(json)).toEqual([
			{
				type: "dynamic-tool",
				toolName: "mcpSearch",
				toolCallId: "d1",
				state: "output-available",
				input: { q: "x" },
				output: { hits: 1 },
			},
		]);
	});
});
