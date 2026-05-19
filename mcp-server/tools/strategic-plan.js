/**
 * strategic_plan — Gemini 1M context strategic planning.
 */
import { strategicPlan } from "../shared/cloud.js";

export const schema = {
  name: "strategic_plan",
  description:
    "Send a complex task + code context to Gemini's 1M-token context window for strategic planning.",
  inputSchema: {
    type: "object",
    properties: {
      task: { type: "string", description: "What you need to accomplish." },
      code_context: { type: "string", description: "All relevant code. Gemini has 1M context." },
      maxTokens: { type: "number", description: "Max plan output tokens. Default 4096." },
    },
    required: ["task", "code_context"],
  },
};

export async function handler(args, ctx) {
  const result = await strategicPlan(args.task, args.code_context, { maxTokens: args.maxTokens });
  return {
    content: [{
      type: "text",
      text: [
        `=== STRATEGIC PLAN (${result.provider}/${result.model}) ===`,
        `${result.tokensIn ?? "?"} tokens analyzed → ${result.tokensOut ?? "?"} tokens plan, ${result.elapsedMs}ms`,
        "",
        result.text.trim(),
      ].join("\n"),
    }],
  };
}
