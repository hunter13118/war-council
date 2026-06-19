/**
 * consult_heavy — Delegate to local 32b conductor model.
 */
import { ARSENAL } from "../shared/config.js";
import { ollamaGenerateWithRetry, formatConsultResult } from "../shared/ollama.js";
import { augmentWithMemory } from "../shared/rag-augment.js";

export const schema = {
  name: "consult_heavy",
  description:
    "Delegate to heavy local model (qwen2.5-coder:32b). " +
    "Use for deep refactors, large implementations, synthesis after tournament — BEFORE escalating to Claude.",
  inputSchema: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "Self-contained prompt with full context." },
      maxTokens: { type: "number" },
    },
    required: ["prompt"],
  },
};

export async function handler(args) {
  const { augmentedPrompt } = await augmentWithMemory(args.prompt);
  const r = await ollamaGenerateWithRetry(ARSENAL.heavy, augmentedPrompt, {
    maxTokens: args.maxTokens ?? 4096,
  });
  return {
    content: [{ type: "text", text: formatConsultResult("HEAVY", r) }],
    _meta: { model: ARSENAL.heavy, tokensOut: r.tokensOut, tps: r.tokensPerSec },
  };
}
