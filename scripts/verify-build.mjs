import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { parse as parseEnv } from "dotenv";
import { loadEnv } from "vite";

const MIB = 1024 * 1024;
const TEXT_EXTENSIONS = new Set([
	".css",
	".html",
	".js",
	".json",
	".map",
	".mjs",
	".svg",
	".txt",
	".xml",
]);
const PRIVATE_KEY =
	/(?:^|_)(?:API_KEY|MASTER_KEYS|PRIVATE_KEY|SECRET|SECRET_ACCESS_KEY|TOKEN)(?:$|_)/;
const PEM_PRIVATE_KEY =
	/-----BEGIN (?:ENCRYPTED |EC |OPENSSH |RSA )?PRIVATE KEY-----([\s\S]*?)-----END (?:ENCRYPTED |EC |OPENSSH |RSA )?PRIVATE KEY-----/g;

function containsPemPrivateKey(source) {
	return [...source.matchAll(PEM_PRIVATE_KEY)].some((match) =>
		/[A-Za-z0-9+/=]{32,}/.test(match[1]),
	);
}

async function filesBelow(root) {
	let entries;
	try {
		entries = await readdir(root, { withFileTypes: true });
	} catch (error) {
		if (error.code === "ENOENT") return [];
		throw error;
	}
	const files = [];
	for (const entry of entries) {
		const path = join(root, entry.name);
		if (entry.isDirectory()) files.push(...(await filesBelow(path)));
		else if (entry.isFile()) files.push(path);
	}
	return files.sort();
}

async function readOptional(path) {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if (error.code === "ENOENT") return undefined;
		throw error;
	}
}

function moduleKind(path) {
	const source = path.replaceAll("\\", "/");
	if (
		/\/node_modules\/(?:@prisma|prisma)\//.test(source) ||
		/\/src\/generated\/prisma\//.test(source)
	) {
		return "Prisma";
	}
	if (/\/node_modules\/(?:@octokit|octokit)\//.test(source)) return "Octokit";
	if (
		/\/src\/(?:lib\/auth(?:\.generate)?\.ts|lib\/db\.ts|features\/review\/github\.ts)/.test(
			source,
		) ||
		/\/node_modules\/@better-auth\/(?:kysely|memory)-adapter\//.test(source) ||
		/\/node_modules\/better-auth\/dist\/(?:adapters|api|crypto|db|plugins\/admin|plugins\/email-otp|plugins\/one-time-token|plugins\/organization)\//.test(
			source,
		)
	) {
		return "Better Auth server";
	}
}

function studioModule(path) {
	return /\/node_modules\/(?:@shiki|@streamdown|mermaid|shiki|streamdown)\//.test(
		path.replaceAll("\\", "/"),
	);
}

function privateValues(env) {
	return new Set(
		Object.entries(env).flatMap(([key, value]) => {
			if (
				!PRIVATE_KEY.test(key) ||
				key.startsWith("NEXT_PUBLIC_") ||
				key.startsWith("PUBLIC_") ||
				typeof value !== "string" ||
				value.length < 8 ||
				/^(?:change-me|replace-with-|your-|base64-of-)/.test(value)
			) {
				return [];
			}
			return [[key, value]];
		}),
	);
}

async function localPrivateValues(appRoot, env) {
	const devVars = await readOptional(join(appRoot, ".dev.vars"));
	return privateValues({
		...loadEnv("production", appRoot, ""),
		...parseEnv(devVars ?? ""),
		...env,
	});
}

function leakVariants(value) {
	return new Set([
		value,
		value.replaceAll("\\n", "\n"),
		value.replaceAll("\n", "\\n"),
		encodeURIComponent(value),
	]);
}

function compressedSize(files, contents) {
	if (files.length === 0) return 0;
	return gzipSync(Buffer.concat(contents)).byteLength;
}

function formatBytes(bytes) {
	return bytes >= MIB
		? `${(bytes / MIB).toFixed(2)} MiB`
		: `${(bytes / 1024).toFixed(2)} KiB`;
}

