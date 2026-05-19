/**
 * consult_fast — Delegate to fast worker model.
 */
import { ARSENAL } from "../shared/config.js";
import { ollamaGenerateWithRetry, formatConsultResult } from "../shared/ollama.js";

export const schema = {
  name: "consult_fast",
  description:
    "Delegate to fast worker (qwen2.5-coder:7b, ~200 tok/s). " +
    "Use for: simple lookups, short summaries, well-defined transforms. " +
    "NOT for complex reasoning or large refactors.",
  inputSchema: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "Self-contained prompt. Include all context (worker has no memory of conversation).",
      },
      maxTokens: {
        type: "number",
        description: "Max output tokens (default 2048).",
      },
    },
    required: ["prompt"],
  },
};

export async function handler(args, ctx) {
  const r = await ollamaGenerateWithRetry(ARSENAL.fast, args.prompt, {
    maxTokens: args.maxTokens,
  });
  return {
    content: [{ type: "text", text: formatConsultResult("FAST", r) }],
    _meta: { model: ARSENAL.fast, tokensOut: r.tokensOut, tps: r.tokensPerSec },
  };
}
