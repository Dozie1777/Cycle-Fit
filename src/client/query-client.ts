import { QueryClient } from "@tanstack/react-query";

const clientOptions = {
	defaultOptions: {
		queries: {
			refetchOnWindowFocus: true,
			retry: 1,
		},
	},
} as const;

let clientSingleton: QueryClient | undefined;

/**
 * The app's QueryClient. A singleton in the browser (shared by the router
 * and the tRPC options proxy); a fresh instance per SSR render so server
 * caches can never leak between requests.
 */
export function getQueryClient(): QueryClient {
	if (typeof window === "undefined") {
		return new QueryClient(clientOptions);
	}
	if (!clientSingleton) {
		clientSingleton = new QueryClient(clientOptions);
	}
	return clientSingleton;
}
