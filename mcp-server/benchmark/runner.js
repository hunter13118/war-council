/**
 * Benchmark runner — execute challenges against models, track results.
 * Stores results in .cline-context/benchmark-results.json
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { CHALLENGES, getChallengeById } from "./challenges.js";

const RESULTS_PATH = resolve(process.cwd(), ".cline-context", "benchmark-results.json");

/**
 * Run a single challenge against a model using provided generate function.
 * @param {string} challengeId
 * @param {Function} generate - async (prompt) => { text, model, elapsedMs, tokensOut }
 * @returns {object} - { challengeId, model, passed, elapsedMs, tokensOut, output }
 */
export async function runChallenge(challengeId, generate) {
  const challenge = getChallengeById(challengeId);
  if (!challenge) throw new Error(`Unknown challenge: ${challengeId}`);

  const systemPrompt = `You are a coding assistant. Write ONLY the requested JavaScript code. No explanation, no markdown, no comments. Just the raw function/class code.`;
  const fullPrompt = `${systemPrompt}\n\n${challenge.prompt}`;

  const t0 = Date.now();
  const result = await generate(fullPrompt);
  const elapsedMs = Date.now() - t0;

  // Extract code from response (strip markdown fences if present)
  let code = result.text || "";
  code = code.replace(/```(?:javascript|js)?\n?/g, "").replace(/```\n?/g, "").trim();

  let passed = false;
  try {
    passed = challenge.validate(code);
  } catch { passed = false; }

  return {
    challengeId: challenge.id,
    challengeName: challenge.name,
    difficulty: challenge.difficulty,
    model: result.model,
    passed,
    elapsedMs,
    tokensOut: result.tokensOut || 0,
    output: code.slice(0, 500),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Run all challenges (or a subset) against a model.
 */
export async function runSuite(generate, opts = {}) {
  const challenges = opts.challengeIds
    ? opts.challengeIds.map(getChallengeById).filter(Boolean)
    : CHALLENGES;

  const results = [];
  for (const challenge of challenges) {
    try {
      const r = await runChallenge(challenge.id, generate);
      results.push(r);
    } catch (e) {
      results.push({
        challengeId: challenge.id,
        challengeName: challenge.name,
        difficulty: challenge.difficulty,
        model: "unknown",
        passed: false,
        elapsedMs: 0,
        tokensOut: 0,
        output: `Error: ${e.message}`,
        timestamp: new Date().toISOString(),
      });
    }
  }
  return results;
}

/**
 * Load historical benchmark results.
 */
export async function loadResults() {
  try {
    const raw = await readFile(RESULTS_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { runs: [], leaderboard: {} };
  }
}

/**
 * Save benchmark results and update leaderboard.
 */
export async function saveResults(newResults) {
  const data = await loadResults();
  const runId = Date.now().toString(36);

  data.runs.push({ id: runId, results: newResults, timestamp: new Date().toISOString() });

  // Update leaderboard
  for (const r of newResults) {
    if (!data.leaderboard[r.model]) {
      data.leaderboard[r.model] = { totalRuns: 0, totalPassed: 0, challenges: {} };
    }
    const entry = data.leaderboard[r.model];
    entry.totalRuns++;
    if (r.passed) entry.totalPassed++;

    if (!entry.challenges[r.challengeId]) {
      entry.challenges[r.challengeId] = { attempts: 0, passes: 0, bestMs: Infinity };
    }
    const ch = entry.challenges[r.challengeId];
    ch.attempts++;
    if (r.passed) ch.passes++;
    if (r.passed && r.elapsedMs < ch.bestMs) ch.bestMs = r.elapsedMs;
  }

  await mkdir(resolve(RESULTS_PATH, ".."), { recursive: true });
  await writeFile(RESULTS_PATH, JSON.stringify(data, null, 2), "utf-8");
  return { runId, data };
}

/**
 * Get win rates per model.
 */
export function getWinRates(leaderboard) {
  return Object.entries(leaderboard).map(([model, data]) => ({
    model,
    winRate: data.totalRuns > 0 ? (data.totalPassed / data.totalRuns * 100).toFixed(1) + "%" : "N/A",
    totalRuns: data.totalRuns,
    totalPassed: data.totalPassed,
  })).sort((a, b) => (b.totalPassed / b.totalRuns || 0) - (a.totalPassed / a.totalRuns || 0));
}
