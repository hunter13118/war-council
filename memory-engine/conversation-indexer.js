/**
 * memory-engine/conversation-indexer.js — Index conversation JSONL logs into vector store.
 *
 * Reads .cline-context/*.jsonl files, chunks by turn, embeds via Ollama, stores.
 */
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
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
 * Index conversation logs into the vector store.
 * Reads JSONL files, extracts message content, chunks and embeds.
 * @param {object} opts - { logDir, storePath, embedModel, chunkSize, daysBack, onProgress }
 * @returns {Promise<object>} - indexing result summary
 */
export async function indexConversations(opts = {}) {
  const logDir = opts.logDir ?? resolve(process.cwd(), ".cline-context");
  const storePath = opts.storePath ?? resolve(logDir, "vector-store.json");
  const model = opts.embedModel ?? DEFAULT_EMBED_MODEL;
  const maxCharsPerChunk = opts.chunkSize ?? 1000;
  const onProgress = opts.onProgress ?? (() => {});

  const store = new VectorStore(storePath);
  await store.load();

  let files;
  try {
    const entries = await readdir(logDir);
    files = entries.filter(f => f.endsWith(".jsonl"));
  } catch (e) {
    if (e.code === "ENOENT") {
      onProgress({ phase: "skip", message: "Log directory not found" });
      return { conversationsProcessed: 0, chunksCreated: 0, skipped: 0, errors: [] };
    }
    throw e;
  }

  // Filter by daysBack if specified
  const cutoff = opts.daysBack ? Date.now() - opts.daysBack * 86400000 : 0;
  let conversationsProcessed = 0;
  let chunksCreated = 0;
  let skipped = 0;
  const errors = [];

  for (const file of files) {
    try {
      const raw = await readFile(join(logDir, file), "utf-8");
      const lines = raw.split("\n").filter(Boolean);

      // Group content into chunks
      let currentChunk = "";
      const chunks = [];

      for (const line of lines) {
        let entry;
        try { entry = JSON.parse(line); } catch { continue; }

        // Skip old entries
        if (cutoff && entry.timestamp && new Date(entry.timestamp).getTime() < cutoff) {
          continue;
        }

        const content = entry.message || entry.text || entry.content || JSON.stringify(entry);
        currentChunk += content + "\n";

        if (currentChunk.length >= maxCharsPerChunk) {
          chunks.push(currentChunk.trim());
          currentChunk = "";
        }
      }
      if (currentChunk.trim()) chunks.push(currentChunk.trim());

      if (chunks.length === 0) { skipped++; continue; }

      // Embed and store
      for (const text of chunks) {
        const embedding = await embed(text, model);
        await store.add([{
          text,
          embedding,
          source: `conversation:${file}`,
          tokenCount: Math.ceil(text.length / 4),
        }]);
        chunksCreated++;
      }

      conversationsProcessed++;
      onProgress({ phase: "indexing", message: `Indexed ${file}`, conversationsProcessed });
    } catch (e) {
      errors.push({ file, error: e.message });
    }
  }

  await store.save();
  onProgress({ phase: "done", message: `Indexed ${conversationsProcessed} conversations, ${chunksCreated} chunks` });

  return { conversationsProcessed, chunksCreated, skipped, errors, stub: false };
}

