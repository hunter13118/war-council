import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { recordOutcome, getThresholds, adaptiveLevel, getTierAccuracy, resetAdaptive } from '../mcp-server/shared/adaptive-thresholds.js';

describe('Adaptive Threshold Tuning', () => {
  beforeEach(() => {
    resetAdaptive();
  });

  it('starts with default thresholds', () => {
    const t = getThresholds();
    assert.equal(t.high, 0.8);
    assert.equal(t.medium, 0.6);
    assert.equal(t.low, 0.4);
    assert.equal(t.adapted, false);
    assert.equal(t.samples, 0);
  });

  it('does not adapt before MIN_SAMPLES', () => {
    for (let i = 0; i < 5; i++) {
      recordOutcome(0.9, true, 'fast');
    }
    const t = getThresholds();
    assert.equal(t.adapted, false);
    assert.equal(t.high, 0.8); // unchanged
  });

  it('adapts after enough samples', () => {
    // Feed a bunch of accepted high-confidence results
    for (let i = 0; i < 15; i++) {
      recordOutcome(0.85 + Math.random() * 0.1, true, 'specialist');
    }
    // Feed some rejected low-confidence results
    for (let i = 0; i < 10; i++) {
      recordOutcome(0.2 + Math.random() * 0.2, false, 'fast');
    }
    const t = getThresholds();
    assert.equal(t.adapted, true);
    assert.equal(t.samples, 25);
    assert.ok(t.adaptationCount > 0);
  });

  it('adaptiveLevel uses current thresholds', () => {
    assert.equal(adaptiveLevel(0.95), 'high');
    assert.equal(adaptiveLevel(0.7), 'medium');
    assert.equal(adaptiveLevel(0.5), 'low');
    assert.equal(adaptiveLevel(0.2), 'uncertain');
  });

  it('thresholds move toward accepted outcomes', () => {
    // All outcomes at 0.7 are accepted → medium threshold should lower
    for (let i = 0; i < 20; i++) {
      recordOutcome(0.7, true, 'specialist');
    }
    for (let i = 0; i < 10; i++) {
      recordOutcome(0.3, false, 'fast');
    }
    const t = getThresholds();
    // High threshold should have moved (EMA smoothing means partial shift)
    assert.ok(t.high <= 0.8, `high should be <= 0.8, got ${t.high}`);
  });

  it('getTierAccuracy reports per-tier stats', () => {
    recordOutcome(0.9, true, 'specialist');
    recordOutcome(0.8, true, 'specialist');
    recordOutcome(0.5, false, 'specialist');
    recordOutcome(0.4, false, 'fast');
    recordOutcome(0.6, true, 'fast');

    const stats = getTierAccuracy();
    assert.equal(stats.specialist.total, 3);
    assert.equal(stats.specialist.accepted, 2);
    assert.ok(Math.abs(stats.specialist.rate - 0.67) < 0.01);
    assert.equal(stats.fast.total, 2);
    assert.equal(stats.fast.accepted, 1);
    assert.equal(stats.fast.rate, 0.5);
  });

  it('rolling window caps at WINDOW_SIZE', () => {
    for (let i = 0; i < 150; i++) {
      recordOutcome(Math.random(), Math.random() > 0.5, 'fast');
    }
    const t = getThresholds();
    assert.equal(t.samples, 100); // capped at WINDOW_SIZE
  });

  it('thresholds maintain ordering (high > medium > low)', () => {
    // Feed random data
    for (let i = 0; i < 50; i++) {
      const score = Math.random();
      recordOutcome(score, score > 0.5, 'specialist');
    }
    const t = getThresholds();
    assert.ok(t.high > t.medium, `high (${t.high}) should be > medium (${t.medium})`);
    assert.ok(t.medium > t.low, `medium (${t.medium}) should be > low (${t.low})`);
  });
});
