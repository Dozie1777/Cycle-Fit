import type { Plugin } from "vite";

export function clientModuleProvenance(): Plugin {
	return {
		name: "client-module-provenance",
		applyToEnvironment(environment) {
			return environment.name === "client";
		},
		generateBundle(_, bundle) {
			const chunks = Object.fromEntries(
				Object.values(bundle)
					.filter((output) => output.type === "chunk")
					.map((chunk) => [
						chunk.fileName,
						{
							modules: Object.entries(chunk.modules)
								.flatMap(([id, module]) =>
									module.renderedLength > 0 ? [id] : [],
								)
								.sort(),
						},
					]),
			);
			this.emitFile({
				type: "asset",
				fileName: ".vite/client-module-provenance.json",
				source: JSON.stringify({ version: 1, chunks }),
			});
			const assetsIgnore = bundle[".assetsignore"];
			if (assetsIgnore?.type !== "asset") {
				throw new Error("Expected Cloudflare to generate .assetsignore");
			}
			assetsIgnore.source = `${assetsIgnore.source}.vite/\n`;
		},
	};
}
