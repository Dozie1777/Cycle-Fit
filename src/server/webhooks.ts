import { getSandbox } from "@cloudflare/sandbox";
import type { App, Octokit } from "octokit";
import {
	abandonReviewClaimStart,
	abandonReviewDeliveryClaimStart,
	CHECK_RUN_NAME,
	canStartReviewClaim,
	claimReview,
	claimReviewDelivery,
	createGitHubApp,
	getEnvIdentity,
	isReviewClaimOwner,
	isReviewDeliveryAttemptCurrent,
	markReviewClaimStarted,
	markReviewDeliveryClaimStarted,
	previousReviewDeliveryAttempt,
	type ReviewClaimKey,
	recordReviewClaimCheckRun,
	recordReviewDeliveryClaimCheckRun,
	releaseReviewClaim,
	releaseReviewDeliveryClaim,
	startCheckRunReview,
} from "@/features/review";

type PullRequestPayload = {
	pull_request: {
		number: number;
		html_url: string;
		head: { sha: string };
	};
	repository: { name: string; full_name: string; owner: { login: string } };
};

type CheckSuitePayload = {
	check_suite: {
		id: number;
		head_sha: string | null;
		head_branch: string | null;
		app?: { slug?: string } | null;
		pull_requests: { number: number }[];
	};
	repository: { name: string; full_name: string; owner: { login: string } };
};

async function findExistingCheckRun(
	octokit: Octokit,
	owner: string,
	repo: string,
	ref: string,
): Promise<number | null> {
	try {
		const { data } = await octokit.rest.checks.listForRef({
			owner,
			repo,
			ref,
			check_name: CHECK_RUN_NAME,
		});
		return data.check_runs[0]?.id ?? null;
	} catch (error) {
		console.log("[checks] failed to list existing check runs:", error);
		return null;
	}
}

async function createQueuedCheckRun(
	octokit: Octokit,
	owner: string,
	repo: string,
	headSha: string,
	context: string,
): Promise<number | null> {
	const { data: run } = await octokit.rest.checks.create({
		owner,
		repo,
		name: CHECK_RUN_NAME,
		head_sha: headSha,
		status: "queued",
	});
	console.log(
		`[checks] created check run ${run.id} ("${CHECK_RUN_NAME}", queued) for ${context} @ ${headSha.slice(0, 7)}`,
	);
	return run.id;
}

async function completeSupersededRun(
	octokit: Octokit,
	owner: string,
	repo: string,
	checkRunId: number,
): Promise<void> {
	await octokit.rest.checks
		.update({
			owner,
			repo,
			check_run_id: checkRunId,
			status: "completed",
			conclusion: "neutral",
			completed_at: new Date().toISOString(),
			output: {
				title: CHECK_RUN_NAME,
				summary:
					"🤖 Review infrastructure failed before the review could start: the review claim was recovered by another delivery",
			},
		})
		.catch((error) =>
			console.log("[checks] failed to neutralize superseded run:", error),
		);
}

type ClaimedCheckRun = { checkRunId: number; claimId: string; secret: string };

async function createClaimedCheckRun(
	octokit: Octokit,
	env: Env,
	key: ReviewClaimKey,
	owner: string,
	repo: string,
	context: string,
): Promise<ClaimedCheckRun | null> {
	let claim: Awaited<ReturnType<typeof claimReview>>;
	try {
		claim = await claimReview(env, key);
	} catch (error) {
		console.log("[checks] failed to claim review:", error);
		return null;
	}
	if (!claim.claimed || claim.claimId === null) {
		console.log(
			`[checks] ${context} already claimed for ${key.headSha.slice(0, 7)}` +
				(claim.checkRunId == null
					? ""
					: ` — reusing check run ${claim.checkRunId}, skipping`),
		);
		return null;
	}
	const { claimId, secret } = claim;
	if (secret === null) {
		console.log(`[checks] ${context} has no attempt credential`);
		return null;
	}
	if (claim.checkRunId != null) {
		console.log(`[checks] resuming claimed check run ${claim.checkRunId}`);
		return { checkRunId: claim.checkRunId, claimId, secret };
	}

	let checkRunId: number | null = null;
	try {
		checkRunId = await createQueuedCheckRun(
			octokit,
			owner,
			repo,
			key.headSha,
			context,
		);
	} catch (error) {
		await releaseReviewClaim(env, key, claimId).catch((releaseError) =>
			console.log("[checks] failed to release review claim:", releaseError),
		);
		console.log("[checks] failed to create check run:", error);
		return null;
	}
	if (checkRunId === null) {
		await releaseReviewClaim(env, key, claimId).catch((releaseError) =>
			console.log("[checks] failed to release review claim:", releaseError),
		);
		return null;
	}
	let recorded = false;
	try {
		recorded = await recordReviewClaimCheckRun(env, key, claimId, checkRunId);
	} catch (error) {
		console.log("[checks] failed to record claimed check run:", error);
	}
	if (!recorded) {
		await completeSupersededRun(octokit, owner, repo, checkRunId);
		return null;
	}
	return { checkRunId, claimId, secret };
}

