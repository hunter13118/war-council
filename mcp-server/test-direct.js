/**
 * Direct test — bypasses MCP, calls the underlying functions directly.
 * Use: node test-direct.js
 *
 * Verifies that:
 *   - Ollama is reachable
 *   - All ARSENAL models respond
 *   - tournament_vote runs in parallel correctly
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const arsenalConfig = JSON.parse(readFileSync(resolve(__dirname, "..", "arsenal.json"), "utf-8"));

const OLLAMA_BASE = process.env.OLLAMA_BASE || arsenalConfig.defaults.ollama_base;

const ARSENAL = {
  fast: arsenalConfig.models.fast.name,
  specialist: arsenalConfig.models.specialist.name,
  reasoning: arsenalConfig.models.reasoning.name,
  heavy: arsenalConfig.models.heavy.name,
};

async function ollamaGenerate(model, prompt) {
  const t0 = Date.now();
  const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      options: { temperature: 0.2, num_predict: 256 },
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return {
    model,
    text: data.response ?? "",
    elapsedMs: Date.now() - t0,
    tokensOut: data.eval_count ?? 0,
  };
}

async function main() {
  console.log("=== war-council direct test ===\n");

  // 1. List arsenal
  console.log("[1] Listing local arsenal...");
  const tags = await (await fetch(`${OLLAMA_BASE}/api/tags`)).json();
  console.log(
    `    Found ${tags.models?.length ?? 0} models:`,
    (tags.models ?? []).map((m) => m.name).join(", "),
  );

  // 2. Sequential consult test (warm-up + correctness)
  const prompt = "In one short sentence, what does FizzBuzz print for n=15?";
  console.log(`\n[2] Sequential consult test: "${prompt}"`);
  for (const [role, model] of Object.entries(ARSENAL)) {
    process.stdout.write(`    ${role.padEnd(12)} (${model}) ... `);
    try {
      const r = await ollamaGenerate(model, prompt);
      console.log(
        `${r.elapsedMs}ms, ${r.tokensOut} tokens — ${r.text.trim().slice(0, 80).replace(/\n/g, " ")}`,
      );
    } catch (e) {
      console.log(`FAILED: ${e.message}`);
    }
  }

  // 3. Parallel tournament test
  console.log(`\n[3] Tournament vote (parallel, 3 voters)...`);
  const t0 = Date.now();
  const voters = ["fast", "specialist", "reasoning"];
  const results = await Promise.all(
    voters.map(async (k) => {
      try {
        return await ollamaGenerate(
          ARSENAL[k],
          "Which is faster: bubble sort or quicksort? One sentence.",
        );
      } catch (e) {
        return { model: ARSENAL[k], text: `ERROR: ${e.message}`, elapsedMs: 0 };
      }
    }),
  );
  const totalMs = Date.now() - t0;
  console.log(`    Total wall time (parallel): ${totalMs}ms`);
  results.forEach((r, i) => {
    console.log(
      `    [${voters[i]}] ${r.elapsedMs}ms — ${r.text.trim().slice(0, 100).replace(/\n/g, " ")}`,
    );
  });

  console.log("\n=== war-council direct test complete ===");
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
