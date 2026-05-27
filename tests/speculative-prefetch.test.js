import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  recordQuery, checkPrefetchCache, getPredictions,
  getPrefetchStats, getTransitionMatrix, resetPrefetch
} from '../mcp-server/shared/speculative-prefetch.js';

describe('Speculative Pre-fetching', () => {
  beforeEach(() => {
    resetPrefetch();
  });

  it('starts with empty stats', () => {
    const stats = getPrefetchStats();
    assert.equal(stats.hits, 0);
    assert.equal(stats.misses, 0);
    assert.equal(stats.cacheSize, 0);
    assert.equal(stats.hitRate, 0);
  });

  it('detects topics from queries', () => {
    recordQuery('How does the circuit breaker work?');
    const stats = getPrefetchStats();
    assert.ok(stats.topicHistory.includes('reliability'));
  });

  it('builds transition matrix from sequential queries', () => {
    recordQuery('Tell me about rate limiting');
    recordQuery('Now explain circuit breakers');
    recordQuery('What about error handling?');

    const matrix = getTransitionMatrix();
    assert.ok(matrix.length > 0, 'Should have transitions');
    assert.ok(matrix.some(t => t.from === 'rate-limiting' && t.to === 'reliability'));
  });

  it('predicts next topic based on history', () => {
    // Train: reliability often leads to debugging
    recordQuery('circuit breaker status');
    recordQuery('debug the error');
    recordQuery('circuit breaker reset');
    recordQuery('debug stack trace');
    recordQuery('breaker tripped');

    const predictions = getPredictions();
    assert.ok(predictions.length > 0, 'Should produce predictions');
    // Current topic is 'reliability', should predict 'debugging'
    assert.ok(predictions.some(p => p.topic === 'debugging'),
      `Should predict debugging, got: ${JSON.stringify(predictions)}`);
  });

  it('cache hit after recording file access', () => {
    recordQuery('How does confidence scoring work?', ['mcp-server/shared/confidence.js']);
    const check = checkPrefetchCache('what about the confidence thresholds?');
    // Topic is 'confidence' — should hit cached confidence.js
    assert.ok(check.hit, 'Should be a cache hit');
  });

  it('cache miss for unrelated topic', () => {
    recordQuery('How does confidence work?', ['confidence.js']);
    const check = checkPrefetchCache('deploy to production');
    assert.equal(check.hit, false);
  });

  it('stats track hits and misses', () => {
    // Record a query about confidence, caching a file with "confidence" in its name
    recordQuery('how does confidence scoring work?', ['confidence-module.js']);
    checkPrefetchCache('what are the confidence thresholds?');  // hit — topic="confidence", key has "confidence"
    checkPrefetchCache('deploy to production');                  // miss — topic="deployment"

    const stats = getPrefetchStats();
    assert.equal(stats.hits, 1);
    assert.equal(stats.misses, 1);
    assert.equal(stats.hitRate, 0.5);
  });

  it('provides heuristic predictions when no history', () => {
    recordQuery('test the authentication');
    const predictions = getPredictions();
    assert.ok(predictions.length > 0, 'Should have heuristic predictions');
    assert.ok(predictions.some(p => p.basis === 'heuristic'));
  });

  it('transition matrix shows probabilities', () => {
    recordQuery('rate limits');
    recordQuery('circuit breaker');
    recordQuery('rate limits');
    recordQuery('circuit breaker');
    recordQuery('rate limits');
    recordQuery('debug error');

    const matrix = getTransitionMatrix();
    const rateToReliability = matrix.find(t => t.from === 'rate-limiting' && t.to === 'reliability');
    assert.ok(rateToReliability, 'Should find rate-limiting→reliability transition');
    assert.ok(rateToReliability.probability > 0.5, 'Should be high probability');
  });
});
