import { applyD1Migrations, type D1Migration, reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach } from "vitest";

const testEnv = env as typeof env & { TEST_MIGRATIONS: D1Migration[] };

beforeEach(async () => {
	await reset();
	await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

afterEach(async () => {
	await reset();
});
