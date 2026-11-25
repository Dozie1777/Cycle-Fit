import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";

export type DesignChatTransportRefs = {
	section: { current: string | null };
	model: { current: string };
};

type DesignChatConnection = {
	sendMessage: (body: unknown) => Promise<unknown>;
	on: (name: string, callback: (...args: unknown[]) => void) => () => void;
};

/**
 * AI SDK ChatTransport that drives the design chat through the RivetKit
 * `designChat` actor. The server keeps history and model state; the client
 * only ships the latest user message plus the current canvas selection,
 * selected model, and attached asset ids.
 */
export class DesignChatTransport implements ChatTransport<UIMessage> {
	constructor(
		connection: DesignChatConnection,
		private refs: DesignChatTransportRefs,
	) {
		this.connection = connection;
	}

	connection: DesignChatConnection;

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
		const { assetIds } = (last.metadata ?? {}) as { assetIds?: string[] };

		const body: Record<string, unknown> = {
			message: text,
			model: this.refs.model.current,
			origin: typeof window !== "undefined" ? window.location.origin : "",
		};
		if (this.refs.section.current) {
			body.section = this.refs.section.current;
		}
		if (assetIds && assetIds.length > 0) {
			body.assets = assetIds;
		}

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
								"design chat turn failed",
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
