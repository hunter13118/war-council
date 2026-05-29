/**
 * register_workspace — Auto-register and index a workspace on first use.
 *
 * This is the FIRST tool an IDE agent should call when connecting to War Council
 * from a new repository. It:
 *   1. Registers the workspace in the workspace registry
 *   2. Switches to it as active
 *   3. Triggers a vector index if not already indexed (async)
 *   4. Returns the workspace status
 *
 * If already registered, just switches context (idempotent).
 */
import { resolve } from "node:path";
import { initRegistry, registerWorkspace, switchWorkspace, getActiveWorkspace, listWorkspaces, updateWorkspace } from "../shared/workspace-registry.js";
import { REPO_ROOT } from "../shared/config.js";
import { indexRepo } from "../../memory-engine/indexer.js";
import { existsSync } from "node:fs";

export const schema = {
  name: "register_workspace",
  description:
    "Register the current workspace with War Council. Call this FIRST when starting work on a repo. " +
    "Idempotent — safe to call every time. Auto-indexes on first use. " +
    "After calling this, memory_query will search THIS repo's code.",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Absolute path to the workspace root. Defaults to REPO_ROOT env var.",
      },
      name: {
        type: "string",
        description: "Human-readable name for this workspace.",
      },
      force_reindex: {
        type: "boolean",
        description: "Force re-indexing even if already indexed. Default false.",
      },
    },
  },
};

export async function handler(args, ctx) {
  await initRegistry(REPO_ROOT);

  const wsPath = args.path || process.env.REPO_ROOT || REPO_ROOT;
  const wsName = args.name || wsPath.split(/[\\/]/).pop();
  const id = wsPath.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').toLowerCase().slice(0, 60);

  // Check if already registered
  const existing = listWorkspaces().find(ws => ws.id === id);
  let ws;

  if (existing) {
    // Already registered — just switch to it
    ws = switchWorkspace(id);
  } else {
    // Register new workspace
    try {
      ws = await registerWorkspace({ path: wsPath, name: wsName });
      switchWorkspace(ws.id);
    } catch (e) {
      return {
        content: [{ type: "text", text: `Failed to register workspace: ${e.message}` }],
        isError: true,
      };
    }
  }

  // Check if vector store exists
  const vectorStorePath = ws.vectorStorePath || resolve(wsPath, '.cline-context', 'vector-store.json');
  const needsIndex = !existsSync(vectorStorePath) || args.force_reindex;

  let indexStatus = "already indexed";
  if (needsIndex) {
    try {
      const result = await indexRepo({
        rootDir: wsPath,
        storePath: vectorStorePath,
        chunkSize: 500,
        chunkOverlap: 50,
      });
      indexStatus = `indexed ${result.chunks || 0} chunks from ${result.files || 0} files`;
      // Update workspace metadata
      if (updateWorkspace) {
        await updateWorkspace(ws.id, { lastIndexedAt: new Date().toISOString(), chunks: result.chunks || 0 });
      }
    } catch (e) {
      indexStatus = `index failed: ${e.message}`;
    }
  }

  const active = getActiveWorkspace();
  const allWorkspaces = listWorkspaces();

  return {
    content: [{
      type: "text",
      text: [
        `=== WORKSPACE REGISTERED ===`,
        `Active: [${active.id}] ${active.name}`,
        `Path: ${active.path}`,
        `Vector store: ${indexStatus}`,
        ``,
        `memory_query will now search THIS workspace's code.`,
        `Total workspaces registered: ${allWorkspaces.length}`,
        ``,
        `REMINDER: Call memory_query before reading files. It's free and instant.`,
      ].join("\n"),
    }],
  };
}
