/**
 * scratchpad_read — Read the shared council scratchpad.
 */
import { readScratchpad } from "../council-deliberation.js";

export const schema = {
  name: "scratchpad_read",
  description: "Read the shared council scratchpad. Persistent memory within a session.",
  inputSchema: { type: "object", properties: {} },
};

export async function handler(args, ctx) {
  const content = await readScratchpad();
  return { content: [{ type: "text", text: content || "(scratchpad is empty)" }] };
}
