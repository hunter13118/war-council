/**
 * Closed-loop ship: plan → apply → verify (+ fix retries).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { executeChain } from "../task-chains.js";
import { classifyShipTier, formatCallerHandoff } from "./ship-tier.js";
import { normalizeCallerContext, recordCallerTelemetry } from "./caller-context.js";
import { extractPatchesFromBrief } from "./apply-plan-core.js";
import { parseApplyMetaFromText } from "./council-rollback.js";
import { runAppliedDiffTournament } from "./applied-diff-tournament.js";
import { ShipCostTracker, recordShipCostSummary } from "./ship-cost-telemetry.js";
import { resolveActiveRepoRoot } from "./resolve-repo-root.js";
import { runShipPrelude } from "./ship-prelude.js";
import { parseBriefFiles } from "./greenfield.js";

function extractPlanBrief(planResult) {
  const brief = planResult.steps?.find((s) => /reconcile brief|implementation brief/i.test(s.label || ""))?.result;
  if (brief) return brief;
  const last = planResult.steps?.filter((s) => s.result && !s.skipped).pop();
  return last?.result || "";
}

function testsPassed(verifyResult) {
  const t = verifyResult.steps?.find((s) => /test/i.test(s.label || ""))?.result || "";
  return t.includes("PASSED");
}

function testOutput(verifyResult) {
  const step = verifyResult?.steps?.find((s) => /test/i.test(s.label || ""));
  if (!step) return "";
  if (step.error) return step.error;
  return step.result || "";
}

function planFailureMessage(planResult) {
  const failed = planResult?.steps?.find((s) => s.error);
  if (failed) return `${failed.label}: ${failed.error}`;
  if (planResult?.failedAt != null) {
    const step = planResult.steps?.[planResult.failedAt];
    if (step?.error) return `${step.label}: ${step.error}`;
  }
  return "Plan chain did not complete.";
}

async function persistHandoff(repoRoot, task, brief, chainName) {
  if (!repoRoot || !brief) return null;
  try {
    const ctxDir = resolve(repoRoot, ".cline-context");
    await mkdir(ctxDir, { recursive: true });
    const latestPath = resolve(ctxDir, "latest-council-handoff.md");
    const body = [
      `# Council handoff — ship`,
      "",
      `- Chain: \`${chainName}\``,
      `- Task: ${task.slice(0, 500)}`,
      `- Written: ${new Date().toISOString()}`,
      "",
      "## CURSOR_RECONCILE",
      "",
      brief,
    ].join("\n");
    await writeFile(latestPath, body, "utf-8");
    return latestPath;
  } catch {
    return null;
  }
}

function parseFixPatches(text) {
  const fromJson = extractPatchesFromBrief(text);
  if (fromJson?.length) return fromJson;
  return null;
}

/**
 * @param {object} opts
 */