type DeliveryClaim = {
	claimId: string;
	checkRunId: number | null;
	secret: string | null;
};

async function claimRerequestDelivery(
	env: Env,
	deliveryId: string,
	context: string,
): Promise<DeliveryClaim | null> {
	try {
		const claim = await claimReviewDelivery(env, deliveryId);
		if (!claim.claimed || claim.claimId === null) {
			console.log(
				`[checks] ${context} already claimed` +
					(claim.checkRunId == null
						? ""
						: ` — reusing check run ${claim.checkRunId}, skipping`),
			);
			return null;
		}
		return {
			claimId: claim.claimId,
			checkRunId: claim.checkRunId,
			secret: claim.secret,
		};
	} catch (error) {
		console.log("[checks] failed to claim rerequest delivery:", error);
		return null;
	}
}

async function createRerequestedCheckRun(
	octokit: Octokit,
	env: Env,
	deliveryId: string,
	owner: string,
	repo: string,
	headSha: string,
	context: string,
): Promise<ClaimedCheckRun | null> {
	const claim = await claimRerequestDelivery(env, deliveryId, context);
	if (claim === null) return null;
	const { claimId, secret } = claim;
	if (secret === null) {
		console.log(`[checks] ${context} has no attempt credential`);
		return null;
	}
	if (claim.checkRunId != null) {
		console.log(`[checks] resuming claimed check run ${claim.checkRunId}`);
		return { checkRunId: claim.checkRunId, claimId, secret };
	}
	let checkRunId: number | null = null;
	try {
		checkRunId = await createQueuedCheckRun(
			octokit,
			owner,
			repo,
			headSha,
			context,
		);
	} catch (error) {
		await releaseReviewDeliveryClaim(env, deliveryId, claimId).catch(
			(releaseError) =>
				console.log("[checks] failed to release delivery claim:", releaseError),
		);
		console.log("[checks] failed to create check run:", error);
		return null;
	}
	if (checkRunId === null) {
		await releaseReviewDeliveryClaim(env, deliveryId, claimId);
		return null;
	}
	let recorded = false;
	try {
		recorded = await recordReviewDeliveryClaimCheckRun(
			env,
			deliveryId,
			claimId,
			checkRunId,
		);
	} catch (error) {
		console.log("[checks] failed to record delivery check run:", error);
	}
	if (!recorded) {
		await completeSupersededRun(octokit, owner, repo, checkRunId);
		return null;
	}
	return { checkRunId, claimId, secret };
}

async function claimCheckRunRerequest(
	env: Env,
	deliveryId: string,
	checkRunId: number,
): Promise<DeliveryClaim | null> {
	const claim = await claimRerequestDelivery(
		env,
		deliveryId,
		`check run ${checkRunId}`,
	);
	if (claim === null) return null;
	if (claim.checkRunId != null) return claim;
	try {
		const recorded = await recordReviewDeliveryClaimCheckRun(
			env,
			deliveryId,
			claim.claimId,
			checkRunId,
		);
		return recorded ? claim : null;
	} catch (error) {
		console.log("[checks] failed to record check-run rerequest:", error);
		return null;
	}
}

function describeSuite(payload: CheckSuitePayload) {
	const suite = payload.check_suite;
	return (
		`suite ${suite.id} (app: ${suite.app?.slug}, ` +
		`head: ${suite.head_branch}@${suite.head_sha?.slice(0, 7)}, ` +
		`prs: ${suite.pull_requests.map((pr) => `#${pr.number}`).join(", ") || "none"})`
	);
}

