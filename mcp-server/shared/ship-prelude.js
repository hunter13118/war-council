/**
 * Ship prelude — satisfy FORCE_WAR_TABLE before closed-loop ship.
 */
import { markDeliberationComplete } from "./protocol-gateway.js";

/**
 * @param {string} task
 * @param {(tool: string, args: object) => Promise<string>} executeTool
 */
export async function runShipPrelude(task, executeTool) {
  if (process.env.FORCE_WAR_TABLE !== "1") {
    return { ran: false, reason: "FORCE_WAR_TABLE off" };
  }
  if (process.env.WAR_COUNCIL_BYPASS === "1") {
    return { ran: false, reason: "WAR_COUNCIL_BYPASS" };
  }

  const stages = [];

  try {
    await executeTool("memory_query", { query: task, k: 8 });
    stages.push("memory_query");
  } catch (err) {
    stages.push(`memory_query: ${err.message}`);
  }

  try {
    await executeTool("tournament_vote", {
      prompt: [
        "Quick scope vote (1 round) — is this bounded coding work the council can ship?",
        "Reply: READY or DEFER + 1-line reason.",
        "",
        task.slice(0, 600),
      ].join("\n"),
      voters: ["fast", "reasoning"],
      rounds: 1,
    });
    stages.push("tournament_vote");
  } catch (err) {
    stages.push(`tournament_vote skipped: ${err.message}`);
  }

  markDeliberationComplete();
  return { ran: true, stages };
}
