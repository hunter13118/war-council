/**
 * memory_index — Re-index repository code into vector store.
 */
import { resolve } from "node:path";
import { MEMORY_STORE_PATH, MEMORY_EMBED_MODEL, REPO_ROOT } from "../shared/config.js";
import { indexRepo } from "../../memory-engine/indexer.js";

export const schema = {
  name: "memory_index",
  description:
    "Re-index the repository CODE into the Sovereign Memory vector store. Idempotent.",
  inputSchema: {
    type: "object",
    properties: {
      root: { type: "string", description: "Directory to index. Default: REPO_ROOT." },
      chunk_size: { type: "number", description: "Default 500." },
      chunk_overlap: { type: "number", description: "Default 50." },
      embed_model: { type: "string", description: "Default 'nomic-embed-text'." },
    },
  },
};

export async function handler(args, ctx) {
  const lines = [];
  const result = await indexRepo({
    rootDir: args.root ? resolve(args.root) : REPO_ROOT,
    storePath: MEMORY_STORE_PATH,
    embedModel: args.embed_model ?? MEMORY_EMBED_MODEL,
    chunkSize: args.chunk_size ?? 500,
    chunkOverlap: args.chunk_overlap ?? 50,
    onProgress: (p) => {
      if (p.phase !== "embed_progress") lines.push(`  [${p.phase}] ${p.message ?? ""}`);
    },
  });
  return {
    content: [{
      type: "text",
      text: ["=== MEMORY_INDEX COMPLETE ===", ...lines, "", "Result:", JSON.stringify(result, null, 2)].join("\n"),
    }],
  };
}
