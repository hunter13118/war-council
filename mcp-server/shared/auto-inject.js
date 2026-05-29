/**
 * Auto-Inject — Silently retrieves memory context when the agent forgets to call memory_query.
 *
 * When the protocol gateway detects a work tool called without prior memory_query,
 * this module runs the retriever under the hood and returns a formatted context block
 * that gets prepended to the agent's prompt. The agent still sees the warning to
 * change behavior, but the output quality is protected immediately.
 */
import { MEMORY_STORE_PATH, MEMORY_EMBED_MODEL, REPO_ROOT } from './config.js';
import { retrieve } from '../../memory-engine/retriever.js';
import { initRegistry, getActiveWorkspace } from './workspace-registry.js';
import { existsSync } from 'node:fs';

const MAX_INJECT_CHARS = 3000; // Keep injection compact (fits within token budget)

/**
 * Retrieve relevant context for a query and format it for prompt injection.
 * Returns null if retrieval fails or finds nothing relevant.
 *
 * @param {string} query - The agent's prompt/task text
 * @returns {string|null} Formatted context block or null
 */
export async function autoInjectContext(query) {
  if (!query || query.length < 5) return null;

  try {
    // Resolve vector store path (workspace-aware)
    let storePath = MEMORY_STORE_PATH;
    try {
      await initRegistry(REPO_ROOT);
      const active = getActiveWorkspace();
      if (active?.vectorStorePath && existsSync(active.vectorStorePath)) {
        storePath = active.vectorStorePath;
      }
    } catch { /* fall through */ }

    // Check if store exists
    if (!existsSync(storePath)) return null;

    const result = await retrieve(query, {
      storePath,
      k: 3, // Fewer chunks than manual query — keep it tight
      embedModel: MEMORY_EMBED_MODEL,
      minRelevance: 0.40, // Higher threshold — only inject truly relevant stuff
      source: 'all',
    });

    if (!result.chunks || result.chunks.length === 0) return null;

    // Format as a compact context block
    const chunks = result.chunks
      .map(c => `[${c.source}]\n${c.text}`)
      .join('\n---\n');

    const contextBlock = chunks.slice(0, MAX_INJECT_CHARS);

    return `[AUTO-INJECTED CONTEXT — memory_query was not called, but here's relevant codebase context:]\n${contextBlock}\n[END AUTO-INJECTED CONTEXT]`;
  } catch {
    // Silent failure — auto-inject is best-effort
    return null;
  }
}
