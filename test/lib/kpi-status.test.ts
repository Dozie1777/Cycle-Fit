import { describe, expect, it } from "vitest";
import { deriveKpiStatus } from "@/features/campaigns/kpis/kpi-status";

describe("deriveKpiStatus", () => {
	it("exceeds when actual is greater than target", () => {
		expect(deriveKpiStatus({ target: 100, actual: 120 })).toBe("exceeded");
	});

	it("meets when actual equals target", () => {
		expect(deriveKpiStatus({ target: 100, actual: 100 })).toBe("met");
	});

	it("partial when actual is between 80% and target", () => {
		expect(deriveKpiStatus({ target: 100, actual: 85 })).toBe("partial");
	});

	it("not met when actual is below 80% of target", () => {
		expect(deriveKpiStatus({ target: 100, actual: 79 })).toBe("not_met");
	});

	it("handles zero target by treating any positive actual as exceeded", () => {
		expect(deriveKpiStatus({ target: 0, actual: 1 })).toBe("exceeded");
		expect(deriveKpiStatus({ target: 0, actual: 0 })).toBe("met");
	});

	it("treats negative actual as not met for positive targets", () => {
		expect(deriveKpiStatus({ target: 100, actual: -10 })).toBe("not_met");
	});
});
