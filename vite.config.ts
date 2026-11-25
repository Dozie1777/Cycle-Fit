import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { clientModuleProvenance } from "./scripts/vite.client-provenance.ts";
import { tanstackStartOptions } from "./start.config.ts";

export default defineConfig({
	plugins: [
		cloudflare({ viteEnvironment: { name: "ssr" } }),
		tanstackStart(tanstackStartOptions),
		react(),
		tailwindcss(),
		clientModuleProvenance(),
	],
	// @rivetkit/cloudflare-workers imports the runtime-provided
	// "cloudflare:workers" module, which esbuild's SSR dep optimizer cannot
	// prebundle (production builds are unaffected). Leave it to the worker
	// runtime to resolve.
	optimizeDeps: {
		exclude: ["@rivetkit/cloudflare-workers"],
	},
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
		},
	},
});
