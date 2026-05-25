import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CircuitBreaker, isAvailable, recordSuccess, recordFailure, getAllStatus, findFallback, getBreaker } from '../mcp-server/shared/circuit-breaker.js';

describe('CircuitBreaker — unit', () => {
  let cb;

  beforeEach(() => {
    cb = new CircuitBreaker(3, 100); // 3 failures, 100ms reset
  });

  it('starts in closed state', () => {
    assert.equal(cb.state, 'closed');
    assert.equal(cb.canExecute(), true);
  });

  it('stays closed with fewer failures than threshold', () => {
    cb.recordFailure();
    cb.recordFailure();
    assert.equal(cb.state, 'closed');
    assert.equal(cb.canExecute(), true);
  });

  it('trips to open after threshold failures', () => {
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    assert.equal(cb.state, 'open');
    assert.equal(cb.canExecute(), false);
  });

  it('resets failure count on success', () => {
    cb.recordFailure();
    cb.recordFailure();
    cb.recordSuccess();
    assert.equal(cb.failures, 0);
    assert.equal(cb.state, 'closed');
    // Now need 3 more failures to trip
    cb.recordFailure();
    cb.recordFailure();
    assert.equal(cb.state, 'closed');
  });

  it('transitions open → half-open after reset timeout', async () => {
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    assert.equal(cb.state, 'open');
    assert.equal(cb.canExecute(), false);
    // Wait for reset
    await new Promise(r => setTimeout(r, 120));
    assert.equal(cb.canExecute(), true);
    assert.equal(cb.state, 'half-open');
  });

  it('half-open → closed on success', async () => {
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    await new Promise(r => setTimeout(r, 120));
    cb.canExecute(); // triggers half-open
    cb.recordSuccess();
    assert.equal(cb.state, 'closed');
    assert.equal(cb.failures, 0);
  });

  it('half-open → open on failure', async () => {
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    await new Promise(r => setTimeout(r, 120));
    cb.canExecute(); // triggers half-open
    cb.recordFailure();
    assert.equal(cb.state, 'open');
  });

  it('getStatus returns full state', () => {
    cb.recordFailure();
    const status = cb.getStatus();
    assert.equal(status.state, 'closed');
    assert.equal(status.failures, 1);
    assert.equal(status.threshold, 3);
    assert.equal(status.resetTimeMs, 100);
    assert.equal(status.totalTrips, 0);
  });

  it('tracks totalTrips across multiple open/close cycles', async () => {
    // Trip 1
    cb.recordFailure(); cb.recordFailure(); cb.recordFailure();
    assert.equal(cb.totalTrips, 1);
    await new Promise(r => setTimeout(r, 120));
    cb.canExecute();
    cb.recordSuccess();
    // Trip 2
    cb.recordFailure(); cb.recordFailure(); cb.recordFailure();
    assert.equal(cb.totalTrips, 2);
  });
});

describe('CircuitBreaker — registry functions', () => {
  it('isAvailable returns true for known tier in closed state', () => {
    assert.equal(isAvailable('fast'), true);
    assert.equal(isAvailable('specialist'), true);
    assert.equal(isAvailable('reasoning'), true);
    assert.equal(isAvailable('groq'), true);
    assert.equal(isAvailable('gemini'), true);
  });

  it('isAvailable returns true for unknown tier', () => {
    assert.equal(isAvailable('nonexistent_model'), true);
  });

  it('recordSuccess/recordFailure work on registry breakers', () => {
    // Fresh state — trip the fast breaker (threshold=5)
    const breaker = getBreaker('fast');
    const initialFailures = breaker.failures;
    recordFailure('fast');
    assert.equal(breaker.failures, initialFailures + 1);
    recordSuccess('fast');
    assert.equal(breaker.failures, 0);
  });

  it('getAllStatus returns all tiers', () => {
    const status = getAllStatus();
    assert.ok('fast' in status);
    assert.ok('specialist' in status);
    assert.ok('reasoning' in status);
    assert.ok('groq' in status);
    assert.ok('gemini' in status);
    assert.equal(status.fast.state, 'closed');
  });

  it('findFallback returns alternative tier when preferred is unavailable', () => {
    // In hybrid mode, if 'fast' is preferred, should find specialist or reasoning
    const fallback = findFallback('fast', 'hybrid');
    assert.ok(['specialist', 'reasoning', 'groq', 'gemini'].includes(fallback));
  });

  it('findFallback respects mode constraints', () => {
    const localFallback = findFallback('fast', 'local');
    assert.ok(['specialist', 'reasoning'].includes(localFallback));

    const cloudFallback = findFallback('groq', 'cloud');
    assert.equal(cloudFallback, 'gemini');
  });

  it('findFallback returns null when all tiers in mode are the preferred one', () => {
    // Trip gemini and openrouter so only groq remains — but groq is the preferred, so null
    const geminiBreaker = getBreaker('gemini');
    const openrouterBreaker = getBreaker('openrouter');
    const origGemini = geminiBreaker.state;
    const origOpenrouter = openrouterBreaker.state;
    // Force open
    for (let i = 0; i < 5; i++) geminiBreaker.recordFailure();
    for (let i = 0; i < 5; i++) openrouterBreaker.recordFailure();
    const result = findFallback('groq', 'cloud');
    assert.equal(result, null);
    // Restore
    geminiBreaker.state = origGemini;
    geminiBreaker.failures = 0;
    openrouterBreaker.state = origOpenrouter;
    openrouterBreaker.failures = 0;
  });
});
