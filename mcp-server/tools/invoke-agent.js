/**
 * invoke_agent — Load and run a sub-agent persona from .github/agents/.
 */
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { ARSENAL, REPO_ROOT } from "../shared/config.js";
import { ollamaGenerate, formatConsultResult } from "../shared/ollama.js";

export const schema = {
  name: "invoke_agent",
  description:
    "Load a persona definition from .github/agents/<name>.agent.md and run it on a worker model. " +
    "This unlocks the whole sub-agent roster without porting any of them. Returns the agent's response.",
  inputSchema: {
    type: "object",
    properties: {
      agent_name: {
        type: "string",
        description: "Name of the agent file (without .agent.md extension).",
      },
      task: {
        type: "string",
        description: "The specific task/question for this agent.",
      },
      tier: {
        type: "string",
        enum: ["fast", "specialist", "reasoning", "heavy"],
        description: "Which model tier runs this agent. Default 'specialist'.",
      },
      maxTokens: { type: "number", description: "Default 4096." },
    },
    required: ["agent_name", "task"],
  },
};

export async function handler(args, ctx) {
  const tier = args.tier ?? "specialist";
  const model = ARSENAL[tier];
  if (!model) {
    return {
      content: [{ type: "text", text: `Unknown tier '${tier}'. Use fast|specialist|reasoning|heavy.` }],
      isError: true,
    };
  }
  const agentPath = join(REPO_ROOT, ".github", "agents", `${args.agent_name}.agent.md`);
  let persona;
  try {
    persona = await readFile(agentPath, "utf-8");
  } catch (e) {
    return {
      content: [{ type: "text", text: `Could not read agent file at ${agentPath}: ${e.message}` }],
      isError: true,
    };
  }
  const fullPrompt = [
    "You are operating as the following sub-agent persona. Adhere to all its rules.",
    "",
    "===== AGENT PERSONA START =====",
    persona,
    "===== AGENT PERSONA END =====",
    "",
    "===== TASK =====",
    args.task,
    "",
    "Respond strictly within the persona's domain. If the task is outside your scope, say so.",
  ].join("\n");
  const r = await ollamaGenerate(model, fullPrompt, { maxTokens: args.maxTokens ?? 4096 });
  return {
    content: [{ type: "text", text: formatConsultResult(`AGENT[${args.agent_name}@${tier}]`, r) }],
  };
}
