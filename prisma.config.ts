import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
	schema: "prisma/schema.prisma",
	migrations: {
		path: "prisma/migrations",
	},
	datasource: {
		// Generation-only: the CLI never connects through this URL — the runtime
		// client binds to the D1 driver adapter (env.DB). `env("DATABASE_URL")`
		// throws when unset (breaking `prisma generate` in CI), so fall back to
		// an empty string; commands that do need a database (migrate diff
		// against a local D1) read the real value from .env.
		url: process.env.DATABASE_URL ?? "",
	},
});
