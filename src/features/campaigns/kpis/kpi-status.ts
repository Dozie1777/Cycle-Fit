export type KpiStatus = "pending" | "not_met" | "partial" | "met" | "exceeded";

export function deriveKpiStatus({
	target,
	actual,
}: {
	target: number;
	actual: number;
}): KpiStatus {
	if (target === 0) {
		return actual === 0 ? "met" : actual > 0 ? "exceeded" : "not_met";
	}
	const ratio = actual / target;
	if (ratio < 0.8) return "not_met";
	if (ratio < 1) return "partial";
	if (ratio === 1) return "met";
	return "exceeded";
}
