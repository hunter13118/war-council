# Wiring war-council MCP into Roo Code (preferred) or Cline

The `war-council` MCP server gives the Conductor model delegation tools
to invoke other local/cloud models without swapping the active model in the UI.

**Current capabilities:** 30 tools, auto-instrumented with circuit breakers,
telemetry, and confidence scoring. See `docs/MCP_SERVER.md` for full tool list.

## Standalone protocol verification

Before wiring into any extension, prove the server speaks MCP correctly:

```powershell
cd tools/war-council
node test-mcp-client.js
```

Expected output:
- `[init] OK — server: war-council v0.1.0`
- `[tools/list] OK — 5 tools: consult_fast, consult_specialist, ...`
- `[list_arsenal call] OK — output: ...full arsenal listing...`

If this works, the server is good — any failure to detect it in an extension
is the extension's fault, not the server's.

## 1. Roo Code (recommended — JSON config still respected)

Roo Code reads MCP settings from
`%APPDATA%\Code\User\globalStorage\rooveterinaryinc.roo-cline\settings\mcp_settings.json`

Drop in this content:

```json
{
  "mcpServers": {
    "war-council": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": [
        "D:\\war-council\\mcp-server\\server.js"
      ],
      "env": {
        "OLLAMA_BASE": "http://127.0.0.1:11434"
      },
      "disabled": false,
      "alwaysAllow": [
        "consult_fast",
        "consult_specialist",
        "consult_reasoning",
        "tournament_vote",
        "list_arsenal"
      ]
    }
  }
}
```

Open the Roo Code panel → **MCP Servers** tab → war-council should appear
with a green dot. If red, click for error details.

## 2. Cline (v3.82+ — JSON config still works, but watch the BOM)

**CORRECTION:** Cline 3.82 still auto-loads
`%APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json`
via a file watcher. No window reload required.

**HOWEVER — the file MUST be UTF-8 WITHOUT BOM.** PowerShell's
`Set-Content -Encoding UTF8` writes a BOM by default. Cline's
`JSON.parse` rejects BOM-prefixed files with the error
*"Invalid MCP settings format. Please ensure your settings follow the
correct JSON format."* — which is misleading since the JSON itself is
valid.

To write the file safely from PowerShell, use:

```powershell
$p = "$env:APPDATA\Code\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json"
$json = '{ "mcpServers": { "war-council": { ... } } }'  # see schema below
[System.IO.File]::WriteAllText($p, $json, [System.Text.UTF8Encoding]::new($false))
```

The first byte must be `0x7B` (`{`), NOT `0xEF 0xBB 0xBF` (BOM).

**Cline 3.82 schema** (validated against extension source):

```json
{
  "mcpServers": {
    "war-council": {
      "type": "stdio",
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": ["D:\\war-council\\mcp-server\\server.js"],
      "env": { "OLLAMA_BASE": "http://127.0.0.1:11434" },
      "disabled": false,
      "timeout": 60,
      "autoApprove": [
        "consult_fast",
        "consult_specialist",
        "consult_reasoning",
        "tournament_vote",
        "list_arsenal"
      ]
    }
  }
}
```

**Schema gotchas:**
- Use `autoApprove` (NOT `alwaysAllow` — that field is from older Cline versions and now silently rejected by zod validator)
- `transportType` is legacy; use `type: "stdio"` instead
- `command` is required, must be absolute path on Windows for reliability

Cline ⚙ → **Model** → **`qwen2.5-coder:32b`** (the heavyweight). This is
the only model you talk to directly. It will call the MCP tools to delegate.

## 4. Steer the Conductor with a custom instruction

Cline ⚙ → **Custom Instructions** → paste:

> You have access to the **war-council** MCP server, which exposes delegation
> tools that invoke other local models:
>
> - `consult_fast` → fast worker (qwen2.5-coder:7b, ~200 tok/s). Use for
>   simple lookups, short summaries, well-defined transforms.
> - `consult_specialist` → balanced model (qwen2.5-coder:14b). Use for code
>   generation, mid-complexity refactors.
> - `consult_reasoning` → reasoning specialist (deepseek-r1:14b). Use for
>   tricky bugs, architectural decisions, debugging.
> - `tournament_vote` → fan out the same prompt to multiple models in
>   parallel for diverse perspectives. Use for important architectural
>   decisions where you want a second opinion.
> - `list_arsenal` → list available local models.
>
> **Delegation policy:** for any sub-task that takes < 5 sentences to fully
> describe and is well-bounded, prefer `consult_fast` over doing it yourself.
> For ambiguous architectural decisions, run a `tournament_vote` with at least
> two voters before choosing. You synthesize the final answer; the worker
> outputs are raw input for your reasoning.

## 5. Test the loop

In Cline chat, fire a task that NATURALLY benefits from delegation:

> *"Look at `mcp-server/task-chains.js`. There's a function `executeChain`. I want to know if the context budget truncation is correct and whether there are edge cases. Use whatever tools you need including delegation."*

Watch for: Conductor reads the file, then calls `consult_reasoning` with the
extracted code, gets a chain-of-thought analysis back, synthesizes a final
answer for you. **One conversation, multiple models, you only see the final
synthesis.**

## Troubleshooting

- **MCP server doesn't show in Cline:** check the Cline output panel for
  startup errors. Most common: wrong path in `args`, or `node` not on PATH
  for the spawned process.
- **Tool calls fail with "Ollama HTTP 500":** the model isn't pulled yet.
  Run `ollama list` to verify.
- **Conductor refuses to delegate:** strengthen the custom instruction with
  a concrete example: "Example: if I ask you to refactor a 5-line function,
  delegate to consult_fast. If I ask you to design a new architecture,
  tournament_vote between specialist and reasoning."
- **Slow tool responses:** first call to a model loads it into VRAM (cold).
  After that, `OLLAMA_KEEP_ALIVE=30m` keeps it hot. Subsequent calls are
  warm-path fast (200-500 tok/s).
- **Circuit breaker tripped:** if a model is failing repeatedly, its breaker
  opens and the system auto-routes to a fallback. Check `/breakers` endpoint
  or the Metrics HUD at `/metrics-hud`.

## Dashboard

The Battle Log server also provides:

- **Command Center** (`/command-center`) — Chat UI with smart routing, tournaments, file drag-drop
- **Metrics HUD** (`/metrics-hud`) — Live telemetry, latency bars, breaker states, DAG executions
- **Showcase** (`/showcase`) — Scroll-driven animated portfolio page

Start the server: `node battle-log/server.js --port 3737`
