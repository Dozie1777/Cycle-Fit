export const RESCUE_RESULT_SCRIPT = `import { readFileSync } from "node:fs";

const CHECK_TITLE = process.env.CHECK_RUN_TITLE ?? "Code Review";
const headers = {
  authorization: "Bearer " + process.env.GH_TOKEN,
  accept: "application/vnd.github+json",
  "content-type": "application/json",
  "user-agent": "code-review-bot-rescue",
};
const api =
  (process.env.REVIEW_GITHUB_API_URL ?? "https://api.github.com") +
  "/repos/" +
  process.env.CHECK_RUN_OWNER +
  "/" +
  process.env.CHECK_RUN_REPO +
  "/check-runs/" +
  process.env.CHECK_RUN_ID;

async function assertCurrentAttempt() {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(process.env.REVIEW_ATTEMPT_URL, {
        method: "POST",
        headers: {
          authorization: "Bearer " + process.env.REVIEW_ATTEMPT_SECRET,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          checkRunId: Number(process.env.CHECK_RUN_ID),
          attemptId: process.env.REVIEW_ATTEMPT_ID,
        }),
      });
      if (response.status === 409) {
        console.log("[rescue] attempt superseded — skipping stale update");
        process.exit(0);
      }
      if (response.ok) return;
      throw new Error("attempt fence failed: " + response.status);
    } catch (error) {
      if (attempt === 3) {
        console.log("[rescue] attempt fence unavailable — proceeding to failure submission");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}
await assertCurrentAttempt();

let alreadyCompleted = false;
try {
  const run = await (await fetch(api, { headers })).json();
  alreadyCompleted = run.status === "completed";
} catch (error) {
  console.log("[rescue] could not read check run status:", error);
}
if (alreadyCompleted) {
  console.log("[rescue] check run already completed by the skill — nothing to do");
  process.exit(0);
}

let details = "";
try {
  details = readFileSync(process.env.REVIEW_OUTPUT_PATH, "utf8").slice(-60000);
} catch {
  // No log is fine — the summary alone explains the outcome.
}
let result;
try {
  const parsed = JSON.parse(readFileSync(process.env.REVIEW_RESULT_PATH, "utf8"));
  result = ["success", "failure", "neutral"].includes(parsed.conclusion)
    ? parsed
    : null;
} catch {
  result = null;
}
if (!result) {
  result = {
    conclusion: "failure",
    summary:
      "🤖 Review process failed without producing a result" +
      (process.env.REVIEW_EXIT_CODE ? " (exit code " + process.env.REVIEW_EXIT_CODE + ")" : "") +
      ". Re-run the check to retry the review.",
  };
}

await assertCurrentAttempt();
const submission = await fetch(process.env.REVIEW_SUBMISSION_URL, {
  method: "POST",
  headers: {
    authorization: "Bearer " + process.env.REVIEW_ATTEMPT_SECRET,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    kind: "check-run",
    checkRunId: Number(process.env.CHECK_RUN_ID),
    attemptId: process.env.REVIEW_ATTEMPT_ID,
    method: "PATCH",
    path: "repos/" + process.env.CHECK_RUN_OWNER + "/" + process.env.CHECK_RUN_REPO + "/check-runs/" + process.env.CHECK_RUN_ID,
    payload: {
      status: "completed",
      conclusion: result.conclusion,
      completed_at: new Date().toISOString(),
      output: {
        title: CHECK_TITLE,
        summary: String(result.summary ?? "").slice(0, 65000),
        text: details || undefined,
      },
    },
  }),
});
console.log("[rescue] completing check run as " + result.conclusion + " -> " + submission.status);
if (!submission.ok) {
  console.log("[rescue] body:", await submission.text());
  process.exit(1);
}
`;

