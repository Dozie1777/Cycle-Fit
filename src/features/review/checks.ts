// The single check name this app owns. Everything that creates, updates or
// reacts to check runs filters on this — the repo has many other checks.
//
// The review-result.json contract the sandbox skill writes and submits is
// documented in .agents/skills/github-pr-check-review/SKILL.md — keep the two
// in sync.
export const CHECK_RUN_NAME = "Code Review";

// Separate check name for the cron-triggered whole-codebase review on the
// default branch (see features/review/daily-review.ts and the
// codebase-daily-review skill). Everything that reacts to check runs via
// webhooks filters on CHECK_RUN_NAME, so the daily run never collides with
// the PR pipeline.
export const DAILY_CHECK_RUN_NAME = "Daily Codebase Review";
