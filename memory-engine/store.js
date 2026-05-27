/**
 * memory-engine/store.js — HNSW-accelerated vector store with JSON persistence.
 *
 * Stores embeddings + metadata as a JSON file. Builds an in-memory HNSW index
 * for O(log N) approximate nearest neighbor search. Falls back to brute-force
 * cosine for source-filtered queries or when HNSW is unavailable.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { HNSWIndex } from "./hnsw-index.js";

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
  constructor(storePath, opts = {}) {
    this.storePath = storePath;
    this.chunks = [];
    this.hnswOpts = { M: opts.M || 16, efConstruction: opts.efConstruction || 200, efSearch: opts.efSearch || 50 };
    this._hnsw = null;
    this._indexDirty = false;
  }

  _buildHNSW() {
    this._hnsw = new HNSWIndex(this.hnswOpts);
    for (let i = 0; i < this.chunks.length; i++) {
      const c = this.chunks[i];
      if (c.embedding && c.embedding.length > 0) {
        this._hnsw.insert(`idx-${i}`, c.embedding, { index: i });
      }
    }
    this._indexDirty = false;
  }

  async load() {
    try {
      const raw = await readFile(this.storePath, "utf-8");
      this.chunks = JSON.parse(raw);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      this.chunks = [];
    }
    if (this.chunks.length > 0) {
      this._buildHNSW();
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
    const hnswStats = this._hnsw ? this._hnsw.stats() : null;
    return {
      totalChunks: this.chunks.length,
      uniqueFiles: files.size,
      totalTokens: this.chunks.reduce((s, c) => s + (c.tokenCount || 0), 0),
      storePath: this.storePath,
      stub: false,
      hnsw: hnswStats,
      searchMode: this._hnsw ? 'hnsw' : 'brute-force',
    };
  }

  /**
   * Search for nearest chunks by HNSW (or brute-force fallback).
   * @param {number[]} embedding - query embedding vector
   * @param {number} k - number of results
   * @param {object} opts - { minScore, source }
   * @returns {Array<{ chunk: object, score: number }>}
   */
  async search(embedding, k = 5, opts = {}) {
    const minScore = opts.minScore ?? 0.0;
    const sourceFilter = opts.source;

    // Rebuild HNSW if chunks were added since last build
    if (this._indexDirty && this.chunks.length > 0) {
      this._buildHNSW();
    }

    // Use brute-force for source-filtered queries (subset search)
    if (sourceFilter || !this._hnsw) {
      return this._bruteForceScan(embedding, k, minScore, sourceFilter);
    }

    // HNSW search — fetch extra to account for minScore filtering
    const hnswResults = this._hnsw.search(embedding, Math.min(k * 3, this.chunks.length));
    return hnswResults
      .filter(r => r.score >= minScore)
      .slice(0, k)
      .map(r => ({
        chunk: this.chunks[r.data.index],
        score: r.score,
      }));
  }

  _bruteForceScan(embedding, k, minScore, sourceFilter) {
    let candidates = this.chunks;
    if (sourceFilter) {
      candidates = candidates.filter(c => c.source === sourceFilter);
    }
    return candidates
      .map(chunk => ({ chunk, score: cosineSimilarity(embedding, chunk.embedding) }))
      .filter(r => r.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  /**
   * Add chunks to the store.
   * @param {Array<{ text: string, embedding: number[], source: string, tokenCount?: number }>} newChunks
   * @returns {{ added: number }}
   */
  async add(newChunks) {
    this.chunks.push(...newChunks);
    this._indexDirty = true;
    return { added: newChunks.length };
  }
}
