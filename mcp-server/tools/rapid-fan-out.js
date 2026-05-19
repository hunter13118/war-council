/**
 * rapid_fan_out — Parallel prompts to Groq.
 */
import { rapidFanOut } from "../shared/cloud.js";

export const schema = {
  name: "rapid_fan_out",
  description:
    "Send MULTIPLE prompts to Groq (70B) in parallel and get all responses back.",
  inputSchema: {
    type: "object",
    properties: {
      prompts: { type: "array", items: { type: "string" }, description: "Array of self-contained prompts." },
      maxTokens: { type: "number", description: "Max tokens per response. Default 2048." },
    },
    required: ["prompts"],
  },
};

export async function handler(args, ctx) {
  if (!Array.isArray(args.prompts) || args.prompts.length === 0) {
    throw new Error("prompts must be a non-empty array");
  }
  if (args.prompts.length > 10) {
    throw new Error("Max 10 parallel prompts (Groq rate limit protection)");
  }
  const result = await rapidFanOut(args.prompts, { maxTokens: args.maxTokens });
  const formatted = result.results.map((r, i) => [
    `--- [${i + 1}/${result.count}] (${r.tokensOut ?? "?"} tokens, ${r.elapsedMs}ms) ---`,
    r.text.trim(),
  ].join("\n")).join("\n\n");
  return {
    content: [{
      type: "text",
      text: [
        `=== RAPID FAN-OUT (${result.count} prompts, ${result.totalElapsedMs}ms total) ===`,
        "",
        formatted,
      ].join("\n"),
    }],
  };
}
