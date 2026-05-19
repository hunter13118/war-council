/**
 * benchmark_run — Run coding challenges against models, track win rates.
 */
import { ARSENAL } from "../shared/config.js";
import { ollamaGenerate } from "../shared/ollama.js";
import { runSuite, runChallenge, saveResults, loadResults, getWinRates } from "../benchmark/runner.js";
import { CHALLENGES } from "../benchmark/challenges.js";
import { emitBattleEvent } from "../shared/battle-events.js";

export const schema = {
  name: "benchmark_run",
  description:
    "Run standardized coding challenges against one or more models. " +
    "Tracks win rates over time. Use to compare model performance on code generation.",
  inputSchema: {
    type: "object",
    properties: {
      models: {
        type: "array",
        items: { type: "string", enum: ["fast", "specialist", "reasoning", "heavy"] },
        description: "Model tiers to benchmark. Default: ['fast', 'specialist'].",
      },
      challenges: {
        type: "array",
        items: { type: "string" },
        description: "Challenge IDs to run. Default: all challenges.",
      },
      action: {
        type: "string",
        enum: ["run", "leaderboard"],
        description: "run = execute benchmarks, leaderboard = show current standings.",
      },
    },
  },
};

export async function handler(args, ctx) {
  const action = args.action ?? "run";

  if (action === "leaderboard") {
    const { leaderboard } = await loadResults();
    const rates = getWinRates(leaderboard);
    const lines = [
      "=== BENCHMARK LEADERBOARD ===",
      "",
      ...rates.map((r, i) => `  ${i + 1}. ${r.model} — ${r.winRate} (${r.totalPassed}/${r.totalRuns} passed)`),
      "",
      `Available challenges: ${CHALLENGES.map(c => c.id).join(", ")}`,
    ];
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  // Run benchmarks
  const modelKeys = args.models ?? ["fast", "specialist"];
  const allResults = [];

  for (const tier of modelKeys) {
    const model = ARSENAL[tier];
    if (!model) continue;

    const generate = async (prompt) => {
      const r = await ollamaGenerate(model, prompt, { maxTokens: 1024, temperature: 0.1 });
      return { text: r.text, model, elapsedMs: r.elapsedMs, tokensOut: r.tokensOut };
    };

    const results = await runSuite(generate, { challengeIds: args.challenges });
    allResults.push(...results);

    // Emit benchmark events
    const passed = results.filter(r => r.passed).length;
    emitBattleEvent({
      type: "benchmark_complete",
      model,
      tier,
      passed,
      total: results.length,
      winRate: `${((passed / results.length) * 100).toFixed(0)}%`,
    });
  }

  const { runId } = await saveResults(allResults);

  // Format output
  const lines = [
    `=== BENCHMARK RUN ${runId} ===`,
    "",
  ];

  // Group by model
  const byModel = {};
  for (const r of allResults) {
    if (!byModel[r.model]) byModel[r.model] = [];
    byModel[r.model].push(r);
  }

  for (const [model, results] of Object.entries(byModel)) {
    const passed = results.filter(r => r.passed).length;
    lines.push(`📊 ${model}: ${passed}/${results.length} passed (${((passed / results.length) * 100).toFixed(0)}%)`);
    for (const r of results) {
      const icon = r.passed ? "✅" : "❌";
      lines.push(`  ${icon} ${r.challengeName} [${r.difficulty}] — ${r.elapsedMs}ms, ${r.tokensOut} tok`);
    }
    lines.push("");
  }

  return { content: [{ type: "text", text: lines.join("\n") }] };
}
