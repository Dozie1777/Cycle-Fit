import { describe, expect, it } from "vitest";
import {
	chatPartsFromSteps,
	chatPartsPayload,
	type StoredChatPart,
	withTextPart,
} from "./chat-parts";

/** A finished step whose content is just text (typed loosely as the SDK does). */
function step(content: unknown[]) {
	return { content } as Parameters<typeof chatPartsFromSteps>[0][number];
}

describe("chatPartsFromSteps", () => {
	it("builds text parts from step content", () => {
		const parts = chatPartsFromSteps(
			[step([{ type: "text", text: "Here is your design." }])],
			"Here is your design.",
		);
		expect(parts).toEqual([
			{ type: "text", state: "done", text: "Here is your design." },
		]);
	});

	it("builds reasoning parts", () => {
		const parts = chatPartsFromSteps(
			[step([{ type: "reasoning", text: "thinking hard" }])],
			"",
		);
		expect(parts).toEqual([
			{ type: "reasoning", state: "done", text: "thinking hard" },
		]);
	});

	it("merges a tool call with its result into one output-available part", () => {
		const parts = chatPartsFromSteps(
			[
				step([
					{
						type: "tool-call",
						toolCallId: "call-1",
						toolName: "propose_design",
						input: { name: "Landing" },
					},
					{
						type: "tool-result",
						toolCallId: "call-1",
						toolName: "propose_design",
						input: { name: "Landing" },
						output: { ok: true, previewUrl: "/preview" },
					},
				]),
			],
			"",
		);
		expect(parts).toEqual([
			{
				type: "tool-propose_design",
				toolCallId: "call-1",
				state: "output-available",
				input: { name: "Landing" },
				output: { ok: true, previewUrl: "/preview" },
			},
		]);
	});

	it("renders dynamic (MCP) tool parts with their toolName", () => {
		const parts = chatPartsFromSteps(
			[
				step([
					{
						type: "tool-call",
						toolCallId: "d1",
						toolName: "mcpSearch",
						input: { q: "x" },
						dynamic: true,
					},
					{
						type: "tool-result",
						toolCallId: "d1",
						toolName: "mcpSearch",
						input: { q: "x" },
						output: { hits: 2 },
						dynamic: true,
					},
				]),
			],
			"",
		);
		expect(parts).toEqual([
			{
				type: "dynamic-tool",
				toolName: "mcpSearch",
				toolCallId: "d1",
				state: "output-available",
				input: { q: "x" },
				output: { hits: 2 },
			},
		]);
	});

	it("marks a tool error part with its message", () => {
		const parts = chatPartsFromSteps(
			[
				step([
					{
						type: "tool-call",
						toolCallId: "e1",
						toolName: "wireframe",
						input: {},
					},
					{
						type: "tool-error",
						toolCallId: "e1",
						toolName: "wireframe",
						input: {},
						error: new Error("boom"),
					},
				]),
			],
			"",
		);
		expect(parts).toEqual([
			{
				type: "tool-wireframe",
				toolCallId: "e1",
				state: "output-error",
				input: {},
				errorText: "boom",
			},
		]);
	});

	it("appends the fallback text when no streamed text exists (ask_user turn)", () => {
		const parts = chatPartsFromSteps(
			[
				step([
					{
						type: "tool-call",
						toolCallId: "a1",
						toolName: "ask_user",
						input: { question: "Which palette?" },
					},
					{
						type: "tool-result",
						toolCallId: "a1",
						toolName: "ask_user",
						input: { question: "Which palette?" },
						output: { question: "Which palette?" },
					},
				]),
			],
			"I'd like to know: Which palette?",
		);
		expect(parts).toEqual([
			{
				type: "tool-ask_user",
				toolCallId: "a1",
				state: "output-available",
				input: { question: "Which palette?" },
				output: { question: "Which palette?" },
			},
			{ type: "text", state: "done", text: "I'd like to know: Which palette?" },
		]);
	});

	it("does not duplicate the fallback text when streamed text exists", () => {
		const parts = chatPartsFromSteps(
			[
				step([
					{
						type: "tool-call",
						toolCallId: "t1",
						toolName: "wireframe",
						input: {},
					},
					{
						type: "tool-result",
						toolCallId: "t1",
						toolName: "wireframe",
						input: {},
						output: { ok: true, previewUrl: "/p" },
					},
				]),
				step([{ type: "text", text: "Done — here is the wireframe." }]),
			],
			"Done — here is the wireframe.",
		);
		expect(parts).toEqual([
			{
				type: "tool-wireframe",
				toolCallId: "t1",
				state: "output-available",
				input: {},
				output: { ok: true, previewUrl: "/p" },
			},
			{ type: "text", state: "done", text: "Done — here is the wireframe." },
		]);
	});

	it("skips empty text and unknown content shapes", () => {
		const parts = chatPartsFromSteps(
			[
				step([
					{ type: "text", text: "  " },
					{ type: "source", id: "s" },
				]),
			],
			"",
		);
		expect(parts).toEqual([]);
	});
});

