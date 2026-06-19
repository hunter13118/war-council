/**
 * conductor_prelude — FORCE_WAR_TABLE entry: route + RAG + tournament + report.
 */
import { routeTask } from "../decision-router.js";
import { markSmartRoute, markDeliberationComplete } from "../shared/protocol-gateway.js";
import { createChainToolExecutor } from "../shared/chain-tool-registry.js";
import { handler as smartRouteHandler } from "./smart-route.js";
import { handler as reportActionHandler } from "./report-action.js";

export const schema = {
  name: "conductor_prelude",
  description:
    "Mandatory War Table prelude when FORCE_WAR_TABLE=1: smart_route + memory_query + tournament_vote + report_action.",
  inputSchema: {
    type: "object",
    properties: {
      task: { type: "string", description: "User message verbatim." },
      skip_tournament: { type: "boolean", description: "Skip tournament (hotfix only)." },
    },
    required: ["task"],
  },
};

export async function handler(args, ctx) {
  const task = args.task?.trim();
  if (!task) {
    return {
      content: [{ type: "text", text: "conductor_prelude requires `task`." }],
      isError: true,
    };
  }

  const route = routeTask(task);
  markSmartRoute(route, task);
  const executeTool = createChainToolExecutor(ctx);
  const sections = [];

  const routeRes = await smartRouteHandler({ task }, ctx);
  sections.push(routeRes.content?.[0]?.text ?? "");

  try {
    const rag = await executeTool("memory_query", { query: task, k: 8 });
    sections.push("=== MEMORY ===", rag.slice(0, 2000));
  } catch (err) {
    sections.push(`memory_query skipped: ${err.message}`);
  }

  if (!args.skip_tournament) {
    try {
      const vote = await executeTool("tournament_vote", {
        prompt: `Scope vote for:\n${task.slice(0, 600)}\n\nREADY or DEFER + risks.`,
        voters: ["fast", "specialist", "reasoning"],
        rounds: process.env.FORCE_WAR_TABLE === "1" ? 2 : 1,
      });
      sections.push("=== TOURNAMENT ===", vote.slice(0, 2500));
    } catch (err) {
      sections.push(`tournament_vote skipped: ${err.message}`);
    }
  }

  markDeliberationComplete();

  await reportActionHandler(
    {
      action: `conductor_prelude: ${task.slice(0, 120)}`,
      outcome: "success",
    },
    ctx,
  );

  const next = route.tool === "coding_delivery"
    ? "NEXT: coding_delivery({ phase: 'ship', task })"
    : `NEXT: ${route.chain ? `run_chain('${route.chain}')` : route.tool}`;

  return {
    content: [{
      type: "text",
      text: [
        "=== CONDUCTOR_PRELUDE ✅ ===",
        `FORCE_WAR_TABLE: ${process.env.FORCE_WAR_TABLE === "1" ? "on" : "off"}`,
        "",
        ...sections,
        "",
        "---",
        next,
      ].join("\n"),
    }],
    _meta: { route, deliberationComplete: true },
  };
}
