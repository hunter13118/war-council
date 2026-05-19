/**
 * memory_index_conversations — Index past Copilot/Cline transcripts.
 */
import { MEMORY_STORE_PATH, MEMORY_EMBED_MODEL } from "../shared/config.js";
import { indexConversations } from "../../memory-engine/conversation-indexer.js";

export const schema = {
  name: "memory_index_conversations",
  description: "Index past Copilot transcripts and Cline tasks into the Sovereign Memory store.",
  inputSchema: {
    type: "object",
    properties: {
      days_back: { type: "number", description: "Only index conversations modified within this window. Default 30." },
      chunk_size: { type: "number", description: "Default 800." },
      chunk_overlap: { type: "number", description: "Default 80." },
    },
  },
};

export async function handler(args, ctx) {
  const lines = [];
  const result = await indexConversations({
    storePath: MEMORY_STORE_PATH,
    embedModel: MEMORY_EMBED_MODEL,
    chunkSize: args.chunk_size ?? 800,
    chunkOverlap: args.chunk_overlap ?? 80,
    daysBack: args.days_back ?? 30,
    onProgress: (p) => {
      if (p.phase !== "embed_progress") lines.push(`  [${p.phase}] ${p.message ?? ""}`);
    },
  });
  return {
    content: [{
      type: "text",
      text: ["=== MEMORY_INDEX_CONVERSATIONS COMPLETE ===", ...lines, "", JSON.stringify(result, null, 2)].join("\n"),
    }],
  };
}
