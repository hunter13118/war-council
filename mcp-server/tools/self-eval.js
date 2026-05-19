/**
 * self_eval — Send generated code to a second model for quick review.
 */
import { groqGenerate } from "../shared/cloud.js";
import { withRetry } from "../shared/retry.js";

export const schema = {
  name: "self_eval",
  description:
    "Self-evaluation gate: sends generated code to a second model for quick review. " +
    "Returns pass/fail + issues found.",
  inputSchema: {
    type: "object",
    properties: {
      code: { type: "string", description: "The generated code to evaluate." },
      context: { type: "string", description: "What this code is supposed to do." },
    },
    required: ["code", "context"],
  },
};

export async function handler(args, ctx) {
  const evalResult = await withRetry(
    () => groqGenerate(
      `You are a code reviewer. Evaluate this code for correctness, security, and quality.

TASK (what this code should do): ${args.context}

CODE:
\`\`\`
${args.code}
\`\`\`

Respond with:
1. VERDICT: PASS or FAIL
2. ISSUES (if any): bullet list of problems
3. SUGGESTIONS (if any): improvements

Be concise and specific.`,
      { maxTokens: 1024 }
    ),
    { maxRetries: 2, baseDelayMs: 1500, label: "self_eval/groq" }
  );

  return {
    content: [{
      type: "text",
      text: [`=== SELF-EVAL (${evalResult.elapsedMs}ms) ===`, evalResult.text.trim()].join("\n"),
    }],
  };
}
