/**
 * council_deliberate — Multi-model sequential deliberation.
 */
import { ARSENAL } from "../shared/config.js";
import { ollamaGenerateWithRetry } from "../shared/ollama.js";
import { emitBattleEvent } from "../shared/battle-events.js";
import { deliberate, appendScratchpad } from "../council-deliberation.js";

export const schema = {
  name: "council_deliberate",
  description:
    "Convene a council deliberation: multiple models discuss a topic sequentially, " +
    "each seeing previous responses. Produces a synthesized final answer.",
  inputSchema: {
    type: "object",
    properties: {
      topic: { type: "string", description: "The topic/question for the council." },
      panelists: {
        type: "array",
        items: {
          type: "object",
          properties: {
            role: { type: "string", description: "e.g. 'Architect', 'Security Expert'" },
            model: { type: "string", description: "Model key: fast, specialist, reasoning" },
          },
          required: ["role", "model"],
        },
        description: "The council panel. Each sees all previous responses.",
      },
    },
    required: ["topic"],
  },
};

export async function handler(args, ctx) {
  const panelists = args.panelists || [
    { role: "Architect", model: "specialist" },
    { role: "Devil's Advocate", model: "reasoning" },
    { role: "Pragmatist", model: "fast" },
  ];

  const generateFn = async (modelKey, prompt) => {
    const model = ARSENAL[modelKey] || ARSENAL.specialist;
    const r = await ollamaGenerateWithRetry(model, prompt, { maxTokens: 1024 });
    return r.text;
  };

  const result = await deliberate(args.topic, panelists, generateFn);
  await appendScratchpad(`[DELIBERATION] ${args.topic}\nSynthesis: ${result.synthesis}`);

  // Emit council_deliberation event for the Deliberation Theatre
  const agentEmojis = { fast: '🏃', specialist: '⚔️', reasoning: '🧠' };
  emitBattleEvent({
    type: "council_deliberation",
    prompt: args.topic,
    agents: result.rounds.map(r => ({
      name: r.role,
      emoji: agentEmojis[r.model] || '🤖',
      text: r.response.slice(0, 200),
    })),
    verdict: result.synthesis.slice(0, 300),
  });

  return {
    content: [{
      type: "text",
      text: [
        `=== COUNCIL DELIBERATION (${result.rounds.length} panelists) ===`,
        `Topic: ${args.topic}`,
        "",
        ...result.rounds.map((r) => `### ${r.role} (${r.model}):\n${r.response}`),
        "",
        `### SYNTHESIS:\n${result.synthesis}`,
      ].join("\n"),
    }],
  };
}
