import {
	isReviewAttemptCredentialValid,
	isReviewAttemptCurrent,
} from "@/features/review";

export function reviewAttemptSecret(request: Request): string | null {
	const authorization = request.headers.get("authorization") ?? "";
	return authorization.startsWith("Bearer ")
		? authorization.slice("Bearer ".length)
		: null;
}

// Internal sandbox capability check. A separate high-entropy attempt secret is
// the Bearer credential; the public claim/sandbox ID is not a credential.
export async function handleReviewAttemptRequest(
	request: Request,
	env: Env,
): Promise<Response> {
	if (request.method !== "POST") {
		return new Response("method not allowed", {
			status: 405,
			headers: { allow: "POST" },
		});
	}
	let body: { checkRunId?: unknown; attemptId?: unknown };
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "invalid JSON" }, { status: 400 });
	}
	if (
		typeof body.checkRunId !== "number" ||
		!Number.isInteger(body.checkRunId) ||
		typeof body.attemptId !== "string" ||
		body.attemptId.length === 0
	) {
		return Response.json({ error: "invalid review attempt" }, { status: 400 });
	}
	const secret = reviewAttemptSecret(request);
	if (
		!secret ||
		!(await isReviewAttemptCredentialValid(
			env,
			body.checkRunId,
			body.attemptId,
			secret,
		))
	) {
		return Response.json({ error: "unauthorized" }, { status: 401 });
	}
	const current = await isReviewAttemptCurrent(
		env,
		body.checkRunId,
		body.attemptId,
	);
	return new Response(null, { status: current ? 204 : 409 });
}
