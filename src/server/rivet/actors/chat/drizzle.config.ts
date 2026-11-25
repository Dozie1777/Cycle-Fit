import { defineConfig } from "drizzle-kit";

export default defineConfig({
	dialect: "sqlite",
	driver: "durable-sqlite",
	schema: "./src/server/rivet/actors/chat/schema.ts",
	out: "./src/server/rivet/actors/chat/drizzle",
});
