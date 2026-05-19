/**
 * consult_reasoning — Delegate to reasoning model with chain-of-thought.
 */
import { ARSENAL } from "../shared/config.js";
import { ollamaGenerateWithRetry, formatConsultResult } from "../shared/ollama.js";

export const schema = {
  name: "consult_reasoning",
  description:
    "Delegate to reasoning specialist (deepseek-r1:14b). Returns chain-of-thought. " +
    "Use for: tricky bugs, architectural decisions, debugging.",
  inputSchema: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "Self-contained prompt." },
      maxTokens: { type: "number" },
    },
    required: ["prompt"],
  },
};

export async function handler(args, ctx) {
  const r = await ollamaGenerateWithRetry(ARSENAL.reasoning, args.prompt, {
    maxTokens: args.maxTokens,
  });
  return {
    content: [{ type: "text", text: formatConsultResult("REASONING", r) }],
    _meta: { model: ARSENAL.reasoning, tokensOut: r.tokensOut, tps: r.tokensPerSec },
  };
}
