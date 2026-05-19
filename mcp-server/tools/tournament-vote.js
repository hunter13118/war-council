/**
 * tournament_vote — Fan out same prompt to N models, judge picks winner.
 */
import { ARSENAL } from "../shared/config.js";
import { ollamaGenerate, ollamaGenerateWithRetry, formatConsultResult } from "../shared/ollama.js";
import { emitBattleEvent } from "../shared/battle-events.js";

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
    },
    required: ["prompt"],
  },
};

export async function handler(args, ctx) {
  let voterKeys = args.voters ?? ["specialist", "reasoning"];
  if (typeof voterKeys === "string") voterKeys = voterKeys.split(",").map((s) => s.trim());
  const voterToAgent = { fast: "consult_fast", specialist: "consult_specialist", reasoning: "consult_reasoning", heavy: "consult_specialist" };
  const t0 = Date.now();

  const results = await Promise.all(
    voterKeys.map(async (k) => {
      const model = ARSENAL[k];
      if (!model) {
        return { voterKey: k, model: `unknown:${k}`, text: `(unknown voter '${k}')`, elapsedMs: 0, tokensOut: 0 };
      }
      try {
        const r = await ollamaGenerate(model, args.prompt);
        return { ...r, voterKey: k };
      } catch (e) {
        return { voterKey: k, model, text: `(error: ${e.message})`, elapsedMs: 0, tokensOut: 0 };
      }
    })
  );
  const totalMs = Date.now() - t0;

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

  // Judge pass
  let judgeVerdict = "";
  let winnerKey = voterKeys[0];
  let loserKey = voterKeys[voterKeys.length - 1];
  try {
    const judgePrompt = `You are a tournament judge. Multiple AI models answered the same question. Pick the BEST response and explain why in 2-3 sentences.

QUESTION: ${args.prompt}

${results.map((r, i) => `--- CONTESTANT ${i + 1} (${r.voterKey}) ---\n${r.text.slice(0, 500)}`).join("\n\n")}

Respond in this exact format:
WINNER: <contestant number>
REASON: <2-3 sentence explanation>`;

    const judgeResult = await ollamaGenerateWithRetry(ARSENAL.reasoning, judgePrompt, { maxTokens: 512 });
    const judgeFullText = judgeResult.fullText || judgeResult.text;
    judgeVerdict = judgeResult.text || judgeResult.thinking || "";

    const cleanedVerdict = judgeFullText.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    const winnerMatch = (cleanedVerdict || judgeFullText).match(/WINNER:\s*(?:contestant\s*)?(\d+)/i);
    const reasonMatch = (cleanedVerdict || judgeFullText).match(/REASON:\s*(.+?)(?:\n|$)/is);

    if (reasonMatch) {
      judgeVerdict = reasonMatch[1].trim();
    } else {
      const thinkingContent = judgeResult.thinking || "";
      const sentences = thinkingContent.split(/[.!?]+/).filter((s) => s.trim().length > 20);
      const lastFew = sentences.slice(-3).join(". ").trim();
      if (lastFew) judgeVerdict = lastFew.slice(0, 300);
    }
    if (winnerMatch) {
      const winIdx = parseInt(winnerMatch[1], 10) - 1;
      if (winIdx >= 0 && winIdx < results.length) {
        winnerKey = results[winIdx].voterKey;
        loserKey = results.find((r, i) => i !== winIdx)?.voterKey || voterKeys[0];
      }
    }
  } catch (e) {
    judgeVerdict = `(judge error: ${e.message})`;
  }

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
