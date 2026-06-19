/**
 * Chain tool executor — runs MCP tools from task chains.
 */
import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { ARSENAL, MEMORY_EMBED_MODEL } from "./config.js";
import { resolveActiveRepoRoot } from "./resolve-repo-root.js";
import { resolveVectorStorePath } from "./workspace-bootstrap.js";
import { ollamaGenerateWithRetry } from "./ollama.js";
import { cloudGenerateWithFailover, strategicPlan, rapidFanOut } from "./cloud.js";
import { runCommand } from "./commands.js";
import { retrieve } from "../../memory-engine/retriever.js";

/**
 * @param {import("@modelcontextprotocol/sdk").ServerContext} [ctx]
 * @param {{ repoRoot?: string }} [options]
 * @returns {(toolName: string, toolArgs: object) => Promise<string>}
 */
export function createChainToolExecutor(ctx = {}, options = {}) {
  const repoRoot = resolveActiveRepoRoot(options.repoRoot);
  return async function executeChainTool(toolName, toolArgs) {
    switch (toolName) {
      case "memory_query": {
        const r = await retrieve(toolArgs.query, {
          storePath: resolveVectorStorePath(),
          k: toolArgs.k ?? 5,
          embedModel: MEMORY_EMBED_MODEL,
          minRelevance: toolArgs.minRelevance ?? 0.3,
        });
        if (!r.chunks?.length) return "(no memory hits above relevance threshold)";
        return r.chunks.map((c) => `[${c.source || c.file || "?"}] ${c.text}`).join("\n\n");
      }
      case "memory_recall_conversation": {
        const r = await retrieve(toolArgs.query, {
          storePath: resolveVectorStorePath(),
          k: toolArgs.k ?? 5,
          embedModel: MEMORY_EMBED_MODEL,
          source: "conversations",
        });
        return r.chunks?.map((c) => `[${c.file}] ${c.text}`).join("\n\n") || "(no conversation hits)";
      }
      case "consult_fast": {
        const r = await ollamaGenerateWithRetry(ARSENAL.fast, toolArgs.prompt, {
          maxTokens: toolArgs.maxTokens ?? 2048,
        });
        return r.text;
      }
      case "consult_specialist": {
        const r = await ollamaGenerateWithRetry(ARSENAL.specialist, toolArgs.prompt, {
          maxTokens: toolArgs.maxTokens ?? 4096,
        });
        return r.text;
      }
      case "consult_reasoning": {
        const r = await ollamaGenerateWithRetry(ARSENAL.reasoning, toolArgs.prompt, {
          maxTokens: toolArgs.maxTokens ?? 2048,
        });
        return r.text;
      }
      case "consult_cloud": {
        const provider = toolArgs.provider ?? "gemini";
        const r = await cloudGenerateWithFailover(toolArgs.prompt, {
          primary: provider,
          maxTokens: toolArgs.maxTokens ?? 4096,
          temperature: toolArgs.temperature ?? 0.3,
        });
        return [
          `=== CLOUD (${r.provider}/${r.model})${r.failedOver ? " [failover]" : ""} ===`,
          r.text.trim(),
        ].join("\n");
      }
      case "apple_strategic_plan": {
        const { runAppleStrategicPlan } = await import("./apple-plan-prompts.js");
        const r = await runAppleStrategicPlan(toolArgs.task, toolArgs.code_context, {
          maxTokens: toolArgs.maxTokens ?? 8192,
        });
        return [
          `=== APPLE PLAN (${r.provider}/${r.model})${r.failedOver ? " [failover]" : ""} ===`,
          r.text.trim(),
        ].join("\n");
      }
      case "strategic_plan": {
        const r = await strategicPlan(toolArgs.task, toolArgs.code_context, toolArgs);
        return r.text;
      }
      case "rapid_fan_out": {
        const r = await rapidFanOut(toolArgs.prompts, toolArgs);
        return r.results.map((x, i) => `--- angle ${i + 1} ---\n${x.text}`).join("\n\n");
      }
      case "run_tests": {
        const suite = toolArgs.suite ?? detectDefaultTestSuite(repoRoot);
        const npmScript =
          suite === "all" ? "test"
          : suite === "jest" ? "test:jest"
          : suite === "python" ? "test:python"
          : suite === "e2e" ? "test:e2e"
          : suite === "ui" ? "test:ui"
          : null;
        if (!npmScript) throw new Error(`Unknown test suite '${suite}'`);
        const cmd = await runCommand(
          "npm",
          ["run", npmScript],
          repoRoot,
          toolArgs.timeout_ms ?? 300_000,
        );
        const tail = (cmd.stdout + "\n" + cmd.stderr).trim();
        const body = tail.length > 3000 ? tail.slice(-3000) : tail;
        if (cmd.exitCode !== 0) {
          throw new Error(`❌ FAILED exit ${cmd.exitCode} (npm run ${npmScript})\n${body}`);
        }
        return `✅ PASSED (npm run ${npmScript})\n${body}`;
      }
      case "review_diff": {
        const mod = await import("../tools/review-diff.js");
        const res = await mod.handler(
          { ...toolArgs, repo_root: toolArgs.repo_root ?? repoRoot },
          ctx,
        );
        if (res.isError) throw new Error(res.content?.[0]?.text ?? "review_diff failed");
        return res.content?.[0]?.text ?? "";
      }
      case "capture_visual_audit": {
        const mod = await import("../tools/capture-visual-audit.js");
        const res = await mod.handler(
          {
            url: toolArgs.url ?? toolArgs.visual_url,
            output_path: toolArgs.output_path ?? toolArgs.visual_output_path,
            question: toolArgs.question ?? toolArgs.visual_question,
            wait_ms: toolArgs.wait_ms ?? toolArgs.visual_wait_ms,
          },
          ctx,
        );
        if (res.isError) throw new Error(res.content?.[0]?.text ?? "capture_visual_audit failed");
        return res.content?.[0]?.text ?? "";
      }
      case "tournament_vote": {
        const mod = await import("../tools/tournament-vote.js");
        const res = await mod.handler(toolArgs, ctx);
        if (res.isError) throw new Error(res.content?.[0]?.text ?? "tournament_vote failed");
        return res.content?.[0]?.text ?? "";
      }
      case "invoke_agent": {
        const mod = await import("../tools/invoke-agent.js");
        const res = await mod.handler(toolArgs, ctx);
        if (res.isError) throw new Error(res.content?.[0]?.text ?? "invoke_agent failed");
        return res.content?.[0]?.text ?? "";
      }
      case "report_action": {
        const mod = await import("../tools/report-action.js");
        const res = await mod.handler(toolArgs, ctx);
        return res.content?.[0]?.text ?? "reported";
      }
      case "apply_plan": {
        const mod = await import("../tools/apply-plan.js");
        const res = await mod.handler(
          { ...toolArgs, repo_root: toolArgs.repo_root ?? repoRoot },
          ctx,
        );
        if (res.isError) throw new Error(res.content?.[0]?.text ?? "apply_plan failed");
        return res.content?.[0]?.text ?? "";
      }
      default:
        throw new Error(`tool '${toolName}' not available in chain executor`);
    }
  };
}

/**
 * @param {string} repoRoot
 * @returns {string}
 */
export function detectDefaultTestSuite(repoRoot) {
  const pkgPath = resolve(repoRoot, "package.json");
  if (!existsSync(pkgPath)) return "all";
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    const scripts = pkg.scripts ?? {};
    if (scripts["test:e2e"]) return "e2e";
    if (scripts["test:jest"]) return "jest";
    if (scripts["test:ui"]) return "ui";
    if (scripts.test) return "all";
  } catch {
    /* ignore */
  }
  return "all";
}
