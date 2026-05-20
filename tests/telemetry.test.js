import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { record, getMetrics, getRecentEvents, getTotalEvents } from '../mcp-server/shared/telemetry.js';

describe('Telemetry — record and query', () => {
  it('records events and increments total count', () => {
    const before = getTotalEvents();
    record({ category: 'model', event: 'model.inference.complete', tier: 'fast', model: 'test:7b', latencyMs: 100, tokensOut: 50, success: true });
    assert.equal(getTotalEvents(), before + 1);
  });

  it('getRecentEvents returns recorded events', () => {
    const before = getRecentEvents(100).length;
    record({ category: 'model', event: 'test.event', tier: 'specialist', latencyMs: 200, success: true });
    const after = getRecentEvents(100);
    assert.equal(after.length, before + 1);
    assert.equal(after[after.length - 1].event, 'test.event');
  });

  it('events have timestamp and id', () => {
    record({ category: 'system', event: 'system.test', success: true });
    const events = getRecentEvents(1);
    const last = events[events.length - 1];
    assert.ok(last.timestamp > 0);
    assert.ok(typeof last.id === 'number');
  });
});

describe('Telemetry — getMetrics aggregation', () => {
  // Seed some events
  beforeEach(() => {
    // Record model events for different tiers
    for (let i = 0; i < 5; i++) {
      record({ category: 'model', event: 'model.inference.complete', tier: 'fast', model: 'qwen:7b', latencyMs: 80 + i * 20, tokensOut: 40 + i * 5, success: true });
    }
    record({ category: 'model', event: 'model.inference.error', tier: 'fast', model: 'qwen:7b', latencyMs: 5000, success: false, reason: 'timeout' });
    record({ category: 'model', event: 'model.inference.complete', tier: 'groq', model: 'llama-70b', latencyMs: 300, tokensOut: 100, success: true });

    // RAG events
    record({ category: 'memory', event: 'memory.hit', latencyMs: 45 });
    record({ category: 'memory', event: 'memory.hit', latencyMs: 62 });
    record({ category: 'memory', event: 'memory.miss', latencyMs: 30 });

    // Routing events
    record({ category: 'routing', event: 'routing.fallback', tier: 'specialist', meta: { fallbackTo: 'fast' } });
  });

  it('returns model metrics grouped by tier', () => {
    const m = getMetrics(60000);
    assert.ok('fast' in m.models);
    assert.ok(m.models.fast.calls > 0);
    assert.ok(m.models.fast.successes > 0);
    assert.ok(m.models.fast.failures > 0);
    assert.ok(m.models.fast.p50 > 0);
    assert.ok(m.models.fast.p95 >= m.models.fast.p50);
  });

  it('calculates error rate correctly', () => {
    const m = getMetrics(60000);
    // At least 5 successes + 1 failure for fast tier
    assert.ok(m.models.fast.errorRate > 0);
    assert.ok(m.models.fast.errorRate < 1);
  });

  it('returns RAG hit rate', () => {
    const m = getMetrics(60000);
    assert.ok(m.rag.queries > 0);
    assert.ok(m.rag.hits > 0);
    assert.ok(m.rag.hitRate > 0);
    assert.ok(m.rag.hitRate <= 1);
  });

  it('returns routing fallback count', () => {
    const m = getMetrics(60000);
    assert.ok(m.routing.decisions > 0);
    assert.ok(m.routing.fallbacks > 0);
  });

  it('respects time window — very old events would be excluded', () => {
    // With a very large window, everything shows. With a very small window, less shows.
    const wide = getMetrics(9999999);
    const narrow = getMetrics(1);
    // Narrow window should have fewer or equal events compared to wide
    assert.ok(narrow.recentEvents <= wide.recentEvents);
  });

  it('tokensPerSec is calculated', () => {
    const m = getMetrics(60000);
    if (m.models.fast) {
      assert.ok(m.models.fast.tokensPerSec > 0);
    }
  });
});
