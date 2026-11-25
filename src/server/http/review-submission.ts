import { z } from "zod";
import {
	createGitHubApp,
	isReviewAttemptCredentialValid,
	isReviewAttemptCurrent,
	mintInstallationToken,
	resolveIdentityForInstallation,
} from "@/features/review";
import { getPrisma } from "../../lib/db";
import { reviewAttemptSecret } from "./review-attempt";

const attemptFields = {
	checkRunId: z.number().int().positive(),
	attemptId: z.string().min(1),
};

const checkRunSubmission = z.object({
	...attemptFields,
	kind: z.literal("check-run"),
	method: z.enum(["PATCH", "POST"]),
	path: z.string(),
	payload: z.unknown(),
});

const prReviewSubmission = z.object({
	...attemptFields,
	kind: z.literal("pr-review"),
	owner: z.string().min(1),
	repo: z.string().min(1),
	prNumber: z.number().int().positive(),
	event: z.enum(["APPROVE", "REQUEST_CHANGES", "COMMENT"]),
	body: z.string().optional(),
});

const submissionBody = z.discriminatedUnion("kind", [
	checkRunSubmission,
	prReviewSubmission,
]);

function checkRunPath(body: z.infer<typeof checkRunSubmission>): string | null {
	const match = body.path.match(
		/^repos\/[^/]+\/[^/]+\/check-runs\/(\d+)(\/annotations)?$/,
	);
	if (!match || Number(match[1]) !== body.checkRunId) return null;
	const annotations = match[2] != null;
	if ((body.method === "POST") !== annotations) return null;
	return body.path;
}

// Internal fenced GitHub submission. The per-attempt Bearer credential is
// checked before any installation token is minted or external write is made.
export async function handleReviewSubmissionRequest(
	request: Request,
	env: Env,
): Promise<Response> {
	if (request.method !== "POST") {
		return new Response("method not allowed", {
			status: 405,
			headers: { allow: "POST" },
		});
	}
	const raw = await request.json().catch(() => null);
	const parsed = submissionBody.safeParse(raw);
	if (!parsed.success) {
		return Response.json({ error: "invalid submission" }, { status: 400 });
	}
	const body = parsed.data;
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
	if (!(await isReviewAttemptCurrent(env, body.checkRunId, body.attemptId))) {
		return Response.json({ error: "attempt superseded" }, { status: 409 });
	}

	let method: string;
	let path: string;
	let payload: unknown;
	if (body.kind === "check-run") {
		const validPath = checkRunPath(body);
		if (!validPath) {
			return Response.json(
				{ error: "invalid check-run path" },
				{ status: 400 },
			);
		}
		method = body.method;
		path = validPath;
		payload = body.payload;
	} else {
		method = "POST";
		path = `repos/${body.owner}/${body.repo}/pulls/${body.prNumber}/reviews`;
		payload = {
			event: body.event,
			...(body.body === undefined ? {} : { body: body.body }),
		};
	}

	const identity = await resolveIdentityForInstallation(
		getPrisma(env),
		env,
		env.INSTALLATION_ID as string,
	);
	const { token } = await mintInstallationToken(
		createGitHubApp(identity, env.WEBHOOK_SECRET),
		identity,
	);
	const upstream = await fetch(`https://api.github.com/${path}`, {
		method,
		headers: {
			authorization: `Bearer ${token}`,
			accept: "application/vnd.github+json",
			"content-type": "application/json",
			"user-agent": "code-review-bot-submission",
		},
		body: JSON.stringify(payload),
	});
	return new Response(upstream.body, {
		status: upstream.status,
		headers: {
			"content-type":
				upstream.headers.get("content-type") ?? "application/json",
		},
	});
}
