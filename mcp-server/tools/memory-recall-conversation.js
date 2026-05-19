/**
 * memory_recall_conversation — Retrieve from past conversation history.
 */
import { MEMORY_STORE_PATH, MEMORY_EMBED_MODEL } from "../shared/config.js";
import { retrieve } from "../../memory-engine/retriever.js";

export const schema = {
  name: "memory_recall_conversation",
  description:
    "Retrieve relevant chunks from past Copilot/Cline conversation history. " +
    "Use when user asks 'what did we decide about X?'",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "What past discussion to recall." },
      k: { type: "number", description: "Default 5." },
    },
    required: ["query"],
  },
};

export async function handler(args, ctx) {
  const t0 = Date.now();
  const result = await retrieve(args.query, {
    storePath: MEMORY_STORE_PATH,
    k: args.k ?? 5,
    embedModel: MEMORY_EMBED_MODEL,
    source: "conversation",
  });
  const lines = [
    `=== MEMORY_RECALL_CONVERSATION (${Date.now() - t0}ms) ===`,
    `Query: "${args.query}"`,
    `Relevant: ${result.relevant} | Past conversation chunks: ${result.chunks.length}`,
    "",
    ...result.chunks.map(
      (c, i) => `--- Recall ${i + 1} [${c.score.toFixed(3)}] ${c.file} turn ${c.startLine} ---\n${c.text}`
    ),
    ...(result.chunks.length === 0
      ? ["No past conversations matched. Either memory_index_conversations hasn't been run, the topic is new, or threshold needs lowering."]
      : []),
  ];
  return { content: [{ type: "text", text: lines.join("\n") }] };
}
