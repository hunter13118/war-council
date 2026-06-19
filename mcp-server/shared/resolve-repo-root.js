/**
 * Resolve apply/ship REPO_ROOT — explicit arg > registry active > env REPO_ROOT.
 */
import { REPO_ROOT } from "./config.js";
import { getActiveWorkspace } from "./workspace-registry.js";

/**
 * @param {string} [explicit]
 * @returns {string}
 */
export function resolveActiveRepoRoot(explicit) {
  if (explicit && String(explicit).trim()) return explicit;
  const active = getActiveWorkspace();
  if (active?.path) return active.path;
  return REPO_ROOT;
}
