export type ReviewClaimKey = {
	repository: string;
	headSha: string;
	deliveryId: string;
};

export type ReviewClaimResult = {
	claimed: boolean;
	claimId: string | null;
	checkRunId: number | null;
	secret: string | null;
};

type ClaimRow = {
	id: string;
	checkRunId: number | null;
	state: string;
	leaseUntil: string | null;
};

export async function hashReviewAttemptSecret(secret: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(secret),
	);
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

function constantTimeEqual(left: string, right: string): boolean {
	if (left.length !== right.length) return false;
	let difference = 0;
	for (let index = 0; index < left.length; index++) {
		difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
	}
	return difference === 0;
}

const CLAIM_LEASE_MS = 60_000;
const CLAIM_WAIT_DELAY_MS = 50;

function delay(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, CLAIM_WAIT_DELAY_MS));
}

function isExpired(leaseUntil: string | null): boolean {
	return leaseUntil === null || Date.parse(leaseUntil) <= Date.now();
}

function leaseExpiry(): string {
	return new Date(Date.now() + CLAIM_LEASE_MS).toISOString();
}

export async function claimReview(
	env: Env,
	key: ReviewClaimKey,
): Promise<ReviewClaimResult> {
	const claimId = crypto.randomUUID();
	const secret = `${crypto.randomUUID()}${crypto.randomUUID()}`;
	const secretHash = await hashReviewAttemptSecret(secret);
	for (;;) {
		const inserted = await env.DB.prepare(
			`INSERT OR IGNORE INTO "ReviewClaim"
				("id", "repository", "headSha", "deliveryId", "state", "secretHash", "leaseUntil")
			VALUES (?, ?, ?, ?, 'creating', ?, ?)`,
		)
			.bind(
				claimId,
				key.repository,
				key.headSha,
				key.deliveryId,
				secretHash,
				leaseExpiry(),
			)
			.run();
		if (inserted.meta.changes === 1) {
			return { claimed: true, claimId, checkRunId: null, secret };
		}

		const existing = await env.DB.prepare(
			`SELECT "id", "checkRunId", "state", "leaseUntil" FROM "ReviewClaim"
			WHERE "repository" = ? AND "headSha" = ?`,
		)
			.bind(key.repository, key.headSha)
			.first<ClaimRow>();
		if (!existing) continue;
		if (existing.state === "started") {
			return {
				claimed: false,
				claimId: null,
				checkRunId: existing.checkRunId,
				secret: null,
			};
		}
		if (!isExpired(existing.leaseUntil)) {
			await delay();
			continue;
		}
		if (existing.state === "created" && existing.checkRunId != null) {
			const recovered = await env.DB.prepare(
				`UPDATE "ReviewClaim" SET "id" = ?, "deliveryId" = ?, "secretHash" = ?, "leaseUntil" = ?
				WHERE "id" = ? AND "state" = 'created' AND "checkRunId" IS NOT NULL
					AND ("leaseUntil" IS NULL OR "leaseUntil" <= ?)`,
			)
				.bind(
					claimId,
					key.deliveryId,
					secretHash,
					leaseExpiry(),
					existing.id,
					new Date().toISOString(),
				)
				.run();
			if (recovered.meta.changes === 1) {
				return {
					claimed: true,
					claimId,
					checkRunId: existing.checkRunId,
					secret,
				};
			}
			continue;
		}
		await env.DB.prepare(
			`DELETE FROM "ReviewClaim"
			WHERE "id" = ? AND "checkRunId" IS NULL
				AND ("leaseUntil" IS NULL OR "leaseUntil" <= ?)`,
		)
			.bind(existing.id, new Date().toISOString())
			.run();
	}
}

export async function recordReviewClaimCheckRun(
	env: Env,
	key: ReviewClaimKey,
	claimId: string,
	checkRunId: number,
): Promise<boolean> {
	const updated = await env.DB.prepare(
		`UPDATE "ReviewClaim" SET "checkRunId" = ?, "state" = 'created'
		WHERE "id" = ? AND "repository" = ? AND "headSha" = ?
			AND "deliveryId" = ? AND "state" = 'creating' AND "checkRunId" IS NULL`,
	)
		.bind(checkRunId, claimId, key.repository, key.headSha, key.deliveryId)
		.run();
	return updated.meta.changes === 1;
}

export async function releaseReviewClaim(
	env: Env,
	key: ReviewClaimKey,
	claimId: string,
): Promise<void> {
	await env.DB.prepare(
		`DELETE FROM "ReviewClaim"
		WHERE "id" = ? AND "repository" = ? AND "headSha" = ?
			AND "deliveryId" = ? AND "checkRunId" IS NULL`,
	)
		.bind(claimId, key.repository, key.headSha, key.deliveryId)
		.run();
}

