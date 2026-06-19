/**
 * escalate_premium — Defer heavy apply to caller's strong model.
 */
import { emitBattleEvent } from "../shared/battle-events.js";
import {
  normalizeCallerContext,
  tailorCallerGuidance,
  recordCallerTelemetry,
} from "../shared/caller-context.js";

export const schema = {
  name: "escalate_premium",
  description:
    "Request premium caller (Cursor Opus, etc.) to apply after council planning. Returns CALLER_HANDOFF block.",
  inputSchema: {
    type: "object",
    properties: {
      reason: { type: "string" },
      task: { type: "string" },
      context_summary: { type: "string" },
      tried_local: { type: "boolean", description: "Default true." },
      caller_client: { type: "string" },
      caller_tier: { type: "string" },
    },
    required: ["reason", "task", "context_summary"],
  },
};

export async function handler(args) {
  const tried = args.tried_local !== false;
  const callerContext = normalizeCallerContext(args);
  recordCallerTelemetry(callerContext, "escalate_premium", { reason: args.reason?.slice(0, 120) });

  emitBattleEvent({
    type: "premium_escalation",
    source: "war-council",
    reason: args.reason,
    task: args.task?.slice(0, 500),
    triedLocal: tried,
    caller_client: callerContext.client,
    caller_tier: callerContext.tier,
  });

  const text = [
    "=== CALLER_HANDOFF (defer_to_caller via escalate_premium) ===",
    `Reason: ${args.reason}`,
    `caller: ${callerContext.label}`,
    "",
    tailorCallerGuidance(callerContext, { shipTier: "defer_to_caller" }),
    "",
    "--- WAR COUNCIL CONTEXT ---",
    args.context_summary,
    "--- END CONTEXT ---",
    "",
    `Task: ${args.task}`,
    tried ? "(Local/cloud council already consulted.)" : "",
    "",
    "--- END CALLER_HANDOFF ---",
  ].join("\n");

  return {
    content: [{ type: "text", text }],
    _meta: {
      premiumRequired: !callerContext.isPremium,
      shipTier: "defer_to_caller",
      caller_client: callerContext.client,
      caller_tier: callerContext.tier,
    },
  };
}
