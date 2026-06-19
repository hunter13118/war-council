/**
 * coding_delivery — Automated coding arc: plan | apply | verify | ship.
 */
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { routeTask } from "../decision-router.js";
import { markSmartRoute } from "../shared/protocol-gateway.js";
import { resolveActiveRepoRoot } from "../shared/resolve-repo-root.js";
import { executeChain, CHAINS } from "../task-chains.js";
import {
  createChainToolExecutor,
  detectDefaultTestSuite,
} from "../shared/chain-tool-registry.js";
import { handler as applyPlanHandler } from "./apply-plan.js";
import { executeAppleShip } from "../shared/ship-executor.js";
import { normalizeCallerContext, recordCallerTelemetry } from "../shared/caller-context.js";
import { surveyRepo } from "../shared/greenfield.js";

export const schema = {
  name: "coding_delivery",
  description:
    "Automated coding delivery arc. Phase 'ship': plan → apply → verify (+ fix retries). " +
    "Phase 'plan': memory+RAG, cloud+local parallel planning, implementation brief. " +
    "Phase 'verify': run_tests, review_diff, capture_visual_audit (optional), Hypeman report. " +
    "Phase apply uses apply_plan; defer_to_caller returns CALLER_HANDOFF.",
  inputSchema: {
    type: "object",
    properties: {
      task: {
        type: "string",
        description: "User coding task (paste full user message or optimized summary).",
      },
      phase: {
        type: "string",
        enum: ["ship", "plan", "verify", "apple_plan", "apply"],
        description:
          "ship = closed loop (plan→apply→verify); plan | apple_plan = brief; apply = write patches; verify = after apply.",
      },
      use_apple_plan: {
        type: "boolean",
        description: "When phase=plan, use apple_plan chain instead of coding_plan. Default true.",
      },
      tdd_first: {
        type: "boolean",
        description: "Emit failing test spec before implementation brief. Default false.",
      },
      use_routed_chain: {
        type: "boolean",
        description: "If true and smart_route picks fix_bug/new_feature/refactor, run that chain instead.",
      },
      test_suite: {
        type: "string",
        description: "verify phase: jest|python|e2e|ui|all. Auto-detected if omitted.",
      },
      visual_url: { type: "string" },
      visual_output_path: { type: "string" },
      visual_question: { type: "string" },
      patches: { type: "array", items: { type: "object" } },
      from_handoff: { type: "boolean" },
      dry_run: { type: "boolean" },
      force_local: { type: "boolean" },
      max_verify_loops: { type: "number" },
      caller_client: { type: "string" },
      caller_tier: { type: "string" },
      repo_root: { type: "string" },
      skip_prelude: { type: "boolean", description: "Skip FORCE_WAR_TABLE ship prelude." },
    },
    required: ["task"],
  },
};

function formatStepSummary(steps) {
  if (!steps?.length) return "(no steps)";
  return steps
    .map((s) => {
      if (s.skipped) return `  ${s.label}: ⏭️ ${s.reason || "skipped"}`;
      if (s.error) return `  ${s.label}: ❌ ${s.error}`;
      const preview = (s.result || "").slice(0, 160).replace(/\s+/g, " ");
      return `  ${s.label}: ✅ ${preview}${preview.length >= 160 ? "…" : ""}`;
    })
    .join("\n");
}

function pickPlanChain(route, useRoutedChain, useApplePlan) {
  if (useRoutedChain && route.chain && CHAINS[route.chain]) return route.chain;
  if (useApplePlan !== false && CHAINS.apple_plan) return "apple_plan";
  return "coding_plan";
}

