/**
 * Council Deliberation Engine — enables models to "talk to each other."
 *
 * Architecture: Sequential pipeline with shared scratchpad.
 * Each model sees all previous models' responses and builds on them.
 * This simulates multi-agent discussion within a single-GPU constraint.
 *
 * Modes:
 *   - deliberate: 3 models weigh in sequentially (specialist → reasoning → specialist synthesis)
 *   - debate: 2 models argue back and forth for N rounds
 *   - consensus: fan-out + synthesis pass
 *   - scratchpad: persistent shared memory between tool calls
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { existsSync } from "node:fs";

const SCRATCHPAD_DIR = resolve(
  dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")),
  "..",
  "..",
  ".cline-context"
);

/**
 * Sequential deliberation — each model sees all previous responses.
 * @param {string} topic - The question or task to deliberate on
 * @param {Array<{role: string, model: string}>} panelists - e.g. [{role: "Architect", model: "specialist"}, ...]
 * @param {Function} generate - async (model, prompt) => text
 * @returns {Object} { topic, rounds: [{role, model, response}], synthesis }
 */
export async function deliberate(topic, panelists, generate) {
  const rounds = [];
  let transcript = `# Council Deliberation\n## Topic: ${topic}\n\n`;

  for (const panelist of panelists) {
    const prompt = `You are the "${panelist.role}" on a technical council.

TOPIC: ${topic}

${rounds.length > 0 ? `PREVIOUS RESPONSES FROM OTHER COUNCIL MEMBERS:\n${rounds.map((r) => `### ${r.role}:\n${r.response}`).join("\n\n")}` : "(You are first to respond.)"}

Give your perspective as the ${panelist.role}. Be specific, actionable, and concise. If you disagree with a previous response, explain why. If you agree, add NEW information rather than repeating.`;

    const response = await generate(panelist.model, prompt);
    rounds.push({ role: panelist.role, model: panelist.model, response });
    transcript += `### ${panelist.role} (${panelist.model}):\n${response}\n\n`;
  }

  // Synthesis pass — specialist model reads all and produces final answer
  const synthesisPrompt = `You are the Synthesizer. Read all council member responses and produce a FINAL UNIFIED ANSWER that incorporates the best insights from each.

TOPIC: ${topic}

COUNCIL RESPONSES:
${rounds.map((r) => `### ${r.role}:\n${r.response}`).join("\n\n")}

Produce a clear, actionable synthesis. Resolve any disagreements. Output the best path forward.`;

  const synthesis = await generate("specialist", synthesisPrompt);
  transcript += `### SYNTHESIS:\n${synthesis}\n`;

  return { topic, rounds, synthesis, transcript };
}

/**
 * Adversarial debate — two models argue back and forth.
 * @param {string} topic - The proposition to debate
 * @param {{model: string, stance: string}} pro - The "for" side
 * @param {{model: string, stance: string}} con - The "against" side
 * @param {number} rounds - Number of back-and-forth rounds
 * @param {Function} generate - async (model, prompt) => text
 * @returns {Object} { topic, exchanges: [{side, response}], verdict }
 */
export async function debate(topic, pro, con, rounds, generate) {
  const exchanges = [];
  let history = "";

  for (let i = 0; i < rounds; i++) {
    // Pro argues
    const proPrompt = `You are arguing FOR: "${pro.stance}"
Topic: ${topic}
${history ? `\nDebate so far:\n${history}` : ""}

Make your ${i === 0 ? "opening" : "rebuttal"} argument. Be specific and evidence-based. Max 200 words.`;

    const proResponse = await generate(pro.model, proPrompt);
    exchanges.push({ side: "PRO", stance: pro.stance, response: proResponse });
    history += `\n[PRO - Round ${i + 1}]: ${proResponse}\n`;

    // Con argues
    const conPrompt = `You are arguing AGAINST: "${con.stance}"
Topic: ${topic}

Debate so far:
${history}

Make your ${i === 0 ? "opening" : "rebuttal"} argument. Address the PRO's points directly. Be specific. Max 200 words.`;

    const conResponse = await generate(con.model, conPrompt);
    exchanges.push({ side: "CON", stance: con.stance, response: conResponse });
    history += `\n[CON - Round ${i + 1}]: ${conResponse}\n`;
  }

  // Judge pass
  const verdictPrompt = `You are an impartial judge. Read this debate and declare a winner with reasoning.

Topic: ${topic}
PRO stance: ${pro.stance}
CON stance: ${con.stance}

Full debate:
${history}

Verdict: Which side made the stronger argument? Why? What's the recommended action?`;

  const verdict = await generate("reasoning", verdictPrompt);

  return { topic, pro: pro.stance, con: con.stance, exchanges, verdict };
}

/**
 * Consensus building — fan-out to multiple models, then synthesize.
 * Unlike tournament_vote (which just picks a winner), this MERGES insights.
 * @param {string} topic
 * @param {string[]} models - models to consult
 * @param {Function} generate - async (model, prompt) => text
 * @returns {Object} { topic, responses: [{model, response}], consensus }
 */
export async function buildConsensus(topic, models, generate) {
  // Parallel fan-out (all models get the same prompt independently)
  const responses = await Promise.all(
    models.map(async (model) => {
      const prompt = `Give your technical opinion on: ${topic}\n\nBe specific, concise, and actionable. Max 300 words.`;
      const response = await generate(model, prompt);
      return { model, response };
    })
  );

  // Synthesis
  const synthesisPrompt = `Multiple AI models gave opinions on: "${topic}"

${responses.map((r) => `### ${r.model}:\n${r.response}`).join("\n\n")}

Identify points of AGREEMENT (consensus) and DISAGREEMENT (contention). Produce a final recommendation that captures the consensus while noting unresolved disagreements.`;

  const consensus = await generate("specialist", synthesisPrompt);

  return { topic, responses, consensus };
}

/**
 * Shared Scratchpad — persistent memory between tool calls within a session.
 * Agents can read/write/append to the scratchpad to coordinate.
 */
export async function readScratchpad() {
  const path = resolve(SCRATCHPAD_DIR, "council-scratchpad.md");
  if (!existsSync(path)) return "";
  return await readFile(path, "utf-8");
}

export async function writeScratchpad(content) {
  if (!existsSync(SCRATCHPAD_DIR)) {
    await mkdir(SCRATCHPAD_DIR, { recursive: true });
  }
  const path = resolve(SCRATCHPAD_DIR, "council-scratchpad.md");
  await writeFile(path, content, "utf-8");
}

export async function appendScratchpad(entry) {
  const current = await readScratchpad();
  const timestamp = new Date().toISOString().slice(0, 19);
  const updated = `${current}\n\n## [${timestamp}]\n${entry}`;
  await writeScratchpad(updated);
  return updated;
}
