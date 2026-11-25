import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFile(resolve(repoRoot, path), "utf8");

describe("Start CI and deployment contract", () => {
	it("uses Start route splitting and keeps the client-only studio boundary", async () => {
		const paths = [
			"src/routes/_authenticated/admins.tsx",
			"src/routes/_authenticated/agents.tsx",
			"src/routes/_authenticated/designs.tsx",
			"src/routes/login.tsx",
		];
		const [studio, ...routes] = await Promise.all([
			read("src/routes/_authenticated/studio/$id.tsx"),
			...paths.map(read),
		]);
		for (const route of routes)
			assert.doesNotMatch(route, /lazyRouteComponent/);
		assert.match(studio, /ClientOnly/);
		assert.match(studio, /lazy\(\(\)\s*=>\s*import/);
	});

	it("uses generated Worker artifacts for dry-run and deployment", async () => {
		const pkg = JSON.parse(await read("package.json"));
		assert.equal(pkg.scripts["verify:build"], "node scripts/verify-build.mjs");
		assert.match(
			pkg.scripts.deploy,
			/pnpm build && wrangler deploy --config dist\/server\/wrangler\.json/,
		);
	});

	it("emits client module provenance in the production build", async () => {
		const config = await read("vite.config.ts");
		assert.match(config, /clientModuleProvenance\(\)/);
	});

	it("runs every required PR check after one package install/build", async () => {
		const ci = await read(".github/workflows/ci.yaml");
		assert.doesNotMatch(ci, /code-review-bot-admin-ui/);
		assert.match(ci, /node-version:\s*22\.12\.0/);
		assert.match(ci, /version:\s*10\.0\.0/);
		assert.match(ci, /pnpm install --frozen-lockfile\n/);
		for (const command of [
			"test",
			"typecheck",
			"build",
			"verify:build",
			"cf-typegen",
			"wrangler deploy --dry-run --config dist/server/wrangler.json",
			"biome check .",
		]) {
			assert(ci.includes(command), `CI is missing ${command}`);
		}
		// The workerd integration suite is deliberately not part of CI.
		assert.doesNotMatch(ci, /pnpm test:workers/);
		assert.match(ci, /test\/router\.test\.ts test\/routes\.test\.tsx/);
		assert.match(ci, /git diff --exit-code/);
	});

	it("builds once before remote migrations and generated-config deploy", async () => {
		const deploy = await read(".github/workflows/deploy.yaml");
		assert.doesNotMatch(deploy, /code-review-bot-admin-ui/);
		assert.doesNotMatch(deploy, /^pull_request:/m);
		assert.match(deploy, /node-version:\s*22\.12\.0/);
		assert.match(deploy, /version:\s*10\.0\.0/);
		assert.match(deploy, /pnpm install --frozen-lockfile\n/);
		assert.match(deploy, /wranglerVersion:\s*4\.152\.0/);
		assert.match(
			deploy,
			/command:\s*deploy --config dist\/server\/wrangler\.json/,
		);
		const build = deploy.indexOf("pnpm build");
		const audit = deploy.indexOf("pnpm verify:build");
		const migrate = deploy.indexOf("db:migrate-remote");
		assert(
			build >= 0 && audit > build && migrate > audit,
			"build and artifact audit must precede remote migrations",
		);
		assert.equal(deploy.match(/pnpm build/g).length, 1);
	});
});
