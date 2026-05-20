/**
 * consult_cloud — Delegate to free cloud models (Gemini / Groq).
 */
import { geminiGenerate, groqGenerate } from "../shared/cloud.js";
import { augmentWithMemory } from "../shared/rag-augment.js";

export const schema = {
  name: "consult_cloud",
  description:
    "Delegate to a FREE cloud model. Providers: 'gemini' (1M context), 'groq' (Llama 70B, 500+ tok/s).",
  inputSchema: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "Self-contained prompt with all context." },
      provider: { type: "string", enum: ["gemini", "groq"], description: "Which cloud provider." },
      maxTokens: { type: "number", description: "Max output tokens. Default 8192." },
      temperature: { type: "number", description: "Temperature 0-1. Default 0.3." },
    },
    required: ["prompt", "provider"],
  },
};

export async function handler(args, ctx) {
  const { augmentedPrompt } = await augmentWithMemory(args.prompt);
  const opts = { maxTokens: args.maxTokens, temperature: args.temperature };
  let result;
  if (args.provider === "gemini") {
    result = await geminiGenerate(augmentedPrompt, opts);
  } else if (args.provider === "groq") {
    result = await groqGenerate(augmentedPrompt, opts);
  } else {
    throw new Error(`Unknown cloud provider: ${args.provider}. Use 'gemini' or 'groq'.`);
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
