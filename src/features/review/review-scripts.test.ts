import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
	RESCUE_RESULT_SCRIPT,
	REVIEW_GH_SCRIPT,
	REVIEW_GH_WRAPPER,
	RUN_REVIEW_SCRIPT,
} from "./review-scripts";

const executeFile = promisify(execFile);
const cleanup: (() => Promise<void>)[] = [];

afterEach(async () => {
	await Promise.all(cleanup.splice(0).map((fn) => fn()));
});

async function executable(path: string, content: string) {
	await writeFile(path, content, { mode: 0o755 });
}

async function scriptWorkspace(name: string, content: string, fakeNode = true) {
	const directory = await mkdtemp(join(tmpdir(), "review-scripts-"));
	cleanup.push(() => rm(directory, { recursive: true, force: true }));
	const bin = join(directory, "bin");
	await mkdir(bin);
	await executable(join(directory, name), content);
	await executable(
		join(bin, "kimi"),
		`#!/bin/bash\nprintf started > "${directory}/kimi-started"\n`,
	);
	if (fakeNode) {
		await executable(
			join(bin, "node"),
			`#!/bin/bash\nprintf started > "${directory}/rescue-started"\n`,
		);
	}
	return { directory, bin };
}

async function endpoint(
	handler: (body: string, request: IncomingMessage) => number,
) {
	const requests: { body: string; authorization: string | undefined }[] = [];
	const server = createServer((request, response) => {
		let body = "";
		request.on("data", (chunk) => {
			body += chunk;
		});
		request.on("end", () => {
			requests.push({ body, authorization: request.headers.authorization });
			response.statusCode = handler(body, request);
			response.end();
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	cleanup.push(
		() => new Promise<void>((resolve) => server.close(() => resolve())),
	);
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("missing port");
	return { requests, origin: `http://127.0.0.1:${address.port}` };
}

async function unreachableOrigin(): Promise<string> {
	const server = createServer();
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("missing port");
	const origin = `http://127.0.0.1:${address.port}`;
	await new Promise<void>((resolve) => server.close(() => resolve()));
	return origin;
}

function environment(bin: string, extra: Record<string, string>) {
	return {
		...process.env,
		PATH: `${bin}:${process.env.PATH}`,
		...extra,
	};
}

describe("review sandbox script execution", () => {
	it("passes KIMI_SKILL_PROMPT through to kimi and falls back to the PR skill", async () => {
		const mkScriptWorkspace = async () => {
			const directory = await mkdtemp(join(tmpdir(), "review-scripts-"));
			cleanup.push(() => rm(directory, { recursive: true, force: true }));
			const bin = join(directory, "bin");
			await mkdir(bin);
			await executable(join(directory, "run-review.sh"), RUN_REVIEW_SCRIPT);
			const argsPath = join(directory, "kimi-args");
			await executable(
				join(bin, "kimi"),
				`#!/bin/bash\nprintf '%s' "$*" > "${argsPath}"\n`,
			);
			await executable(join(bin, "node"), "#!/bin/bash\nexit 0\n");
			return { directory, bin, argsPath };
		};

		// Daily review: explicit prompt, no PR URL.
		const daily = await mkScriptWorkspace();
		await executeFile("bash", [join(daily.directory, "run-review.sh")], {
			env: environment(daily.bin, {
				KIMI_SKILL_PROMPT: "/skill:codebase-daily-review",
				CHECK_RUN_ID: "9012",
			}),
		});
		expect(await readFile(daily.argsPath, "utf8")).toBe(
			"-p /skill:codebase-daily-review",
		);

		// PR review fallback: no prompt, PR_URL set.
		const pr = await mkScriptWorkspace();
		await executeFile("bash", [join(pr.directory, "run-review.sh")], {
			env: environment(pr.bin, {
				CHECK_RUN_ID: "9012",
				PR_URL: "https://github.com/owner/repo/pull/42",
			}),
		});
		expect(await readFile(pr.argsPath, "utf8")).toBe(
			"-p /skill:github-pr-check-review https://github.com/owner/repo/pull/42",
		);
	});

	it("sends valid authenticated preflight JSON and proceeds to review and rescue", async () => {
		const { directory, bin } = await scriptWorkspace(
			"run-review.sh",
			RUN_REVIEW_SCRIPT,
		);
		const server = await endpoint(() => 204);
		const env = environment(bin, {
			REVIEW_ATTEMPT_URL: `${server.origin}/api/review-attempt`,
			REVIEW_ATTEMPT_ID: "ordinary-claim",
			REVIEW_ATTEMPT_SECRET: "ordinary-secret",
			CHECK_RUN_ID: "9012",
			PR_URL: "https://github.com/owner/repo/pull/42",
		});

		await executeFile("bash", [join(directory, "run-review.sh")], { env });

		expect(server.requests).toHaveLength(1);
		expect(server.requests[0]?.authorization).toBe("Bearer ordinary-secret");
		expect(JSON.parse(server.requests[0]?.body ?? "")).toEqual({
			checkRunId: 9012,
			attemptId: "ordinary-claim",
		});
		expect(await readFile(join(directory, "kimi-started"), "utf8")).toBe(
			"started",
		);
		expect(await readFile(join(directory, "rescue-started"), "utf8")).toBe(
			"started",
		);
	});

	it("does not start kimi when an ordinary owner is stale at launch", async () => {
		const { directory, bin } = await scriptWorkspace(
			"run-review.sh",
			RUN_REVIEW_SCRIPT,
		);
		const server = await endpoint(() => 409);
		const env = environment(bin, {
			REVIEW_ATTEMPT_URL: `${server.origin}/api/review-attempt`,
			REVIEW_ATTEMPT_ID: "stale-ordinary-owner",
			REVIEW_ATTEMPT_SECRET: "stale-ordinary-secret",
			CHECK_RUN_ID: "9012",
			PR_URL: "https://github.com/owner/repo/pull/42",
		});

		await executeFile("bash", [join(directory, "run-review.sh")], { env });

		await expect(
			readFile(join(directory, "kimi-started"), "utf8"),
		).rejects.toThrow();
		await expect(
			readFile(join(directory, "rescue-started"), "utf8"),
		).rejects.toThrow();
	});

	it("rejects stale skill mutations and submits current completion, annotation, and verdict", async () => {
		const { directory, bin } = await scriptWorkspace(
			"review-gh.mjs",
			REVIEW_GH_SCRIPT,
			false,
		);
		await executable(join(directory, "gh"), REVIEW_GH_WRAPPER);
		const realGh = join(directory, "real-gh");
		await executable(realGh, "#!/bin/bash\nexit 0\n");
		await writeFile(
			join(directory, "payload.json"),
			JSON.stringify({ status: "completed", conclusion: "success" }),
		);
		await writeFile(
			join(directory, "verdict.txt"),
			'comment with `markdown`, "quotes" & $shell\nline two',
		);
		const server = await endpoint((body) => {
			const attemptId = JSON.parse(body).attemptId;
			return attemptId === "stale-attempt" ? 409 : 200;
		});
		const env = environment(bin, {
			GH_REAL: realGh,
			REVIEW_SUBMISSION_URL: `${server.origin}/api/review-submission`,
			REVIEW_ATTEMPT_ID: "current-attempt",
			REVIEW_ATTEMPT_SECRET: "current-secret",
			CHECK_RUN_ID: "9012",
			CHECK_RUN_OWNER: "owner",
			CHECK_RUN_REPO: "repo",
			PR_NUMBER: "42",
		});
		const gh = join(directory, "gh");
		const common = { cwd: directory, env };

		await executeFile(
			gh,
			[
				"pr",
				"review",
				"42",
				"--repo",
				"owner/repo",
				"--approve",
				"--body",
				"approved exactly",
			],
			common,
		);
		await executeFile(
			gh,
			[
				"pr",
				"review",
				"42",
				"--repo",
				"owner/repo",
				"--request-changes",
				"--body",
				'needs "quotes" & $shell',
			],
			common,
		);
		await executeFile(
			gh,
			[
				"pr",
				"review",
				"42",
				"--repo",
				"owner/repo",
				"--comment",
				"--body-file",
				join(directory, "verdict.txt"),
			],
			common,
		);
		await executeFile(
			gh,
			[
				"api",
				"-X",
				"PATCH",
				"repos/owner/repo/check-runs/9012",
				"--input",
				join(directory, "payload.json"),
			],
			common,
		);
		await executeFile(
			gh,
			[
				"api",
				"-X",
				"POST",
				"repos/owner/repo/check-runs/9012/annotations",
				"--input",
				join(directory, "payload.json"),
			],
			common,
		);
		await expect(
			executeFile(
				gh,
				[
					"api",
					"-X",
					"PATCH",
					"repos/owner/repo/check-runs/9012",
					"--input",
					join(directory, "payload.json"),
				],
				{
					...common,
					env: {
						...env,
						REVIEW_ATTEMPT_ID: "stale-attempt",
						REVIEW_ATTEMPT_SECRET: "stale-secret",
					},
				},
			),
		).rejects.toMatchObject({ code: 1 });

		expect(server.requests).toHaveLength(6);
		expect(server.requests.map((request) => request.authorization)).toEqual([
			"Bearer current-secret",
			"Bearer current-secret",
			"Bearer current-secret",
			"Bearer current-secret",
			"Bearer current-secret",
			"Bearer stale-secret",
		]);
		const submissions = server.requests.map((request) =>
			JSON.parse(request.body),
		);
		expect(submissions.map((submission) => submission.kind)).toEqual([
			"pr-review",
			"pr-review",
			"pr-review",
			"check-run",
			"check-run",
			"check-run",
		]);
		expect(submissions[0]).toMatchObject({
			event: "APPROVE",
			body: "approved exactly",
		});
		expect(submissions[1]).toMatchObject({
			event: "REQUEST_CHANGES",
			body: 'needs "quotes" & $shell',
		});
		expect(submissions[2]).toMatchObject({
			event: "COMMENT",
			body: 'comment with `markdown`, "quotes" & $shell\nline two',
		});
		expect(submissions[4]).toMatchObject({
			method: "POST",
			path: "repos/owner/repo/check-runs/9012/annotations",
		});
	});

	it("retries launch preflight 500s before allowing review and rescue", async () => {
		const { directory, bin } = await scriptWorkspace(
			"run-review.sh",
			RUN_REVIEW_SCRIPT,
		);
		let calls = 0;
		const server = await endpoint(() => {
			calls++;
			return calls < 3 ? 500 : 204;
		});
		const env = environment(bin, {
			REVIEW_ATTEMPT_URL: `${server.origin}/api/review-attempt`,
			REVIEW_ATTEMPT_ID: "ordinary-claim",
			REVIEW_ATTEMPT_SECRET: "ordinary-secret",
			CHECK_RUN_ID: "9012",
			PR_URL: "https://github.com/owner/repo/pull/42",
		});

		await executeFile("bash", [join(directory, "run-review.sh")], { env });

		expect(server.requests).toHaveLength(3);
		expect(await readFile(join(directory, "kimi-started"), "utf8")).toBe(
			"started",
		);
		expect(await readFile(join(directory, "rescue-started"), "utf8")).toBe(
			"started",
		);
	});

	it("uses the failure rescue path after persistent launch preflight 500s", async () => {
		const { directory, bin } = await scriptWorkspace(
			"run-review.sh",
			RUN_REVIEW_SCRIPT,
		);
		const server = await endpoint(() => 500);
		const env = environment(bin, {
			REVIEW_ATTEMPT_URL: `${server.origin}/api/review-attempt`,
			REVIEW_ATTEMPT_ID: "ordinary-claim",
			REVIEW_ATTEMPT_SECRET: "ordinary-secret",
			CHECK_RUN_ID: "9012",
			PR_URL: "https://github.com/owner/repo/pull/42",
		});

		await executeFile("bash", [join(directory, "run-review.sh")], { env });

		expect(server.requests).toHaveLength(3);
		await expect(
			readFile(join(directory, "kimi-started"), "utf8"),
		).rejects.toThrow();
		expect(await readFile(join(directory, "rescue-started"), "utf8")).toBe(
			"started",
		);
	});

	it("uses the failure rescue path after a launch preflight network error", async () => {
		const { directory, bin } = await scriptWorkspace(
			"run-review.sh",
			RUN_REVIEW_SCRIPT,
		);
		const env = environment(bin, {
			REVIEW_ATTEMPT_URL: `${await unreachableOrigin()}/api/review-attempt`,
			REVIEW_ATTEMPT_ID: "ordinary-claim",
			REVIEW_ATTEMPT_SECRET: "ordinary-secret",
			CHECK_RUN_ID: "9012",
			PR_URL: "https://github.com/owner/repo/pull/42",
		});

		await executeFile("bash", [join(directory, "run-review.sh")], { env });

		await expect(
			readFile(join(directory, "kimi-started"), "utf8"),
		).rejects.toThrow();
		expect(await readFile(join(directory, "rescue-started"), "utf8")).toBe(
			"started",
		);
	});

	it.each([
		"500",
		"network",
	])("retries a rescue preflight %s failure and submits failure completion", async (kind) => {
		const { directory } = await scriptWorkspace(
			"rescue-result.mjs",
			RESCUE_RESULT_SCRIPT,
			false,
		);
		let attempts = 0;
		const submissions: string[] = [];
		const server = await endpoint((body, request) => {
			if (request.url === "/attempt") {
				attempts++;
				return 500;
			}
			if (request.url === "/submission") {
				submissions.push(body);
				return 200;
			}
			return 200;
		});
		const env = environment(join(directory, "bin"), {
			REVIEW_GITHUB_API_URL: server.origin,
			REVIEW_ATTEMPT_URL:
				kind === "500"
					? `${server.origin}/attempt`
					: `${await unreachableOrigin()}/attempt`,
			REVIEW_SUBMISSION_URL: `${server.origin}/submission`,
			REVIEW_ATTEMPT_ID: "ordinary-claim",
			REVIEW_ATTEMPT_SECRET: "ordinary-secret",
			CHECK_RUN_ID: "9012",
			CHECK_RUN_OWNER: "owner",
			CHECK_RUN_REPO: "repo",
			GH_TOKEN: "test-token",
			REVIEW_RESULT_PATH: join(directory, "missing-result.json"),
			REVIEW_OUTPUT_PATH: join(directory, "missing-output.log"),
			REVIEW_EXIT_CODE: "1",
		});

		await executeFile(
			process.execPath,
			[join(directory, "rescue-result.mjs")],
			{
				env,
			},
		);

		expect(attempts).toBe(kind === "500" ? 6 : 0);
		expect(submissions).toHaveLength(1);
		expect(JSON.parse(submissions[0] ?? "{}")).toMatchObject({
			kind: "check-run",
			checkRunId: 9012,
			attemptId: "ordinary-claim",
			method: "PATCH",
			payload: expect.objectContaining({
				status: "completed",
				conclusion: "failure",
			}),
		});
	});

	it("stops a stale rescue without submitting after a 409", async () => {
		const { directory } = await scriptWorkspace(
			"rescue-result.mjs",
			RESCUE_RESULT_SCRIPT,
			false,
		);
		let attempts = 0;
		const submissions: string[] = [];
		const server = await endpoint((body, request) => {
			if (request.url === "/attempt") {
				attempts++;
				return 409;
			}
			if (request.url === "/submission") submissions.push(body);
			return 200;
		});
		const env = environment(join(directory, "bin"), {
			REVIEW_GITHUB_API_URL: server.origin,
			REVIEW_ATTEMPT_URL: `${server.origin}/attempt`,
			REVIEW_SUBMISSION_URL: `${server.origin}/submission`,
			REVIEW_ATTEMPT_ID: "ordinary-claim",
			REVIEW_ATTEMPT_SECRET: "ordinary-secret",
			CHECK_RUN_ID: "9012",
			CHECK_RUN_OWNER: "owner",
			CHECK_RUN_REPO: "repo",
			GH_TOKEN: "test-token",
			REVIEW_RESULT_PATH: join(directory, "missing-result.json"),
			REVIEW_OUTPUT_PATH: join(directory, "missing-output.log"),
		});

		await executeFile(
			process.execPath,
			[join(directory, "rescue-result.mjs")],
			{
				env,
			},
		);

		expect(attempts).toBe(1);
		expect(submissions).toHaveLength(0);
	});
});
