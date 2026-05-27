/**
 * Adaptive Threshold Tuning
 *
 * Automatically adjusts confidence thresholds based on rolling historical data.
 * Tracks user feedback (accept/reject/edit) correlated with confidence scores
 * to learn where the "good enough" boundary actually sits.
 *
 * Algorithm:
 *   1. Maintain a rolling window of (confidence_score, was_accepted) pairs
 *   2. Find the optimal threshold that maximizes separation (accepted above, rejected below)
 *   3. Smooth adjustments with exponential moving average to prevent wild swings
 *   4. Export adjusted thresholds for use in routing decisions
 */

const DEFAULT_THRESHOLDS = { high: 0.8, medium: 0.6, low: 0.4 };
const WINDOW_SIZE = 100; // Rolling window of recent outcomes
const SMOOTHING_FACTOR = 0.15; // EMA smoothing (lower = more stable)
const MIN_SAMPLES = 10; // Minimum samples before adapting

let history = []; // { score, accepted, tier, timestamp }
let currentThresholds = { ...DEFAULT_THRESHOLDS };
let adaptationCount = 0;

/**
 * Record an outcome — a confidence score paired with whether the output was accepted.
 * @param {number} score - The confidence composite (0-1)
 * @param {boolean} accepted - Was the output accepted (true) or rejected/edited (false)
 * @param {string} [tier] - Which model tier produced this
 */
export function recordOutcome(score, accepted, tier = 'unknown') {
  history.push({ score, accepted, tier, timestamp: Date.now() });

  // Trim to window size
  if (history.length > WINDOW_SIZE) {
    history = history.slice(-WINDOW_SIZE);
  }

  // Re-tune if we have enough samples
  if (history.length >= MIN_SAMPLES) {
    adapt();
  }
}

/**
 * Get the current adaptive thresholds.
 * @returns {{ high: number, medium: number, low: number, adapted: boolean, samples: number }}
 */
export function getThresholds() {
  return {
    ...currentThresholds,
    adapted: history.length >= MIN_SAMPLES,
    samples: history.length,
    adaptationCount,
  };
}

/**
 * Classify a score using adaptive thresholds.
 * @param {number} score
 * @returns {'high'|'medium'|'low'|'uncertain'}
 */
export function adaptiveLevel(score) {
  if (score >= currentThresholds.high) return 'high';
  if (score >= currentThresholds.medium) return 'medium';
  if (score >= currentThresholds.low) return 'low';
  return 'uncertain';
}

/**
 * Core adaptation algorithm.
 * Finds optimal thresholds via acceptance rate analysis.
 */
function adapt() {
  const sorted = [...history].sort((a, b) => a.score - b.score);

  // Find the score where acceptance rate crosses 50% (low threshold)
  // and where it crosses 80% (high threshold)
  const buckets = buildBuckets(sorted, 10);

  let newHigh = DEFAULT_THRESHOLDS.high;
  let newMedium = DEFAULT_THRESHOLDS.medium;
  let newLow = DEFAULT_THRESHOLDS.low;

  // Find threshold where acceptance rate >= 90% → high
  for (let i = buckets.length - 1; i >= 0; i--) {
    if (buckets[i].acceptRate >= 0.9 && buckets[i].count >= 2) {
      newHigh = buckets[i].minScore;
      break;
    }
  }

  // Find threshold where acceptance rate >= 65% → medium
  for (let i = buckets.length - 1; i >= 0; i--) {
    if (buckets[i].acceptRate >= 0.65 && buckets[i].count >= 2) {
      newMedium = Math.min(buckets[i].minScore, newHigh - 0.05);
      break;
    }
  }

  // Find threshold where acceptance rate >= 35% → low
  for (let i = buckets.length - 1; i >= 0; i--) {
    if (buckets[i].acceptRate >= 0.35 && buckets[i].count >= 2) {
      newLow = Math.min(buckets[i].minScore, newMedium - 0.05);
      break;
    }
  }

  // Clamp values
  newHigh = Math.max(0.5, Math.min(0.95, newHigh));
  newMedium = Math.max(0.3, Math.min(newHigh - 0.1, newMedium));
  newLow = Math.max(0.15, Math.min(newMedium - 0.1, newLow));

  // Smooth with EMA
  currentThresholds.high = ema(currentThresholds.high, newHigh);
  currentThresholds.medium = ema(currentThresholds.medium, newMedium);
  currentThresholds.low = ema(currentThresholds.low, newLow);

  // Round for cleanliness
  currentThresholds.high = Math.round(currentThresholds.high * 100) / 100;
  currentThresholds.medium = Math.round(currentThresholds.medium * 100) / 100;
  currentThresholds.low = Math.round(currentThresholds.low * 100) / 100;

  adaptationCount++;
}

function buildBuckets(sorted, numBuckets) {
  const buckets = [];
  const perBucket = Math.ceil(sorted.length / numBuckets);

  for (let i = 0; i < numBuckets; i++) {
    const slice = sorted.slice(i * perBucket, (i + 1) * perBucket);
    if (slice.length === 0) continue;
    const accepted = slice.filter(s => s.accepted).length;
    buckets.push({
      minScore: slice[0].score,
      maxScore: slice[slice.length - 1].score,
      acceptRate: accepted / slice.length,
      count: slice.length,
    });
  }
  return buckets;
}

function ema(current, target) {
  return current + SMOOTHING_FACTOR * (target - current);
}

/**
 * Get per-tier accuracy stats.
 * @returns {Record<string, { total: number, accepted: number, rate: number }>}
 */
export function getTierAccuracy() {
  const byTier = {};
  for (const h of history) {
    if (!byTier[h.tier]) byTier[h.tier] = { total: 0, accepted: 0 };
    byTier[h.tier].total++;
    if (h.accepted) byTier[h.tier].accepted++;
  }
  for (const tier of Object.keys(byTier)) {
    byTier[tier].rate = byTier[tier].total > 0
      ? Math.round((byTier[tier].accepted / byTier[tier].total) * 100) / 100
      : 0;
  }
  return byTier;
}

/**
 * Reset adaptive state (for testing).
 */
export function resetAdaptive() {
  history = [];
  currentThresholds = { ...DEFAULT_THRESHOLDS };
  adaptationCount = 0;
}
