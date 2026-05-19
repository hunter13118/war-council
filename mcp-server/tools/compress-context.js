/**
 * compress_context — Compress long text into concise summary.
 */
import { groqGenerate } from "../shared/cloud.js";
import { withRetry } from "../shared/retry.js";

export const schema = {
  name: "compress_context",
  description:
    "Compress a long text into a concise summary. Preserves key facts, decisions, action items.",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", description: "The text to compress/summarize." },
      focus: { type: "string", description: "What aspects to prioritize (optional)." },
      maxLength: { type: "number", description: "Target max length in characters. Default 1000." },
    },
    required: ["text"],
  },
};

export async function handler(args, ctx) {
  const maxLen = args.maxLength ?? 1000;
  const compressResult = await withRetry(
    () => groqGenerate(
      `Compress the following text into a concise summary of ~${maxLen} characters.
${args.focus ? `Focus on: ${args.focus}` : ""}

Preserve: key facts, decisions, action items, file paths, function names.
Drop: filler, repetition, verbose explanations, pleasantries.
Format: bullet points for quick scanning.

TEXT TO COMPRESS:
${args.text}`,
      { maxTokens: Math.max(512, Math.ceil(maxLen / 3)) }
    ),
    { maxRetries: 2, baseDelayMs: 1000, label: "compress/groq" }
  );

  return {
    content: [{
      type: "text",
      text: [
        `=== COMPRESSED (${args.text.length} chars → ${compressResult.text.length} chars, ${Math.round((1 - compressResult.text.length / args.text.length) * 100)}% reduction) ===`,
        "",
        compressResult.text.trim(),
      ].join("\n"),
    }],
  };
}