function formatShipFailure(shipResult) {
  const lines = [];
  if (shipResult.failedStage === "plan") {
    lines.push(shipResult.error || "Plan chain did not complete.");
    if (shipResult.planResult?.steps?.length) {
      lines.push("", "--- PLAN STEPS ---", formatStepSummary(shipResult.planResult.steps));
      if (shipResult.planResult.failedAt != null) {
        lines.push("", `Failed at step index ${shipResult.planResult.failedAt}`);
      }
    }
    return lines.join("\n");
  }
  if (shipResult.failedStage === "apply") {
    lines.push(shipResult.error || "apply_plan failed.");
    return lines.join("\n");
  }
  lines.push(shipResult.error || "Verify loop did not pass.");
  if (shipResult.planResult?.steps?.length) {
    lines.push("", "--- PLAN STEPS (context) ---", formatStepSummary(shipResult.planResult.steps));
  }
  if (shipResult.applyText) {
    lines.push("", "--- APPLY OUTPUT ---", shipResult.applyText.slice(0, 1200));
  }
  if (shipResult.handoffPath) {
    lines.push("", `Handoff: ${shipResult.handoffPath}`);
  }
  const verifySteps = shipResult.lastVerify?.steps;
  if (verifySteps?.length) {
    lines.push("", "--- VERIFY STEPS ---", formatStepSummary(verifySteps));
  }
  return lines.join("\n");
}