export async function canStartReviewClaim(
	env: Env,
	key: ReviewClaimKey,
	claimId: string,
	checkRunId: number,
): Promise<boolean> {
	const owner = await env.DB.prepare(
		`SELECT "id" FROM "ReviewClaim"
		WHERE "id" = ? AND "repository" = ? AND "headSha" = ?
			AND "deliveryId" = ? AND "checkRunId" = ? AND "state" = 'created'`,
	)
		.bind(claimId, key.repository, key.headSha, key.deliveryId, checkRunId)
		.first<{ id: string }>();
	return owner?.id === claimId;
}

export async function isReviewClaimOwner(
	env: Env,
	key: ReviewClaimKey,
	claimId: string,
	checkRunId: number,
): Promise<boolean> {
	const owner = await env.DB.prepare(
		`SELECT "id" FROM "ReviewClaim"
		WHERE "id" = ? AND "repository" = ? AND "headSha" = ?
			AND "deliveryId" = ? AND "checkRunId" = ?
			AND "state" IN ('created', 'started')`,
	)
		.bind(claimId, key.repository, key.headSha, key.deliveryId, checkRunId)
		.first<{ id: string }>();
	return owner?.id === claimId;
}

export async function markReviewClaimStarted(
	env: Env,
	key: ReviewClaimKey,
	claimId: string,
	checkRunId: number,
): Promise<void> {
	await env.DB.prepare(
		`UPDATE "ReviewClaim" SET "state" = 'started', "leaseUntil" = NULL
		WHERE "id" = ? AND "repository" = ? AND "headSha" = ?
			AND "deliveryId" = ? AND "checkRunId" = ? AND "state" = 'created'`,
	)
		.bind(claimId, key.repository, key.headSha, key.deliveryId, checkRunId)
		.run();
}

export async function abandonReviewClaimStart(
	env: Env,
	key: ReviewClaimKey,
	claimId: string,
	checkRunId: number,
): Promise<void> {
	await env.DB.prepare(
		`UPDATE "ReviewClaim" SET "leaseUntil" = ?
		WHERE "id" = ? AND "repository" = ? AND "headSha" = ?
			AND "deliveryId" = ? AND "checkRunId" = ? AND "state" = 'created'`,
	)
		.bind(
			new Date().toISOString(),
			claimId,
			key.repository,
			key.headSha,
			key.deliveryId,
			checkRunId,
		)
		.run();
}

export async function claimReviewDelivery(
	env: Env,
	deliveryId: string,
): Promise<ReviewClaimResult> {
	const claimId = crypto.randomUUID();
	const secret = `${crypto.randomUUID()}${crypto.randomUUID()}`;
	const secretHash = await hashReviewAttemptSecret(secret);
	for (;;) {
		const inserted = await env.DB.prepare(
			`INSERT OR IGNORE INTO "ReviewDeliveryClaim"
				("id", "deliveryId", "state", "secretHash", "leaseUntil")
			VALUES (?, ?, 'creating', ?, ?)`,
		)
			.bind(claimId, deliveryId, secretHash, leaseExpiry())
			.run();
		if (inserted.meta.changes === 1) {
			return { claimed: true, claimId, checkRunId: null, secret };
		}

		const existing = await env.DB.prepare(
			`SELECT "id", "checkRunId", "state", "leaseUntil" FROM "ReviewDeliveryClaim"
			WHERE "deliveryId" = ?`,
		)
			.bind(deliveryId)
			.first<ClaimRow>();
		if (!existing) continue;
		if (existing.state === "started") {
			return {
				claimed: false,
				claimId: null,
				checkRunId: existing.checkRunId,
				secret: null,
			};
		}
		if (!isExpired(existing.leaseUntil)) {
			await delay();
			continue;
		}
		if (existing.state === "created" && existing.checkRunId != null) {
			const recovered = await env.DB.prepare(
				`UPDATE "ReviewDeliveryClaim" SET "id" = ?, "secretHash" = ?, "leaseUntil" = ?
				WHERE "id" = ? AND "state" = 'created' AND "checkRunId" IS NOT NULL
					AND ("leaseUntil" IS NULL OR "leaseUntil" <= ?)`,
			)
				.bind(
					claimId,
					secretHash,
					leaseExpiry(),
					existing.id,
					new Date().toISOString(),
				)
				.run();
			if (recovered.meta.changes === 1) {
				return {
					claimed: true,
					claimId,
					checkRunId: existing.checkRunId,
					secret,
				};
			}
			continue;
		}
		await env.DB.prepare(
			`DELETE FROM "ReviewDeliveryClaim"
			WHERE "id" = ? AND "checkRunId" IS NULL
				AND ("leaseUntil" IS NULL OR "leaseUntil" <= ?)`,
		)
			.bind(existing.id, new Date().toISOString())
			.run();
	}
}

