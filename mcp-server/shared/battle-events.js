/**
 * Battle Log event system — emits structured events for the dashboard.
 */
import { appendFile } from "node:fs/promises";
import { BATTLE_LOG_PATH } from "./config.js";

export const battleLogListeners = new Set();

export async function emitBattleEvent(event) {
  const entry = {
    ...event,
    timestamp: new Date().toISOString(),
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  };
  try {
    await appendFile(BATTLE_LOG_PATH, JSON.stringify(entry) + "\n");
  } catch {}
  const data = `data: ${JSON.stringify(entry)}\n\n`;
  for (const listener of battleLogListeners) {
    try { listener.write(data); } catch { battleLogListeners.delete(listener); }
  }
}
