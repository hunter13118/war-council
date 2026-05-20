/**
 * Confidence Scoring — Multi-dimensional certainty assessment for model outputs.
 * 
 * Dimensions (from CONTRACTS_AND_PROTOCOLS.md):
 *   1. Relevance: How well does the response address the question?
 *   2. Completeness: Does it fully answer or leave gaps?
 *   3. Certainty: How confident is the model in its claims?
 *   4. Consistency: Does it align with known context (RAG, history)?
 * 
 * Composite score: weighted average of all dimensions.
 * Score range: 0.0 (no confidence) to 1.0 (maximum confidence).
 */

/**
 * Heuristic confidence scoring based on response characteristics.
 * No LLM call needed — pure signal analysis.
 * 
 * @param {Object} opts
 * @param {string} opts.response - The model's response text
 * @param {string} opts.question - The original question
 * @param {number} opts.latencyMs - Response latency
 * @param {number} opts.tokensOut - Token count
 * @param {string} opts.tier - Model tier used
 * @param {boolean} opts.ragHit - Whether RAG returned relevant context
 * @param {number} [opts.turnCount] - Number of conversation turns (context depth)
 * @returns {Object} Confidence assessment
 */
export function scoreConfidence({ response, question, latencyMs, tokensOut, tier, ragHit, turnCount = 0 }) {
  const scores = {};

  // 1. Relevance: keyword overlap between question and response
  const qWords = new Set(question.toLowerCase().split(/\W+/).filter(w => w.length > 3));
  const rWords = new Set(response.toLowerCase().split(/\W+/).filter(w => w.length > 3));
  const overlap = [...qWords].filter(w => rWords.has(w)).length;
  scores.relevance = Math.min(1, overlap / Math.max(qWords.size, 1) * 1.5);

  // 2. Completeness: response length relative to question complexity
  const questionComplexity = question.split(/\s+/).length;
  const responseLength = response.split(/\s+/).length;
  const expectedMin = Math.max(10, questionComplexity * 2);
  scores.completeness = Math.min(1, responseLength / expectedMin);

  // 3. Certainty: absence of hedging language
  const hedges = ['maybe', 'perhaps', 'might', 'could be', 'not sure', 'i think', 'possibly', 'unclear', 'i\'m not certain', 'it depends'];
  const lowerResp = response.toLowerCase();
  const hedgeCount = hedges.filter(h => lowerResp.includes(h)).length;
  scores.certainty = Math.max(0, 1 - (hedgeCount * 0.15));

  // 4. Consistency: boosted by RAG hit, conversation depth, and model tier
  let consistency = 0.5; // baseline
  if (ragHit) consistency += 0.2; // RAG context grounds the response
  if (turnCount > 0) consistency += Math.min(0.15, turnCount * 0.03); // conversation history helps
  const tierBoost = { reasoning: 0.15, specialist: 0.1, fast: 0, groq: 0.1, gemini: 0.12 };
  consistency += tierBoost[tier] || 0;
  scores.consistency = Math.min(1, consistency);

  // Composite: weighted average
  const weights = { relevance: 0.3, completeness: 0.2, certainty: 0.25, consistency: 0.25 };
  const composite = Object.entries(weights).reduce((sum, [dim, w]) => sum + (scores[dim] * w), 0);

  // Tier-adjusted: higher-tier models get a slight trust bonus
  const tierTrust = { reasoning: 0.05, specialist: 0.03, fast: 0, groq: 0.04, gemini: 0.04 };
  const adjusted = Math.min(1, composite + (tierTrust[tier] || 0));

  return {
    composite: Math.round(adjusted * 1000) / 1000,
    dimensions: {
      relevance: Math.round(scores.relevance * 1000) / 1000,
      completeness: Math.round(scores.completeness * 1000) / 1000,
      certainty: Math.round(scores.certainty * 1000) / 1000,
      consistency: Math.round(scores.consistency * 1000) / 1000,
    },
    tier,
    ragAugmented: ragHit,
  };
}

/**
 * Confidence level classification.
 * @param {number} composite - Score from 0-1
 * @returns {'high'|'medium'|'low'|'uncertain'}
 */
export function confidenceLevel(composite) {
  if (composite >= 0.8) return 'high';
  if (composite >= 0.6) return 'medium';
  if (composite >= 0.4) return 'low';
  return 'uncertain';
}
