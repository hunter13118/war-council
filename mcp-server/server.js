#!/usr/bin/env node
/**
 * war-council MCP server — Plugin Architecture
 *
 * Cloud API keys: loaded from D:/war-council/.env via shared/config.js (load-env).
 *
 * Exposes model-delegation + agentic tools for a local Ollama Conductor pattern.
 * Tools are auto-discovered from the tools/ directory via the ToolRegistry.
 *
 * Transport: stdio (Cline / Claude Desktop spec compliant).
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { ToolRegistry } from "./tool-registry.js";
import { OLLAMA_BASE, arsenalConfig } from "./shared/config.js";
import { emitBattleEvent } from "./shared/battle-events.js";
import { BATTLE_LOG_PATH } from "./shared/config.js";
import { initTelemetry } from "./shared/telemetry.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Shared context passed to every tool handler
const ctx = { __dirname };

// Export for dashboard server to import
export { BATTLE_LOG_PATH };

// ===== Initialize Telemetry =====
initTelemetry(resolve(__dirname, '..', '.cline-context'));

// ===== Registry Setup =====
const registry = new ToolRegistry();
await registry.discover(resolve(__dirname, "tools"));

// ===== MCP Server =====
const server = new Server(
  { name: "war-council", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: registry.listSchemas(),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  return registry.execute(name, args || {}, ctx);
});

// Silent healthcheck — Cursor treats any stderr as an MCP error in the UI.
async function healthcheck() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${OLLAMA_BASE}/api/version`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

await healthcheck();

const transport = new StdioServerTransport();
await server.connect(transport);
// Keep process alive — MCP server runs until parent closes stdio.
