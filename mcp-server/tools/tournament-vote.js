/**
 * tournament_vote — Fan out same prompt to N models, judge picks winner.
 */
import { ARSENAL } from "../shared/config.js";
import { ollamaGenerate, ollamaGenerateWithRetry, formatConsultResult } from "../shared/ollama.js";
import { emitBattleEvent } from "../shared/battle-events.js";
import { buildJudgePrompt, parseJudgeVerdict } from "../shared/judge.js";

export const schema = {
  name: "tournament_vote",
  description:
    "Fan out SAME prompt to multiple models in parallel, return all responses. " +
    "Use for diverse perspectives before deciding architectural questions. " +
    "You (Conductor) synthesize the verdict.",
  inputSchema: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "The question to vote on." },
      voters: {
        type: "array",
        items: { type: "string", enum: ["fast", "specialist", "reasoning"] },
        description: "Default: ['specialist','reasoning']. Run in parallel.",
      },
      rounds: {
        type: "number",
        description: "Number of deliberation rounds. Default 1. Higher = more thorough but slower.",
      },
      weights: {
        type: "object",
        description: "Scoring weights per voter tier. Default: fast=1, specialist=2, reasoning=3.",
        properties: {
          fast: { type: "number" },
          specialist: { type: "number" },
          reasoning: { type: "number" },
        },
      },
    },
    required: ["prompt"],
  },
};

export async function handler(args, ctx) {
  let voterKeys = args.voters ?? ["specialist", "reasoning"];
  if (typeof voterKeys === "string") voterKeys = voterKeys.split(",").map((s) => s.trim());
  const rounds = Math.min(args.rounds ?? 1, 3); // Cap at 3 rounds
  const weights = args.weights ?? { fast: 1, specialist: 2, reasoning: 3 };
  const voterToAgent = { fast: "consult_fast", specialist: "consult_specialist", reasoning: "consult_reasoning", heavy: "consult_specialist" };
  const t0 = Date.now();

  // Track wins across rounds
  const winCounts = Object.fromEntries(voterKeys.map(k => [k, 0]));
  const allResults = [];

  for (let round = 0; round < rounds; round++) {
    const roundPrompt = round === 0
      ? args.prompt
      : `${args.prompt}\n\n[Round ${round + 1}: Consider previous responses and refine your answer.]`;

    const results = await Promise.all(
      voterKeys.map(async (k) => {
        const model = ARSENAL[k];
        if (!model) {
          return { voterKey: k, model: `unknown:${k}`, text: `(unknown voter '${k}')`, elapsedMs: 0, tokensOut: 0 };
        }
        try {
          const r = await ollamaGenerate(model, roundPrompt);
          return { ...r, voterKey: k, round };
        } catch (e) {
          return { voterKey: k, model, text: `(error: ${e.message})`, elapsedMs: 0, tokensOut: 0, round };
        }
      })
    );
    allResults.push(...results);

    // Judge this round
    try {
      const judgePrompt = buildJudgePrompt(args.prompt, results);
      const judgeResult = await ollamaGenerateWithRetry(ARSENAL.reasoning, judgePrompt, { maxTokens: 512 });
      const parsed = parseJudgeVerdict(judgeResult, results, voterKeys);
      // Apply weighted scoring
      const winnerWeight = weights[parsed.winnerKey] ?? 1;
      winCounts[parsed.winnerKey] = (winCounts[parsed.winnerKey] || 0) + winnerWeight;
    } catch { /* judge failed this round */ }
  }

  const totalMs = Date.now() - t0;
  const results = allResults.filter(r => r.round === rounds - 1); // Last round results for display

  // Determine overall winner by weighted score
  const sortedVoters = Object.entries(winCounts).sort((a, b) => b[1] - a[1]);
  const winnerKey = sortedVoters[0][0];
  const loserKey = sortedVoters[sortedVoters.length - 1][0];

  // Emit debate_round events
  for (let i = 0; i < results.length - 1; i++) {
    const a1 = voterToAgent[results[i].voterKey] || "consult_fast";
    const a2 = voterToAgent[results[i + 1].voterKey] || "consult_specialist";
    emitBattleEvent({
      type: "debate_round",
      agent1: a1,
      agent2: a2,
      text1: results[i].text.slice(0, 400),
      text2: results[i + 1].text.slice(0, 400),
      prompt: args.prompt.slice(0, 200),
    });
  }

  const judgeVerdict = `Weighted scores: ${sortedVoters.map(([k, s]) => `${k}=${s}`).join(", ")} (${rounds} round${rounds > 1 ? "s" : ""})`;

  // Emit tournament_result
  const winnerAgent = voterToAgent[winnerKey] || "consult_fast";
  const loserAgent = voterToAgent[loserKey] || "consult_specialist";
  const winnerResult = results.find((r) => r.voterKey === winnerKey);
  const loserResult = results.find((r) => r.voterKey === loserKey);
  emitBattleEvent({
    type: "tournament_result",
    winner: winnerAgent,
    loser: loserAgent,
    rationale: judgeVerdict.slice(0, 500),
    prompt: args.prompt.slice(0, 200),
    winnerArg: winnerResult ? winnerResult.text.slice(0, 400) : "",
    loserArg: loserResult ? loserResult.text.slice(0, 400) : "",
  });

  const blocks = [
    `=== TOURNAMENT VOTE (${results.length} voters, ${totalMs}ms wall) ===`,
    "",
    ...results.map((r, i) => formatConsultResult(`VOTER ${i + 1} [${r.voterKey}]`, r)),
    "",
    `=== JUDGE VERDICT ===`,
    judgeVerdict,
    "",
    `🏆 WINNER: ${winnerKey} | 💀 LOSER: ${loserKey}`,
  ];
  return {
    content: [{ type: "text", text: blocks.join("\n\n") }],
    _meta: { preview: `🏆 ${winnerKey} defeats ${loserKey}` },
  };
}
