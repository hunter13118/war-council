/**
 * consult_specialist — Delegate to balanced specialist model.
 */
import { ARSENAL } from "../shared/config.js";
import { ollamaGenerateWithRetry, formatConsultResult } from "../shared/ollama.js";

export const schema = {
  name: "consult_specialist",
  description:
    "Delegate to balanced specialist (qwen2.5-coder:14b). " +
    "Use for: code generation, refactors, mid-difficulty design questions.",
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
  const r = await ollamaGenerateWithRetry(ARSENAL.specialist, args.prompt, {
    maxTokens: args.maxTokens,
  });
  return {
    content: [{ type: "text", text: formatConsultResult("SPECIALIST", r) }],
    _meta: { model: ARSENAL.specialist, tokensOut: r.tokensOut, tps: r.tokensPerSec },
  };
}
