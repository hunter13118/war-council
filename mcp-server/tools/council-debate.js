/**
 * council_debate — Adversarial debate between two models.
 */
import { ARSENAL } from "../shared/config.js";
import { ollamaGenerateWithRetry } from "../shared/ollama.js";
import { emitBattleEvent } from "../shared/battle-events.js";
import { debate, appendScratchpad } from "../council-deliberation.js";

export const schema = {
  name: "council_debate",
  description:
    "Run an adversarial debate between two models. One argues FOR, one AGAINST. " +
    "After N rounds, a judge declares a winner.",
  inputSchema: {
    type: "object",
    properties: {
      topic: { type: "string", description: "The proposition to debate." },
      pro_stance: { type: "string", description: "The 'FOR' position." },
      con_stance: { type: "string", description: "The 'AGAINST' position." },
      rounds: { type: "number", description: "Number of rounds. Default 2." },
    },
    required: ["topic", "pro_stance", "con_stance"],
  },
};

export async function handler(args, ctx) {
  const rounds = args.rounds ?? 2;
  const voterToAgent = { fast: "consult_fast", specialist: "consult_specialist", reasoning: "consult_reasoning" };

  const generateFn = async (modelKey, prompt) => {
    const model = ARSENAL[modelKey] || ARSENAL.specialist;
    const r = await ollamaGenerateWithRetry(model, prompt, { maxTokens: 512 });
    return r.text;
  };

  const result = await debate(
    args.topic,
    { model: "specialist", stance: args.pro_stance },
    { model: "fast", stance: args.con_stance },
    rounds,
    generateFn
  );
  await appendScratchpad(`[DEBATE] ${args.topic}\nVerdict: ${result.verdict}`);

  // Emit debate_round events
  const proAgent = voterToAgent["specialist"] || "consult_specialist";
  const conAgent = voterToAgent["fast"] || "consult_fast";
  for (let i = 0; i < result.exchanges.length - 1; i += 2) {
    const pro = result.exchanges[i];
    const con = result.exchanges[i + 1];
    if (pro && con) {
      emitBattleEvent({
        type: "debate_round",
        agent1: proAgent,
        agent2: conAgent,
        text1: pro.response.slice(0, 150),
        text2: con.response.slice(0, 150),
      });
    }
  }

  // Determine winner
  let winnerAgent = proAgent;
  let loserAgent = conAgent;
  const verdictLower = result.verdict.toLowerCase();
  if (verdictLower.includes("con wins") || verdictLower.includes("con side") ||
      verdictLower.includes("against") || verdictLower.includes("con makes the stronger")) {
    winnerAgent = conAgent;
    loserAgent = proAgent;
  }

  emitBattleEvent({
    type: "tournament_result",
    winner: winnerAgent,
    loser: loserAgent,
    rationale: result.verdict.slice(0, 300),
    topic: args.topic,
  });

  return {
    content: [{
      type: "text",
      text: [
        `=== COUNCIL DEBATE (${rounds} rounds) ===`,
        `Topic: ${args.topic}`,
        `PRO: ${args.pro_stance}`,
        `CON: ${args.con_stance}`,
        "",
        ...result.exchanges.map((e) => `[${e.side}]: ${e.response}`),
        "",
        `### VERDICT (reasoning model):\n${result.verdict}`,
        "",
        `🏆 Winner: ${winnerAgent} | 💀 Loser: ${loserAgent}`,
      ].join("\n"),
    }],
    _meta: { preview: `Debate verdict: ${winnerAgent} wins` },
  };
}
