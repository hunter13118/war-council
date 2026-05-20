/**
 * switch_workspace — Switch the active workspace for RAG retrieval.
 */
import { initRegistry, switchWorkspace, listWorkspaces, getActiveWorkspace } from "../shared/workspace-registry.js";
import { REPO_ROOT } from "../shared/config.js";

export const schema = {
  name: "switch_workspace",
  description:
    "List registered workspaces or switch the active one. " +
    "The active workspace determines which vector store is used for RAG context in consult tools.",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["list", "switch", "active"],
        description: "list = show all workspaces, switch = change active, active = show current.",
      },
      workspaceId: {
        type: "string",
        description: "Required for 'switch' action. The workspace ID to activate.",
      },
    },
    required: ["action"],
  },
};

export async function handler(args, ctx) {
  // Ensure registry is initialized
  await initRegistry(REPO_ROOT);

  if (args.action === "list") {
    const workspaces = listWorkspaces();
    if (workspaces.length === 0) {
      return { content: [{ type: "text", text: "No workspaces registered. Use the dashboard to register workspaces." }] };
    }
    const active = getActiveWorkspace();
    const lines = workspaces.map(ws =>
      `${ws.id === active?.id ? '→ ' : '  '}[${ws.id}] ${ws.name || ws.path}`
    );
    return { content: [{ type: "text", text: `=== WORKSPACES ===\n${lines.join('\n')}` }] };
  }

  if (args.action === "active") {
    const active = getActiveWorkspace();
    if (!active) return { content: [{ type: "text", text: "No active workspace set." }] };
    return { content: [{ type: "text", text: `Active: [${active.id}] ${active.name || active.path}` }] };
  }

  if (args.action === "switch") {
    if (!args.workspaceId) {
      return { content: [{ type: "text", text: "workspaceId required for switch action." }], isError: true };
    }
    try {
      const ws = switchWorkspace(args.workspaceId);
      return { content: [{ type: "text", text: `Switched to: [${ws.id}] ${ws.name || ws.path}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Failed: ${e.message}` }], isError: true };
    }
  }

  return { content: [{ type: "text", text: `Unknown action '${args.action}'. Use list|switch|active.` }], isError: true };
}
