/**
 * memory_stats — Report vector store health.
 */
import { MEMORY_STORE_PATH } from "../shared/config.js";
import { VectorStore } from "../../memory-engine/store.js";

export const schema = {
  name: "memory_stats",
  description: "Report on the Sovereign Memory vector store health.",
  inputSchema: { type: "object", properties: {} },
};

export async function handler(args, ctx) {
  const store = new VectorStore(MEMORY_STORE_PATH);
  await store.load();
  const stats = store.stats();
  let codeChunks = 0, convChunks = 0;
  for (const c of store.chunks) {
    if (c.file.startsWith("conv://")) convChunks++;
    else codeChunks++;
  }
  return {
    content: [{
      type: "text",
      text: ["=== MEMORY_STATS ===", JSON.stringify({ ...stats, codeChunks, conversationChunks: convChunks }, null, 2)].join("\n"),
    }],
  };
}
