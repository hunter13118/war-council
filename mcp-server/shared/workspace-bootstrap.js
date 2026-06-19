/**
 * Workspace vector store path for RAG retrieval.
 */
import { resolve } from "node:path";
import { getActiveWorkspace } from "./workspace-registry.js";
import { REPO_ROOT } from "./config.js";

/**
 * @returns {string}
 */
export function resolveVectorStorePath() {
  const active = getActiveWorkspace();
  if (active?.vectorStorePath) return active.vectorStorePath;
  return resolve(REPO_ROOT, ".cline-context", "vector-store.json");
}
