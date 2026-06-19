/**
 * Caller context — client-agnostic hybrid ship integrations.
 */
import { record } from "./telemetry.js";

const CLIENTS = new Set([
  "cursor",
  "claude",      // Claude Code / Claude Desktop
  "cline",
  "roo",
  "copilot",     // VS Code GitHub Copilot (agent mode)
  "gemini",      // Gemini CLI
  "antigravity", // Google Antigravity IDE
  "windsurf",
  "command_center",
  "ci",
  "mcp",
  "unknown",
]);
const TIERS = new Set(["cheap", "premium", "unknown"]);

// Aliases clients commonly self-report as.
const CLIENT_ALIASES = {
  "claude-code": "claude",
  "claude_desktop": "claude",
  "claude-desktop": "claude",
  "roo-cline": "roo",
  "roo_code": "roo",
  "github-copilot": "copilot",
  "vscode": "copilot",
  "gemini-cli": "gemini",
  "codeium": "windsurf",
};

/**
 * @param {object} [args]
 */
export function normalizeCallerContext(args = {}) {
  let rawClient = (args.caller_client || process.env.WC_CALLER_CLIENT || "unknown").toLowerCase();
  rawClient = CLIENT_ALIASES[rawClient] || rawClient;
  const rawTier = (args.caller_tier || process.env.WC_CALLER_TIER || "unknown").toLowerCase();
  const client = CLIENTS.has(rawClient) ? rawClient : "unknown";
  const tier = TIERS.has(rawTier) ? rawTier : "unknown";
  return {
    client,
    tier,
    isPremium: tier === "premium",
    isCheap: tier === "cheap",
    label: `${client}/${tier}`,
  };
}

/**
 * @param {ReturnType<typeof normalizeCallerContext>} ctx
 * @param {{ shipTier?: string }} [opts]
 */
export function tailorCallerGuidance(ctx, { shipTier } = {}) {
  const lines = ["", "## Guidance for this caller"];

  switch (ctx.client) {
    case "cursor":
      if (ctx.isCheap) {
        lines.push(
          "- **Cursor (cheap):** Read handoff below. Switch to **Opus/Sonnet** for apply, or re-run `coding_delivery({ phase: 'ship', force_local: true })`.",
        );
      } else if (ctx.isPremium) {
        lines.push(
          "- **Cursor (premium):** You are the overflow conductor. Apply remaining patches, run tests, ship.",
        );
      } else {
        lines.push("- **Cursor:** Use premium model for defer/hybrid overflow.");
      }
      break;
    case "claude":
      lines.push(
        "- **Claude (Code/Desktop):** You are the overflow conductor. Apply the handoff patches with your own editing tools, run the listed tests, then call `coding_delivery({ phase: 'verify', from_handoff: true })` to confirm with the council.",
      );
      break;
    case "copilot":
      lines.push(
        "- **Copilot (VS Code):** Hand this to the Conductor agent (`.github/agents/Conductor.agent.md`). Apply patches via agent-mode edits; gate the commit through QualityGatekeeper before shipping.",
      );
      break;
    case "cline":
    case "roo":
      lines.push(
        `- **${ctx.client === "roo" ? "Roo Code" : "Cline"}:** Apply the handoff with your own model (plan→act). Re-run \`run_tests\` through the council after applying so telemetry stays complete.`,
      );
      break;
    case "gemini":
    case "antigravity":
      lines.push(
        `- **${ctx.client === "antigravity" ? "Antigravity" : "Gemini CLI"}:** Use your host model for the apply step. The council remains available for \`memory_query\` (free retrieval) and \`review_diff\` verification afterward.`,
      );
      break;
    case "windsurf":
      lines.push(
        "- **Windsurf:** Apply via Cascade with the handoff plan. Call `self_eval` on the result to log a confidence score back into the council.",
      );
      break;
    default:
      lines.push("- **Caller:** Use your host's strong model for overflow or `force_local: true`.");
  }

  if (shipTier === "defer_to_caller") {
    lines.push("- Tier **defer_to_caller** — MCP planned only; caller must apply.");
  } else if (shipTier === "hybrid_ship") {
    lines.push("- Tier **hybrid_ship** — MCP applied bounded set; caller completes overflow.");
  }

  return lines.join("\n");
}

/**
 * @param {ReturnType<typeof normalizeCallerContext>} ctx
 * @param {string} event
 * @param {object} [meta]
 */
export function recordCallerTelemetry(ctx, event, meta = {}) {
  try {
    record({
      category: "ship",
      event,
      success: true,
      meta: { caller_client: ctx.client, caller_tier: ctx.tier, ...meta },
    });
  } catch {
    /* telemetry optional */
  }
}