export async function executeAppleShip({
  task,
  inputs,
  executeTool,
  planChainName = "apple_plan",
  verifyChainName = "coding_verify",
  maxVerifyLoops = 3,
  forceLocal = false,
  jobId,
  callerContext: callerContextIn,
  skipPrelude = false,
  onStage,
}) {
  const stages = [];
  const callerContext = callerContextIn || normalizeCallerContext({});
  const repoRoot = resolveActiveRepoRoot(inputs.repo_root);
  const shipInputs = { ...inputs, repo_root: repoRoot };
  const costTracker = new ShipCostTracker();
  const trackedExecute = async (tool, args) => {
    const t0 = Date.now();
    const text = await executeTool(tool, args);
    costTracker.record(tool, text, Date.now() - t0);
    return text;
  };

  const tierPreview = classifyShipTier(task, {
    force_local: forceLocal,
    estimated_files: shipInputs.repo_survey?.sourceFileCount,
  });
  recordCallerTelemetry(callerContext, "apple_ship.start", { jobId, shipTier: tierPreview.tier });

  if (!skipPrelude) {
    onStage?.({ stage: "prelude" });
    const prelude = await runShipPrelude(task, trackedExecute);
    stages.push({ name: "prelude", result: prelude });
  }

  onStage?.({ stage: "planning", shipTier: tierPreview.tier });
  let planResult;
  try {
    planResult = await executeChain(planChainName, shipInputs, trackedExecute);
  } catch (err) {
    return {
      success: false,
      failedStage: "plan",
      error: err.message,
      stages,
      shipTier: tierPreview.tier,
      planResult: { success: false, steps: [{ label: "plan chain", error: err.message }] },
    };
  }
  stages.push({ name: "plan", result: planResult });
  if (!planResult.success) {
    return {
      success: false,
      failedStage: "plan",
      error: planFailureMessage(planResult),
      stages,
      shipTier: tierPreview.tier,
      planResult,
    };
  }

  const brief = extractPlanBrief(planResult);
  const handoffPath = await persistHandoff(repoRoot, task, brief, planChainName);
  const briefCheck = parseBriefFiles(brief);
  if (!briefCheck.ok && shipInputs.repo_survey?.isGreenfield) {
    return {
      success: false,
      failedStage: "plan",
      error: `Greenfield brief incomplete: ${briefCheck.reason}`,
      stages,
      handoffPath,
      planResult,
      shipTier: tierPreview.tier,
    };
  }

  if (shipInputs.tdd_first) {
    onStage?.({ stage: "tdd_baseline" });
    try {
      const baselineText = await trackedExecute("run_tests", {
        suite: shipInputs.test_suite || "all",
        timeout_ms: shipInputs.test_timeout_ms ?? 300_000,
      });
      stages.push({ name: "tdd_baseline", baselineText });
    } catch (err) {
      stages.push({ name: "tdd_baseline", note: err.message });
    }
  }

  if (tierPreview.tier === "defer_to_caller" && !forceLocal) {
    const fileList = briefCheck.ok && briefCheck.files?.length
      ? briefCheck.files
      : ["Apply full CURSOR_RECONCILE brief from handoff"];
    const handoff = formatCallerHandoff({
      tier: tierPreview.tier,
      reason: tierPreview.reason,
      task,
      planSummary: brief.slice(0, 2000),
      patchesForCaller: fileList,
      handoffPath,
      callerContext,
    });
    onStage?.({ stage: "deferred", shipTier: tierPreview.tier });
    return {
      success: true,
      deferred: true,
      shipTier: tierPreview.tier,
      callerHandoff: handoff,
      handoffPath,
      stages,
      planResult,
    };
  }

  onStage?.({ stage: "applying", shipTier: tierPreview.tier });
  let applyText = "";
  try {
    applyText = await trackedExecute("apply_plan", {
      task,
      from_handoff: true,
      force_local: forceLocal,
      repo_root: repoRoot,
      snapshot: true,
      job_id: jobId,
    });
  } catch (err) {
    return {
      success: false,
      failedStage: "apply",
      error: err.message,
      stages,
      handoffPath,
      planResult,
    };
  }

  if (applyText.includes("CALLER_HANDOFF")) {
    const isDefer =
      /defer_to_caller|hybrid_ship/i.test(applyText) || applyText.includes("defer");
    onStage?.({ stage: "deferred", shipTier: isDefer ? "defer_to_caller" : "hybrid_ship" });
    return {
      success: true,
      deferred: true,
      shipTier: isDefer ? "defer_to_caller" : "hybrid_ship",
      callerHandoff: applyText,
      handoffPath,
      stages,
      applyText,
      planResult,
    };
  }

  onStage?.({ stage: "diff_tournament" });
  let diffTournament = null;
  try {
    diffTournament = await runAppliedDiffTournament({
      executeTool: trackedExecute,
      task,
      repoRoot,
      applySummary: applyText,
    });
    stages.push({ name: "applied_diff_tournament", result: diffTournament });
  } catch (err) {
    stages.push({ name: "applied_diff_tournament", error: err.message });
  }

  let verifySuccess = false;
  let lastVerify = null;

  for (let loop = 0; loop < maxVerifyLoops; loop++) {
    onStage?.({ stage: "verifying", loop: loop + 1, maxLoops: maxVerifyLoops });
    const verifyResult = await executeChain(verifyChainName, shipInputs, trackedExecute);
    lastVerify = verifyResult;
    stages.push({ name: `verify_${loop + 1}`, result: verifyResult });

    if (verifyResult.success && testsPassed(verifyResult)) {
      verifySuccess = true;
      break;
    }

    if (loop < maxVerifyLoops - 1) {
      onStage?.({ stage: "fixing", loop: loop + 1 });
      const fixPrompt = [
        "Tests failed. Output JSON ONLY:",
        '{ "patches": [ { "path": "rel/path", "op": "write", "content": "full file" } ] }',
        "Minimal fix only. Max 3 files.",
        `TASK: ${task}`,
        `TEST OUTPUT:\n${testOutput(verifyResult)}`,
      ].join("\n");
      const fixText = await trackedExecute("consult_fast", { prompt: fixPrompt, maxTokens: 2048 });
      const patches = parseFixPatches(fixText);
      if (patches?.length) {
        try {
          await trackedExecute("apply_plan", {
            task,
            patches,
            force_local: true,
            repo_root: repoRoot,
            snapshot: false,
          });
        } catch {
          break;
        }
      } else {
        break;
      }
    }
  }

  const hypeman = lastVerify?.steps?.filter((s) => /hypeman/i.test(s.label || "") && s.result).pop()?.result;
  const applyMeta = parseApplyMetaFromText(applyText);
  const costSummary = recordShipCostSummary({
    summary: costTracker.summary(),
    callerContext,
    shipTier: tierPreview.tier,
    verifySuccess,
    deferred: false,
    jobId,
  });

  return {
    success: verifySuccess,
    verifySuccess,
    deferred: false,
    shipTier: tierPreview.tier,
    handoffPath,
    applyMeta,
    applyText,
    diffTournament,
    costSummary,
    stages,
    planResult,
    lastVerify,
    hypemanReport: hypeman,
    failedStage: verifySuccess ? null : "verify",
    error: verifySuccess
      ? null
      : testOutput(lastVerify) ||
        (applyText?.includes("invalid JSON") || applyText?.includes("Patch ")
          ? `Apply may have failed before verify: ${applyText.slice(0, 400)}`
          : "Verify loop did not pass."),
    repoRoot,
  };
}
