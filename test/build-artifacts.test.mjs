import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "vitest";
import { auditBuild } from "../scripts/verify-build.mjs";

const roots = [];

async function fixture() {
	const appRoot = await mkdtemp(join(tmpdir(), "start-build-audit-"));
	roots.push(appRoot);
	const files = {
		"dist/server/index.js":
			'export { ActorHandler, ContainerProxy, PlaywrightMCP, Sandbox, worker as default } from "./assets/worker.js";\n',
		"dist/server/assets/worker.js": "export const worker = {};\n",
		"dist/server/wrangler.json": JSON.stringify({
			main: "index.js",
			assets: { directory: "../client" },
			durable_objects: {
				bindings: [
					{ name: "Sandbox", class_name: "Sandbox" },
					{ name: "MCP_OBJECT", class_name: "PlaywrightMCP" },
					{ name: "ACTOR_DO", class_name: "ActorHandler" },
				],
			},
			migrations: [
				{ tag: "v1", new_sqlite_classes: ["Sandbox"] },
				{ tag: "v2", new_sqlite_classes: ["PlaywrightMCP"] },
				{ tag: "v3", new_sqlite_classes: ["ActorHandler"] },
			],
			d1_databases: [
				{ binding: "DB", migrations_dir: "../../prisma/migrations" },
			],
		}),
		"dist/client/.assetsignore": "*.map\n.vite/\n",
		"dist/client/.vite/client-module-provenance.json": JSON.stringify({
			version: 1,
			chunks: Object.fromEntries(
				["index", "admin", "studio"].map((name) => [
					`assets/${name}.js`,
					{ modules: [`../../src/${name}.tsx`] },
				]),
			),
		}),
		"dist/client/assets/index.js": 'import "./admin.js";\n',
		"dist/client/assets/admin.js": "export const admin = true;\n",
		"dist/client/assets/studio.js": "export const studio = true;\n",
		"dist/server/assets/_tanstack-start-manifest_v-test.js": `export const tsrStartManifest = () => ({ routes: {
			__root__: { preloads: ["/assets/index.js"], scripts: [{ attrs: { src: "/assets/index.js" } }] },
			"/projects": { preloads: ["/assets/admin.js"] },
			"/projects/designs": { preloads: [] },
			"/studio/$id": { preloads: ["/assets/studio.js"] }
		} });\n`,
		"prisma/migrations/0001_init/migration.sql": "SELECT 1;\n",
	};
	for (const [path, contents] of Object.entries(files)) {
		const target = join(appRoot, path);
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, contents);
	}
	return {
		appRoot,
		write: async (path, contents) => {
			const target = join(appRoot, path);
			await mkdir(dirname(target), { recursive: true });
			await writeFile(target, contents);
		},
	};
}

async function provenance(build, chunk, sources) {
	const metadataPath = "dist/client/.vite/client-module-provenance.json";
	const { readFile } = await import("node:fs/promises");
	const metadata = JSON.parse(
		await readFile(join(build.appRoot, metadataPath), "utf8"),
	);
	metadata.chunks[`assets/${chunk}`] = { modules: sources };
	await build.write(metadataPath, JSON.stringify(metadata));
	await build.write(
		`dist/client/assets/${chunk}`,
		"const minifiedProductionChunk=true;",
	);
}

function failures(report, code) {
	return report.failures.filter((failure) => failure.code === code);
}

