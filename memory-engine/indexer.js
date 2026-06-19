/**
 * memory-engine/indexer.js — Index repository files into the vector store.
 *
 * Walks source files, chunks them, embeds via Ollama, stores in VectorStore.
 */
import { readFile, readdir, stat } from "node:fs/promises";
import { join, extname, resolve } from "node:path";
import { VectorStore } from "./store.js";

const DEFAULT_STORE_PATH = ".cline-context/vector-store.json";
const DEFAULT_EMBED_MODEL = "nomic-embed-text";
const OLLAMA_BASE = process.env.OLLAMA_BASE || "http://127.0.0.1:11434";

const INDEXABLE_EXTS = new Set([".js", ".ts", ".md", ".json", ".py", ".html", ".css"]);
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".cline-context", ".war-council"]);
// Lockfiles/minified/generated files are huge and semantically worthless for RAG —
// indexing them once produced ~9k junk chunks (a >100MB store) and crushed dashboard perf.
const SKIP_FILES = new Set([
  "package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml",
  "composer.lock", "Cargo.lock", "poetry.lock", "Gemfile.lock", "uv.lock",
]);
const SKIP_FILE_PATTERNS = [/\.min\.(js|css)$/i, /\.map$/i, /\.d\.ts$/i];

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

/** Split text into overlapping chunks */
function chunkText(text, chunkSize = 500, overlap = 50) {
  const lines = text.split("\n");
  const chunks = [];
  let current = [];
  let currentLen = 0;

  for (const line of lines) {
    current.push(line);
    currentLen += line.length + 1;
    if (currentLen >= chunkSize) {
      chunks.push(current.join("\n"));
      // Keep last `overlap` chars worth of lines
      const overlapLines = [];
      let oLen = 0;
      for (let i = current.length - 1; i >= 0 && oLen < overlap; i--) {
        overlapLines.unshift(current[i]);
        oLen += current[i].length + 1;
      }
      current = overlapLines;
      currentLen = oLen;
    }
  }
  if (current.length > 0) chunks.push(current.join("\n"));
  return chunks;
}

/** Recursively collect indexable files */
async function walkDir(dir) {
  const files = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkDir(full)));
    } else if (
      INDEXABLE_EXTS.has(extname(entry.name)) &&
      !SKIP_FILES.has(entry.name) &&
      !SKIP_FILE_PATTERNS.some((re) => re.test(entry.name))
    ) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Index repository files into the vector store.
 * @param {object} opts - { rootDir, storePath, embedModel, chunkSize, chunkOverlap, onProgress }
 * @returns {Promise<object>} - indexing result summary
 */
export async function indexRepo(opts = {}) {
  const rootDir = opts.rootDir ?? process.cwd();
  const storePath = opts.storePath ?? resolve(rootDir, DEFAULT_STORE_PATH);
  const model = opts.embedModel ?? DEFAULT_EMBED_MODEL;
  const chunkSize = opts.chunkSize ?? 500;
  const chunkOverlap = opts.chunkOverlap ?? 50;
  const onProgress = opts.onProgress ?? (() => {});

  const store = new VectorStore(storePath);
  await store.load();

  // Re-index REPLACES by default. store.add() appends blindly, so the old
  // load-then-add behavior duplicated the entire store on every /reindex.
  // Pass { append: true } for incremental adds.
  if (!opts.append && store.chunks.length > 0) {
    onProgress({ phase: "scanning", message: `Clearing ${store.chunks.length} existing chunks (full re-index)` });
    store.chunks = [];
    store._indexDirty = true;
  }

  onProgress({ phase: "scanning", message: "Walking directory tree..." });
  const files = await walkDir(rootDir);
  onProgress({ phase: "scanning", message: `Found ${files.length} indexable files` });

  let filesProcessed = 0;
  let chunksCreated = 0;
  let skipped = 0;
  const errors = [];

  for (const filePath of files) {
    try {
      const content = await readFile(filePath, "utf-8");
      if (content.length < 10) { skipped++; continue; }

      const chunks = chunkText(content, chunkSize, chunkOverlap);
      const embeddedChunks = [];

      for (const text of chunks) {
        const embedding = await embed(text, model);
        embeddedChunks.push({
          text,
          embedding,
          source: filePath.replace(rootDir, "").replace(/\\/g, "/"),
          tokenCount: Math.ceil(text.length / 4), // rough estimate
        });
      }

      await store.add(embeddedChunks);
      chunksCreated += embeddedChunks.length;
      filesProcessed++;
      onProgress({ phase: "indexing", message: `Indexed ${filePath}`, filesProcessed, total: files.length });
    } catch (e) {
      errors.push({ file: filePath, error: e.message });
    }
  }

  await store.save();
  onProgress({ phase: "done", message: `Indexed ${filesProcessed} files, ${chunksCreated} chunks` });

  return { filesProcessed, chunksCreated, skipped, errors, stub: false };
}

export { chunkText, walkDir };

