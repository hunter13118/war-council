/**
 * Post-apply diff tournament — judge applied git diff, not the plan.
 */
import { runCommand } from "./commands.js";

/**
 * @param {object} opts
 */
export async function runAppliedDiffTournament({
  executeTool,
  task,
  repoRoot,
  applySummary = "",
}) {
  const diffRes = await runCommand("git", ["diff"], repoRoot, 60_000);
  const diff = (diffRes.stdout || "").trim();
  if (!diff) {
    return { skipped: true, reason: "no diff after apply", tournament: "(no diff)" };
  }

  const reviewText = await executeTool("review_diff", {
    tier: "fast",
    repo_root: repoRoot,
  });

  const prompt = [
    "Judge the **APPLIED git diff** (not the plan). Is implementation COMPLETE for the task?",
    "If gaps remain, list numbered MUST-FIX items.",
    "",
    `TASK: ${task.slice(0, 500)}`,
    "",
    `APPLY SUMMARY:\n${applySummary.slice(0, 1500)}`,
    "",
    `DIFF REVIEW:\n${reviewText.slice(0, 3000)}`,
  ].join("\n");

  const tournament = await executeTool("tournament_vote", {
    prompt,
    voters: ["specialist", "reasoning"],
    rounds: 1,
  });

  return { tournament, reviewText, diffBytes: diff.length };
}