export async function handler(args, ctx) {
  const phase = args.phase ?? "ship";
  const task = args.task?.trim();
  const callerContext = normalizeCallerContext(args);
  if (!task) {
    return {
      content: [{ type: "text", text: "coding_delivery requires non-empty `task`." }],
      isError: true,
    };
  }

  const route = routeTask(task);
  markSmartRoute(route, task);
  const repoRoot = resolveActiveRepoRoot(args.repo_root);

  if (phase === "ship") {
    recordCallerTelemetry(callerContext, "coding_delivery.ship", { task: task.slice(0, 80) });
    const executeTool = createChainToolExecutor(ctx, { repoRoot });
    const repoSurvey = await surveyRepo(repoRoot);
    const auditDir = resolve(repoRoot, "public", "audit");
    mkdirSync(auditDir, { recursive: true });
    const inputs = {
      task,
      tdd_first: Boolean(args.tdd_first),
      repo_root: repoRoot,
      repo_survey: repoSurvey,
      greenfield: repoSurvey.isGreenfield,
      test_suite: args.test_suite ?? detectDefaultTestSuite(repoRoot),
      test_timeout_ms: 300_000,
      visual_url: args.visual_url,
      visual_output_path:
        args.visual_output_path ?? resolve(auditDir, "wc-capture.png"),
      visual_question: args.visual_question,
      visual_wait_ms: 2000,
    };
    const planChain = pickPlanChain(route, args.use_routed_chain, args.use_apple_plan);
    const shipResult = await executeAppleShip({
      task,
      inputs,
      executeTool,
      planChainName: planChain,
      verifyChainName: "coding_verify",
      maxVerifyLoops: args.max_verify_loops ?? 3,
      forceLocal: Boolean(args.force_local),
      callerContext,
      skipPrelude: Boolean(args.skip_prelude),
    });

    const lines = [
      `=== CODING_DELIVERY [SHIP] ${shipResult.success ? "✅" : "❌"} ===`,
      `REPO_ROOT: ${repoRoot}`,
      `Plan chain: ${planChain}`,
      `Ship tier: ${shipResult.shipTier}`,
      `Caller: ${callerContext.label}`,
      `Route hint: ${route.tool}${route.chain ? ` / ${route.chain}` : ""} — ${route.reason}`,
      `Repo survey: ${repoSurvey.sourceFileCount} source files, greenfield=${repoSurvey.isGreenfield}`,
      "",
    ];

    if (shipResult.deferred) {
      lines.push(
        "=== DEFERRED — CALLER HANDOFF ===",
        shipResult.callerHandoff || shipResult.applyText || "(see latest-council-handoff.md)",
      );
    } else if (shipResult.verifySuccess) {
      lines.push("=== SHIPPED ===", shipResult.hypemanReport || "Tests passed.");
    } else {
      lines.push(
        `=== SHIP HALTED (${shipResult.failedStage || "unknown"}) ===`,
        formatShipFailure(shipResult),
      );
    }

    if (shipResult.handoffPath) {
      lines.push("", `Handoff: ${shipResult.handoffPath}`);
    }
    if (shipResult.costSummary?.localVsCloud) {
      lines.push(
        "",
        `Cost: ${shipResult.costSummary.localVsCloud}`,
        `Wall ms: ${shipResult.costSummary.totalMs}`,
      );
    }
    if (shipResult.diffTournament?.tournament) {
      lines.push("", "--- APPLIED DIFF TOURNAMENT ---", shipResult.diffTournament.tournament.slice(0, 800));
    }

    return {
      content: [{ type: "text", text: lines.join("\n") }],
      _meta: {
        phase: "ship",
        success: shipResult.success,
        verifySuccess: shipResult.verifySuccess,
        deferred: shipResult.deferred,
        failedStage: shipResult.failedStage,
        shipTier: shipResult.shipTier,
        caller_client: callerContext.client,
        caller_tier: callerContext.tier,
        costSummary: shipResult.costSummary,
        route,
      },
    };
  }

  if (phase === "apply") {
    return applyPlanHandler(
      {
        task,
        patches: args.patches,
        from_handoff: args.from_handoff ?? (!args.patches?.length),
        dry_run: args.dry_run,
        force_local: args.force_local,
        repo_root: repoRoot,
      },
      ctx,
    );
  }

  const executeTool = createChainToolExecutor(ctx, { repoRoot });
  const chainName =
    phase === "verify"
      ? "coding_verify"
      : phase === "apple_plan"
        ? "apple_plan"
        : pickPlanChain(route, args.use_routed_chain, args.use_apple_plan);

  const auditDir = resolve(repoRoot, "public", "audit");
  mkdirSync(auditDir, { recursive: true });

  const inputs = {
    task,
    tdd_first: Boolean(args.tdd_first),
    repo_root: repoRoot,
    test_suite: args.test_suite ?? detectDefaultTestSuite(repoRoot),
    test_timeout_ms: 300_000,
    visual_url: args.visual_url,
    visual_output_path:
      args.visual_output_path ?? resolve(auditDir, "wc-capture.png"),
    visual_question: args.visual_question,
    visual_wait_ms: 2000,
  };

  const chainResult = await executeChain(chainName, inputs, executeTool);
  const lastText =
    chainResult.steps.filter((s) => s.result && !s.skipped).pop()?.result || "";

  const lines = [
    `=== CODING_DELIVERY [${phase.toUpperCase()}] ${chainResult.success ? "✅" : "❌"} ===`,
    `Chain: ${chainName}`,
    `REPO_ROOT: ${repoRoot}`,
    `Route hint: ${route.tool}${route.chain ? ` / ${route.chain}` : ""} — ${route.reason}`,
    "",
    formatStepSummary(chainResult.steps),
    "",
  ];

  if (phase === "plan" || phase === "apple_plan") {
    lines.push(
      "=== NEXT: APPLY ===",
      "coding_delivery({ phase: 'apply', task, from_handoff: true })",
      "",
      "--- CURSOR_RECONCILE BRIEF ---",
      lastText || "(no brief generated)",
    );
  } else {
    const testsOk = chainResult.steps.some(
      (s) => s.label?.includes("test") && (s.result || "").includes("PASSED"),
    );
    lines.push(
      "=== CURSOR CONDUCTOR — USER HANDOFF ===",
      testsOk ? "Tests passed — ship or ask for approval." : "Tests failed — fix and re-run verify.",
      "",
      "--- HYPEMAN / VERIFY REPORT ---",
      lastText || "(no report)",
    );
  }

  if (!chainResult.success) {
    lines.push("", `Failed at step ${chainResult.failedAt}`);
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    _meta: { phase, chain: chainName, success: chainResult.success, route },
  };
}
