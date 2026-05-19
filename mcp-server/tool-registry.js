/**
 * Tool Registry — auto-discovers tool plugins from the tools/ directory.
 *
 * Each tool file exports:
 *   schema  — MCP tool schema object { name, description, inputSchema }
 *   handler — async (args, ctx) => MCP content response
 *
 * The registry provides:
 *   - Auto-discovery via filesystem glob
 *   - Shared context injection (ctx object with all shared utilities)
 *   - Middleware: timing, battle event emission, error wrapping
 *   - Lazy loading option for large tool sets
 */
import { readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname } from "node:path";
import { emitBattleEvent } from "./shared/battle-events.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class ToolRegistry {
  constructor() {
    this.tools = new Map(); // name → { schema, handler }
  }

  /**
   * Register a single tool manually.
   */
  register(schema, handler) {
    if (this.tools.has(schema.name)) {
      throw new Error(`Duplicate tool registration: '${schema.name}'`);
    }
    this.tools.set(schema.name, { schema, handler });
  }

  /**
   * Auto-discover and load all tool files from a directory.
   * Each file must export { schema, handler }.
   */
  async discover(toolsDir) {
    const entries = await readdir(toolsDir, { withFileTypes: true });
    const jsFiles = entries
      .filter((e) => e.isFile() && e.name.endsWith(".js"))
      .map((e) => e.name);

    for (const file of jsFiles) {
      const fullPath = resolve(toolsDir, file);
      const fileUrl = pathToFileURL(fullPath).href;
      const mod = await import(fileUrl);

      if (!mod.schema || !mod.handler) {
        process.stderr.write(
          `[war-council] WARN: ${file} missing schema or handler export, skipping.\n`
        );
        continue;
      }

      this.register(mod.schema, mod.handler);
    }

    process.stderr.write(
      `[war-council] Loaded ${this.tools.size} tools from ${toolsDir}\n`
    );
  }

  /**
   * Get all tool schemas for ListToolsRequestSchema response.
   */
  listSchemas() {
    return Array.from(this.tools.values()).map((t) => t.schema);
  }

  /**
   * Execute a tool by name with middleware (timing + battle events + error handling).
   */
  async execute(name, args, ctx) {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }

    const callStart = Date.now();

    emitBattleEvent({
      type: "tool_start",
      tool: name,
      args: Object.keys(args || {}),
      preview: JSON.stringify(args || {}).slice(0, 200),
    });

    try {
      const result = await tool.handler(args, ctx);

      emitBattleEvent({
        type: "tool_complete",
        tool: name,
        durationMs: Date.now() - callStart,
        ...(result._meta || {}),
      });

      // Strip internal _meta before returning to MCP
      if (result._meta) delete result._meta;
      return result;
    } catch (e) {
      emitBattleEvent({
        type: "tool_error",
        tool: name,
        error: e.message,
        durationMs: Date.now() - callStart,
      });
      return {
        content: [{ type: "text", text: `Tool '${name}' failed: ${e.message}` }],
        isError: true,
      };
    }
  }

  /**
   * Check if a tool exists.
   */
  has(name) {
    return this.tools.has(name);
  }

  /**
   * Get tool count.
   */
  get size() {
    return this.tools.size;
  }
}
