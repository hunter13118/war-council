# ⚔️ Integrations — One Council, Every Client

Ready-made MCP configs for every major AI coding client. The `{{WAR_COUNCIL_ROOT}}`
and `{{WORKSPACE_ROOT}}` placeholders are filled automatically by the bootstrap:

```powershell
# From the war-council repo:
node scripts/init-workspace.js D:/path/to/your-repo            # auto-detect clients
node scripts/init-workspace.js D:/path/to/your-repo --client all
node scripts/init-workspace.js D:/path/to/your-repo --hooks    # + adherence git gates
```

Or use any template manually — replace the placeholders with absolute paths (forward slashes).

| Client | Template | Installs to | Notes |
|---|---|---|---|
| Cursor | `cursor/mcp.json` | `<repo>/.cursor/mcp.json` | + `.cursor/rules` copied |
| VS Code Copilot (agent mode) | `vscode/mcp.json` | `<repo>/.vscode/mcp.json` | + tasks/settings/extensions; pairs with `.github/agents/` |
| Cline / Roo Code | `cline/cline_mcp_settings.json` | global `cline_mcp_settings.json` | **UTF-8 without BOM!** Roo: set `WC_CALLER_CLIENT=roo` |
| Claude Code | `claude-code/mcp.json` | `<repo>/.mcp.json` | project-scope, commits cleanly |
| Claude Desktop | `claude-desktop/claude_desktop_config.snippet.json` | global Claude config | merge manually, restart app |
| Gemini CLI / Antigravity | `gemini/settings.json` | `<repo>/.gemini/settings.json` | Antigravity: `WC_CALLER_CLIENT=antigravity` |
| Windsurf | `windsurf/mcp_config.snippet.json` | `~/.codeium/windsurf/mcp_config.json` | refresh plugins in Cascade |

## Why `WC_CALLER_CLIENT` / `WC_CALLER_TIER` matter

The council's complexity-fallback tailors its CALLER_HANDOFF to whoever invoked it
(`mcp-server/shared/caller-context.js`). When a task exceeds local-model guardrails
(`shared/ship-tier.js`), the handoff tells *your specific client* how to take over —
Cursor gets "switch to Opus", Copilot gets "route through the Conductor agent",
Cline gets plan→act instructions. Set `WC_CALLER_TIER=cheap` if your client runs a
budget model and you want the council to keep more work local.

## Universal rules

`init-workspace.js` also writes **AGENTS.md** into the target repo (from `.cursor/rules`)
so agents that read AGENTS.md — Claude Code, Gemini CLI, Codex-style tools — get the
same operating rules Cursor does.
