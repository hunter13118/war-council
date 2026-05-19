/**
 * scratchpad_write — Append to the shared council scratchpad.
 */
import { appendScratchpad } from "../council-deliberation.js";

export const schema = {
  name: "scratchpad_write",
  description: "Append a note to the shared council scratchpad. Timestamped automatically.",
  inputSchema: {
    type: "object",
    properties: {
      entry: { type: "string", description: "The note to append." },
    },
    required: ["entry"],
  },
};

export async function handler(args, ctx) {
  const updated = await appendScratchpad(args.entry);
  return {
    content: [{ type: "text", text: `✅ Note appended to scratchpad (${updated.length} chars total).` }],
  };
}
