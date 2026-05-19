/**
 * judge.js — Tournament judge logic extracted for testability.
 * 
 * Handles:
 * - Building the judge prompt
 * - Parsing WINNER/REASON from model output (including <think> tags)
 * - Fallback logic when parsing fails
 */

/**
 * Build the judge prompt for a tournament.
 * @param {string} question - The original question posed to contestants
 * @param {Array<{voterKey: string, text: string}>} results - Contestant responses
 * @returns {string} The formatted judge prompt
 */
export function buildJudgePrompt(question, results) {
  return `You are a tournament judge. Multiple AI models answered the same question. Pick the BEST response and explain why in 2-3 sentences.

QUESTION: ${question}

${results.map((r, i) => `--- CONTESTANT ${i + 1} (${r.voterKey}) ---\n${r.text.slice(0, 500)}`).join("\n\n")}

Respond in this exact format:
WINNER: <contestant number>
REASON: <2-3 sentence explanation>`;
}

/**
 * Parse the judge's verdict from model output.
 * Handles <think> tags from reasoning models (deepseek-r1).
 * 
 * @param {object} judgeResult - { text, fullText, thinking }
 * @param {Array<{voterKey: string}>} results - Contestant list (for index mapping)
 * @param {string[]} voterKeys - Original voter key order
 * @returns {{ winnerKey: string, loserKey: string, verdict: string }}
 */
export function parseJudgeVerdict(judgeResult, results, voterKeys) {
  const judgeFullText = judgeResult.fullText || judgeResult.text || "";
  let verdict = judgeResult.text || judgeResult.thinking || "";

  // Strip <think> tags for clean parsing
  const cleanedVerdict = judgeFullText.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

  // Parse WINNER
  const winnerMatch = (cleanedVerdict || judgeFullText).match(/WINNER:\s*(?:contestant\s*)?(\d+)/i);
  
  // Parse REASON
  const reasonMatch = (cleanedVerdict || judgeFullText).match(/REASON:\s*(.+?)(?:\n|$)/is);

  if (reasonMatch) {
    verdict = reasonMatch[1].trim();
  } else {
    // Fallback: extract last few sentences from thinking
    const thinkingContent = judgeResult.thinking || "";
    const sentences = thinkingContent.split(/[.!?]+/).filter((s) => s.trim().length > 20);
    const lastFew = sentences.slice(-3).join(". ").trim();
    if (lastFew) verdict = lastFew.slice(0, 300);
  }

  let winnerKey = voterKeys[0];
  let loserKey = voterKeys[voterKeys.length - 1];

  if (winnerMatch) {
    const winIdx = parseInt(winnerMatch[1], 10) - 1;
    if (winIdx >= 0 && winIdx < results.length) {
      winnerKey = results[winIdx].voterKey;
      loserKey = results.find((r, i) => i !== winIdx)?.voterKey || voterKeys[0];
    }
  }

  return { winnerKey, loserKey, verdict };
}
