/**
 * apply_plan — Write council patches to REPO_ROOT under ship guardrails.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { emitBattleEvent } from "../shared/battle-events.js";
import { resolveActiveRepoRoot } from "../shared/resolve-repo-root.js";
import {
  applyValidatedPatches,
  createApplySnapshot,
  defaultHandoffPath,
  generatePatchesFromHandoff,
  gitDiffSummary,
  validatePatchSet,
} from "../shared/apply-plan-core.js";

export { extractPatchesFromBrief } from "../shared/apply-plan-core.js";

export const schema = {
  name: "apply_plan",
  description:
    "Apply council plan patches to REPO_ROOT. Use from_handoff after apple_plan/coding_plan, or pass patches[]. " +
    "defer_to_caller / hybrid_ship returns CALLER_HANDOFF when scope exceeds guardrails.",
  inputSchema: {
    type: "object",
    properties: {
      task: { type: "string", description: "Original coding task." },
      patches: {
        type: "array",
        description: "Patch list: { path, op: write|delete, content? }",
        items: { type: "object" },
      },
      from_handoff: { type: "boolean", description: "Read latest-council-handoff.md." },
      handoff_path: { type: "string" },
      dry_run: { type: "boolean" },
      force_local: { type: "boolean", description: "Override defer_to_caller size limits." },
      snapshot: { type: "boolean", description: "Git stash before apply. Default true." },
      job_id: { type: "string" },
      repo_root: { type: "string" },
    },
  },
};

export async function handler(args, ctx) {
  const repoRoot = resolveActiveRepoRoot(args.repo_root);
  const task = args.task?.trim() || "";
  const dryRun = Boolean(args.dry_run);
  const forceLocal = Boolean(args.force_local);

  let patches = args.patches;
  if ((!patches || !patches.length) && args.from_handoff) {
    const handoffPath = args.handoff_path ?? defaultHandoffPath(repoRoot);
    if (!existsSync(handoffPath)) {
      return {
        content: [{ type: "text", text: `Handoff not found: ${handoffPath}. Run plan/ship first.` }],
        isError: true,
      };
    }
    const brief = await readFile(handoffPath, "utf-8");
    try {
      patches = await generatePatchesFromHandoff(brief, task);
    } catch (e) {
      return {
        content: [{ type: "text", text: `apply_plan handoff parse failed: ${e.message}` }],
        isError: true,
      };
    }
  }

  if (!patches?.length) {
    return {
      content: [{ type: "text", text: "apply_plan requires patches[] or from_handoff: true" }],
      isError: true,
    };
  }

  let validation;
  try {
    validation = validatePatchSet(patches, { task, repoRoot, forceLocal });
  } catch (e) {
    return {
      content: [{ type: "text", text: `apply_plan rejected: ${e.message}` }],
      isError: true,
    };
  }

  if (!validation.allowed) {
    return {
      content: [{ type: "text", text: validation.handoff }],
      _meta: {
        shipTier: validation.tier.tier,
        mcpMayApply: false,
        callerShouldApply: true,
      },
    };
  }

  const tier = validation.tier;
  let snapshotResult = { ok: false, skipped: true, message: "(no snapshot)" };
  if (!dryRun && args.snapshot !== false) {
    snapshotResult = await createApplySnapshot(
      repoRoot,
      task.slice(0, 24).replace(/\s+/g, "-"),
      args.job_id,
    );
  }

  const applyResult = await applyValidatedPatches(validation.validated, { dryRun, repoRoot });
  const diffStat = dryRun ? "(dry run — no git diff)" : await gitDiffSummary(repoRoot);

  emitBattleEvent({
    type: "tool_complete",
    tool: "apply_plan",
    dryRun,
    files: applyResult.applied.map((a) => a.path),
    shipTier: tier.tier,
  });

  const lines = [
    `=== APPLY_PLAN ${dryRun ? "[DRY RUN]" : "✅"} ===`,
    `REPO_ROOT: ${repoRoot}`,
    `ship_tier: ${tier.tier} — ${tier.reason}`,
    `files: ${validation.validated.length} (${validation.totalBytes} bytes)`,
    `snapshot: ${snapshotResult.stashed ? `git stash push -m "${snapshotResult.message}"` : snapshotResult.message || "skipped"}`,
    "",
    "## Applied",
    ...applyResult.applied.map((a) => `- ${a.op} ${a.path}`),
    "",
    diffStat,
  ];

  if (tier.tier === "hybrid_ship") {
    lines.push("", "=== CALLER_HANDOFF (hybrid overflow) ===", "Caller may need to finish remaining files from handoff.");
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    _meta: {
      shipTier: tier.tier,
      mcpMayApply: tier.mcpMayApply,
      callerShouldApply: tier.callerShouldApply,
      dryRun,
      applied: applyResult.applied,
    },
  };
}
