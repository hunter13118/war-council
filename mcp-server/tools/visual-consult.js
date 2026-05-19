/**
 * visual_consult — Pass an image to a vision-language model.
 */
import { ollamaVisualize } from "../shared/ollama.js";

export const schema = {
  name: "visual_consult",
  description:
    "Pass an image (file path on disk) + a question to a local vision-language model. " +
    "Use for UI screenshot analysis, layout debugging, design audits.",
  inputSchema: {
    type: "object",
    properties: {
      image_path: { type: "string", description: "Absolute path to a PNG/JPG/WEBP image." },
      question: { type: "string", description: "What to analyze." },
      model: { type: "string", description: "Vision model. Default 'qwen2.5vl:7b'." },
      max_tokens: { type: "number", description: "Default 1024." },
    },
    required: ["image_path", "question"],
  },
};

export async function handler(args, ctx) {
  const model = args.model ?? "qwen2.5vl:7b";
  const result = await ollamaVisualize(model, args.image_path, args.question, {
    maxTokens: args.max_tokens ?? 1024,
  });
  return {
    content: [{
      type: "text",
      text: [
        `=== VISUAL_CONSULT ${result.model} ===`,
        `Image: ${args.image_path} (${(result.imageBytes / 1024).toFixed(1)} KB)`,
        `${result.tokensOut ?? "?"} tokens in ${result.elapsedMs}ms` +
          (result.tokensPerSec ? `, ${result.tokensPerSec} tok/s` : ""),
        "",
        result.text.trim(),
      ].join("\n"),
    }],
  };
}
