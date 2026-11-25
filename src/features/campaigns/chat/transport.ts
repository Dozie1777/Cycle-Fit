import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";

export type CampaignChatTransportRefs = {
	thinkingEffort: { current: string };
};

type CampaignChatConnection = {
	sendMessage: (body: unknown) => Promise<unknown>;
	on: (name: string, callback: (...args: unknown[]) => void) => () => void;
};

/**
 * AI SDK ChatTransport that drives the campaign chat through the RivetKit
 * `campaignChat` actor (the same pattern as DesignChatTransport). The server
 * keeps history in D1 and runs its own model loop; the client only ships the
 * latest user message plus the per-turn thinking-effort choice.
 */
export class CampaignChatTransport implements ChatTransport<UIMessage> {
	constructor(
		connection: CampaignChatConnection,
		private refs: CampaignChatTransportRefs,
	) {
		this.connection = connection;
	}

	connection: CampaignChatConnection;

	async sendMessages({
		messages,
		abortSignal,
	}: Parameters<ChatTransport<UIMessage>["sendMessages"]>[0]): Promise<
		ReadableStream<UIMessageChunk>
	> {
		const last = messages[messages.length - 1];
		if (!last) {
			throw new Error("no messages to send");
		}

		const text = last.parts
			.filter((part) => part.type === "text")
			.map((part) => part.text)
			.join("");

		const body: Record<string, unknown> = {
			message: text,
			thinkingEffort: this.refs.thinkingEffort.current,
		};

		return this.streamFromActor(body, abortSignal);
	}

	async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
		return null;
	}

	private streamFromActor(
		body: Record<string, unknown>,
		abortSignal?: AbortSignal,
	): ReadableStream<UIMessageChunk> {
		const { connection } = this;
		let unsubChunk: (() => void) | undefined;
		let unsubFinished: (() => void) | undefined;
		let unsubFailed: (() => void) | undefined;

		const cleanup = () => {
			unsubChunk?.();
			unsubFinished?.();
			unsubFailed?.();
		};

		return new ReadableStream<UIMessageChunk>({
			start(controller) {
				unsubChunk = connection.on("uiMessageChunk", (payload) => {
					controller.enqueue(
						(payload as { chunk: UIMessageChunk } | undefined)?.chunk ??
							(payload as UIMessageChunk),
					);
				});
				unsubFinished = connection.on("turnFinished", () => {
					cleanup();
					controller.close();
				});
				unsubFailed = connection.on("turnFailed", (payload) => {
					cleanup();
					controller.error(
						new Error(
							(payload as { error?: string } | undefined)?.error ??
								"campaign chat turn failed",
						),
					);
				});

				abortSignal?.addEventListener(
					"abort",
					() => {
						cleanup();
						controller.close();
					},
					{ once: true },
				);

				connection.sendMessage(body).catch((error) => {
					cleanup();
					controller.error(
						error instanceof Error ? error : new Error(String(error)),
					);
				});
			},
			cancel() {
				cleanup();
			},
		});
	}
}
