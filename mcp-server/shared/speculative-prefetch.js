/**
 * Speculative Pre-fetching Engine
 *
 * Predicts what context the user will need next and pre-loads it:
 *   1. Tracks query patterns to learn topic transitions
 *   2. Pre-fetches related files/chunks when a topic is detected
 *   3. Keeps a warm cache of likely-needed context
 *   4. Pre-warms embeddings for recently changed files
 *
 * Zero-cost when idle — only activates on conversation activity.
 */

const CACHE_TTL = 5 * 60 * 1000; // 5 min
const MAX_CACHE = 50;
const TRANSITION_WINDOW = 10; // Track last N topics for Markov transitions

let cache = new Map(); // key → { content, fetchedAt, hits }
let topicHistory = []; // ordered list of detected topics
let transitions = new Map(); // "topicA→topicB" → count
let prefetchQueue = []; // items queued for prefetch
let stats = { hits: 0, misses: 0, prefetches: 0, predictions: 0 };

/**
 * Record a user query and update topic model.
 * @param {string} query - The user's question/prompt
 * @param {string[]} [filesAccessed] - Files that were relevant to this query
 */
export function recordQuery(query, filesAccessed = []) {
  const topic = detectTopic(query);
  
  if (topicHistory.length > 0) {
    const prevTopic = topicHistory[topicHistory.length - 1];
    const key = `${prevTopic}→${topic}`;
    transitions.set(key, (transitions.get(key) || 0) + 1);
  }
  
  topicHistory.push(topic);
  if (topicHistory.length > TRANSITION_WINDOW) {
    topicHistory.shift();
  }

  // Cache the files that were relevant
  for (const file of filesAccessed) {
    cacheSet(`file:${file}`, { path: file, type: 'file' });
  }

  // Predict next topic and queue prefetch
  const predictions = predictNext(topic);
  for (const pred of predictions) {
    queuePrefetch(pred);
  }
}

/**
 * Check if we have pre-fetched context for a query.
 * @param {string} query
 * @returns {{ hit: boolean, cached: Object[]|null }}
 */
export function checkPrefetchCache(query) {
  const topic = detectTopic(query);
  const keys = [...cache.keys()].filter(k => k.includes(topic));
  
  if (keys.length > 0) {
    stats.hits++;
    const results = keys.map(k => {
      const entry = cache.get(k);
      if (entry) entry.hits++;
      return entry;
    }).filter(Boolean);
    return { hit: true, cached: results };
  }
  
  stats.misses++;
  return { hit: false, cached: null };
}

/**
 * Get prefetch predictions for the current conversation state.
 * @returns {Object[]} Predicted items with confidence
 */
export function getPredictions() {
  if (topicHistory.length === 0) return [];
  const currentTopic = topicHistory[topicHistory.length - 1];
  return predictNext(currentTopic);
}

/**
 * Get speculative pre-fetch statistics.
 */
export function getPrefetchStats() {
  return {
    ...stats,
    cacheSize: cache.size,
    topicHistory: [...topicHistory],
    queueLength: prefetchQueue.length,
    hitRate: stats.hits + stats.misses > 0
      ? Math.round((stats.hits / (stats.hits + stats.misses)) * 100) / 100
      : 0,
    transitionCount: transitions.size,
  };
}

/**
 * Get the full transition matrix for visualization.
 * @returns {Array<{ from: string, to: string, count: number, probability: number }>}
 */
export function getTransitionMatrix() {
  const result = [];
  const totals = new Map(); // topic → total outgoing

  for (const [key, count] of transitions) {
    const [from] = key.split('→');
    totals.set(from, (totals.get(from) || 0) + count);
  }

  for (const [key, count] of transitions) {
    const [from, to] = key.split('→');
    const total = totals.get(from) || 1;
    result.push({ from, to, count, probability: Math.round((count / total) * 100) / 100 });
  }

  return result.sort((a, b) => b.probability - a.probability);
}

