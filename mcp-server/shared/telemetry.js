/**
 * Telemetry Engine — Collects, aggregates, and exposes system metrics.
 * 
 * Records: model calls, latency, tokens, success/failure, RAG hits, routing decisions.
 * Storage: In-memory ring buffer (last 1000 events) + JSONL append on disk.
 * Query: Aggregated metrics (p50/p95/p99 latency, throughput, error rates).
 */

import { appendFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const RING_SIZE = 1000;
const ring = [];
let totalEvents = 0;
let telemetryDir = null;

/**
 * Initialize telemetry with a storage directory.
 * @param {string} dir - Directory for JSONL persistence
 */
export async function initTelemetry(dir) {
  telemetryDir = dir;
  await mkdir(dir, { recursive: true });
}

/**
 * Record a telemetry event.
 * @param {Object} event
 * @param {string} event.category - tool|model|memory|chain|system
 * @param {string} event.event - Specific event name (e.g. model.inference.complete)
 * @param {string} [event.tier] - fast|specialist|reasoning|groq|gemini
 * @param {string} [event.model] - Full model name
 * @param {number} [event.latencyMs] - Duration in ms
 * @param {number} [event.tokensOut] - Output token count
 * @param {boolean} [event.success] - Whether the operation succeeded
 * @param {string} [event.reason] - Routing reason or error message
 * @param {Object} [event.meta] - Additional metadata
 */
export function record(event) {
  const entry = {
    id: totalEvents++,
    timestamp: Date.now(),
    ...event,
  };
  ring.push(entry);
  if (ring.length > RING_SIZE) ring.shift();

  // Async persist (fire-and-forget)
  if (telemetryDir) {
    const line = JSON.stringify(entry) + '\n';
    appendFile(resolve(telemetryDir, 'events.jsonl'), line).catch(() => {});
  }

  return entry;
}

/**
 * Get aggregated metrics for a time window.
 * @param {number} [windowMs=300000] - Time window in ms (default: 5 minutes)
 * @returns {Object} Aggregated metrics
 */
export function getMetrics(windowMs = 300000) {
  const cutoff = Date.now() - windowMs;
  const recent = ring.filter(e => e.timestamp >= cutoff);

  // Group by tier
  const byTier = {};
  const modelCalls = recent.filter(e => e.category === 'model');
  for (const call of modelCalls) {
    const tier = call.tier || 'unknown';
    if (!byTier[tier]) byTier[tier] = { calls: 0, successes: 0, failures: 0, latencies: [], tokens: 0 };
    byTier[tier].calls++;
    if (call.success) byTier[tier].successes++;
    else byTier[tier].failures++;
    if (call.latencyMs) byTier[tier].latencies.push(call.latencyMs);
    if (call.tokensOut) byTier[tier].tokens += call.tokensOut;
  }

  // Compute percentiles
  for (const tier of Object.values(byTier)) {
    tier.latencies.sort((a, b) => a - b);
    const len = tier.latencies.length;
    tier.p50 = len > 0 ? tier.latencies[Math.floor(len * 0.5)] : 0;
    tier.p95 = len > 0 ? tier.latencies[Math.floor(len * 0.95)] : 0;
    tier.p99 = len > 0 ? tier.latencies[Math.floor(len * 0.99)] : 0;
    tier.errorRate = tier.calls > 0 ? (tier.failures / tier.calls) : 0;
    tier.tokensPerSec = tier.latencies.length > 0
      ? (tier.tokens / (tier.latencies.reduce((a, b) => a + b, 0) / 1000))
      : 0;
    delete tier.latencies; // Don't expose raw array
  }

  // RAG stats
  const ragEvents = recent.filter(e => e.category === 'memory');
  const ragHits = ragEvents.filter(e => e.event === 'memory.hit').length;
  const ragMisses = ragEvents.filter(e => e.event === 'memory.miss').length;
  const ragLatencies = ragEvents.filter(e => e.latencyMs).map(e => e.latencyMs);
  ragLatencies.sort((a, b) => a - b);

  // Routing breakdown
  const routingEvents = recent.filter(e => e.category === 'routing');

  return {
    window: { ms: windowMs, from: cutoff, to: Date.now() },
    totalEvents: totalEvents,
    recentEvents: recent.length,
    models: byTier,
    rag: {
      queries: ragHits + ragMisses,
      hits: ragHits,
      misses: ragMisses,
      hitRate: (ragHits + ragMisses) > 0 ? ragHits / (ragHits + ragMisses) : 0,
      p50: ragLatencies.length > 0 ? ragLatencies[Math.floor(ragLatencies.length * 0.5)] : 0,
    },
    routing: {
      decisions: routingEvents.length,
      fallbacks: routingEvents.filter(e => e.event === 'routing.fallback').length,
      breakerTrips: routingEvents.filter(e => e.event === 'routing.breaker_trip').length,
    },
  };
}

/**
 * Get raw recent events (for streaming to UI).
 * @param {number} [count=50] - Number of recent events
 * @returns {Array}
 */
export function getRecentEvents(count = 50) {
  return ring.slice(-count);
}

/**
 * Get total event count since boot.
 */
export function getTotalEvents() {
  return totalEvents;
}
