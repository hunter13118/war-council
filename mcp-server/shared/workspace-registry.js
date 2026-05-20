/**
 * Workspace Registry — Multi-workspace management for the War Council.
 * 
 * The War Council is the brain; workspaces are the bodies it operates on.
 * Each workspace has its own vector store, conversation history, and config.
 * 
 * Persistence: workspace-registry.json in the War Council's own .cline-context/
 */

import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

let registryPath = null;
let workspaces = new Map(); // id → workspace config
let activeWorkspaceId = null;

/**
 * Initialize the workspace registry.
 * @param {string} warCouncilRoot - Root of the war-council repo itself
 */
export async function initRegistry(warCouncilRoot) {
  const dir = resolve(warCouncilRoot, '.cline-context');
  await mkdir(dir, { recursive: true });
  registryPath = resolve(dir, 'workspace-registry.json');
  workspaces = new Map();
  activeWorkspaceId = null;
  try {
    const data = JSON.parse(await readFile(registryPath, 'utf-8'));
    for (const ws of data.workspaces || []) {
      workspaces.set(ws.id, ws);
    }
    activeWorkspaceId = data.activeWorkspaceId || null;
  } catch {
    // Fresh install — no registry yet
  }
}

async function persist() {
  if (!registryPath) return;
  const data = {
    activeWorkspaceId,
    workspaces: [...workspaces.values()],
    updatedAt: new Date().toISOString(),
  };
  await writeFile(registryPath, JSON.stringify(data, null, 2));
}

/**
 * Register a new workspace.
 * @param {Object} opts
 * @param {string} opts.path - Absolute path to the workspace root
 * @param {string} [opts.name] - Human-readable name (defaults to directory name)
 * @returns {Object} The created workspace entry
 */
export async function registerWorkspace({ path: wsPath, name }) {
  // Validate path exists
  try { await stat(wsPath); } catch { throw new Error(`Path does not exist: ${wsPath}`); }

  const id = wsPath.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').toLowerCase().slice(0, 60);
  const dirName = wsPath.split(/[\\/]/).pop();

  const ws = {
    id,
    name: name || dirName,
    path: wsPath,
    vectorStorePath: resolve(wsPath, '.cline-context', 'vector-store.json'),
    conversationsDir: resolve(wsPath, '.cline-context', 'conversations'),
    registeredAt: new Date().toISOString(),
    lastIndexedAt: null,
    chunks: 0,
  };

  workspaces.set(id, ws);
  if (!activeWorkspaceId) activeWorkspaceId = id;
  await persist();
  return ws;
}

/**
 * Switch the active workspace.
 * @param {string} id - Workspace ID
 * @returns {Object} The now-active workspace
 */
export function switchWorkspace(id) {
  if (!workspaces.has(id)) throw new Error(`Unknown workspace: ${id}`);
  activeWorkspaceId = id;
  persist().catch(() => {});
  return workspaces.get(id);
}

/**
 * Get the active workspace config.
 * @returns {Object|null}
 */
export function getActiveWorkspace() {
  if (!activeWorkspaceId) return null;
  return workspaces.get(activeWorkspaceId) || null;
}

/**
 * List all registered workspaces.
 * @returns {Array}
 */
export function listWorkspaces() {
  return [...workspaces.values()].map(ws => ({
    ...ws,
    active: ws.id === activeWorkspaceId,
  }));
}

/**
 * Remove a workspace from the registry (does NOT delete files).
 * @param {string} id
 */
export async function removeWorkspace(id) {
  if (!workspaces.has(id)) throw new Error(`Unknown workspace: ${id}`);
  workspaces.delete(id);
  if (activeWorkspaceId === id) {
    activeWorkspaceId = workspaces.size > 0 ? workspaces.keys().next().value : null;
  }
  await persist();
}

/**
 * Update workspace metadata (e.g., after indexing).
 * @param {string} id
 * @param {Object} updates
 */
export async function updateWorkspace(id, updates) {
  const ws = workspaces.get(id);
  if (!ws) throw new Error(`Unknown workspace: ${id}`);
  Object.assign(ws, updates);
  workspaces.set(id, ws);
  await persist();
}

/**
 * Get workspace by ID.
 * @param {string} id
 * @returns {Object|null}
 */
export function getWorkspace(id) {
  return workspaces.get(id) || null;
}
