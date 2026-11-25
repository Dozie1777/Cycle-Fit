import {
	dailyReviewDeliveryId,
	startDailyCodebaseReview,
} from "@/features/review";
import { runWithWorkerEnv } from "./worker-env";

// Cron Triggers invoke the worker's `scheduled` export (see triggers.crons
// in wrangler.jsonc). The daily codebase review runs the same sandboxed
// pipeline as PR reviews — claim → check run → startCheckRunReview — so all
// the fencing and rescue logic is shared; only the trigger differs.
export function handleScheduled(
	controller: ScheduledController,
	env: Env,
	ctx: ExecutionContext,
): void {
	console.log(
		`[scheduled] cron "${controller.cron}" fired (expected daily review: ${dailyReviewDeliveryId()})`,
	);
	ctx.waitUntil(
		runWithWorkerEnv(env, () => startDailyCodebaseReview(env)).catch(
			(error) => {
				// A failed daily run must never crash the isolate — there is no
				// check run to strand yet at this point, so logging is enough.
				console.error("[daily-review] scheduled run failed:", error);
			},
		),
	);
}
