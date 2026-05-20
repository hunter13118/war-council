/**
 * run_dag — Execute a DAG (directed acyclic graph) of tasks.
 */
import { validateDAG, executeDAG, getExecution, listExecutions } from "../shared/dag-engine.js";
import { ARSENAL } from "../shared/config.js";
import { ollamaGenerateWithRetry } from "../shared/ollama.js";

export const schema = {
  name: "run_dag",
  description:
    "Execute a multi-step task DAG (directed acyclic graph). " +
    "Nodes run in parallel where dependencies allow. " +
    "Returns execution ID immediately; poll with executionId to get results.",
  inputSchema: {
    type: "object",
    properties: {
      dag: {
        type: "object",
        description:
          "DAG definition: { id, name, entryNode, nodes: { nodeId: { id, type, config, dependencies } } }. " +
          "Node types: 'task', 'gate', 'merge'. Config should include { tier, args: { prompt } }.",
      },
      context: {
        type: "object",
        description: "Initial context object passed to all nodes.",
      },
      wait: {
        type: "boolean",
        description: "If true, wait for completion and return full trace. Default false (returns immediately).",
      },
    },
    required: ["dag"],
  },
};

export async function handler(args, ctx) {
  const { dag, context, wait } = args;
  if (!dag) throw new Error("dag definition required");

  const validation = validateDAG(dag);
  if (!validation.valid) {
    return {
      content: [{ type: "text", text: `Invalid DAG: ${validation.errors.join(', ')}` }],
      isError: true,
    };
  }

  // Task executor — routes each node to appropriate model tier
  const taskExecutor = async (node, nodeCtx, prevResults) => {
    const { tier, args: nodeArgs } = node.config || {};
    const prompt = nodeArgs?.prompt || nodeArgs?.query || JSON.stringify(nodeArgs || {});
    const model = ARSENAL[tier] || ARSENAL.specialist;

    const r = await ollamaGenerateWithRetry(model, prompt, { maxTokens: 2048 });
    return { text: r.text, model, tier: tier || 'specialist' };
  };

  const { id, promise } = executeDAG(dag, context || {}, taskExecutor);

  if (wait) {
    const trace = await promise;
    return {
      content: [{
        type: "text",
        text: [
          `=== DAG COMPLETE: ${dag.name || dag.id} ===`,
          `Execution: ${id}`,
          `Status: ${trace.status}`,
          `Nodes: ${Object.keys(trace.nodeResults || {}).length}`,
          "",
          ...Object.entries(trace.nodeResults || {}).map(([nodeId, result]) =>
            `[${nodeId}] ${result.text?.slice(0, 200) || '(no output)'}`
          ),
        ].join("\n"),
      }],
      _meta: { executionId: id, status: trace.status },
    };
  }

  return {
    content: [{
      type: "text",
      text: [
        `=== DAG LAUNCHED: ${dag.name || dag.id} ===`,
        `Execution ID: ${id}`,
        `Nodes: ${Object.keys(dag.nodes).length}`,
        `Status: running`,
        "",
        "Use executionId to poll status.",
      ].join("\n"),
    }],
    _meta: { executionId: id, status: 'running' },
  };
}
