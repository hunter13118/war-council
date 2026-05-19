# Tool Plugins

Each `.js` file in this directory is a self-contained MCP tool plugin.

## Adding a New Tool

1. Create a new file, e.g. `my-tool.js`
2. Export `schema` (MCP tool definition) and `handler` (async function):

```js
/**
 * my_tool — Brief description of what it does.
 */
import { ARSENAL } from "../shared/config.js";
import { ollamaGenerateWithRetry } from "../shared/ollama.js";

export const schema = {
  name: "my_tool",
  description: "What this tool does (shown to the model).",
  inputSchema: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "Input description." },
    },
    required: ["prompt"],
  },
};

export async function handler(args, ctx) {
  // args = parsed input from the model
  // ctx  = shared context { __dirname }
  const result = await ollamaGenerateWithRetry(ARSENAL.fast, args.prompt);
  return {
    content: [{ type: "text", text: result.text }],
    // Optional: _meta gets emitted in battle events then stripped
    _meta: { model: ARSENAL.fast, tokensOut: result.tokensOut },
  };
}
```

3. Restart the MCP server — the tool auto-registers. No wiring needed.

## Shared Utilities (../shared/)

| Module | Exports |
|---|---|
| `config.js` | `ARSENAL`, `OLLAMA_BASE`, `REPO_ROOT`, `MEMORY_STORE_PATH`, env vars |
| `ollama.js` | `ollamaGenerate`, `ollamaGenerateWithRetry`, `ollamaLoad`, `ollamaVisualize`, `listLocalModels`, `formatConsultResult` |
| `cloud.js` | `geminiGenerate`, `groqGenerate`, `strategicPlan`, `rapidFanOut` |
| `battle-events.js` | `emitBattleEvent`, `battleLogListeners` |
| `commands.js` | `runCommand` (safe subprocess execution) |
| `retry.js` | `withRetry` (exponential backoff wrapper) |

## Conventions

- Tool name in schema uses `snake_case`
- File name uses `kebab-case` (matching the tool name with hyphens)
- Handler returns `{ content: [...] }` per MCP spec
- Use `_meta` object for battle event metadata (auto-stripped before MCP response)
- Errors: either `throw` (caught by registry middleware) or return `{ isError: true, content: [...] }`
