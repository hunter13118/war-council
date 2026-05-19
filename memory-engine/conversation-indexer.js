/**
 * memory-engine/conversation-indexer.js — Stub
 * 
 * Returns a no-op result until conversation indexing is implemented.
 * Satisfies the import contract in mcp-server/server.js.
 */

/**
 * Index conversation logs into the vector store.
 * @param {object} opts - { storePath, embedModel, chunkSize, chunkOverlap, daysBack, onProgress }
 * @returns {Promise<object>} - indexing result summary
 */
export async function indexConversations(opts = {}) {
  if (opts.onProgress) {
    opts.onProgress({ phase: "stub", message: "conversation indexer not yet implemented — returning empty result" });
  }
  return {
    conversationsProcessed: 0,
    chunksCreated: 0,
    skipped: 0,
    errors: [],
    stub: true,
  };
}