describe("production build artifact audit", () => {
	it("accepts a complete Start build and reports client/server sizes", async () => {
		const build = await fixture();
		const report = await auditBuild({ appRoot: build.appRoot, env: {} });
		assert.deepEqual(report.failures, []);
		assert(report.initialClient.rawBytes > 0);
		assert(report.initialClient.gzipBytes > 0);
		assert(report.server.rawBytes > 0);
		assert(report.server.gzipBytes > 0);
		assert(report.initialClient.files.includes("assets/index.js"));
		assert(report.initialClient.files.includes("assets/admin.js"));
		assert(!report.initialClient.files.includes("assets/studio.js"));
	});

	it("matches Wrangler module selection and gzip measurement", async () => {
		const build = await fixture();
		await build.write(
			"dist/server/assets/worker.js",
			`export const worker = "${"compressible-worker-module-".repeat(5_000)}";`,
		);
		await build.write("dist/server/assets/ignored.css", "x".repeat(100_000));
		const report = await auditBuild({ appRoot: build.appRoot, env: {} });
		const { readFile } = await import("node:fs/promises");
		const { gzipSync } = await import("node:zlib");
		const files = [
			"dist/server/index.js",
			"dist/server/assets/worker.js",
			"dist/server/assets/_tanstack-start-manifest_v-test.js",
		].sort();
		const contents = await Promise.all(
			files.map((file) => readFile(join(build.appRoot, file))),
		);
		assert.equal(
			report.server.rawBytes,
			contents.reduce((sum, contents) => sum + contents.byteLength, 0),
		);
		assert.equal(
			report.server.gzipBytes,
			gzipSync(Buffer.concat(contents)).byteLength,
		);
	});

	it("attributes forbidden modules by build-time provenance, not chunk names", async () => {
		const build = await fixture();
		await provenance(build, "index.js", [
			"../../node_modules/.pnpm/@prisma+client@6/node_modules/@prisma/client/runtime/wasm.mjs",
			"../../node_modules/octokit/dist-src/index.js",
			"../../src/lib/auth.ts",
		]);
		const report = await auditBuild({ appRoot: build.appRoot, env: {} });
		assert.deepEqual(
			new Set(failures(report, "forbidden-client-module").map((x) => x.module)),
			new Set(["Prisma", "Octokit", "Better Auth server"]),
		);
	});

	it("allows grammars, browser auth, and Start isomorphic client stubs", async () => {
		const build = await fixture();
		await provenance(build, "studio.js", [
			"../../node_modules/@shiki/langs/dist/prisma.mjs",
			"../../node_modules/better-auth/dist/client/plugins/index.mjs",
			"../../src/components/prisma-example.tsx",
			"../../src/server/admin-session.ts",
			"../../src/server/share-document.ts",
		]);
		const report = await auditBuild({ appRoot: build.appRoot, env: {} });
		assert.deepEqual(failures(report, "forbidden-client-module"), []);
	});

	it("detects production Better Auth server imports without maps or comments", async () => {
		const build = await fixture();
		await provenance(build, "index.js", [
			"../../node_modules/better-auth/dist/api/index.mjs",
		]);
		const report = await auditBuild({ appRoot: build.appRoot, env: {} });
		assert.equal(failures(report, "forbidden-client-module").length, 1);
	});

	it("records only modules rendered into production chunks", async () => {
		const { readFile } = await import("node:fs/promises");
		const { transpileModule } = await import("typescript");
		const source = await readFile(
			new URL("../scripts/vite.client-provenance.ts", import.meta.url),
			"utf8",
		);
		const javascript = transpileModule(source, {
			compilerOptions: { module: "esnext" },
		}).outputText;
		const { clientModuleProvenance } = await import(
			`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`
		);
		const plugin = clientModuleProvenance();
		const emitted = [];
		const bundle = {
			".assetsignore": { type: "asset", source: "" },
			"assets/index.js": {
				type: "chunk",
				fileName: "assets/index.js",
				modules: {
					"/src/server/auth.ts": { renderedLength: 0 },
					"/src/client.ts": { renderedLength: 42 },
				},
			},
		};
		plugin.generateBundle.call(
			{ emitFile: (file) => emitted.push(file) },
			{},
			bundle,
		);
		const metadata = JSON.parse(
			emitted.find((file) => file.fileName.includes("provenance")).source,
		);
		assert.deepEqual(metadata.chunks["assets/index.js"].modules, [
			"/src/client.ts",
		]);
		assert.match(bundle[".assetsignore"].source, /\.vite\//);
	});

	it("fails closed when required chunk provenance is missing", async () => {
		const build = await fixture();
		await rm(
			join(build.appRoot, "dist/client/.vite/client-module-provenance.json"),
		);
		const report = await auditBuild({ appRoot: build.appRoot, env: {} });
		assert(failures(report, "missing-provenance").length > 0);
	});

	it("keeps studio-heavy modules out of initial admin preloads only", async () => {
		const build = await fixture();
		await provenance(build, "studio.js", [
			"../../node_modules/@streamdown/mermaid/dist/index.js",
			"../../node_modules/shiki/dist/index.mjs",
			"../../node_modules/streamdown/dist/index.js",
		]);
		const clean = await auditBuild({ appRoot: build.appRoot, env: {} });
		assert.deepEqual(failures(clean, "eager-studio-module"), []);
		await provenance(build, "admin.js", [
			"../../node_modules/streamdown/dist/index.js",
		]);
		const leaking = await auditBuild({ appRoot: build.appRoot, env: {} });
		assert.equal(failures(leaking, "eager-studio-module").length, 1);
	});

	it("fails on private environment values without reporting the value", async () => {
		const build = await fixture();
		const secret = "fixture-only-private-secret-value";
		await build.write(
			"dist/client/assets/index.js",
			`const leaked = "${secret}";`,
		);
		const report = await auditBuild({
			appRoot: build.appRoot,
			env: { BETTER_AUTH_SECRET: secret },
		});
		assert.equal(failures(report, "private-env-leak").length, 1);
		assert(!JSON.stringify(report.failures).includes(secret));
	});

	it("detects non-PEM secrets in every production Vite env source", async () => {
		for (const file of [
			".env",
			".env.local",
			".env.production",
			".env.production.local",
		]) {
			const build = await fixture();
			const secret = `non-pem-${file}-secret-value`;
			await build.write(file, `BETTER_AUTH_SECRET="${secret}"`);
			await build.write(
				"dist/client/assets/index.js",
				`const leaked = "${secret}";`,
			);
			const report = await auditBuild({ appRoot: build.appRoot, env: {} });
			assert.equal(failures(report, "private-env-leak").length, 1, file);
			assert(!JSON.stringify(report.failures).includes(secret));
		}
	});

	it("fails on PEM private key material", async () => {
		const build = await fixture();
		await build.write(
			"dist/client/assets/index.js",
			"-----BEGIN RSA PRIVATE KEY-----\\nMDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=\\n-----END RSA PRIVATE KEY-----",
		);
		const report = await auditBuild({ appRoot: build.appRoot, env: {} });
		assert.equal(failures(report, "pem-leak").length, 1);
	});

	it("allows PEM documentation placeholders without key payloads", async () => {
		const build = await fixture();
		await build.write(
			"dist/client/assets/index.js",
			"-----BEGIN PRIVATE KEY-----\\n…\\n-----END PRIVATE KEY-----",
		);
		const report = await auditBuild({ appRoot: build.appRoot, env: {} });
		assert.deepEqual(failures(report, "pem-leak"), []);
	});

	it("fails when generated Worker and migration assets are missing", async () => {
		const build = await fixture();
		await rm(join(build.appRoot, "dist/server/wrangler.json"));
		const report = await auditBuild({ appRoot: build.appRoot, env: {} });
		assert(failures(report, "missing-asset").length > 0);
	});

	it("enforces the uncompressed Worker limit", async () => {
		const build = await fixture();
		const report = await auditBuild({
			appRoot: build.appRoot,
			env: {},
			workerRawLimitBytes: 1,
		});
		assert.equal(failures(report, "worker-size-limit").length, 1);
	});

	it("enforces the compressed Worker limit with incompressible input", async () => {
		const build = await fixture();
		const { randomBytes } = await import("node:crypto");
		await build.write("dist/server/assets/worker.js", randomBytes(4096));
		const report = await auditBuild({
			appRoot: build.appRoot,
			env: {},
			workerGzipLimitBytes: 1024,
		});
		assert.equal(failures(report, "worker-gzip-limit").length, 1);
		assert.deepEqual(failures(report, "worker-size-limit"), []);
	});

	it("enforces static asset size and file-count limits", async () => {
		const build = await fixture();
		const report = await auditBuild({
			appRoot: build.appRoot,
			env: {},
			assetRawLimitBytes: 1,
			clientFileLimit: 1,
		});
		assert(failures(report, "asset-size-limit").length > 0);
		assert.equal(failures(report, "asset-count-limit").length, 1);
	});
});

process.on("exit", async () => {
	await Promise.all(
		roots.map((root) => rm(root, { recursive: true, force: true })),
	);
});
