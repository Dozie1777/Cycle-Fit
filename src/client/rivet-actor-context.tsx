import { createRivetKit } from "@rivetkit/react";
import { createContext, type ReactNode, useContext, useEffect } from "react";
import type { Registry } from "@/server/rivet/registry";
import { authClient } from "./auth-client";

// Same-origin actor manager — src/server.ts mounts the RivetKit registry at
// /rivet and the ping actor answers raw WebSockets + action calls there
// (mirrors apps/timbuktu/src/contexts/actor-context.tsx). The endpoint is
// only meaningful in the browser: useActor connects in effects, so the SSR
// render never touches it and the fallback value is never dereferenced.
export const { useActor } = createRivetKit<Registry>({
	endpoint:
		typeof window !== "undefined"
			? `${window.location.origin}/rivet`
			: "http://localhost:5173/rivet",
	disableMetadataLookup: true,
});

// Define the context type
export type RivetActorContextType = {
	useActor: typeof useActor;
	ping: ReturnType<typeof useActor<"ping">>;
};

// Create the context with default values
const RivetActorContext = createContext<RivetActorContextType | null>(null);

// Provider component
export default function RivetActorProvider({
	children,
}: {
	children: ReactNode;
}) {
	// /rivet is gated behind a Better Auth session server-side, and the
	// RivetKit client retries failed connects forever (p-retry, hardcoded).
	// Without a session every attempt is a 401 that reconnect-loop-spams the
	// worker — so only enable the actor while an admin session exists.
	// Flipping `enabled` back to false unmounts the connection, which aborts
	// the retry loop.
	const { data: session } = authClient.useSession();
	const ping = useActor({
		name: "ping",
		key: ["general"],
		enabled: session != null,
	});

	// Log the pong to the console once the connection is live.
	useEffect(() => {
		if (!ping.connection) return;
		void ping.connection
			.ping()
			.then((pong) => console.log("[rivet] ping", pong))
			.catch((error) => console.log("[rivet] ping failed", error));
	}, [ping.connection]);

	const value = {
		useActor: useActor,
		ping: ping,
	};

	return (
		<RivetActorContext.Provider value={value}>
			{children}
		</RivetActorContext.Provider>
	);
}

// Custom hook to use the context
export function useRivetActorContext() {
	const context = useContext(RivetActorContext);

	if (!context) {
		throw new Error(
			"useRivetActorContext must be used within a RivetActorProvider",
		);
	}

	return context;
}
