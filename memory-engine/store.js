/**
 * memory-engine/store.js — Stub
 * 
 * Minimal VectorStore that returns empty results.
 * Satisfies the import contract in mcp-server/server.js.
 */

export class VectorStore {
  constructor(storePath) {
    this.storePath = storePath;
    this.chunks = [];
  }

  async load() {
    // No-op — store file doesn't exist yet
    return this;
  }

  async save() {
    // No-op
    return this;
  }

  stats() {
    return {
      totalChunks: 0,
      uniqueFiles: 0,
      totalTokens: 0,
      storePath: this.storePath,
      stub: true,
    };
  }

  async search(embedding, k = 5) {
    return [];
  }

  async add(chunks) {
    // No-op
    return { added: 0 };
  }
}
