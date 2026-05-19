/**
 * memory-engine/retriever.js — Retrieve relevant chunks via embedding search.
 *
 * Uses Ollama nomic-embed-text for query embedding, then cosine search on VectorStore.
 */
import { VectorStore } from "./store.js";

const DEFAULT_STORE_PATH = ".cline-context/vector-store.json";
const DEFAULT_EMBED_MODEL = "nomic-embed-text";
const OLLAMA_BASE = process.env.OLLAMA_BASE || "http://127.0.0.1:11434";

async function embed(text, model = DEFAULT_EMBED_MODEL) {
  const res = await fetch(`${OLLAMA_BASE}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt: text }),
  });
  if (!res.ok) throw new Error(`Embed failed: HTTP ${res.status}`);
  const data = await res.json();
  return data.embedding;
}

/**
 * Retrieve relevant chunks from the vector store.
 * @param {string} query - The search query
 * @param {object} opts - { storePath, k, embedModel, minRelevance, source }
 * @returns {Promise<object>} - { relevant, chunks, latency, stats }
 */
export async function retrieve(query, opts = {}) {
  const storePath = opts.storePath ?? DEFAULT_STORE_PATH;
  const k = opts.k ?? 5;
  const minRelevance = opts.minRelevance ?? 0.3;

  const store = new VectorStore(storePath);
  await store.load();

  if (store.chunks.length === 0) {
    return {
      relevant: false,
      chunks: [],
      latency: { embed: 0, search: 0 },
      stats: store.stats(),
    };
  }

  const t0 = Date.now();
  const queryEmbedding = await embed(query, opts.embedModel ?? DEFAULT_EMBED_MODEL);
  const embedMs = Date.now() - t0;

  const t1 = Date.now();
  const results = await store.search(queryEmbedding, k, { minScore: minRelevance, source: opts.source });
  const searchMs = Date.now() - t1;

  return {
    relevant: results.length > 0,
    chunks: results.map(r => ({ text: r.chunk.text, source: r.chunk.source, score: r.score })),
    latency: { embed: embedMs, search: searchMs },
    stats: store.stats(),
  };
}

