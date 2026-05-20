import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { withInstrumentation, resolveTier, TOOL_TIER_MAP } from '../mcp-server/shared/tool-middleware.js';

// Reset circuit breaker state between tests
import { isAvailable, recordFailure } from '../mcp-server/shared/circuit-breaker.js';
import { initTelemetry, getRecentEvents } from '../mcp-server/shared/telemetry.js';
import { resolve } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

describe('Tool Middleware — resolveTier', () => {
  it('maps consult_fast to fast tier', () => {
    assert.equal(resolveTier('consult_fast', {}), 'fast');
  });

  it('maps consult_specialist to specialist tier', () => {
    assert.equal(resolveTier('consult_specialist', {}), 'specialist');
  });

  it('maps consult_reasoning to reasoning tier', () => {
    assert.equal(resolveTier('consult_reasoning', {}), 'reasoning');
  });

  it('maps consult_cloud with gemini to gemini tier', () => {
    assert.equal(resolveTier('consult_cloud', { provider: 'gemini' }), 'gemini');
  });

  it('maps consult_cloud with groq to groq tier', () => {
    assert.equal(resolveTier('consult_cloud', { provider: 'groq' }), 'groq');
  });

  it('returns null for tools without model calls', () => {
    assert.equal(resolveTier('smart_route', {}), null);
  });
});

describe('Tool Middleware — withInstrumentation', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await mkdtemp(resolve(tmpdir(), 'mw-test-'));
    initTelemetry(tmpDir);
  });

  it('passes through successful handler result', async () => {
    const handler = async (args) => ({
      content: [{ type: 'text', text: `Hello ${args.prompt}` }],
      _meta: { model: 'test', tokensOut: 50, tps: 100 },
    });

    const wrapped = withInstrumentation('consult_fast', handler);
    const result = await wrapped({ prompt: 'world' }, {});

    assert.equal(result.content[0].text, 'Hello world');
    assert.ok(result._meta.confidence); // confidence was attached
    assert.ok(result._meta.confidence.composite >= 0);
  });

  it('records telemetry on success', async () => {
    const handler = async () => ({
      content: [{ type: 'text', text: 'test response with enough words to score well' }],
      _meta: { tokensOut: 30 },
    });

    const wrapped = withInstrumentation('consult_specialist', handler);
    await wrapped({ prompt: 'test query' }, {});

    const events = getRecentEvents(10);
    const toolEvent = events.find(e => e.tool === 'consult_specialist');
    assert.ok(toolEvent);
    assert.equal(toolEvent.success, true);
    assert.ok(toolEvent.latencyMs >= 0);
  });

  it('records telemetry on failure', async () => {
    const handler = async () => { throw new Error('model crashed'); };

    const wrapped = withInstrumentation('consult_fast', handler);
    await assert.rejects(() => wrapped({ prompt: 'test' }, {}), /model crashed/);

    const events = getRecentEvents(10);
    const errorEvent = events.find(e => e.tool === 'consult_fast' && !e.success);
    assert.ok(errorEvent);
    assert.equal(errorEvent.error, 'model crashed');
  });

  it('returns error when circuit breaker is open', async () => {
    // Trip the groq breaker (threshold 3)
    recordFailure('groq');
    recordFailure('groq');
    recordFailure('groq');

    assert.equal(isAvailable('groq'), false);

    const handler = async () => ({ content: [{ type: 'text', text: 'should not run' }] });
    const wrapped = withInstrumentation('consult_cloud', handler);
    const result = await wrapped({ prompt: 'test', provider: 'groq' }, {});

    assert.ok(result.isError);
    assert.ok(result.content[0].text.includes('Circuit breaker OPEN'));
  });

  it('attaches confidence metadata to result', async () => {
    const handler = async () => ({
      content: [{ type: 'text', text: 'The function uses a HashMap for O(1) lookups to process the data efficiently with proper error handling.' }],
      _meta: { model: 'qwen2.5-coder:7b', tokensOut: 20, tps: 200 },
    });

    const wrapped = withInstrumentation('consult_fast', handler);
    const result = await wrapped({ prompt: 'How does the function work?' }, {});

    assert.ok(result._meta.confidence);
    assert.ok(result._meta.confidence.composite > 0);
    assert.ok(result._meta.confidence.dimensions);
    assert.ok(result._meta.confidence.tier);
  });
});
