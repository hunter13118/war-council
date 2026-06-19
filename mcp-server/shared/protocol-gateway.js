/**
 * Protocol Gateway — Enforces the War Council operating protocol.
 *
 * Tracks session state and ensures agents follow the mandated flow:
 *   0. register_workspace (first time)
 *   1. memory_query (before reading/answering)
 *   2. [work] (consult_*, strategic_plan, etc.)
 *   3. report_action (after completing work)
 *
 * Enforcement levels:
 *   - SOFT: Inject reminders into tool responses (never blocks)
 *   - MEDIUM: Refuse tool call, return "call X first" (can loop)
 *   - HARD: Block entirely until prerequisite met (risky)
 *
 * Default: SOFT — maximizes compliance without breaking agent loops.
 */

function getEnforcementLevel() {
  return process.env.GATEWAY_ENFORCEMENT || "soft";
}

// Session state
let sessionState = {
  workspaceRegistered: false,
  memoryQueried: false,
  lastMemoryQueryAt: 0,
  deliberationComplete: false,
  lastDeliberationAt: 0,
  actionsWithoutReport: 0,
  totalCalls: 0,
  callHistory: [], // last N tool calls
  lastRoute: null,
};

// Tools that constitute "work" (actions that should be preceded by memory_query)
const WORK_TOOLS = new Set([
  "consult_fast", "consult_specialist", "consult_reasoning", "consult_cloud",
  "tournament_vote", "council_debate", "council_deliberate", "rapid_fan_out",
  "strategic_plan", "review_diff", "invoke_agent",
]);

// Tools that count as "reporting"
const REPORT_TOOLS = new Set(["report_action", "log_decision"]);

// Tools exempt from protocol checks (utility/read-only)
const EXEMPT_TOOLS = new Set([
  "memory_query", "memory_stats", "memory_index", "memory_recall_conversation",
  "register_workspace", "switch_workspace", "list_arsenal",
  "scratchpad_read", "scratchpad_write", "run_tests",
  "memory_index_conversations", "prewarm_loadout",
  "coding_delivery", "apply_plan", "smart_route", "conductor_prelude",
  "council_rollback", "run_chain",
]);

// How long memory_query stays "fresh" (5 minutes)
const MEMORY_FRESHNESS_MS = 5 * 60 * 1000;

/**
 * Check protocol compliance before a tool executes.
 * Returns null if compliant, or a gateway response object if violated.
 *
 * @param {string} toolName
 * @param {Object} args
 * @returns {null | { warning: string, autoInject: boolean }}
 */
export function checkGateway(toolName, args) {
  sessionState.totalCalls++;
  sessionState.callHistory.push({ tool: toolName, at: Date.now() });
  if (sessionState.callHistory.length > 50) sessionState.callHistory.shift();

  // Track state transitions
  if (toolName === "register_workspace") {
    sessionState.workspaceRegistered = true;
    return null;
  }
  if (toolName === "memory_query") {
    sessionState.memoryQueried = true;
    sessionState.lastMemoryQueryAt = Date.now();
    return null;
  }
  if (REPORT_TOOLS.has(toolName)) {
    sessionState.actionsWithoutReport = 0;
    return null;
  }

  // Exempt tools skip checks
  if (EXEMPT_TOOLS.has(toolName)) return null;

  // === GATE 1: workspace not registered ===
  if (!sessionState.workspaceRegistered && toolName !== "list_arsenal") {
    if (getEnforcementLevel() === "hard") {
      return { blocked: true, message: "BLOCKED: Call register_workspace first to initialize this repo's context." };
    }
    return {
      warning: "⚠️ PROTOCOL: register_workspace has not been called. RAG context may be from a different repo. Call register_workspace() to ensure correct context.",
      autoInject: false,
    };
  }

  // === GATE 2: memory_query not called (or stale) before work ===
  if (WORK_TOOLS.has(toolName)) {
    const stale = (Date.now() - sessionState.lastMemoryQueryAt) > MEMORY_FRESHNESS_MS;
    if (!sessionState.memoryQueried || stale) {
      sessionState.actionsWithoutReport++;
      if (getEnforcementLevel() === "hard") {
        return { blocked: true, message: `BLOCKED: Call memory_query before ${toolName}. RAG context is free and prevents hallucination.` };
      }
      return {
        warning: `⚠️ PROTOCOL: You called ${toolName} without memory_query first. Vector search is FREE and instant. Call memory_query to ground your response in actual code.`,
        autoInject: true, // Signal to auto-inject RAG results
      };
    }
  }

  // === GATE 3: too many actions without report_action ===
  if (WORK_TOOLS.has(toolName)) {
    sessionState.actionsWithoutReport++;
    if (sessionState.actionsWithoutReport >= 3) {
      return {
        warning: `⚠️ PROTOCOL: ${sessionState.actionsWithoutReport} tool calls since last report_action. The user cannot see what you're doing. Call report_action to maintain visibility.`,
        autoInject: false,
      };
    }
  }

  return null;
}

/**
 * Generate a response footer with next-step guidance.
 * Appended to every tool response to reinforce protocol.
 *
 * @param {string} toolName - The tool that just executed
 * @returns {string} Footer text to append
 */
export function getResponseFooter(toolName) {
  if (toolName === "register_workspace") {
    return "\n\n---\nNEXT: Call memory_query to search this workspace's code before making changes.";
  }
  if (toolName === "memory_query") {
    return "\n\n---\nNEXT: Use the retrieved context. When done with your task, call report_action.";
  }
  if (WORK_TOOLS.has(toolName)) {
    if (sessionState.actionsWithoutReport >= 2) {
      return "\n\n---\n⚠️ REMINDER: Call report_action to log what you've done. The user's dashboard needs visibility.";
    }
    return "";
  }
  if (REPORT_TOOLS.has(toolName)) {
    return "\n\n---\nAction logged. Continue with the next task or call memory_query for new context.";
  }
  return "";
}

/**
 * Get current session state (for debugging/dashboard).
 */
export function getSessionState() {
  return { ...sessionState };
}

/**
 * Reset session state (for testing or new session).
 */
export function resetSession() {
  sessionState = {
    workspaceRegistered: false,
    memoryQueried: false,
    lastMemoryQueryAt: 0,
    deliberationComplete: false,
    lastDeliberationAt: 0,
    actionsWithoutReport: 0,
    totalCalls: 0,
    callHistory: [],
    lastRoute: null,
  };
}

/**
 * Record smart_route result for coding_delivery hints.
 * @param {object} route
 * @param {string} task
 */
export function markSmartRoute(route, task) {
  sessionState.lastRoute = { ...route, task: task?.slice(0, 200), at: Date.now() };
}

/**
 * Mark FORCE_WAR_TABLE prelude satisfied (ship prelude / conductor_prelude).
 */
export function markDeliberationComplete() {
  sessionState.deliberationComplete = true;
  sessionState.lastDeliberationAt = Date.now();
  sessionState.memoryQueried = true;
  sessionState.lastMemoryQueryAt = Date.now();
}

/**
 * @returns {boolean}
 */
export function isDeliberationComplete() {
  if (process.env.FORCE_WAR_TABLE !== "1") return true;
  const fresh = (Date.now() - sessionState.lastDeliberationAt) < MEMORY_FRESHNESS_MS;
  return sessionState.deliberationComplete && fresh;
}
