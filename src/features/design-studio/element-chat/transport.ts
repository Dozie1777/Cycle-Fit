import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";

type ElementChatConnection = {
	sendMessage: (body: unknown) => Promise<unknown>;
	on: (name: string, callback: (...args: unknown[]) => void) => () => void;
};

/**
 * AI SDK ChatTransport driving the focused element chat through the
 * RivetKit `elementChat` actor — same pattern as DesignChatTransport. The
 * conversation is NOT in the message body: the connection was scoped by
 * params at connect time, so the server derives it. History and model
 * state live server-side (D1); the client ships only the latest message.
 */
export class ElementChatTransport implements ChatTransport<UIMessage> {
	connection: ElementChatConnection;

	constructor(connection: ElementChatConnection) {
		this.connection = connection;
	}

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

		return this.streamFromActor({ message: text }, abortSignal);
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
						(payload as { chunk?: UIMessageChunk } | undefined)?.chunk ??
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
								"element chat turn failed",
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
