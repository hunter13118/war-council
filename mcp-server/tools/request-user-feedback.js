/**
 * request_user_feedback — Format feedback gate for the Conductor.
 */
export const schema = {
  name: "request_user_feedback",
  description:
    "Format a structured feedback request to present to the user before declaring task done.",
  inputSchema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "1-2 sentence summary of what was done." },
      test_results: { type: "string", description: "Test suite results. Empty string if N/A." },
      question: { type: "string", description: "Specific freeform question for the user." },
    },
    required: ["summary"],
  },
};

export async function handler(args, ctx) {
  const q = args.question ?? "Is the work acceptable? Adjustments needed, or are we good?";
  const block = [
    "=== USER FEEDBACK GATE ===",
    "",
    "**Summary:** " + args.summary,
    "",
    ...(args.test_results ? ["**Test results:**", args.test_results, ""] : []),
    "**Question:** " + q,
    "",
    "⚠️ DO NOT close the turn until the user explicitly approves. " +
      "Display this block to the user verbatim and wait for their reply.",
  ].join("\n");
  return { content: [{ type: "text", text: block }] };
}
