/**
 * Apple Plan — high-context implementation planning for War Council → Cursor handoff.
 */
import { cloudGenerateWithFailover } from "./cloud.js";

export const APPLE_PLAN_SYSTEM = `You are a senior staff engineer producing an "Apple Plan" — a dense, verifiable implementation plan.

Rules:
- 5–9 atomic steps; each step names exact file paths and expected outcome
- Separate MUST / SHOULD / WON'T sections
- Include test strategy (unit, integration, E2E, visual) with concrete commands when known
- Flag risks, rollback, and dependencies between steps
- Do NOT paste full file contents — describe edits (function names, behavior deltas)
- End with ## ACCEPTANCE CRITERIA (bullet checklist a reviewer can tick)

Output format:
## GOAL
## SCOPE (in / out)
## STEPS (numbered)
## FILES TO TOUCH (table: path | change | why)
## TEST PLAN
## RISKS
## ACCEPTANCE CRITERIA`;

export const CURSOR_BRIEF_SYSTEM = `Produce a CURSOR_RECONCILE brief — minimal tokens for the Cursor conductor.

The user will see a short Hypeman summary; Cursor must apply patches from this brief, then call review_diff (fast) to reconcile git state.

Required sections (exact headers):
## TASK_ID
(one line slug)

## HYPEMAN_ONE_LINER
(1 sentence for the user — no code)

## FILES
(bullets: path — intent in ≤12 words)

## EDITS_ORDERED
(numbered minimal steps; no full code blocks unless ≤15 lines for a test stub)

## TESTS
(commands to run)

## DO_NOT
(guardrails)

## CURSOR_NEXT
(exactly: coding_delivery phase=apply,from_handoff:true then phase=verify)

For greenfield or when council apply is expected, REQUIRED appendix (valid JSON only — no "..." placeholders):
\`\`\`json
{ "patches": [ { "path": "relative/file", "op": "write", "content": "full file body" } ] }
\`\`\`
If patches would exceed 8 files, omit JSON and set ## CURSOR_NEXT to defer_to_caller.`;

/**
 * @param {object} ctx - chain context with task, results[]
 */
export function buildApplePlanPrompt(ctx) {
  const rag = ctx.results?.[0]?.text || "";
  return [
    APPLE_PLAN_SYSTEM,
    "",
    `REPO_ROOT: ${ctx.repo_root || "(active workspace)"}`,
    `TASK:\n${ctx.task}`,
    rag ? `\nCODEBASE CONTEXT (RAG):\n${rag}` : "",
  ].join("\n");
}

/**
 * @param {object} ctx
 */
export function buildCursorBriefPrompt(ctx) {
  const r = ctx.results || [];
  const pick = (i) => r[i]?.text || "";
  const applePlan = pick(1) || pick(0);
  const cloudRefine = pick(2) || "(skipped)";
  const planTournament = pick(3) || "(skipped)";
  const tddSpec = pick(4) || "(none)";
  const completeness = pick(5) || pick(6) || "(pending)";
  return [
    CURSOR_BRIEF_SYSTEM,
    "",
    `TASK:\n${ctx.task}`,
    `\nAPPLE PLAN:\n${applePlan}`,
    `\nCLOUD REFINE:\n${cloudRefine}`,
    `\nPLAN TOURNAMENT:\n${planTournament}`,
    `\nTDD SPEC:\n${tddSpec}`,
    `\nCOMPLETENESS TOURNAMENT:\n${completeness}`,
    `REPO_ROOT: ${ctx.repo_root || "(active workspace)"}`,
  ].join("\n");
}

/**
 * @param {string} task
 * @param {string} codeContext
 */
export async function runAppleStrategicPlan(task, codeContext, options = {}) {
  const fullPrompt = `${APPLE_PLAN_SYSTEM}\n\n## TASK\n${task}\n\n## CODE CONTEXT\n${codeContext || "(none)"}`;
  const r = await cloudGenerateWithFailover(fullPrompt, {
    primary: options.provider ?? "gemini",
    maxTokens: options.maxTokens ?? 8192,
    temperature: 0.2,
  });
  return {
    text: r.text,
    provider: r.provider,
    model: r.model,
    failedOver: r.failedOver,
  };
}
