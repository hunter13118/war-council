/**
 * Battle Log event system — writes structured events to JSONL for the dashboard.
 * 
 * Architecture: MCP server writes to JSONL only. The battle-log dashboard
 * (a separate HTTP server) watches the JSONL and broadcasts via SSE.
 * This keeps MCP server as a pure stdio process.
 */
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { BATTLE_LOG_PATH } from "./config.js";

export async function emitBattleEvent(event) {
  const entry = {
    ...event,
    timestamp: new Date().toISOString(),
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  };
  try {
    await mkdir(dirname(BATTLE_LOG_PATH), { recursive: true });
    await appendFile(BATTLE_LOG_PATH, JSON.stringify(entry) + "\n");
  } catch {}
}

// Legacy export — kept for backward compatibility, but no longer used.
export const battleLogListeners = new Set();
