/**
 * Rollback council apply_plan — git reset + optional stash restore.
 */
import { runCommand } from "./commands.js";

/**
 * @param {string} text
 */
export function parseApplyMetaFromText(text) {
  const stashed = /stashed:\s*true/i.test(text) || /git stash push/i.test(text);
  const clean = /clean tree/i.test(text);
  const snap = text.match(/snapshot:\s*(?:git stash push -m\s*)?["']?([^"'\n]+)["']?/i);
  const files = [...text.matchAll(/^-\s*(?:write|delete)\s+(\S+)/gm)].map((m) => m[1]);
  return {
    stashed: stashed && !clean,
    snapshotMessage: snap?.[1]?.trim() || (clean ? "(clean tree)" : null),
    appliedFiles: files,
  };
}

/**
 * @param {string} repoRoot
 * @param {{ stashed?: boolean, snapshotMessage?: string }} meta
 */
export async function rollbackCouncilApply(repoRoot, meta) {
  if (!meta?.stashed && !meta?.snapshotMessage) {
    return { ok: false, reason: "no apply snapshot metadata" };
  }

  const reset = await runCommand("git", ["reset", "--hard", "HEAD"], repoRoot, 30_000);
  if (reset.exitCode !== 0) {
    return { ok: false, reason: reset.stderr || "git reset failed" };
  }

  const clean = await runCommand("git", ["clean", "-fd"], repoRoot, 30_000);
  let stashRestored = false;
  if (meta.stashed) {
    const pop = await runCommand("git", ["stash", "pop"], repoRoot, 30_000);
    stashRestored = pop.exitCode === 0;
  }

  return {
    ok: true,
    reset: "HEAD",
    cleaned: clean.exitCode === 0,
    stashRestored,
  };
}
