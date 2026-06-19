/**
 * council_rollback — Undo council apply_plan (git reset + stash restore).
 */
import { resolveActiveRepoRoot } from "../shared/resolve-repo-root.js";
import { rollbackCouncilApply } from "../shared/council-rollback.js";

export const schema = {
  name: "council_rollback",
  description:
    "Rollback council apply_plan writes. Use job_id against Battle Log, or pass explicit snapshot fields.",
  inputSchema: {
    type: "object",
    properties: {
      job_id: { type: "string" },
      battle_log_url: { type: "string", description: "Default http://localhost:3737" },
      repo_root: { type: "string" },
      stashed: { type: "boolean" },
      snapshot_message: { type: "string" },
      applied_files: { type: "array", items: { type: "string" } },
    },
  },
};

export async function handler(args) {
  const battleLog = (args.battle_log_url || "http://localhost:3737").replace(/\/$/, "");

  if (args.job_id) {
    try {
      const res = await fetch(`${battleLog}/council/jobs/${args.job_id}/rollback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(120_000),
      });
      const data = await res.json();
      const text = data.ok
        ? `=== COUNCIL_ROLLBACK ✅ ===\njob: ${args.job_id}\nstash restored: ${data.stashRestored ?? false}`
        : `=== COUNCIL_ROLLBACK ❌ ===\n${data.reason || data.error || res.status}`;
      return {
        content: [{ type: "text", text }],
        isError: !data.ok,
        _meta: data,
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: `council_rollback HTTP failed: ${e.message}` }],
        isError: true,
      };
    }
  }

  const repoRoot = resolveActiveRepoRoot(args.repo_root);
  const result = await rollbackCouncilApply(repoRoot, {
    stashed: Boolean(args.stashed),
    snapshotMessage: args.snapshot_message,
    appliedFiles: args.applied_files,
  });

  const lines = [
    `=== COUNCIL_ROLLBACK ${result.ok ? "✅" : "❌"} ===`,
    `REPO_ROOT: ${repoRoot}`,
    result.ok
      ? `reset: ${result.reset}, stash restored: ${result.stashRestored}`
      : `reason: ${result.reason}`,
  ];

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    isError: !result.ok,
    _meta: result,
  };
}
