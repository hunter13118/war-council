/**
 * Task Chain Engine — pre-baked multi-step workflows.
 *
 * Instead of the 32b conductor figuring out tool sequences on its own,
 * chains define the steps upfront. The conductor just says "run_chain('fix_bug', {...})"
 * and the engine executes the full pipeline, returning aggregated results.
 *
 * Each chain step can reference outputs from previous steps via {{step_N}}.
 */
import { buildCursorBriefPrompt } from "./shared/apple-plan-prompts.js";

/**
 * @typedef {Object} ChainStep
 * @property {string} tool - MCP tool name to call
 * @property {Object|Function} args - Static args or function(context) => args
 * @property {string} [label] - Human-readable step name
 * @property {boolean} [optional] - If true, failure doesn't abort the chain
 * @property {Function} [condition] - function(context) => boolean. Skip if false.
 */

/**
 * @typedef {Object} ChainDef
 * @property {string} name - Chain identifier
 * @property {string} description - What this chain does
 * @property {string[]} requiredInputs - Keys the caller must provide
 * @property {ChainStep[]} steps
 */

function isComplexTask(ctx) {
  const t = (ctx.task || "").toLowerCase();
  return t.length > 120 || /architect|migration|refactor|multi-file|security/.test(t);
}

/** @type {Record<string, ChainDef>} */
export const CHAINS = {
  coding_plan: {
    name: "coding_plan",
    description: "Plan: RAG → cloud+local parallel → merge → brief",
    requiredInputs: ["task"],
    contextBudget: 5000,
    steps: [
      {
        label: "1. RAG — codebase context",
        tool: "memory_query",
        args: (ctx) => ({ query: ctx.task, k: 10 }),
      },
      {
        label: "2. Cloud + local planning (parallel)",
        parallel: [
          {
            tool: "consult_cloud",
            args: (ctx) => ({
              provider: "gemini",
              prompt: `Implementation plan for:\n${ctx.task}\n\nContext:\n${ctx.results[0]?.text || "(none)"}`,
              maxTokens: 4096,
            }),
          },
          {
            tool: "consult_specialist",
            args: (ctx) => ({
              prompt: `Local plan (patterns + files) for:\n${ctx.task}\n\nRAG:\n${ctx.results[0]?.text || "(none)"}`,
              maxTokens: 4096,
            }),
          },
        ],
      },
      {
        label: "3. Merge cloud + local",
        tool: "consult_fast",
        args: (ctx) => ({
          prompt: `Merge into one implementation plan:\n${ctx.results[1]?.text || ""}\n\nTASK: ${ctx.task}`,
          maxTokens: 2048,
        }),
      },
      {
        label: "4. Tournament (complex tasks)",
        tool: "tournament_vote",
        args: (ctx) => ({
          prompt: `Stress-test this plan. List risks and missing steps:\n${ctx.results[2]?.text || ""}`,
          voters: ["specialist", "reasoning"],
          rounds: 1,
        }),
        condition: isComplexTask,
        optional: true,
      },
      {
        label: "5. TDD — failing test spec",
        tool: "consult_specialist",
        args: (ctx) => ({
          prompt: `Write a FAILING test spec (file paths + test code stub) before implementation.\nTASK: ${ctx.task}\nPlan: ${ctx.results[2]?.text || ""}`,
          maxTokens: 2048,
        }),
        condition: (ctx) => Boolean(ctx.tdd_first),
        optional: true,
      },
      {
        label: "6. Implementation brief for Cursor",
        tool: "consult_specialist",
        args: (ctx) => ({
          prompt: [
            "Produce CURSOR_RECONCILE brief with FILES, EDITS_ORDERED, TESTS, and optional JSON patches block.",
            `TASK: ${ctx.task}`,
            `PLAN:\n${ctx.results[2]?.text || ""}`,
            ctx.results[4]?.text ? `TDD:\n${ctx.results[4].text}` : "",
          ].join("\n"),
          maxTokens: 4096,
        }),
      },
    ],
  },

  apple_plan: {
    name: "apple_plan",
    description: "Apple Plan: RAG → Gemini plan → tournaments → CURSOR_RECONCILE brief",
    requiredInputs: ["task"],
    contextBudget: 8000,
    steps: [
      {
        label: "1. RAG — codebase context",
        tool: "memory_query",
        args: (ctx) => ({ query: ctx.task, k: 12, minRelevance: 0.28 }),
      },
      {
        label: "2. Apple Plan (cloud high context)",
        tool: "apple_strategic_plan",
        args: (ctx) => ({
          task: ctx.task,
          code_context: ctx.results[0]?.text || "",
          maxTokens: 8192,
        }),
      },
      {
        label: "3. Cloud refine gaps",
        tool: "consult_cloud",
        args: (ctx) => ({
          provider: "gemini",
          prompt: `Refine gaps/risks in this plan:\n${ctx.results[1]?.text || ""}\n\nTASK: ${ctx.task}`,
          maxTokens: 2048,
        }),
        optional: true,
      },
      {
        label: "4. Tournament — stress-test plan",
        tool: "tournament_vote",
        args: (ctx) => ({
          prompt: `Stress-test plan. MUST-FIX gaps?\n${ctx.results[1]?.text || ""}`,
          voters: ["specialist", "reasoning"],
          rounds: 1,
        }),
        optional: true,
      },
      {
        label: "5. TDD — failing test spec",
        tool: "consult_specialist",
        args: (ctx) => ({
          prompt: `Emit failing test spec before implementation.\nTASK: ${ctx.task}\nPlan: ${ctx.results[1]?.text || ""}`,
          maxTokens: 2048,
        }),
        condition: (ctx) => Boolean(ctx.tdd_first),
        optional: true,
      },
      {
        label: "6. Cursor reconcile brief",
        tool: "consult_fast",
        args: (ctx) => ({
          prompt: buildCursorBriefPrompt(ctx),
          maxTokens: 4096,
        }),
      },
      {
        label: "7. Tournament — brief completeness",
        tool: "tournament_vote",
        args: (ctx) => ({
          prompt: `Is this brief complete enough for Cursor to apply?\n${ctx.results[5]?.text || ctx.results[6]?.text || ""}`,
          voters: ["fast", "reasoning"],
          rounds: 1,
        }),
        optional: true,
      },
    ],
  },

  coding_verify: {
    name: "coding_verify",
    description: "Verify: tests → diff review → optional visual → Hypeman",
    requiredInputs: ["task"],
    contextBudget: 4000,
    steps: [
      {
        label: "1. Run test suite",
        tool: "run_tests",
        args: (ctx) => ({
          suite: ctx.test_suite || "all",
          timeout_ms: ctx.test_timeout_ms ?? 300_000,
        }),
      },
      {
        label: "2. Review git diff (fast reconcile)",
        tool: "review_diff",
        args: (ctx) => ({ tier: "fast", repo_root: ctx.repo_root }),
      },
      {
        label: "2b. Applied diff tournament",
        tool: "tournament_vote",
        args: (ctx) => ({
          prompt: [
            "Judge APPLIED diff completeness for task.",
            `TASK: ${ctx.task}`,
            `DIFF REVIEW:\n${ctx.results[1]?.text || ""}`,
          ].join("\n"),
          voters: ["specialist", "reasoning"],
          rounds: 1,
        }),
        optional: true,
      },
      {
        label: "3. Test failure analysis",
        tool: "rapid_fan_out",
        args: (ctx) => ({
          prompts: [
            `Root cause of test failure:\n${ctx.results[0]?.text || ""}`,
            `Minimal fix suggestion:\n${ctx.results[0]?.text || ""}`,
          ],
          maxTokens: 1024,
        }),
        condition: (ctx) => !(ctx.results[0]?.text || "").includes("PASSED"),
        optional: true,
      },
      {
        label: "4. Visual audit",
        tool: "capture_visual_audit",
        args: (ctx) => ({
          url: ctx.visual_url,
          output_path: ctx.visual_output_path,
          question: ctx.visual_question,
          wait_ms: ctx.visual_wait_ms ?? 2000,
        }),
        condition: (ctx) => Boolean(ctx.visual_url),
        optional: true,
      },
      {
        label: "5. Hypeman user report",
        tool: "invoke_agent",
        args: (ctx) => ({
          agent_name: "Hypeman",
          prompt: [
            "Summarize verify results for the user in 3-5 sentences. Mention test pass/fail.",
            `TASK: ${ctx.task}`,
            `TESTS:\n${ctx.results[0]?.text || ""}`,
            `DIFF:\n${ctx.results[1]?.text || ""}`,
          ].join("\n"),
          maxTokens: 512,
        }),
      },
      {
        label: "6. Log to Battle Log",
        tool: "report_action",
        args: (ctx) => ({
          action: `coding_delivery verify: ${ctx.task.slice(0, 120)}`,
          outcome: (ctx.results[0]?.text || "").includes("PASSED") ? "success" : "partial",
        }),
      },
    ],
  },

  fix_bug: {
    name: "fix_bug",
    description:
      "Full TDD bug-fix pipeline: understand → test → fix → verify",
    requiredInputs: ["bug_description"],
    steps: [
      {
        label: "1. Search memory for context",
        tool: "memory_query",
        args: (ctx) => ({ query: ctx.bug_description, k: 8 }),
      },
      {
        label: "2. Plan the fix (strategic, if complex)",
        tool: "strategic_plan",
        args: (ctx) => ({
          task: `Fix this bug: ${ctx.bug_description}\n\nRelevant context from memory:\n${ctx.results[0]?.text || "(none)"}`,
          code_context: ctx.results[0]?.text || "",
        }),
        condition: (ctx) => (ctx.bug_description?.length || 0) > 200, // only for complex bugs
        optional: true,
      },
      {
        label: "3. Generate test (TDD: test FIRST)",
        tool: "consult_specialist",
        args: (ctx) => ({
          prompt: `Write a failing test for this bug. Use the project's test framework (Jest for React, pytest for Python, Playwright for E2E).

Bug: ${ctx.bug_description}

Context from codebase:
${ctx.results[0]?.text || "(none)"}

${ctx.results[1]?.text ? `\nPlan:\n${ctx.results[1].text}` : ""}

Output ONLY the test code, no explanation.`,
          maxTokens: 2048,
        }),
      },
      {
        label: "4. Generate fix implementation",
        tool: "consult_specialist",
        args: (ctx) => ({
          prompt: `Implement the minimal fix for this bug. The test has already been written.

Bug: ${ctx.bug_description}
Test code: ${ctx.results[2]?.text || "(see previous step)"}
Codebase context: ${ctx.results[0]?.text || ""}

Output ONLY the implementation code (the minimal change needed). No explanation.`,
          maxTokens: 2048,
        }),
      },
      {
        label: "5. Self-review the fix",
        tool: "consult_reasoning",
        args: (ctx) => ({
          prompt: `Review this bug fix for correctness, edge cases, and regressions.

Bug: ${ctx.bug_description}
Fix code: ${ctx.results[3]?.text || "(see previous step)"}
Test: ${ctx.results[2]?.text || ""}

Is this fix correct? Any edge cases missed? Any regressions likely? Be brief and specific.`,
          maxTokens: 1024,
        }),
      },
    ],
  },

  new_feature: {
    name: "new_feature",
    description:
      "Feature implementation pipeline: plan → scaffold → implement → test → review",
    requiredInputs: ["feature_description"],
    steps: [
      {
        label: "1. Search existing patterns",
        tool: "memory_query",
        args: (ctx) => ({ query: ctx.feature_description, k: 10 }),
      },
      {
        label: "2. Strategic plan (Gemini 1M)",
        tool: "strategic_plan",
        args: (ctx) => ({
          task: ctx.feature_description,
          code_context: ctx.results[0]?.text || "",
        }),
      },
      {
        label: "3. Generate implementation",
        tool: "consult_specialist",
        args: (ctx) => ({
          prompt: `Implement this feature following the plan below.

Feature: ${ctx.feature_description}
Plan: ${ctx.results[1]?.text || ""}
Existing patterns: ${ctx.results[0]?.text || ""}

Write the implementation code. Follow existing patterns in the codebase.`,
          maxTokens: 4096,
        }),
      },
      {
        label: "4. Generate tests",
        tool: "consult_specialist",
        args: (ctx) => ({
          prompt: `Write tests for this new feature implementation.

Feature: ${ctx.feature_description}
Implementation: ${ctx.results[2]?.text || ""}
Existing patterns: ${ctx.results[0]?.text || ""}

Write comprehensive tests. Use the same framework/style as existing tests.`,
          maxTokens: 2048,
        }),
      },
      {
        label: "5. Batch review (parallel)",
        tool: "rapid_fan_out",
        args: (ctx) => ({
          prompts: [
            `Review for correctness: ${ctx.results[2]?.text || ""}`,
            `Review for security issues: ${ctx.results[2]?.text || ""}`,
            `Review test coverage: ${ctx.results[3]?.text || ""}`,
          ],
          maxTokens: 1024,
        }),
      },
    ],
  },

  refactor: {
    name: "refactor",
    description:
      "Safe refactor pipeline: understand → plan → implement → verify no regressions",
    requiredInputs: ["refactor_goal", "target_files"],
    steps: [
      {
        label: "1. Understand current code",
        tool: "memory_query",
        args: (ctx) => ({ query: `${ctx.refactor_goal} ${ctx.target_files}`, k: 10 }),
      },
      {
        label: "2. Plan refactor steps",
        tool: "strategic_plan",
        args: (ctx) => ({
          task: `Refactor: ${ctx.refactor_goal}\nTarget files: ${ctx.target_files}`,
          code_context: ctx.results[0]?.text || "",
        }),
      },
      {
        label: "3. Run tests BEFORE (baseline)",
        tool: "run_tests",
        args: () => ({ suite: "all", timeout_ms: 300000 }),
      },
      {
        label: "4. Generate refactored code",
        tool: "consult_specialist",
        args: (ctx) => ({
          prompt: `Refactor this code according to the plan.

Goal: ${ctx.refactor_goal}
Plan: ${ctx.results[1]?.text || ""}
Current code: ${ctx.results[0]?.text || ""}

Output the refactored code. Preserve all existing behavior.`,
          maxTokens: 4096,
        }),
      },
      {
        label: "5. Review for behavioral changes",
        tool: "consult_reasoning",
        args: (ctx) => ({
          prompt: `Compare original vs refactored code. Does the refactor preserve ALL existing behavior? Flag any behavioral changes.

Original: ${ctx.results[0]?.text || ""}
Refactored: ${ctx.results[3]?.text || ""}`,
          maxTokens: 1024,
        }),
      },
    ],
  },

  investigate: {
    name: "investigate",
    description:
      "Deep investigation: multi-angle analysis of an issue or question",
    requiredInputs: ["question"],
    steps: [
      {
        label: "1. Memory search",
        tool: "memory_query",
        args: (ctx) => ({ query: ctx.question, k: 10 }),
      },
      {
        label: "2. Check past conversations",
        tool: "memory_recall_conversation",
        args: (ctx) => ({ query: ctx.question, k: 5 }),
        optional: true,
      },
      {
        label: "3. Multi-angle analysis (parallel)",
        tool: "rapid_fan_out",
        args: (ctx) => ({
          prompts: [
            `Based on this codebase context, answer: ${ctx.question}\n\nContext: ${ctx.results[0]?.text || ""}`,
            `What are the risks or gotchas related to: ${ctx.question}`,
            `What's the recommended approach for: ${ctx.question}`,
          ],
          maxTokens: 1024,
        }),
      },
      {
        label: "4. Synthesize (strategic)",
        tool: "strategic_plan",
        args: (ctx) => ({
          task: `Synthesize these findings into a clear answer:\n\nQuestion: ${ctx.question}\nMemory: ${ctx.results[0]?.text || ""}\nPast convos: ${ctx.results[1]?.text || ""}\nAnalysis: ${ctx.results[2]?.text || ""}`,
          code_context: ctx.results[0]?.text || "",
        }),
      },
    ],
  },
};

