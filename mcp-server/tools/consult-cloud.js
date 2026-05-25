/**
 * consult_cloud — Delegate to free cloud models (Gemini / Groq / OpenRouter).
 */
import { geminiGenerate, groqGenerate, openRouterGenerate } from "../shared/cloud.js";
import { augmentWithMemory } from "../shared/rag-augment.js";

export const schema = {
  name: "consult_cloud",
  description:
    "Delegate to a FREE cloud model. Providers: 'gemini' (1M context), 'groq' (Llama 70B, 500+ tok/s), 'openrouter' (DeepSeek V4 Flash 1M, many free models).",
  inputSchema: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "Self-contained prompt with all context." },
      provider: { type: "string", enum: ["gemini", "groq", "openrouter"], description: "Which cloud provider." },
      model: { type: "string", description: "Override model name. For openrouter: e.g. 'nvidia/nemotron-3-super-120b-a12b:free'." },
      maxTokens: { type: "number", description: "Max output tokens. Default 8192." },
      temperature: { type: "number", description: "Temperature 0-1. Default 0.3." },
    },
    required: ["prompt", "provider"],
  },
};

export async function handler(args, ctx) {
  const { augmentedPrompt } = await augmentWithMemory(args.prompt);
  const opts = { maxTokens: args.maxTokens, temperature: args.temperature, model: args.model };
  let result;
  if (args.provider === "gemini") {
    result = await geminiGenerate(augmentedPrompt, opts);
  } else if (args.provider === "groq") {
    result = await groqGenerate(augmentedPrompt, opts);
  } else if (args.provider === "openrouter") {
    result = await openRouterGenerate(augmentedPrompt, opts);
  } else {
    throw new Error(`Unknown cloud provider: ${args.provider}. Use 'gemini', 'groq', or 'openrouter'.`);
  }
  return {
    content: [{
      type: "text",
      text: [
        `=== CLOUD (${result.provider}/${result.model}) ===`,
        `${result.tokensIn ?? "?"} in → ${result.tokensOut ?? "?"} out, ${result.elapsedMs}ms`,
        "",
        result.text.trim(),
      ].join("\n"),
    }],
  };
}
