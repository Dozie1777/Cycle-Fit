// Provider passthrough probe (KUK-892): proves that the thinking-effort
// parameters reach the `inputs` object of `binding.run()` on the pinned
// workers-ai-provider version — NOT the run options (3rd argument), where
// pre-3.1.11 releases silently dropped them (cloudflare/ai#501).
//
// The probe mirrors the production pipeline exactly: the chat model is
// created with empty settings (`workersai(modelId, {})`) and the per-turn
// effort rides `providerOptions["workers-ai"]` on the streamText call,
// mapped by thinkingEffortInputs.
import { describe, expect, it, vi } from "vitest";
import { createWorkersAI } from "workers-ai-provider";
import {
	CAMPAIGN_CHAT_MODEL,
	type CampaignChatModel,
	thinkingEffortInputs,
} from "./campaign-chat-prompt";

type RunInputs = Record<string, unknown>;
type RunOptions = Record<string, unknown>;

/** Records every binding.run(model, inputs, options) call. */
function mockBinding() {
	const run = vi.fn(async () => ({
		choices: [
			{
				message: { role: "assistant", content: "ok" },
				finish_reason: "stop",
			},
		],
		usage: { prompt_tokens: 1, completion_tokens: 1 },
	}));
	return {
		run,
		calls: run.mock.calls as unknown as Array<[string, RunInputs, RunOptions]>,
	};
}

async function runOneTurn(
	modelId: CampaignChatModel,
	providerOptions?: Record<string, unknown>,
): Promise<{ binding: ReturnType<typeof mockBinding> }> {
	const binding = mockBinding();
	const workersai = createWorkersAI({ binding: binding as never });
	const model = workersai(modelId, {});
	const result = await model.doStream({
		prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
		providerOptions,
	} as Parameters<typeof model.doStream>[0]);
	// Drain the stream the way result.consumeStream() would.
	const reader = result.stream.getReader();
	for (;;) {
		const chunk = await reader.read();
		if (chunk.done) break;
	}
	return { binding };
}

describe("workers-ai-provider passthrough (pinned version probe)", () => {
	it("forwards reasoning_effort from providerOptions onto binding.run INPUTS for GLM", async () => {
		const { binding } = await runOneTurn(
			CAMPAIGN_CHAT_MODEL,
			// The exact shape the campaign chat pipeline sends (thinkingEffortInputs output).
			{ "workers-ai": thinkingEffortInputs(CAMPAIGN_CHAT_MODEL, "max") },
		);
		expect(binding.calls).toHaveLength(1);
		const [, inputs, options] = binding.calls[0];
		// On the inputs object (cloudflare/ai#501 fixed in ≥3.1.11):
		expect(inputs.reasoning_effort).toBe("max");
		expect(inputs.stream).toBe(true);
		expect(Array.isArray(inputs.messages)).toBe(true);
		// …and NOT on the run options, where the bug dropped them silently.
		expect(options).not.toHaveProperty("reasoning_effort");
	});

	it("forwards every GLM effort level (low / high / max) to the inputs", async () => {
		for (const effort of ["low", "high", "max"] as const) {
			const { binding } = await runOneTurn(CAMPAIGN_CHAT_MODEL, {
				"workers-ai": thinkingEffortInputs(CAMPAIGN_CHAT_MODEL, effort),
			});
			expect(binding.calls[0][1].reasoning_effort).toBe(effort);
			expect(binding.calls[0][2]).not.toHaveProperty("reasoning_effort");
		}
	});

	it("forwards chat_template_kwargs from providerOptions onto binding.run INPUTS", async () => {
		// Any extra inputs the pipeline sets must land on the inputs object,
		// not the run options (cloudflare/ai#501 fixed in ≥3.1.11).
		const { binding } = await runOneTurn(CAMPAIGN_CHAT_MODEL, {
			"workers-ai": { chat_template_kwargs: { clear_thinking: false } },
		});
		const [, inputs, options] = binding.calls[0];
		expect(inputs.chat_template_kwargs).toEqual({ clear_thinking: false });
		expect(inputs).not.toHaveProperty("reasoning_effort");
		expect(options).not.toHaveProperty("chat_template_kwargs");
	});

	it("sends no reasoning fields when no providerOptions are given", async () => {
		const { binding } = await runOneTurn(CAMPAIGN_CHAT_MODEL, undefined);
		const [, inputs] = binding.calls[0];
		expect(inputs).not.toHaveProperty("reasoning_effort");
		expect(inputs).not.toHaveProperty("chat_template_kwargs");
	});
});
