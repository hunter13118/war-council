/**
 * memory-engine/store.js — JSON-backed vector store with cosine similarity search.
 *
 * Stores embeddings + metadata as a JSON file. Uses brute-force cosine similarity
 * for search (fast enough for <100K chunks). Upgrade to hnswlib-node when scale demands.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}

export class VectorStore {
  constructor(storePath) {
    this.storePath = storePath;
    this.chunks = [];
  }

  async load() {
    try {
      const raw = await readFile(this.storePath, "utf-8");
      this.chunks = JSON.parse(raw);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      this.chunks = [];
    }
    return this;
  }

  async save() {
    await mkdir(dirname(this.storePath), { recursive: true });
    await writeFile(this.storePath, JSON.stringify(this.chunks), "utf-8");
    return this;
  }

  stats() {
    const files = new Set(this.chunks.map(c => c.source));
    return {
      totalChunks: this.chunks.length,
      uniqueFiles: files.size,
      totalTokens: this.chunks.reduce((s, c) => s + (c.tokenCount || 0), 0),
      storePath: this.storePath,
      stub: false,
    };
  }

  /**
   * Search for nearest chunks by cosine similarity.
   * @param {number[]} embedding - query embedding vector
   * @param {number} k - number of results
   * @param {object} opts - { minScore, source }
   * @returns {Array<{ chunk: object, score: number }>}
   */
  async search(embedding, k = 5, opts = {}) {
    const minScore = opts.minScore ?? 0.0;
    const sourceFilter = opts.source;

    let candidates = this.chunks;
    if (sourceFilter) {
      candidates = candidates.filter(c => c.source === sourceFilter);
    }

    const scored = candidates
      .map(chunk => ({ chunk, score: cosineSimilarity(embedding, chunk.embedding) }))
      .filter(r => r.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);

    return scored;
  }

  /**
   * Add chunks to the store.
   * @param {Array<{ text: string, embedding: number[], source: string, tokenCount?: number }>} newChunks
   * @returns {{ added: number }}
   */
  async add(newChunks) {
    this.chunks.push(...newChunks);
    return { added: newChunks.length };
  }
}
