/**
 * run_chain — Execute pre-built multi-step task chains.
 */
import { resolve } from "node:path";
import { ARSENAL, REPO_ROOT, MEMORY_STORE_PATH, MEMORY_EMBED_MODEL } from "../shared/config.js";
import { ollamaGenerateWithRetry } from "../shared/ollama.js";
import { strategicPlan, rapidFanOut } from "../shared/cloud.js";
import { runCommand } from "../shared/commands.js";
import { retrieve } from "../../memory-engine/retriever.js";
import { CHAINS, executeChain } from "../task-chains.js";

export const schema = {
  name: "run_chain",
  description:
    "Execute a pre-built task chain (multi-step workflow). Available chains: " +
    Object.keys(CHAINS).join(", ") +
    ". Use smart_route first to find the best chain for your task.",
  inputSchema: {
    type: "object",
    properties: {
      chain: { type: "string", description: `Chain name. One of: ${Object.keys(CHAINS).join(", ")}` },
      inputs: { type: "object", description: "Key-value inputs required by the chain." },
    },
    required: ["chain", "inputs"],
  },
};

export async function handler(args, ctx) {
  const internalExecute = async (toolName, toolArgs) => {
    switch (toolName) {
      case "memory_query": {
        const r = await retrieve(toolArgs.query, {
          storePath: MEMORY_STORE_PATH, k: toolArgs.k ?? 5,
          embedModel: MEMORY_EMBED_MODEL, minRelevance: 0.30,
        });
        return r.chunks.map((c) => `[${c.file}:${c.startLine}] ${c.text}`).join("\n\n");
      }
      case "memory_recall_conversation": {
        const r = await retrieve(toolArgs.query, {
          storePath: MEMORY_STORE_PATH, k: toolArgs.k ?? 5,
          embedModel: MEMORY_EMBED_MODEL, source: "conversations",
        });
        return r.chunks.map((c) => `[${c.file}] ${c.text}`).join("\n\n");
      }
      case "consult_fast": {
        const r = await ollamaGenerateWithRetry(ARSENAL.fast, toolArgs.prompt, { maxTokens: toolArgs.maxTokens });
        return r.text;
      }
      case "consult_specialist": {
        const r = await ollamaGenerateWithRetry(ARSENAL.specialist, toolArgs.prompt, { maxTokens: toolArgs.maxTokens });
        return r.text;
      }
      case "consult_reasoning": {
        const r = await ollamaGenerateWithRetry(ARSENAL.reasoning, toolArgs.prompt, { maxTokens: toolArgs.maxTokens });
        return r.text;
      }
      case "strategic_plan": {
        const r = await strategicPlan(toolArgs.task, toolArgs.code_context, toolArgs);
        return r.text;
      }
      case "rapid_fan_out": {
        const r = await rapidFanOut(toolArgs.prompts, toolArgs);
        return r.results.map((x) => x.text).join("\n---\n");
      }
      case "run_tests": {
        const cmd = await runCommand("npm", ["run", toolArgs.suite === "all" ? "test" : `test:${toolArgs.suite}`], REPO_ROOT, toolArgs.timeout_ms ?? 300000);
        return cmd.exitCode === 0 ? "✅ ALL TESTS PASSED" : `❌ FAILED (exit ${cmd.exitCode})\n${(cmd.stdout + cmd.stderr).slice(-2000)}`;
      }
      default:
        return `(tool '${toolName}' not available in chain context)`;
    }
  };

  const chainResult = await executeChain(args.chain, args.inputs, internalExecute);

  const stepSummary = chainResult.steps.map((s) => {
    if (s.skipped) return `  ${s.label}: ⏭️ SKIPPED (${s.reason})`;
    if (s.error) return `  ${s.label}: ❌ FAILED (${s.error})`;
    const preview = (s.result || "").slice(0, 200);
    return `  ${s.label}: ✅ (${preview}${preview.length >= 200 ? "..." : ""})`;
  }).join("\n");

  return {
    content: [{
      type: "text",
      text: [
        `=== CHAIN: ${args.chain} (${chainResult.success ? "✅ SUCCESS" : "❌ FAILED"}) ===`,
        "",
        stepSummary,
        "",
        chainResult.success
          ? `Final output:\n${chainResult.steps[chainResult.steps.length - 1]?.result || "(chain complete)"}`
          : `Failed at step ${chainResult.failedAt}: ${chainResult.steps[chainResult.failedAt]?.error}`,
      ].join("\n"),
    }],
  };
}
