/**
 * memory-engine/indexer.js — Stub
 * 
 * Returns a no-op result until the full RAG indexing system is implemented.
 * Satisfies the import contract in mcp-server/server.js.
 */

/**
 * Index repository files into the vector store.
 * @param {object} opts - { rootDir, storePath, embedModel, chunkSize, chunkOverlap, onProgress }
 * @returns {Promise<object>} - indexing result summary
 */
export async function indexRepo(opts = {}) {
  if (opts.onProgress) {
    opts.onProgress({ phase: "stub", message: "memory-engine not yet implemented — returning empty result" });
  }
  return {
    filesProcessed: 0,
    chunksCreated: 0,
    skipped: 0,
    errors: [],
    stub: true,
  };
}
