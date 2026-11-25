import { actor } from "rivetkit";

// Minimal connectivity probe: the RivetKit "hello world" for this worker.
// Uses the low-level `onWebSocket` handler instead of actions/events so it
// exercises the raw WebSocket path through the `ActorHandler` Durable Object
// (the same pattern rivet/actor-node/src/actors/ relies on for streams and
// booking sessions). Keyed freely — every key gets an independent DO-backed
// actor, e.g. `client.ping.getOrCreate(["design:123"])`.
export const ping = actor({
	state: { pongs: 0 },
	onWebSocket: (c, websocket) => {
		websocket.addEventListener("open", () => {
			// Tell the client how many pongs this actor has served so far.
			websocket.send(JSON.stringify({ type: "ready", pongs: c.state.pongs }));
		});

		websocket.addEventListener("message", (event) => {
			if (event.data !== "ping") return;

			c.state.pongs += 1;
			websocket.send(
				JSON.stringify({
					type: "pong",
					at: Date.now(),
					pongs: c.state.pongs,
				}),
			);
			// WebSocket connections are long-lived; persist the counter eagerly
			// so it survives the Durable Object hibernating or restarting.
			c.saveState({ immediate: true });
		});
	},
	actions: {
		// Same probe over HTTP for clients that don't hold a WebSocket open.
		ping: (c) => {
			c.state.pongs += 1;
			c.saveState({ immediate: true });
			return { at: Date.now(), pongs: c.state.pongs };
		},
	},
});
