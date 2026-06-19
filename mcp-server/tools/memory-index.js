/**
 * memory_index — Re-index repository code into vector store.
 */
import { resolve, parse } from "node:path";
import { existsSync, statSync } from "node:fs";
import { MEMORY_STORE_PATH, MEMORY_EMBED_MODEL, REPO_ROOT } from "../shared/config.js";
import { indexRepo } from "../../memory-engine/indexer.js";

/**
 * Guard caller-supplied roots: must exist, be a directory, and not be a
 * filesystem/drive root (indexing C:\ or / is never intentional).
 * Override with WC_ALLOW_ANY_INDEX_ROOT=1.
 */
function validateIndexRoot(raw) {
  const root = resolve(raw);
  if (!existsSync(root)) return { error: `Index root does not exist: ${root}` };
  if (!statSync(root).isDirectory()) return { error: `Index root is not a directory: ${root}` };
  const { root: fsRoot } = parse(root);
  if (root === fsRoot && process.env.WC_ALLOW_ANY_INDEX_ROOT !== "1") {
    return { error: `Refusing to index a filesystem root (${root}). Pass a project directory, or set WC_ALLOW_ANY_INDEX_ROOT=1.` };
  }
  return { root };
}

export const schema = {
  name: "memory_index",
  description:
    "Re-index the repository CODE into the Sovereign Memory vector store. Idempotent.",
  inputSchema: {
    type: "object",
    properties: {
      root: { type: "string", description: "Directory to index. Default: REPO_ROOT." },
      chunk_size: { type: "number", description: "Default 500." },
      chunk_overlap: { type: "number", description: "Default 50." },
      embed_model: { type: "string", description: "Default 'nomic-embed-text'." },
    },
  },
};

export async function handler(args, ctx) {
  let rootDir = REPO_ROOT;
  if (args.root) {
    const check = validateIndexRoot(args.root);
    if (check.error) {
      return { content: [{ type: "text", text: `=== MEMORY_INDEX REFUSED ===\n${check.error}` }], isError: true };
    }
    rootDir = check.root;
  }
  const lines = [];
  const result = await indexRepo({
    rootDir,
    storePath: MEMORY_STORE_PATH,
    embedModel: args.embed_model ?? MEMORY_EMBED_MODEL,
    chunkSize: args.chunk_size ?? 500,
    chunkOverlap: args.chunk_overlap ?? 50,
    onProgress: (p) => {
      if (p.phase !== "embed_progress") lines.push(`  [${p.phase}] ${p.message ?? ""}`);
    },
  });
  return {
    content: [{
      type: "text",
      text: ["=== MEMORY_INDEX COMPLETE ===", ...lines, "", "Result:", JSON.stringify(result, null, 2)].join("\n"),
    }],
  };
}
