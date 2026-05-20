/**
 * Tool Middleware — Wraps MCP tool handlers with:
 * 1. Circuit breaker check (fail-fast if breaker open)
 * 2. Telemetry recording (latency, tokens, success/fail)
 * 3. Confidence scoring (on successful responses)
 *
 * Usage: wrap your handler with `withInstrumentation(tier, handler)`
 */
import { isAvailable, recordSuccess, recordFailure, findFallback } from './circuit-breaker.js';
import { record as telemetryRecord } from './telemetry.js';
import { scoreConfidence } from './confidence.js';

/**
 * Maps tool names to their circuit breaker tier.
 */
const TOOL_TIER_MAP = {
  consult_fast: 'fast',
  consult_specialist: 'specialist',
  consult_reasoning: 'reasoning',
  consult_cloud: null, // determined dynamically by provider arg
  tournament_vote: null, // multi-model, handled specially
  smart_route: null, // no model call
  rapid_fan_out: null, // multi-model
};

/**
 * Resolve the breaker tier for a given tool + args.
 */
function resolveTier(toolName, args) {
  if (toolName === 'consult_cloud') {
    return args?.provider === 'gemini' ? 'gemini' : 'groq';
  }
  return TOOL_TIER_MAP[toolName] || null;
}

/**
 * Wrap a tool handler with circuit breaker + telemetry + confidence.
 * @param {string} toolName - The tool's registered name
 * @param {Function} originalHandler - The original handler(args, ctx)
 * @returns {Function} Instrumented handler
 */
export function withInstrumentation(toolName, originalHandler) {
  return async function instrumentedHandler(args, ctx) {
    const tier = resolveTier(toolName, args);
    const t0 = Date.now();

    // Circuit breaker check
    if (tier && !isAvailable(tier)) {
      const fallback = findFallback(tier, 'hybrid');
      const latencyMs = Date.now() - t0;
      telemetryRecord({
        type: 'tool_call', tier, tool: toolName,
        success: false, latencyMs, error: 'circuit_open',
        fallbackUsed: fallback || null,
      });
      if (!fallback) {
        return {
          content: [{ type: 'text', text: `⚡ Circuit breaker OPEN for ${tier}. No fallback available. Try again later.` }],
          isError: true,
        };
      }
      // Return info about breaker state — let caller decide to retry with fallback
      return {
        content: [{ type: 'text', text: `⚡ Circuit breaker OPEN for ${tier}. Fallback available: ${fallback}. Re-route recommended.` }],
        isError: true,
        _meta: { circuitOpen: true, tier, fallback },
      };
    }

    // Execute the original handler
    try {
      const result = await originalHandler(args, ctx);
      const latencyMs = Date.now() - t0;

      // Record success
      if (tier) recordSuccess(tier);

      // Extract response text for confidence scoring
      const responseText = result?.content?.[0]?.text || '';
      const prompt = args?.prompt || args?.task || '';
      const confidence = scoreConfidence({
        response: responseText,
        question: prompt,
        latencyMs,
        tokensOut: result?._meta?.tokensOut || 0,
        tier: tier || 'unknown',
        ragHit: responseText.includes('[RAG]') || responseText.includes('context'),
      });

      // Telemetry
      telemetryRecord({
        type: 'tool_call', tier: tier || toolName, tool: toolName,
        success: true, latencyMs,
        tokens: result?._meta?.tokensOut || null,
        tokensPerSec: result?._meta?.tps || null,
        confidence: confidence.composite,
      });

      // Attach confidence to result metadata
      if (result._meta) {
        result._meta.confidence = confidence;
      } else {
        result._meta = { confidence };
      }

      return result;
    } catch (err) {
      const latencyMs = Date.now() - t0;

      // Record failure
      if (tier) recordFailure(tier);

      // Telemetry
      telemetryRecord({
        type: 'tool_call', tier: tier || toolName, tool: toolName,
        success: false, latencyMs, error: err.message,
      });

      throw err;
    }
  };
}

export { resolveTier, TOOL_TIER_MAP };
