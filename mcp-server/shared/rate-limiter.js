/**
 * Rate limit tracker — sliding window counter for cloud API usage.
 * 
 * Tracks requests per minute for each provider. If approaching the limit,
 * throws a descriptive error instead of hitting 429s.
 * 
 * Free tier limits (as of 2024):
 *   - Gemini: 15 RPM (requests per minute), 1M TPM (tokens per minute)
 *   - Groq: 30 RPM, 6000 TPD (tokens per day on free)
 */

class SlidingWindowCounter {
  constructor(windowMs, maxRequests) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.timestamps = [];
  }

  /** Remove expired entries and return current count */
  _prune() {
    const cutoff = Date.now() - this.windowMs;
    this.timestamps = this.timestamps.filter(t => t > cutoff);
  }

  /** Check if a request is allowed without recording it */
  canRequest() {
    this._prune();
    return this.timestamps.length < this.maxRequests;
  }

  /** Record a request. Returns true if allowed, false if rate limited. */
  record() {
    this._prune();
    if (this.timestamps.length >= this.maxRequests) {
      return false;
    }
    this.timestamps.push(Date.now());
    return true;
  }

  /** Get remaining requests in current window */
  remaining() {
    this._prune();
    return Math.max(0, this.maxRequests - this.timestamps.length);
  }

  /** Get ms until next slot opens */
  msUntilAvailable() {
    this._prune();
    if (this.timestamps.length < this.maxRequests) return 0;
    return this.timestamps[0] + this.windowMs - Date.now();
  }

  /** Current usage stats */
  stats() {
    this._prune();
    return {
      used: this.timestamps.length,
      limit: this.maxRequests,
      remaining: this.remaining(),
      windowMs: this.windowMs,
      msUntilSlot: this.msUntilAvailable(),
    };
  }
}

// Provider rate limits (conservative to avoid 429s)
const LIMITS = {
  gemini: { rpm: 14, windowMs: 60_000 }, // Free tier: 15 RPM, leave 1 margin
  groq: { rpm: 28, windowMs: 60_000 },   // Free tier: 30 RPM, leave 2 margin
  openrouter: { rpm: 18, windowMs: 60_000 }, // Free tier: 20 RPM, leave 2 margin
};

const counters = new Map();

/**
 * Get or create a rate limit counter for a provider.
 * @param {string} provider - "gemini" or "groq"
 * @returns {SlidingWindowCounter}
 */
function getCounter(provider) {
  if (!counters.has(provider)) {
    const limits = LIMITS[provider] || { rpm: 10, windowMs: 60_000 };
    counters.set(provider, new SlidingWindowCounter(limits.windowMs, limits.rpm));
  }
  return counters.get(provider);
}

/**
 * Check rate limit and record a request. Throws if rate limited.
 * @param {string} provider - "gemini" or "groq"
 * @throws {Error} if rate limited
 */
export function checkRateLimit(provider) {
  const counter = getCounter(provider);
  if (!counter.record()) {
    const waitMs = counter.msUntilAvailable();
    throw new Error(
      `Rate limited: ${provider} — ${counter.stats().used}/${counter.stats().limit} requests in window. ` +
      `Wait ${Math.ceil(waitMs / 1000)}s before retrying.`
    );
  }
}

/**
 * Get current rate limit stats for a provider.
 * @param {string} provider
 * @returns {{ used: number, limit: number, remaining: number, windowMs: number }}
 */
export function getRateLimitStats(provider) {
  return getCounter(provider).stats();
}

/**
 * Get stats for all providers.
 * @returns {Record<string, object>}
 */
export function getAllRateLimitStats() {
  const result = {};
  for (const provider of Object.keys(LIMITS)) {
    result[provider] = getCounter(provider).stats();
  }
  return result;
}

export { SlidingWindowCounter, LIMITS };
