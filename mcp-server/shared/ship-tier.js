/**
 * Hybrid ship tier — who applies patches (MCP vs caller).
 */
import { tailorCallerGuidance } from "./caller-context.js";

/** @typedef {'council_ship' | 'hybrid_ship' | 'defer_to_caller'} ShipTier */

const DEFER_KEYWORDS = [
  "entire codebase",
  "full rewrite",
  "greenfield",
  "from scratch",
  "security audit",
  "compliance",
  "production outage",
  "critical incident",
  "novel algorithm",
];

const HYBRID_KEYWORDS = [
  "deep refactor",
  "large refactor",
  "complex implementation",
  "whole module",
  "multi-file",
  "multi file",
  "across repos",
  "migration",
];

function matches(text, keywords) {
  return keywords.some((kw) => text.includes(kw));
}

// Env-tunable thresholds (see .env.example).
const num = (name, dflt) => {
  const v = parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : dflt;
};
const DEFER_TASK_CHARS = num("WC_DEFER_TASK_CHARS", 2400);
const HYBRID_TASK_CHARS = num("WC_HYBRID_TASK_CHARS", 1200);
const MAX_COUNCIL_FILES = num("WC_MAX_COUNCIL_FILES", 8);
const MAX_COUNCIL_LOC = num("WC_MAX_COUNCIL_LOC", 400);

/**
 * Structural complexity signals that keyword matching misses:
 * a long, multi-requirement task with no magic keyword is still
 * too big for a 7b/14b council to own end-to-end.
 * @param {string} lower lowercased task text
 */
function structuralComplexity(lower) {
  const enumerated = (lower.match(/(^|\n)\s*(?:[-*]|\d+[.)])\s+/g) || []).length;
  const conjunctions = (lower.match(/\b(?:and then|after that|also|additionally|as well as|plus)\b/g) || []).length;
  return { chars: lower.length, requirements: enumerated + conjunctions };
}

/**
 * @param {string} task
 * @param {{ force_local?: boolean, cross_repo?: boolean, estimated_files?: number, estimated_loc?: number }} [opts]
 */
export function classifyShipTier(task, opts = {}) {
  const lower = (task || "").toLowerCase();

  if (opts.force_local) {
    const sparse = (opts.estimated_files ?? 99) < 6;
    return {
      tier: sparse ? "hybrid_ship" : "council_ship",
      reason: sparse
        ? "Greenfield + force_local — council bounded apply; caller must reconcile scaffold"
        : "Caller requested force_local — council tries best-effort apply+verify",
      mcpMayApply: true,
      callerShouldApply: sparse,
    };
  }

  if ((opts.estimated_files ?? 99) < 6) {
    return {
      tier: "defer_to_caller",
      reason: "Greenfield repo (<6 source files) — caller scaffolds; council plans and verifies",
      mcpMayApply: false,
      callerShouldApply: true,
    };
  }

  const sc = structuralComplexity(lower);

  if (matches(lower, DEFER_KEYWORDS) || opts.cross_repo) {
    return {
      tier: "defer_to_caller",
      reason: opts.cross_repo
        ? "Cross-repo scope — caller conductor applies with premium/local strength"
        : "Scope exceeds council apply guardrails — defer to caller",
      mcpMayApply: false,
      callerShouldApply: true,
    };
  }

  // Structural defer: very long / many-requirement tasks without keywords.
  if (sc.chars > DEFER_TASK_CHARS || sc.requirements >= 10) {
    return {
      tier: "defer_to_caller",
      reason: `Structural complexity (${sc.chars} chars, ~${sc.requirements} requirements) exceeds council guardrails — defer to caller`,
      mcpMayApply: false,
      callerShouldApply: true,
    };
  }

  const fileHeavy =
    (opts.estimated_files ?? 0) > MAX_COUNCIL_FILES ||
    (opts.estimated_loc ?? 0) > MAX_COUNCIL_LOC ||
    matches(lower, HYBRID_KEYWORDS) ||
    sc.chars > HYBRID_TASK_CHARS ||
    sc.requirements >= 5;

  if (fileHeavy) {
    return {
      tier: "hybrid_ship",
      reason: "Multi-file / large change — MCP applies bounded core; caller may finish overflow",
      mcpMayApply: true,
      callerShouldApply: true,
    };
  }

  return {
    tier: "council_ship",
    reason: "Standard coding task — MCP owns plan, apply, verify loop",
    mcpMayApply: true,
    callerShouldApply: false,
  };
}

/**
 * @param {object} opts
 */
export function formatCallerHandoff({
  tier,
  reason,
  task,
  planSummary,
  patchesForCaller = [],
  handoffPath = null,
  callerContext = null,
}) {
  const lines = [
    "=== CALLER_HANDOFF ===",
    `ship_tier: ${tier}`,
    `reason: ${reason}`,
    "",
    "## Task",
    task?.slice(0, 800) || "(none)",
    "",
    "## Plan summary",
    planSummary || "(see latest-council-handoff.md)",
    "",
    ...(handoffPath ? [`handoff_file: ${handoffPath}`, ""] : []),
    "## Files / next steps for caller",
    ...(patchesForCaller.length
      ? patchesForCaller.map((p) => `- ${p}`)
      : ["- Apply CURSOR_RECONCILE brief from handoff"]),
    "",
    "## CURSOR_NEXT",
    "1. Read handoff_file (or latest-council-handoff.md)",
    "2. Apply patches / scaffold per ## FILES",
    "3. coding_delivery({ phase: 'verify', from_handoff: true, test_suite: 'e2e' })",
  ];

  if (callerContext) {
    lines.push(tailorCallerGuidance(callerContext, { shipTier: tier }));
  }

  lines.push("", "--- END CALLER_HANDOFF ---");
  return lines.filter(Boolean).join("\n");
}
