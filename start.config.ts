import type { tanstackStart } from "@tanstack/react-start/plugin/vite";

export const tanstackStartOptions = {
	router: {},
} satisfies Parameters<typeof tanstackStart>[0];