async function handlePullRequestOpened(
	octokit: Octokit,
	payload: PullRequestPayload,
	deliveryId: string,
	env: Env,
	origin: string,
) {
	const pr = payload.pull_request;
	const owner = payload.repository.owner.login;
	const repo = payload.repository.name;
	const headSha = pr.head.sha;
	console.log(
		`Received pull_request.opened for #${pr.number} @ ${headSha.slice(0, 7)}`,
	);

	const existingRunId = await findExistingCheckRun(
		octokit,
		owner,
		repo,
		headSha,
	);
	if (existingRunId != null) {
		console.log(
			`[checks] PR #${pr.number} already has check run ${existingRunId} for ${headSha.slice(0, 7)} — skipping`,
		);
		return;
	}

	const claimKey = {
		repository: payload.repository.full_name,
		headSha,
		deliveryId,
	};
	const claimed = await createClaimedCheckRun(
		octokit,
		env,
		claimKey,
		owner,
		repo,
		`PR #${pr.number}`,
	);
	if (claimed === null) return;
	const { checkRunId, claimId, secret } = claimed;

	await startCheckRunReview(
		octokit,
		{
			owner,
			repo,
			fullName: payload.repository.full_name,
			prNumber: pr.number,
			prUrl: pr.html_url,
			headSha,
			checkRunId,
			attemptId: claimId,
			attemptSecret: secret,
			canStart: () => canStartReviewClaim(env, claimKey, claimId, checkRunId),
			canUpdate: () => isReviewClaimOwner(env, claimKey, claimId, checkRunId),
			onStarted: () =>
				markReviewClaimStarted(env, claimKey, claimId, checkRunId),
			onFailure: () =>
				abandonReviewClaimStart(env, claimKey, claimId, checkRunId),
		},
		origin,
		env,
	);
}

async function handleCheckSuiteRequest(
	octokit: Octokit,
	payload: CheckSuitePayload,
	deliveryId: string,
	env: Env,
	origin: string,
	isRerequest = false,
) {
	const suite = payload.check_suite;
	const pr = suite.pull_requests[0];
	if (!suite.head_sha) {
		console.log(`[checks] ${describeSuite(payload)} — no head_sha, skipping`);
		return;
	}
	if (!pr) {
		console.log(
			`[checks] ${describeSuite(payload)} — no PR attached, skipping`,
		);
		return;
	}
	if (!isRerequest) {
		const existingRunId = await findExistingCheckRun(
			octokit,
			payload.repository.owner.login,
			payload.repository.name,
			suite.head_sha,
		);
		if (existingRunId != null) {
			console.log(
				`[checks] ${describeSuite(payload)} — check run ${existingRunId} already exists, skipping`,
			);
			return;
		}
	}

	const claimKey = {
		repository: payload.repository.full_name,
		headSha: suite.head_sha,
		deliveryId,
	};
	const claimed = isRerequest
		? await createRerequestedCheckRun(
				octokit,
				env,
				deliveryId,
				payload.repository.owner.login,
				payload.repository.name,
				suite.head_sha,
				`suite ${suite.id}`,
			)
		: await createClaimedCheckRun(
				octokit,
				env,
				claimKey,
				payload.repository.owner.login,
				payload.repository.name,
				`suite ${suite.id}`,
			);
	if (claimed === null) return;
	const { checkRunId, claimId, secret } = claimed;

	await startCheckRunReview(
		octokit,
		{
			owner: payload.repository.owner.login,
			repo: payload.repository.name,
			fullName: payload.repository.full_name,
			prNumber: pr.number,
			prUrl: `https://github.com/${payload.repository.full_name}/pull/${pr.number}`,
			headSha: suite.head_sha,
			checkRunId,
			rerequested: isRerequest,
			attemptId: claimId,
			attemptSecret: secret,
			canStart: () =>
				isRerequest
					? isReviewDeliveryAttemptCurrent(env, checkRunId, claimId)
					: canStartReviewClaim(env, claimKey, claimId, checkRunId),
			canUpdate: () =>
				isRerequest
					? isReviewDeliveryAttemptCurrent(env, checkRunId, claimId)
					: isReviewClaimOwner(env, claimKey, claimId, checkRunId),
			onStarted: (processId) =>
				isRerequest
					? markReviewDeliveryClaimStarted(
							env,
							deliveryId,
							claimId,
							checkRunId,
							processId,
						).then(() => {})
					: markReviewClaimStarted(env, claimKey, claimId, checkRunId),
			onFailure: () =>
				isRerequest
					? abandonReviewDeliveryClaimStart(
							env,
							deliveryId,
							claimId,
							checkRunId,
						)
					: abandonReviewClaimStart(env, claimKey, claimId, checkRunId),
		},
		origin,
		env,
	);
}

