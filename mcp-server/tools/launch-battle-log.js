/**
 * launch_battle_log — Launch the real-time dashboard.
 */
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { emitBattleEvent } from "../shared/battle-events.js";

export const schema = {
  name: "launch_battle_log",
  description: "Launch the Battle Log dashboard in the default browser.",
  inputSchema: { type: "object", properties: {} },
};

export async function handler(args, ctx) {
  const dashboardScript = resolve(ctx.__dirname, "..", "battle-log", "server.js");
  const child = spawn("node", [dashboardScript], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
  child.unref();
  await new Promise((r) => setTimeout(r, 1500));
  const openCmd = process.platform === "win32" ? "start" : process.platform === "darwin" ? "open" : "xdg-open";
  spawn(openCmd, ["http://localhost:3737"], { shell: true, detached: true, stdio: "ignore" }).unref();
  emitBattleEvent({ type: "system", tool: "battle_log", preview: "Dashboard launched at http://localhost:3737" });
  return {
    content: [{
      type: "text",
      text: "⚔️ Battle Log dashboard launched at http://localhost:3737\nOpen your browser to watch the war unfold in real-time.",
    }],
  };
}