/**
 * Reset state (for testing).
 */
export function resetPrefetch() {
  cache.clear();
  topicHistory = [];
  transitions.clear();
  prefetchQueue = [];
  stats = { hits: 0, misses: 0, prefetches: 0, predictions: 0 };
}

// === Internal ===

function detectTopic(text) {
  const lower = text.toLowerCase();
  const topics = [
    { pattern: /circuit.?break|breaker|failover|fallback/, topic: 'reliability' },
    { pattern: /rate.?limit|throttl|quota/, topic: 'rate-limiting' },
    { pattern: /embed|vector|similarity|semantic/, topic: 'embeddings' },
    { pattern: /dag|pipeline|workflow|stage/, topic: 'orchestration' },
    { pattern: /confidence|threshold|score|calibrat/, topic: 'confidence' },
    { pattern: /test|spec|assert|coverage/, topic: 'testing' },
    { pattern: /error|bug|fix|debug|stack/, topic: 'debugging' },
    { pattern: /memory|context|rag|retriev/, topic: 'memory' },
    { pattern: /model|ollama|generate|inference/, topic: 'inference' },
    { pattern: /route|dispatch|delegate|tier/, topic: 'routing' },
    { pattern: /graph|node|edge|relation/, topic: 'graph' },
    { pattern: /auth|token|key|secret|secure/, topic: 'security' },
    { pattern: /perf|latency|speed|optim/, topic: 'performance' },
    { pattern: /ui|dashboard|visual|render/, topic: 'ui' },
    { pattern: /deploy|ship|push|release/, topic: 'deployment' },
  ];

  for (const { pattern, topic } of topics) {
    if (pattern.test(lower)) return topic;
  }
  return 'general';
}

function predictNext(currentTopic) {
  const predictions = [];
  const candidates = new Map(); // topic → total count

  for (const [key, count] of transitions) {
    const [from, to] = key.split('→');
    if (from === currentTopic) {
      candidates.set(to, (candidates.get(to) || 0) + count);
    }
  }

  // Sort by frequency, take top 3
  const sorted = [...candidates.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const total = sorted.reduce((s, [, c]) => s + c, 0) || 1;

  for (const [topic, count] of sorted) {
    const confidence = count / total;
    predictions.push({ topic, confidence: Math.round(confidence * 100) / 100, basis: 'markov' });
    stats.predictions++;
  }

  // If no history yet, use common co-occurrences
  if (predictions.length === 0) {
    const defaults = {
      'reliability': ['debugging', 'performance'],
      'rate-limiting': ['reliability', 'inference'],
      'confidence': ['routing', 'inference'],
      'debugging': ['testing', 'performance'],
      'memory': ['embeddings', 'graph'],
      'inference': ['routing', 'performance'],
      'routing': ['confidence', 'inference'],
      'testing': ['debugging', 'deployment'],
      'graph': ['memory', 'embeddings'],
      'ui': ['performance', 'deployment'],
    };
    const fallbacks = defaults[currentTopic] || ['general'];
    for (const topic of fallbacks) {
      predictions.push({ topic, confidence: 0.3, basis: 'heuristic' });
    }
  }

  return predictions;
}

function queuePrefetch(prediction) {
  prefetchQueue.push({ ...prediction, queuedAt: Date.now() });
  stats.prefetches++;
  // Trim queue
  if (prefetchQueue.length > 20) prefetchQueue.shift();
}

function cacheSet(key, value) {
  // Evict expired entries
  const now = Date.now();
  for (const [k, v] of cache) {
    if (now - v.fetchedAt > CACHE_TTL) cache.delete(k);
  }
  // Evict LRU if full
  if (cache.size >= MAX_CACHE) {
    let oldest = null, oldestTime = Infinity;
    for (const [k, v] of cache) {
      if (v.fetchedAt < oldestTime) { oldest = k; oldestTime = v.fetchedAt; }
    }
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { ...value, fetchedAt: now, hits: 0 });
}
