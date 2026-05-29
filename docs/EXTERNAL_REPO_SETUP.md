# War Council — External Repo Connection Guide

## Quick Start (3 steps)

### 1. Copy MCP config to your repo

Create `.cursor/mcp.json` in your target repo:

```json
{
  "mcpServers": {
    "war-council": {
      "command": "node",
      "args": ["D:/war-council/mcp-server/server.js"],
      "env": {
        "OLLAMA_BASE": "http://127.0.0.1:11434",
        "NODE_OPTIONS": "--env-file=D:/war-council/.env",
        "REPO_ROOT": "D:/path/to/your-repo"
      }
    }
  }
}
```

**Change `REPO_ROOT` to your actual repo path.**

### 2. Copy the rules file

Copy `.cursor/rules` from war-council to your repo's `.cursor/rules`. This tells the agent HOW to use the tools.

### 3. First connection

When you open the repo in Cursor, the agent should call:
```
register_workspace(path="D:/path/to/your-repo")
```

This auto-indexes the repo into a vector store at `<your-repo>/.cline-context/vector-store.json` and makes `memory_query` search YOUR code.

---

## How it Works

```
Your Repo (.cursor/mcp.json)
    │
    │ stdio (MCP protocol)
    ▼
War Council MCP Server (D:/war-council/mcp-server/server.js)
    │
    ├─ memory_query    → searches YOUR repo's vector store
    ├─ consult_fast    → local 7b model (free)
    ├─ consult_specialist → local 14b (free)
    ├─ report_action   → dashboard visibility
    ├─ run_tests       → execute tests
    └─ 28 more tools...
    │
    ▼
Ollama (localhost:11434)
```

---

## Multi-Workspace

War Council supports multiple registered workspaces. Switch between them:

```
switch_workspace(action="list")     → see all registered repos
switch_workspace(action="switch", workspaceId="d-projects-my-app")
```

Each workspace has its own:
- Vector store (code index)
- Conversation history
- Settings

---

## Gitignore

Add to your repo's `.gitignore`:
```
.cline-context/
```

The vector store and other War Council artifacts live there.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| memory_query returns nothing | Run `register_workspace()` or `memory_index()` to trigger indexing |
| Wrong repo context | `switch_workspace(action="switch", workspaceId="...")` |
| Ollama not available | Make sure Ollama is running: `ollama serve` |
| Tools not showing in Cursor | Check `.cursor/mcp.json` path is correct, restart Cursor |
