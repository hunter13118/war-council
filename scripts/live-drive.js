#!/usr/bin/env node
/**
 * War Council — LIVE Drive
 * ========================
 * Exercises the REAL pipeline end-to-end (no mocks): live Ollama chat, a real
 * three-model tournament with a genuine judged verdict, a real DAG execution,
 * and a real knowledge-graph extraction — so every dashboard page lights up
 * with authentic data.
 *
 *   node scripts/live-drive.js [--base http://localhost:3737]
 *        [--skip-chat] [--skip-tournament] [--skip-dag] [--skip-graph]
 *        [--reindex] [--capture]
 *
 * Prereqs: battle-log server running, Ollama serving the arsenal models.
 * Pair with: `npm run test:ui:live` (Playwright live project) and
 *            `node scripts/capture-dashboards.js` (or just pass --capture).
 */
"use strict";

const { spawn } = require("node:child_process");
const path = require("node:path");

const argv = process.argv.slice(2);
const flag = (f) => argv.includes(f);
const baseIdx = argv.indexOf("--base");
const BASE = baseIdx >= 0 ? argv[baseIdx + 1] : "http://localhost:3737";

const log = (msg) => console.log(`[live-drive] ${msg}`);
const hr = () => console.log("─".repeat(60));

async function getJSON(route) {
  const r = await fetch(BASE + route);
  if (!r.ok) throw new Error(`GET ${route} → HTTP ${r.status}`);
  return r.json();
}

async function postJSON(route, body) {
  const r = await fetch(BASE + route, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!r.ok) throw new Error(`POST ${route} → HTTP ${r.status}`);
  return r.json().catch(() => ({}));
}

/** Stream a real /chat call; returns { text, meta }. */
async function chat(message, mode) {
  const r = await fetch(BASE + "/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, mode }),
  });
  if (!r.ok || !r.body) throw new Error(`/chat → HTTP ${r.status}`);
  const decoder = new TextDecoder();
  let buf = "", text = "", meta = {};
  for await (const chunk of r.body) {
    buf += decoder.decode(chunk, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const d = JSON.parse(line.slice(6));
        if (d.token) text += d.token;
        if (d.done) meta = d;
      } catch {}
    }
  }
  return { text, meta };
}

async function stepHealth() {
  const h = await getJSON("/health");
  log(`health: ${h.status} | ollama: ${h.ollama} | models: ${(h.models || []).length} | RAG chunks: ${h.rag?.chunks ?? "?"} | mode: ${h.mode}`);
  if (!h.ollama) {
    log("⚠ Ollama is not reachable — model steps will fail. Run `ollama serve` first.");
  }
  return h;
}