export async function recordReviewDeliveryClaimCheckRun(
	env: Env,
	deliveryId: string,
	claimId: string,
	checkRunId: number,
): Promise<boolean> {
	const updated = await env.DB.prepare(
		`UPDATE "ReviewDeliveryClaim" SET "checkRunId" = ?, "state" = 'created'
		WHERE "id" = ? AND "deliveryId" = ? AND "state" = 'creating' AND "checkRunId" IS NULL`,
	)
		.bind(checkRunId, claimId, deliveryId)
		.run();
	return updated.meta.changes === 1;
}

export async function releaseReviewDeliveryClaim(
	env: Env,
	deliveryId: string,
	claimId: string,
): Promise<void> {
	await env.DB.prepare(
		`DELETE FROM "ReviewDeliveryClaim"
		WHERE "id" = ? AND "deliveryId" = ? AND "checkRunId" IS NULL`,
	)
		.bind(claimId, deliveryId)
		.run();
}

export async function isReviewDeliveryAttemptCurrent(
	env: Env,
	checkRunId: number,
	claimId: string,
): Promise<boolean> {
	const latest = await env.DB.prepare(
		`SELECT "id" FROM "ReviewDeliveryClaim"
		WHERE "checkRunId" = ? ORDER BY "rowid" DESC LIMIT 1`,
	)
		.bind(checkRunId)
		.first<{ id: string }>();
	return latest?.id === claimId;
}

export async function previousReviewDeliveryAttempt(
	env: Env,
	checkRunId: number,
	claimId: string,
): Promise<{ id: string; processId: string | null } | null> {
	return env.DB.prepare(
		`SELECT "id", "processId" FROM "ReviewDeliveryClaim"
		WHERE "checkRunId" = ? AND "id" <> ? AND "processId" IS NOT NULL
		ORDER BY "rowid" DESC LIMIT 1`,
	)
		.bind(checkRunId, claimId)
		.first<{ id: string; processId: string | null }>();
}

export async function markReviewDeliveryClaimStarted(
	env: Env,
	deliveryId: string,
	claimId: string,
	checkRunId: number,
	processId: string,
): Promise<boolean> {
	const updated = await env.DB.prepare(
		`UPDATE "ReviewDeliveryClaim"
		SET "state" = 'started', "processId" = ?, "leaseUntil" = NULL
		WHERE "id" = ? AND "deliveryId" = ? AND "checkRunId" = ? AND "state" = 'created'
			AND "id" = (
				SELECT "id" FROM "ReviewDeliveryClaim"
				WHERE "checkRunId" = ? ORDER BY "rowid" DESC LIMIT 1
			)`,
	)
		.bind(processId, claimId, deliveryId, checkRunId, checkRunId)
		.run();
	return updated.meta.changes === 1;
}

export async function abandonReviewDeliveryClaimStart(
	env: Env,
	deliveryId: string,
	claimId: string,
	checkRunId: number,
): Promise<void> {
	await env.DB.prepare(
		`UPDATE "ReviewDeliveryClaim" SET "leaseUntil" = ?
		WHERE "id" = ? AND "deliveryId" = ? AND "checkRunId" = ? AND "state" = 'created'
			AND "id" = (
				SELECT "id" FROM "ReviewDeliveryClaim"
				WHERE "checkRunId" = ? ORDER BY "rowid" DESC LIMIT 1
			)`,
	)
		.bind(new Date().toISOString(), claimId, deliveryId, checkRunId, checkRunId)
		.run();
}

export async function isReviewAttemptCurrent(
	env: Env,
	checkRunId: number,
	attemptId: string,
): Promise<boolean> {
	const ordinary = await env.DB.prepare(
		`SELECT "state" FROM "ReviewClaim" WHERE "id" = ? AND "checkRunId" = ?`,
	)
		.bind(attemptId, checkRunId)
		.first<{ state: string }>();
	if (ordinary) {
		return ordinary.state === "created" || ordinary.state === "started";
	}
	return isReviewDeliveryAttemptCurrent(env, checkRunId, attemptId);
}

export async function isReviewAttemptCredentialValid(
	env: Env,
	checkRunId: number,
	attemptId: string,
	secret: string,
): Promise<boolean> {
	const ordinary = await env.DB.prepare(
		`SELECT "secretHash" FROM "ReviewClaim" WHERE "id" = ? AND "checkRunId" = ?`,
	)
		.bind(attemptId, checkRunId)
		.first<{ secretHash: string | null }>();
	const delivery = ordinary
		? null
		: await env.DB.prepare(
				`SELECT "secretHash" FROM "ReviewDeliveryClaim"
				WHERE "id" = ? AND "checkRunId" = ?`,
			)
				.bind(attemptId, checkRunId)
				.first<{ secretHash: string | null }>();
	const storedHash = ordinary?.secretHash ?? delivery?.secretHash;
	if (!storedHash) return false;
	return constantTimeEqual(storedHash, await hashReviewAttemptSecret(secret));
}