export const RUN_REVIEW_SCRIPT = `#!/bin/bash
set -u
LOG_FILE="$(dirname "$0")/review-output.log"
preflight_attempt() {
  local attempt=1 status
  while [ "$attempt" -le 3 ]; do
    status=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' -X POST \
      -H "authorization: Bearer $REVIEW_ATTEMPT_SECRET" \
      -H "content-type: application/json" \
      --data '{"checkRunId":'$CHECK_RUN_ID',"attemptId":"'$REVIEW_ATTEMPT_ID'"}' \
      "$REVIEW_ATTEMPT_URL" || true)
    case "$status" in
      204) return 0 ;;
      409) return 2 ;;
    esac
    if [ "$attempt" -lt 3 ]; then sleep 0.05; fi
    attempt=$((attempt + 1))
  done
  return 1
}
if [ -n "\${REVIEW_ATTEMPT_URL:-}" ]; then
  preflight_attempt
  preflight_status=$?
  if [ "$preflight_status" -eq 2 ]; then
    echo "[review] attempt superseded — not starting"
    exit 0
  fi
  if [ "$preflight_status" -ne 0 ]; then
    export REVIEW_EXIT_CODE=1
    node "$(dirname "$0")/rescue-result.mjs"
    exit $?
  fi
fi
kimi -p "\${KIMI_SKILL_PROMPT:-/skill:github-pr-check-review $PR_URL}" 2>&1 | tee "$LOG_FILE"
export REVIEW_EXIT_CODE="\${PIPESTATUS[0]}"
node "$(dirname "$0")/rescue-result.mjs"
`;

export const REVIEW_GH_WRAPPER = `#!/bin/bash
set -u
node "$(dirname "$0")/review-gh.mjs" "$@"
`;

export const REVIEW_GH_SCRIPT = `import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);

function passthrough() {
  const result = spawnSync(process.env.GH_REAL, args, {
    stdio: "inherit",
    env: process.env,
  });
  process.exit(result.status ?? 1);
}

async function submit(body) {
  const response = await fetch(process.env.REVIEW_SUBMISSION_URL, {
    method: "POST",
    headers: {
      authorization: "Bearer " + process.env.REVIEW_ATTEMPT_SECRET,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      checkRunId: Number(process.env.CHECK_RUN_ID),
      attemptId: process.env.REVIEW_ATTEMPT_ID,
      ...body,
    }),
  });
  const text = await response.text();
  if (response.status === 409) {
    console.error("[submit] attempt superseded — mutation rejected");
    process.exit(1);
  }
  if (!response.ok) {
    console.error(text);
    process.exit(1);
  }
  console.log(text);
}

if (args[0] === "api") {
  const methodIndex = args.indexOf("-X");
  const method = methodIndex === -1 ? "GET" : args[methodIndex + 1].toUpperCase();
  const path = args.find((arg) => arg.startsWith("repos/"));
  if (method !== "GET" && path?.includes("/check-runs/")) {
    const inputIndex = args.indexOf("--input");
    const payload = inputIndex === -1
      ? undefined
      : JSON.parse(readFileSync(args[inputIndex + 1], "utf8"));
    await submit({ kind: "check-run", method, path, payload });
  } else {
    passthrough();
  }
} else if (args[0] === "pr" && args[1] === "review") {
  const event = args.includes("--approve")
    ? "APPROVE"
    : args.includes("--request-changes")
      ? "REQUEST_CHANGES"
      : "COMMENT";
  const repoIndex = args.indexOf("--repo");
  const [owner, repo] = args[repoIndex + 1].split("/");
  const bodyIndex = args.indexOf("--body");
  const bodyFileIndex = args.indexOf("--body-file");
  const body = bodyIndex === -1
    ? bodyFileIndex === -1
      ? undefined
      : readFileSync(args[bodyFileIndex + 1], "utf8")
    : args[bodyIndex + 1];
  await submit({
    kind: "pr-review",
    owner,
    repo,
    prNumber: Number(args[2]),
    event,
    ...(body === undefined ? {} : { body }),
  });
} else {
  passthrough();
}
`;