async function stepChat() {
  log("LIVE CHAT — consulting the fast model for real...");
  const t0 = Date.now();
  const { text, meta } = await chat(
    "In two sentences: what is the most important property of a deterministic multi-model orchestrator?",
    "fast",
  );
  log(`  ↳ ${meta.model || "fast"} answered ${text.length} chars in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  log(`  ↳ "${text.slice(0, 140).replace(/\s+/g, " ")}..."`);
}

async function stepTournament() {
  log("LIVE TOURNAMENT — real deliberation, real verdict:");
  const prompt = "Explain, in 3 sentences max, when a software team should choose SQLite over PostgreSQL.";

  log("  ① challenger (fast/7b) answering...");
  const a = await chat(prompt, "fast");
  log(`     ${a.meta.model || "fast"}: ${a.text.length} chars`);

  log("  ② defender (specialist/14b) answering...");
  const b = await chat(prompt, "specialist");
  log(`     ${b.meta.model || "specialist"}: ${b.text.length} chars`);

  log("  ③ arbiter (reasoning) judging — this is a REAL verdict, not scripted...");
  const judgePrompt = [
    `Two AI models answered the question: "${prompt}"`,
    "", "=== ANSWER A (challenger) ===", a.text.slice(0, 1500),
    "", "=== ANSWER B (defender) ===", b.text.slice(0, 1500),
    "",
    "Judge which answer is better on correctness, completeness, and concision.",
    "Reply with your reasoning in 2-3 sentences, then a final line containing exactly: VERDICT: A or VERDICT: B",
  ].join("\n");
  const j = await chat(judgePrompt, "reasoning");

  const verdictMatch = j.text.match(/VERDICT:\s*([AB])/i);
  const pick = verdictMatch ? verdictMatch[1].toUpperCase() : (b.text.length >= a.text.length ? "B" : "A");
  const winner = pick === "A" ? "consult_fast" : "consult_specialist";
  const loser = pick === "A" ? "consult_specialist" : "consult_fast";
  const winnerTier = pick === "A" ? "fast" : "specialist";
  log(`  ⚖ verdict: ${pick} wins → ${winner}${verdictMatch ? "" : " (no explicit verdict parsed — length tiebreak)"}`);

  // Feed the REAL case to the dashboards (leaderboard, arbitration court, war table)
  await postJSON("/emit", {
    type: "debate_round",
    agent1: "consult_fast",
    agent2: "consult_specialist",
    text1: a.text.slice(0, 300),
    text2: b.text.slice(0, 300),
    prompt,
    verdict: j.text.slice(0, 400),
    winner,
  });
  await postJSON("/emit", {
    type: "tournament_result",
    winner,
    loser,
    winner_tier: winnerTier,
    prompt,
  });
  log("  ↳ emitted debate_round + tournament_result (Arbitration Court now has a real case)");
}

async function stepDag() {
  log("LIVE DAG — real 3-node pipeline through the engine:");
  const dag = {
    id: "live-probe-cli",
    name: "Live Council Probe (CLI)",
    entryNode: "plan",
    nodes: {
      plan: { type: "task", dependsOn: [], config: { tier: "fast", args: { prompt: "Plan, in 3 short bullet points, how to add a /healthcheck endpoint to a Node HTTP server." } } },
      draft: { type: "task", dependsOn: ["plan"], config: { tier: "fast", args: { prompt: "Write the minimal Node code for a /healthcheck endpoint returning JSON {ok:true}." } } },
      review: { type: "task", dependsOn: ["draft"], config: { tier: "fast", args: { prompt: "In 2 sentences, review a basic /healthcheck endpoint for production-readiness." } } },
    },
  };
  const { executionId } = await postJSON("/dag/run", { dag, context: {} });
  log(`  ↳ executionId ${executionId} — polling (watch it live at ${BASE}/dag-theater)`);

  const t0 = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 2500));
    const trace = await getJSON(`/dag/status/${executionId}`);
    const states = Object.entries(trace.nodeStates).map(([k, v]) => `${k}:${v}`).join("  ");
    log(`  ${trace.status.padEnd(9)} ${states}`);
    if (trace.status !== "running") {
      if (trace.errors?.length) log(`  ⚠ errors: ${trace.errors.join(" | ")}`);
      break;
    }
    if (Date.now() - t0 > 600_000) { log("  ⚠ timed out after 10min"); break; }
  }
}

async function stepGraph() {
  log("LIVE KNOWLEDGE GRAPH — re-extracting entities from the repo...");
  const res = await postJSON("/knowledge-graph/extract");
  const s = res.stats || {};
  log(`  ↳ ${JSON.stringify(s).slice(0, 200)}`);
  log(`  ↳ view it at ${BASE}/knowledge-graph-viz`);
}

async function stepReindex() {
  log("REINDEX — rebuilding the vector store (real embeddings, may take minutes)...");
  const res = await postJSON("/reindex");
  log(`  ↳ ${JSON.stringify(res).slice(0, 200)}`);
}

function stepCapture() {
  return new Promise((resolve) => {
    log("CAPTURE — screenshotting all dashboards with the fresh live data...");
    const p = spawn(process.execPath, [path.join(__dirname, "capture-dashboards.js"), "--base", BASE], { stdio: "inherit" });
    p.on("close", resolve);
  });
}

(async () => {
  hr();
  log(`target: ${BASE}`);
  hr();
  try {
    const h = await stepHealth();
    if (flag("--reindex")) await stepReindex();
    if (h.ollama) {
      if (!flag("--skip-chat")) await stepChat();
      if (!flag("--skip-tournament")) await stepTournament();
      if (!flag("--skip-dag")) await stepDag();
    } else {
      log("skipping chat/tournament/dag (no Ollama)");
    }
    if (!flag("--skip-graph")) await stepGraph();
    if (flag("--capture")) await stepCapture();
    hr();
    log("DONE. The dashboards now show real activity:");
    log(`  ${BASE}/war-table          — events + leaderboard from the real tournament`);
    log(`  ${BASE}/arbitration-court  — the real judged case`);
    log(`  ${BASE}/dag-theater        — the real pipeline execution`);
    log(`  ${BASE}/command-center     — chat + 🔊 babble toggle (bottom of dialogue box)`);
    log("Next: `npm run test:ui:live` for the no-mock Playwright suite.");
  } catch (e) {
    console.error(`[live-drive] ✖ ${e.message}`);
    process.exit(1);
  }
})();