describe("chatPartsPayload", () => {
	it("serializes small parts as-is", () => {
		const parts: StoredChatPart[] = [
			{ type: "text", state: "done", text: "hi" },
		];
		expect(chatPartsPayload(parts)).toBe(JSON.stringify(parts));
	});

	it("strips tool payloads when over budget, keeping text and names", () => {
		const big = "x".repeat(900_000);
		const parts: StoredChatPart[] = [
			{ type: "text", state: "done", text: "answer" },
			{
				type: "tool-propose_design",
				toolCallId: "p1",
				state: "output-available",
				input: { html: big },
				output: { ok: true, html: big },
			},
		];
		const json = chatPartsPayload(parts);
		expect(json).not.toBeNull();
		const parsed = JSON.parse(json ?? "[]") as StoredChatPart[];
		expect(parsed[0]).toEqual({ type: "text", state: "done", text: "answer" });
		const tool = parsed[1] as Extract<StoredChatPart, { toolCallId?: string }>;
		expect(tool.type).toBe("tool-propose_design");
		expect(tool.state).toBe("output-available");
		expect(tool.input).toBeUndefined();
		expect(tool.output).toEqual({ truncated: true });
	});

	it("keeps errorText through the strip and returns null when even that overflows", () => {
		const big = "x".repeat(900_000);
		// The overflow comes from a tool payload, so the strip pass fits and
		// the error part keeps its message.
		const parts: StoredChatPart[] = [
			{
				type: "tool-save_component",
				toolCallId: "s1",
				state: "output-available",
				input: { code: big },
				output: { ok: true },
			},
			{
				type: "tool-test_component",
				toolCallId: "t1",
				state: "output-error",
				errorText: "short",
			},
		];
		const json = chatPartsPayload(parts);
		expect(json).not.toBeNull();
		const parsed = JSON.parse(json ?? "[]") as StoredChatPart[];
		const stripped = parsed[0] as Extract<
			StoredChatPart,
			{ toolCallId?: string }
		>;
		expect(stripped.input).toBeUndefined();
		expect(stripped.output).toEqual({ truncated: true });
		const errored = parsed[1] as Extract<
			StoredChatPart,
			{ toolCallId?: string }
		>;
		expect(errored.errorText).toBe("short");
	});

	it("returns null when unstrippable text alone exceeds the budget", () => {
		const huge = "y".repeat(900_000);
		const overBudget: StoredChatPart[] = [
			{ type: "text", state: "done", text: huge },
		];
		expect(chatPartsPayload(overBudget)).toBeNull();
	});

	it("sizes the budget in UTF-8 bytes, not UTF-16 characters", () => {
		// 300k CJK characters: 300,002 UTF-16 units (would pass a .length
		// check) but ~900KB of UTF-8 — over the D1 byte budget.
		const multibyte = "漢".repeat(300_000);
		const parts: StoredChatPart[] = [
			{ type: "text", state: "done", text: multibyte },
		];
		expect(chatPartsPayload(parts)).toBeNull();
	});
});

describe("withTextPart", () => {
	it("appends a note on top of existing text parts without duplicating", () => {
		const parts: StoredChatPart[] = [
			{ type: "text", state: "done", text: "partial streamed text" },
		];
		withTextPart(parts, "partial streamed text");
		expect(parts).toHaveLength(1);
		withTextPart(parts, "The turn timed out mid-stream.");
		expect(parts).toHaveLength(2);
		expect(parts[1]).toEqual({
			type: "text",
			state: "done",
			text: "The turn timed out mid-stream.",
		});
		withTextPart(parts, "   ");
		expect(parts).toHaveLength(2);
	});
});
