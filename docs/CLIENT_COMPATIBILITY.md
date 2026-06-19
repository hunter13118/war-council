# War Council — Client Compatibility Matrix

The MCP server is pure `@modelcontextprotocol/sdk` over **stdio** (`mcp-server/server.js`),
so any MCP-spec client can drive the council. This matrix tracks per-client wiring,
caller-identity support, and fallback behavior.

| Capability | Cursor | Copilot (VS Code) | Cline | Roo Code | Claude Code | Claude Desktop | Gemini CLI | Antigravity | Windsurf |
|---|---|---|---|---|---|---|---|---|---|
| MCP stdio connect | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Ready-made config (`integrations/`) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Auto-install via `init-workspace.js` | ✅ | ✅ | snippet | snippet | ✅ | snippet | ✅ | ✅ | snippet |
| Caller-aware handoff guidance | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Rules surface | `.cursor/rules` | `.github/copilot-instructions.md` + agents | AGENTS.md | AGENTS.md | AGENTS.md / CLAUDE.md | n/a | AGENTS.md / GEMINI.md | AGENTS.md | AGENTS.md |
| Sub-agent framework | — | ✅ `.github/agents/` (12) | — | — | — | — | — | — | — |
| Adherence git gates | ✅ | ✅ | ✅ | ✅ | ✅ | n/a | ✅ | ✅ | ✅ |

("snippet" = global config file; the bootstrap generates exact content into
`<repo>/.war-council/` and prints where to paste it, rather than silently editing
machine-global state.)

## The fallback contract (any client)

1. Client calls a council tool (`smart_route`, `coding_delivery`, `consult_*`, ...).
2. The council classifies the ship tier (`shared/ship-tier.js`):
   `council_ship` → local models own it; `hybrid_ship` → council applies a bounded
   core, caller finishes; `defer_to_caller` → council plans/verifies only.
3. Local escalation runs fast→specialist→reasoning→heavy with circuit breakers;
   cloud failover (Groq→Gemini→OpenRouter) when Ollama is saturated.
4. If guardrails trip, the tool returns a **CALLER_HANDOFF** block with guidance
   tailored to `WC_CALLER_CLIENT` — your model takes over with full council context.
5. `escalate_premium` is the explicit version of the same handoff.

## Standalone mode (no MCP client at all)

`node battle-log/server.js` → http://localhost:3737. Command Center chats directly
with the local arsenal; every other dashboard renders live SSE state. Degrades
gracefully when Ollama is down (`/health`).

## Caveats

- Tool-name truncation: some clients cap tool counts; the registry exposes 40 tools.
  Prefer `autoApprove`/allow-lists for the consult + memory staples.
- Cline config files must be UTF-8 **without BOM** (`docs/CLINE_SETUP.md`).
- `battle-log/server.js` imports `../mcp-server/shared/*` — keep the repo layout intact.
