/**
 * shared/rag-augment.js — Auto-augment prompts with relevant memory chunks.
 *
 * Retrieves top-K chunks from the vector store and prepends them as context.
 * Falls back gracefully (returns original prompt) if store is empty or embeddings unavailable.
 */
import { VectorStore } from "../../memory-engine/store.js";
import { MEMORY_STORE_PATH, MEMORY_EMBED_MODEL } from "./config.js";

const OLLAMA_BASE = process.env.OLLAMA_BASE || "http://127.0.0.1:11434";

async function embed(text, model) {
  const res = await fetch(`${OLLAMA_BASE}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt: text }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.embedding;
}

/**
 * Augment a prompt with relevant context from the vector store.
 * @param {string} prompt - Original user prompt
 * @param {object} opts - { k, minScore, maxContextChars }
 * @returns {Promise<{ augmentedPrompt: string, chunksUsed: number }>}
 */
export async function augmentWithMemory(prompt, opts = {}) {
  const k = opts.k ?? 3;
  const minScore = opts.minScore ?? 0.35;
  const maxContextChars = opts.maxContextChars ?? 2000;

  try {
    const store = new VectorStore(MEMORY_STORE_PATH);
    await store.load();

    if (store.chunks.length === 0) {
      return { augmentedPrompt: prompt, chunksUsed: 0 };
    }

    const queryEmbedding = await embed(prompt.slice(0, 500), MEMORY_EMBED_MODEL);
    if (!queryEmbedding) {
      return { augmentedPrompt: prompt, chunksUsed: 0 };
    }

    const results = await store.search(queryEmbedding, k, { minScore });
    if (results.length === 0) {
      return { augmentedPrompt: prompt, chunksUsed: 0 };
    }

    // Build context block, respecting char budget
    let contextBlock = "";
    let used = 0;
    for (const r of results) {
      const entry = `[${r.chunk.source}] (score: ${r.score.toFixed(2)})\n${r.chunk.text}\n\n`;
      if (contextBlock.length + entry.length > maxContextChars) break;
      contextBlock += entry;
      used++;
    }

    const augmentedPrompt = [
      "=== RELEVANT CONTEXT FROM CODEBASE MEMORY ===",
      contextBlock.trim(),
      "=== END CONTEXT ===",
      "",
      prompt,
    ].join("\n");

    return { augmentedPrompt, chunksUsed: used };
  } catch {
    // Any failure → graceful degradation
    return { augmentedPrompt: prompt, chunksUsed: 0 };
  }
}
