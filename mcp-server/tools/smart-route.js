/**
 * smart_route — Auto-route tasks to best tool/chain.
 */
import { routeTask } from "../decision-router.js";

export const schema = {
  name: "smart_route",
  description:
    "Given a task description, automatically determines the best tool or chain to use.",
  inputSchema: {
    type: "object",
    properties: {
      task: { type: "string", description: "Natural language description of what needs to be done." },
    },
    required: ["task"],
  },
};

export async function handler(args, ctx) {
  const route = routeTask(args.task);
  return {
    content: [{
      type: "text",
      text: [
        `=== SMART ROUTE ===`,
        `Task: "${args.task}"`,
        `Recommended: ${route.chain ? `run_chain('${route.chain}')` : route.tool}`,
        `Reason: ${route.reason}`,
        "",
        route.args ? `Suggested args: ${JSON.stringify(route.args, null, 2)}` : "",
      ].join("\n"),
    }],
  };
}
