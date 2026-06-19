/**
 * Decision Tree Router — automatically determines the best tool/chain
 * based on task description keywords and patterns.
 *
 * The 32b conductor calls `smart_route` with a task description,
 * and gets back the recommended tool + pre-built args.
 */

/** @typedef {{ tool: string, args?: Object, chain?: string, reason: string }} RouteResult */

function isCodingTask(lower) {
  return matches(lower, [
    "fix ", "implement", "add ", "create ", "build ", "ship ", "refactor",
    "bug", "feature", "playwright", "e2e", "component", "api ", "css",
    "write code", "patch", "test suite", "npm run",
  ]);
}

/**
 * Route a task to the best tool or chain.
 * @param {string} taskDescription
 * @param {{ forceWarTable?: boolean }} [opts]
 * @returns {RouteResult}
 */
export function routeTask(taskDescription, opts = {}) {
  const lower = taskDescription.toLowerCase();
  const forceWar = process.env.FORCE_WAR_TABLE === "1" && opts.forceWarTable !== false;

  if (isCodingTask(lower)) {
    const warHint = forceWar ? " [FORCE_WAR_TABLE: run tournament_vote before execution]" : "";
    return {
      tool: "coding_delivery",
      args: { task: taskDescription, phase: "plan" },
      chain: "apple_plan",
      tier: "coding",
      conductorTier: "cheap",
      requiresTournament: forceWar,
      followUp: forceWar
        ? ["tournament_vote", "coding_delivery", "report_action"]
        : ["coding_delivery", "report_action"],
      reason:
        `Coding task → coding_delivery plan arc (RAG, cloud+local parallel, brief). After patches: phase=verify.${warHint}`,
    };
  }

  // Bug-related keywords → fix_bug chain
  if (matches(lower, ["bug", "broken", "error", "crash", "failing", "doesn't work", "not working", "regression"])) {
    return {
      chain: "fix_bug",
      tool: "run_chain",
      args: { chain: "fix_bug", inputs: { bug_description: taskDescription } },
      reason: "Detected bug-fix keywords → TDD fix pipeline",
    };
  }

  // Feature-related → new_feature chain
  if (matches(lower, ["add", "implement", "create", "build", "new feature", "feature request"])) {
    return {
      chain: "new_feature",
      tool: "run_chain",
      args: { chain: "new_feature", inputs: { feature_description: taskDescription } },
      reason: "Detected feature keywords → plan-implement-test pipeline",
    };
  }

  // Refactor-related → refactor chain
  if (matches(lower, ["refactor", "restructure", "reorganize", "clean up", "simplify", "extract"])) {
    return {
      chain: "refactor",
      tool: "run_chain",
      args: { chain: "refactor", inputs: { refactor_goal: taskDescription, target_files: "(identify from memory)" } },
      reason: "Detected refactor keywords → safe refactor pipeline",
    };
  }

  // Investigation / understanding → investigate chain
  if (matches(lower, ["how does", "what is", "where is", "explain", "understand", "investigate", "why does", "find"])) {
    return {
      chain: "investigate",
      tool: "run_chain",
      args: { chain: "investigate", inputs: { question: taskDescription } },
      reason: "Detected investigation keywords → multi-angle analysis",
    };
  }

  // Architecture / planning → strategic_plan directly
  if (matches(lower, ["architect", "design", "plan", "strategy", "approach", "how should"])) {
    return {
      tool: "strategic_plan",
      args: { task: taskDescription, code_context: "(load relevant files)" },
      reason: "Detected architecture/planning keywords → Gemini strategic plan",
    };
  }

  // Testing → run_tests directly
  if (matches(lower, ["test", "run tests", "check tests", "verify"])) {
    return {
      tool: "run_tests",
      args: { suite: "all" },
      reason: "Detected testing keywords → run full test suite",
    };
  }

  // Code review → review_diff
  if (matches(lower, ["review", "check my code", "audit", "look over"])) {
    return {
      tool: "review_diff",
      args: {},
      reason: "Detected review keywords → diff review",
    };
  }

  // Performance / optimization → consult_reasoning
  if (matches(lower, ["slow", "performance", "optimize", "speed up", "bottleneck", "faster", "taking forever", "too long", "latency"])) {
    return {
      tool: "consult_reasoning",
      args: { prompt: `Analyze this performance issue and suggest optimizations: ${taskDescription}` },
      reason: "Detected performance keywords → deep reasoning analysis",
    };
  }

  // Default: memory search first, then suggest
  return {
    tool: "memory_query",
    args: { query: taskDescription, k: 8 },
    reason: "No specific pattern matched → start with memory search for context",
  };
}

function matches(text, keywords) {
  return keywords.some((kw) => text.includes(kw));
}
