// Builtin skill library integrity (0021_marketing_craft_skills): the committed
// migration must always be regenerated from the skills/builtin/** source
// files, and every source file must satisfy the Skill handler's limits
// (slug shape, description length, known category). The heavy lifting lives
// in scripts/check-builtin-skills.mjs and the generator's own validation —
// these tests just wire both into CI.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	collectSkills,
	renderMigration,
} from "../../../skills/builtin/generate-migration.mjs";

describe("builtin skill sources", () => {
	it("pass scripts/check-builtin-skills.mjs", () => {
		const output = execFileSync("node", ["scripts/check-builtin-skills.mjs"], {
			cwd: new URL("../../..", import.meta.url).pathname,
			encoding: "utf8",
		});
		expect(output).toContain("all builtin skills valid");
	});

	it("match the committed 0021 migration", () => {
		const skills = collectSkills();
		expect(skills.length).toBeGreaterThan(0);
		const committed = readFileSync(
			new URL(
				"../../../prisma/migrations/0021_marketing_craft_skills/migration.sql",
				import.meta.url,
			).pathname,
			"utf8",
		);
		expect(committed).toBe(renderMigration(skills));
	});
});