export async function auditBuild({
	appRoot,
	env = process.env,
	workerRawLimitBytes = 64 * MIB,
	workerGzipLimitBytes = 10 * MIB,
	assetRawLimitBytes = 25 * MIB,
	clientFileLimit = 100_000,
}) {
	const dist = join(appRoot, "dist");
	const clientRoot = join(dist, "client");
	const serverRoot = join(dist, "server");
	const [clientFiles, serverFiles] = await Promise.all([
		filesBelow(clientRoot),
		filesBelow(serverRoot),
	]);
	const failures = [];
	const fail = (code, message, extra = {}) =>
		failures.push({ code, message, ...extra });
	const relativeClient = (file) =>
		relative(clientRoot, file).split(sep).join("/");
	const clientContents = new Map();
	for (const file of clientFiles) {
		const source = await readFile(file);
		clientContents.set(file, source);
		if (source.byteLength > assetRawLimitBytes) {
			fail(
				"asset-size-limit",
				`${relativeClient(file)} is ${formatBytes(source.byteLength)}, above the ${formatBytes(assetRawLimitBytes)} static-asset limit`,
			);
		}
	}
	if (clientFiles.length > clientFileLimit) {
		fail(
			"asset-count-limit",
			`${clientFiles.length} static assets exceed the ${clientFileLimit}-file limit`,
		);
	}
	for (const required of [
		join(clientRoot, ".assetsignore"),
		join(serverRoot, "index.js"),
		join(serverRoot, "wrangler.json"),
	]) {
		if (!(await readOptional(required))) {
			fail(
				"missing-asset",
				`Missing generated asset ${relative(appRoot, required)}`,
			);
		}
	}

	const manifestPath = serverFiles.find((file) =>
		/_tanstack-start-manifest_v-[^/]+\.js$/.test(file),
	);
	const initialFiles = new Set();
	if (!manifestPath) {
		fail("missing-asset", "Missing generated TanStack Start client manifest");
	} else {
		try {
			const { tsrStartManifest } = await import(
				pathToFileURL(manifestPath).href
			);
			const manifest = tsrStartManifest();
			for (const [route, data] of Object.entries(manifest.routes)) {
				// The console surface: every top-level page route except the
				// lazy-loaded studio (route-split), login, and public shares.
				const isConsoleRoute =
					route.startsWith("/projects") ||
					route.startsWith("/campaigns") ||
					route === "/agents" ||
					route === "/admins" ||
					route === "/chat";
				if (
					route !== "__root__" &&
					(!isConsoleRoute || route.includes("/studio/"))
				) {
					continue;
				}
				for (const asset of data.preloads ?? []) {
					const file = join(clientRoot, asset.replace(/^\//, ""));
					if (!clientContents.has(file)) {
						fail("missing-asset", `Missing ${route} preload ${asset}`);
					} else {
						initialFiles.add(file);
					}
				}
			}
			for (const script of manifest.routes.__root__?.scripts ?? []) {
				const src = script.attrs?.src;
				if (
					src &&
					!clientContents.has(join(clientRoot, src.replace(/^\//, "")))
				) {
					fail("missing-asset", `Missing generated client entry ${src}`);
				}
			}
		} catch (error) {
			fail("invalid-manifest", `Cannot read Start manifest: ${error.message}`);
		}
	}

	const forbidden = new Set();
	const privateEntries = await localPrivateValues(appRoot, env);
	const provenanceSource = await readOptional(
		join(clientRoot, ".vite/client-module-provenance.json"),
	);
	let provenanceChunks = {};
	if (provenanceSource === undefined) {
		fail("missing-provenance", "Missing client chunk module provenance");
	} else {
		try {
			const provenance = JSON.parse(provenanceSource);
			if (
				provenance.version !== 1 ||
				typeof provenance.chunks !== "object" ||
				provenance.chunks === null ||
				Array.isArray(provenance.chunks)
			) {
				throw new Error("unsupported provenance format");
			}
			provenanceChunks = provenance.chunks;
		} catch (error) {
			fail("missing-provenance", `Invalid client provenance: ${error.message}`);
		}
	}
	for (const [file, contents] of clientContents) {
		const name = relativeClient(file);
		const extension = name.slice(name.lastIndexOf("."));
		if (!TEXT_EXTENSIONS.has(extension)) continue;
		const source = contents.toString("utf8");
		if (containsPemPrivateKey(source)) {
			fail("pem-leak", `${name} contains PEM private-key material`);
		}
		for (const [key, value] of privateEntries) {
			for (const variant of leakVariants(value)) {
				if (variant.length >= 8 && source.includes(variant)) {
					fail(
						"private-env-leak",
						`${name} contains the private value of ${key}`,
					);
					break;
				}
			}
		}
		if (!name.endsWith(".js")) continue;
		const paths = provenanceChunks[name]?.modules;
		if (
			!Array.isArray(paths) ||
			paths.some((path) => typeof path !== "string")
		) {
			fail("missing-provenance", `Missing module provenance for ${name}`);
			continue;
		}
		for (const path of paths) {
			const kind = moduleKind(path);
			if (kind) forbidden.add(`${kind}\0${name}`);
			if (initialFiles.has(file) && studioModule(path)) {
				fail(
					"eager-studio-module",
					`${name} eagerly includes studio module ${path}`,
				);
			}
		}
	}
	for (const item of forbidden) {
		const [module, file] = item.split("\0");
		fail("forbidden-client-module", `${file} contains ${module}`, { module });
	}

	const workerFiles = serverFiles.filter((file) =>
		/\.(?:js|mjs|wasm)$/.test(file),
	);
	const workerContents = [];
	for (const file of workerFiles) workerContents.push(await readFile(file));
	const initialContents = [...initialFiles].map((file) =>
		clientContents.get(file),
	);
	const report = {
		failures,
		initialClient: {
			files: [...initialFiles].map(relativeClient).sort(),
			rawBytes: initialContents.reduce((sum, x) => sum + x.byteLength, 0),
			gzipBytes: compressedSize([...initialFiles], initialContents),
		},
		server: {
			rawBytes: workerContents.reduce((sum, x) => sum + x.byteLength, 0),
			gzipBytes: compressedSize(workerFiles, workerContents),
		},
		clientFileCount: clientFiles.length,
	};
	if (report.server.rawBytes > workerRawLimitBytes) {
		fail(
			"worker-size-limit",
			`Worker is ${formatBytes(report.server.rawBytes)}, above the ${formatBytes(workerRawLimitBytes)} uncompressed limit`,
		);
	}
	if (report.server.gzipBytes > workerGzipLimitBytes) {
		fail(
			"worker-gzip-limit",
			`Worker is ${formatBytes(report.server.gzipBytes)} gzip, above the ${formatBytes(workerGzipLimitBytes)} compressed paid-plan limit`,
		);
	}

	const configPath = join(serverRoot, "wrangler.json");
	const configSource = await readOptional(configPath);
	if (configSource !== undefined) {
		try {
			const config = JSON.parse(configSource);
			if (config.main !== "index.js") {
				fail(
					"invalid-worker-config",
					"Generated Wrangler main must be index.js",
				);
			}
			const assets = resolve(serverRoot, config.assets?.directory ?? "");
			if (assets !== clientRoot) {
				fail(
					"invalid-worker-config",
					"Generated Wrangler assets must target dist/client",
				);
			}
			const bindings = new Map(
				(config.durable_objects?.bindings ?? []).map((binding) => [
					binding.name,
					binding.class_name,
				]),
			);
			for (const [name, className] of [
				["Sandbox", "Sandbox"],
				["MCP_OBJECT", "PlaywrightMCP"],
				["ACTOR_DO", "ActorHandler"],
			]) {
				if (bindings.get(name) !== className) {
					fail(
						"invalid-worker-config",
						`Missing Durable Object binding ${name}`,
					);
				}
			}
			const migrations = config.migrations ?? [];
			for (const [tag, className] of [
				["v1", "Sandbox"],
				["v2", "PlaywrightMCP"],
				["v3", "ActorHandler"],
			]) {
				if (
					!migrations.some(
						(migration) =>
							migration.tag === tag &&
							migration.new_sqlite_classes?.includes(className),
					)
				) {
					fail(
						"invalid-worker-config",
						`Missing ${tag} migration for ${className}`,
					);
				}
			}
			const entry = await readOptional(join(serverRoot, "index.js"));
			for (const exportName of [
				"ActorHandler",
				"ContainerProxy",
				"PlaywrightMCP",
				"Sandbox",
				"default",
			]) {
				if (!entry?.includes(exportName)) {
					fail(
						"invalid-worker-config",
						`Worker entry is missing ${exportName}`,
					);
				}
			}
			for (const database of config.d1_databases ?? []) {
				if (!database.migrations_dir) continue;
				const migrationFiles = await filesBelow(
					resolve(serverRoot, database.migrations_dir),
				);
				if (!migrationFiles.some((file) => file.endsWith("migration.sql"))) {
					fail(
						"missing-asset",
						`No D1 migrations found for ${database.binding}`,
					);
				}
			}
		} catch (error) {
			fail(
				"invalid-worker-config",
				`Cannot read generated Wrangler config: ${error.message}`,
			);
		}
	}
	return report;
}

const isMain =
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
	const report = await auditBuild({ appRoot });
	console.log(
		`Initial admin client: ${formatBytes(report.initialClient.rawBytes)} raw / ${formatBytes(report.initialClient.gzipBytes)} gzip (${report.initialClient.files.length} files)`,
	);
	console.log(
		`Worker server: ${formatBytes(report.server.rawBytes)} raw / ${formatBytes(report.server.gzipBytes)} gzip (64.00 MiB raw / 10.00 MiB gzip limits)`,
	);
	console.log(
		`Static assets: ${report.clientFileCount} files (100000-file limit)`,
	);
	for (const failure of report.failures)
		console.error(`FAIL ${failure.message}`);
	if (report.failures.length > 0) process.exitCode = 1;
	else console.log("PASS — production build artifact audit");
}