/**
 * Maximum characters per prior step result when injected into subsequent prompts.
 * Prevents 32K context overflow when chains produce large outputs.
 * Override per-chain via chain.contextBudget.
 */
const DEFAULT_CONTEXT_BUDGET = 4000;

/**
 * Truncate text to a character budget, preserving beginning and end.
 * @param {string} text
 * @param {number} budget - Max characters
 * @returns {string}
 */
function truncateResult(text, budget = DEFAULT_CONTEXT_BUDGET) {
  if (!text || text.length <= budget) return text || "";
  const keep = Math.floor((budget - 50) / 2); // 50 chars for the separator
  return (
    text.slice(0, keep) +
    "\n\n... [TRUNCATED — " + (text.length - budget) + " chars omitted] ...\n\n" +
    text.slice(-keep)
  );
}

export { truncateResult, DEFAULT_CONTEXT_BUDGET };

/**
 * Execute a chain by name with given inputs.
 * @param {string} chainName
 * @param {Object} inputs - User-provided inputs matching requiredInputs
 * @param {Function} executeTool - async (toolName, args) => result text
 * @returns {Object} { chain, steps: [{label, tool, result, skipped, error}], success }
 */
export async function executeChain(chainName, inputs, executeTool) {
  const chain = CHAINS[chainName];
  if (!chain) throw new Error(`Unknown chain: '${chainName}'. Available: ${Object.keys(CHAINS).join(", ")}`);

  // Validate required inputs
  for (const key of chain.requiredInputs) {
    if (!inputs[key]) throw new Error(`Chain '${chainName}' requires input '${key}'`);
  }

  const budget = chain.contextBudget || DEFAULT_CONTEXT_BUDGET;
  const context = { ...inputs, results: [] };
  const stepResults = [];

  for (let i = 0; i < chain.steps.length; i++) {
    const step = chain.steps[i];

    // Check condition
    if (step.condition && !step.condition(context)) {
      stepResults.push({ label: step.label, tool: step.tool, skipped: true, reason: "condition false" });
      context.results.push(null);
      continue;
    }

    // Parallel fan-out step
    if (step.parallel && Array.isArray(step.parallel)) {
      try {
        const parts = await Promise.all(
          step.parallel.map(async (p) => {
            const pArgs = typeof p.args === "function" ? p.args(context) : p.args;
            const text = await executeTool(p.tool, pArgs);
            return `--- ${p.tool} ---\n${text}`;
          }),
        );
        const result = parts.join("\n\n");
        context.results.push({ text: truncateResult(result, budget) });
        stepResults.push({ label: step.label, tool: "parallel", result, skipped: false });
        continue;
      } catch (err) {
        if (step.optional) {
          stepResults.push({ label: step.label, tool: "parallel", skipped: true, reason: err.message });
          context.results.push(null);
          continue;
        }
        stepResults.push({ label: step.label, tool: "parallel", error: err.message });
        context.results.push(null);
        return { chain: chainName, steps: stepResults, success: false, failedAt: i };
      }
    }

    // Resolve args
    const args = typeof step.args === "function" ? step.args(context) : step.args;

    try {
      const result = await executeTool(step.tool, args);
      // Store truncated result to prevent context overflow in later steps
      context.results.push({ text: truncateResult(result, budget) });
      stepResults.push({ label: step.label, tool: step.tool, result, skipped: false });
    } catch (err) {
      if (step.optional) {
        stepResults.push({ label: step.label, tool: step.tool, skipped: true, reason: err.message });
        context.results.push(null);
      } else {
        stepResults.push({ label: step.label, tool: step.tool, error: err.message });
        context.results.push(null);
        return { chain: chainName, steps: stepResults, success: false, failedAt: i };
      }
    }
  }

  return { chain: chainName, steps: stepResults, success: true };
}
