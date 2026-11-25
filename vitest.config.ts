import { generateKeyPairSync } from "node:crypto";
import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { defineConfig } from "vitest/config";
import { tanstackStartOptions } from "./start.config.ts";

const { privateKey } = generateKeyPairSync("rsa", {
	modulusLength: 2048,
	privateKeyEncoding: { type: "pkcs1", format: "pem" },
	publicKeyEncoding: { type: "spki", format: "pem" },
});

export default defineConfig({
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
		},
	},
	test: {
		projects: [
			{
				test: {
					name: "unit",
					include: ["src/**/*.test.{ts,tsx}", "test/**/*.test.{ts,tsx,mjs}"],
					exclude: ["test/workers/**", "test/review.test.ts"],
				},
			},
			{
				plugins: [
					tanstackStart(tanstackStartOptions),
					cloudflareTest(async () => ({
						wrangler: { configPath: "./wrangler.jsonc" },
						remoteBindings: false,
						miniflare: {
							compatibilityFlags: [
								"nodejs_compat",
								"enable_nodejs_child_process_module",
								"enable_nodejs_inspector_module",
								"enable_nodejs_inspector_local_dev",
								"enable_nodejs_readline_module",
							],
							bindings: {
								TEST_MIGRATIONS: await readD1Migrations({
									migrationsDir: "prisma/migrations",
									migrationsPattern: "prisma/migrations/*/migration.sql",
								}),
								APP_ID: "1",
								OCTOKIT_PRIVATE_KEY: privateKey,
								WEBHOOK_SECRET: "worker-test-webhook-secret",
								BETTER_AUTH_SECRET: "worker-test-better-auth-secret-32-bytes",
								ENVIRONMENT: "local",
								TOKEN_REFRESH_SECRET: "worker-test-token-refresh-secret",
								BROWSER_MCP_TOKEN: "worker-test-browser-mcp-token",
								AGENT_CRED_MASTER_KEYS: JSON.stringify({
									"1": "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
								}),
								AGENT_CRED_MASTER_KEY_CURRENT: "1",
								S3_ACCESS_KEY_ID: "worker-test-access-key",
								S3_SECRET_ACCESS_KEY: "worker-test-secret-key",
								S3_BUCKET: "working-dir-bucket",
							},
						},
					})),
				],
				test: {
					name: "workers",
					include: ["test/workers/**/*.test.ts", "test/review.test.ts"],
					setupFiles: ["./test/setup.ts"],
					maxWorkers: 1,
					testTimeout: 20_000,
				},
			},
		],
	},
});
