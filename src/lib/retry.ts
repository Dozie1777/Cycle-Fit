/**
 * Retry an async operation with a fixed delay between attempts.
 *
 * Used for transient sandbox/container errors (e.g. ENOENT while the SDK
 * watches a session directory that is still being created) where a quick
 * re-attempt is cheaper than failing the whole review.
 */
export async function withRetry<T>(
	fn: () => Promise<T>,
	options: {
		maxAttempts?: number;
		delayMs?: number;
		label?: string;
	} = {},
): Promise<T> {
	const { maxAttempts = 3, delayMs = 1500, label = "operation" } = options;
	let lastError: unknown;

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			return await fn();
		} catch (error) {
			lastError = error;
			const isLast = attempt === maxAttempts;
			const message = error instanceof Error ? error.message : String(error);
			console.log(
				`[retry] ${label} attempt ${attempt}/${maxAttempts} failed: ${message}${isLast ? " — giving up" : ` — retrying in ${delayMs}ms`}`,
			);
			if (isLast) {
				break;
			}
			await new Promise((resolve) => setTimeout(resolve, delayMs));
		}
	}

	throw lastError;
}
