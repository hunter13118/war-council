/**
 * report_action — Lightweight action reporter for external IDE agents.
 *
 * The calling agent (e.g., Cursor) sends raw action data with minimal token cost.
 * War Council's local 7b model formats and summarizes, then emits to dashboard.
 *
 * This keeps the premium model's token spend to ~50 tokens per report.
 */
import { OLLAMA_BASE, ARSENAL } from "../shared/config.js";
import { emitBattleEvent } from "../shared/battle-events.js";

export const schema = {
  name: "report_action",
  description:
    "Report what you just did to the War Council dashboard. Call this after completing any significant action. " +
    "Keep inputs brief — the local model will format the report. Costs you almost nothing.",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description: "Brief description of what you did (1-2 sentences max)",
      },
      files: {
        type: "array",
        items: { type: "string" },
        description: "Files you modified or read (optional)",
      },
      outcome: {
        type: "string",
        enum: ["success", "partial", "failed", "pending"],
        description: "How it went",
      },
      confidence: {
        type: "number",
        description: "Your confidence in the result (0.0 to 1.0)",
      },
    },
    required: ["action", "outcome"],
  },
};

export async function handler(args) {
  const { action, files, outcome, confidence } = args;

  // Emit raw event immediately (dashboard sees it right away)
  const event = {
    type: "agent_action",
    source: "cursor-pro",
    action,
    files: files || [],
    outcome,
    confidence: confidence ?? null,
    timestamp: new Date().toISOString(),
  };

  emitBattleEvent(event);

  // Optionally use local 7b to generate a formatted summary (async, non-blocking)
  let summary = action;
  try {
    const prompt = `Summarize this agent action in one punchy sentence for a dashboard log:\nAction: ${action}\nFiles: ${(files || []).join(", ") || "none"}\nOutcome: ${outcome}\nConfidence: ${confidence ?? "unknown"}\n\nSummary:`;

    const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: ARSENAL.fast,
        prompt,
        stream: false,
        options: { num_predict: 50, temperature: 0.3 },
      }),
    });

    if (res.ok) {
      const data = await res.json();
      summary = data.response?.trim() || action;
    }
  } catch {
    // 7b unavailable — raw action is fine
  }

  return {
    content: [
      {
        type: "text",
        text: `✅ Logged to War Council: ${summary}`,
      },
    ],
  };
}
