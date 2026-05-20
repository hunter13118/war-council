/**
 * Circuit Breaker — Per-model fault isolation.
 * 
 * States: closed (normal) → open (blocking) → half-open (testing)
 * Prevents cascading failures by cutting off models that are consistently failing.
 * Auto-recovers after reset timeout by allowing a test request through.
 */

export class CircuitBreaker {
  constructor(failureThreshold = 5, resetTimeMs = 60000) {
    this.state = 'closed';
    this.failures = 0;
    this.successes = 0;
    this.threshold = failureThreshold;
    this.resetTime = resetTimeMs;
    this.lastFailure = 0;
    this.lastStateChange = Date.now();
    this.totalTrips = 0;
  }

  canExecute() {
    if (this.state === 'closed') return true;
    if (this.state === 'open') {
      if (Date.now() - this.lastFailure > this.resetTime) {
        this.state = 'half-open';
        this.lastStateChange = Date.now();
        return true;
      }
      return false;
    }
    return true; // half-open: allow test request
  }

  recordSuccess() {
    this.successes++;
    if (this.state === 'half-open') {
      this.state = 'closed';
      this.failures = 0;
      this.lastStateChange = Date.now();
    } else {
      this.failures = 0;
    }
  }

  recordFailure() {
    this.failures++;
    this.lastFailure = Date.now();
    if (this.state === 'half-open') {
      this.state = 'open';
      this.totalTrips++;
      this.lastStateChange = Date.now();
    } else if (this.failures >= this.threshold) {
      this.state = 'open';
      this.totalTrips++;
      this.lastStateChange = Date.now();
    }
  }

  getStatus() {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      threshold: this.threshold,
      resetTimeMs: this.resetTime,
      lastFailure: this.lastFailure,
      lastStateChange: this.lastStateChange,
      totalTrips: this.totalTrips,
      timeUntilReset: this.state === 'open'
        ? Math.max(0, this.resetTime - (Date.now() - this.lastFailure))
        : 0
    };
  }
}

/** Registry of all model circuit breakers */
const breakers = {
  fast: new CircuitBreaker(5, 30000),       // 7b: tolerant, fast reset
  specialist: new CircuitBreaker(3, 60000), // 14b: moderate
  reasoning: new CircuitBreaker(3, 60000),  // deepseek-r1: moderate
  groq: new CircuitBreaker(3, 300000),      // Cloud: longer reset (rate limits)
  gemini: new CircuitBreaker(3, 300000),    // Cloud: longer reset
};

/**
 * Get the circuit breaker for a given model/tier.
 * @param {string} tier - One of: fast, specialist, reasoning, groq, gemini
 */
export function getBreaker(tier) {
  return breakers[tier] || null;
}

/**
 * Check if a tier is available (circuit not open).
 * @param {string} tier
 * @returns {boolean}
 */
export function isAvailable(tier) {
  const breaker = breakers[tier];
  if (!breaker) return true; // unknown tier = allow
  return breaker.canExecute();
}

/**
 * Record success for a tier.
 * @param {string} tier
 */
export function recordSuccess(tier) {
  const breaker = breakers[tier];
  if (breaker) breaker.recordSuccess();
}

/**
 * Record failure for a tier.
 * @param {string} tier
 * @returns {{ tripped: boolean, state: string }} Whether this failure tripped the breaker
 */
export function recordFailure(tier) {
  const breaker = breakers[tier];
  if (!breaker) return { tripped: false, state: 'unknown' };
  const prevState = breaker.state;
  breaker.recordFailure();
  return { tripped: breaker.state === 'open' && prevState !== 'open', state: breaker.state };
}

/**
 * Get status of all breakers.
 * @returns {Object.<string, Object>}
 */
export function getAllStatus() {
  const result = {};
  for (const [tier, breaker] of Object.entries(breakers)) {
    result[tier] = breaker.getStatus();
  }
  return result;
}

/**
 * Find the best available fallback tier when the preferred one is open.
 * @param {string} preferredTier
 * @param {'local'|'cloud'|'hybrid'} mode
 * @returns {string|null} fallback tier or null if everything is down
 */
export function findFallback(preferredTier, mode = 'hybrid') {
  const localFallbacks = ['fast', 'specialist', 'reasoning'];
  const cloudFallbacks = ['groq', 'gemini'];

  let candidates;
  if (mode === 'local') candidates = localFallbacks;
  else if (mode === 'cloud') candidates = cloudFallbacks;
  else candidates = [...localFallbacks, ...cloudFallbacks];

  // Remove the preferred tier and find first available
  for (const tier of candidates) {
    if (tier === preferredTier) continue;
    if (isAvailable(tier)) return tier;
  }
  return null;
}
