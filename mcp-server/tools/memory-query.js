/**
 * memory_query — Retrieve relevant chunks from Sovereign Memory vector store.
 */
import { MEMORY_STORE_PATH, MEMORY_EMBED_MODEL } from "../shared/config.js";
import { retrieve } from "../../memory-engine/retriever.js";

export const schema = {
  name: "memory_query",
  description:
    "Retrieve top-K most relevant code/doc chunks from the local Sovereign Memory vector store. " +
    "USE THIS as the FIRST step for any question about the codebase.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Natural-language question/topic." },
      k: { type: "number", description: "Number of chunks to return. Default 5." },
      min_relevance: { type: "number", description: "Minimum cosine score (0-1). Default 0.30." },
      source: {
        type: "string",
        enum: ["code", "conversation", "all"],
        description: "Filter by chunk source. Default 'all'.",
      },
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
    minRelevance: args.min_relevance ?? 0.30,
    source: args.source ?? "all",
  });
  const lines = [
    `=== MEMORY_QUERY (${Date.now() - t0}ms total, ` +
      `embed=${result.latency.embed}ms, search=${result.latency.search}ms) ===`,
    `Query: "${args.query}" | Source filter: ${args.source ?? "all"}`,
    `Relevant: ${result.relevant} | Chunks returned: ${result.chunks.length} ` +
      `| Store: ${result.stats.totalChunks} chunks across ${result.stats.uniqueFiles} files`,
    "",
    ...(result.chunks.length > 0
      ? [
          "Retrieved chunks:",
          ...result.chunks.map((c, i) => `  ${i + 1}. [${c.score.toFixed(3)}] ${c.source}`),
          "",
          "----- CONTEXT (top chunks) -----",
          ...result.chunks.map((c) => c.text),
          "",
        ]
      : ["(no chunks above relevance threshold)", ""]),
  ];
  return { content: [{ type: "text", text: lines.join("\n") }] };
}