export function createWebhookApp(env: Env, origin: string): App {
	const githubApp = createGitHubApp(getEnvIdentity(env), env.WEBHOOK_SECRET);

	githubApp.webhooks.on(
		"pull_request.opened",
		async ({ id, octokit, payload }) => {
			await handlePullRequestOpened(octokit, payload, id, env, origin);
		},
	);

	githubApp.webhooks.on("pull_request.synchronize", async ({ payload }) => {
		console.log(
			`Received a pull request sync event for #${payload.pull_request.number} (review handled via check_suite)`,
		);
	});

	githubApp.webhooks.on(
		"check_suite.requested",
		async ({ id, octokit, payload }) => {
			console.log(
				`Received check_suite.requested for ${describeSuite(payload)}`,
			);
			await handleCheckSuiteRequest(octokit, payload, id, env, origin, false);
		},
	);

	githubApp.webhooks.on(
		"check_suite.rerequested",
		async ({ id, octokit, payload }) => {
			console.log(
				`Received check_suite.rerequested for ${describeSuite(payload)}`,
			);
			await handleCheckSuiteRequest(octokit, payload, id, env, origin, true);
		},
	);

	githubApp.webhooks.on(
		"check_run.rerequested",
		async ({ id, octokit, payload }) => {
			const run = payload.check_run;
			const pr = run.pull_requests[0];
			console.log(
				`Received check_run.rerequested for check run ${run.id} ("${run.name}") @ ${run.head_sha.slice(0, 7)} ` +
					`(prs: ${run.pull_requests.map((p) => `#${p.number}`).join(", ") || "none"})`,
			);
			if (run.name !== CHECK_RUN_NAME) {
				console.log(
					`[checks] ignoring rerequest for "${run.name}" — not "${CHECK_RUN_NAME}"`,
				);
				return;
			}
			if (!pr) {
				console.log(
					`[checks] check run ${run.id} has no PR attached — skipping`,
				);
				return;
			}
			const claim = await claimCheckRunRerequest(env, id, run.id);
			if (claim === null || claim.secret === null) return;
			const { claimId, secret } = claim;
			const previous = await previousReviewDeliveryAttempt(
				env,
				run.id,
				claimId,
			);
			if (previous?.processId) {
				await getSandbox(env.Sandbox, previous.id)
					.killProcess(previous.processId)
					.catch((error) =>
						console.log("[review] failed to stop superseded process:", error),
					);
			}
			await startCheckRunReview(
				octokit,
				{
					owner: payload.repository.owner.login,
					repo: payload.repository.name,
					fullName: payload.repository.full_name,
					prNumber: pr.number,
					prUrl: `https://github.com/${payload.repository.full_name}/pull/${pr.number}`,
					headSha: run.head_sha,
					checkRunId: run.id,
					rerequested: true,
					attemptId: claimId,
					attemptSecret: secret,
					canStart: () => isReviewDeliveryAttemptCurrent(env, run.id, claimId),
					canUpdate: () => isReviewDeliveryAttemptCurrent(env, run.id, claimId),
					onStarted: (processId) =>
						markReviewDeliveryClaimStarted(
							env,
							id,
							claimId,
							run.id,
							processId,
						).then(() => {}),
					onFailure: () =>
						abandonReviewDeliveryClaimStart(env, id, claimId, run.id),
				},
				origin,
				env,
			);
		},
	);

	githubApp.webhooks.on("check_suite.completed", async ({ payload }) => {
		const suite = payload.check_suite;
		console.log(
			`Received check_suite.completed for suite ${suite.id} ` +
				`(app: ${suite.app?.slug}, head: ${suite.head_branch}@${suite.head_sha?.slice(0, 7)}, ` +
				`status: ${suite.status}, conclusion: ${suite.conclusion}, ` +
				`prs: ${suite.pull_requests.map((pr) => `#${pr.number}`).join(", ") || "none"})`,
		);
	});

	return githubApp;
}
