/**
 * Provider Registry — Dynamic discovery + graceful degradation for inference providers.
 *
 * Design principles:
 *   1. Any provider can be absent — system works with whatever IS available
 *   2. Health checks run on init and periodically — unhealthy providers are skipped
 *   3. Priority ordering: local (free) → cloud (cheap/free) → premium (paid)
 *   4. Each provider exposes a standard interface: generate(prompt, opts) → { text, model, provider, elapsedMs }
 *
 * Supported providers:
 *   - ollama (local, free) — multiple models via OLLAMA_BASE
 *   - groq (cloud, free tier) — fast inference
 *   - gemini (cloud, free tier) — large context
 *   - openrouter (cloud, free models) — fallback
 *   - cursor (premium, via OpenAI-compat endpoint) — expensive but capable
 *   - custom (any OpenAI-compatible endpoint)
 */

import { OLLAMA_BASE, GEMINI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY, arsenalConfig } from "./config.js";

/**
 * @typedef {Object} Provider
 * @property {string} id - Unique identifier
 * @property {string} type - "local" | "cloud" | "premium"
 * @property {number} priority - Lower = preferred (0 = try first)
 * @property {boolean} available - Health check passed
 * @property {string|null} error - Last error if unhealthy
 * @property {number} costPerMToken - Relative cost per million tokens (0 = free)
 * @property {Function} generate - Standard generation function
 * @property {Function} healthCheck - Returns true if provider is reachable
 */

const registry = new Map();
let initialized = false;

/**
 * Register a provider definition.
 */
export function registerProvider(def) {
  registry.set(def.id, {
    ...def,
    available: false,
    error: null,
    lastHealthCheck: 0,
    successCount: 0,
    failCount: 0,
  });
}

/**
 * Remove a provider.
 */
export function unregisterProvider(id) {
  registry.delete(id);
}

/**
 * Run health checks on all registered providers. Non-blocking — marks unavailable on failure.
 */
export async function discoverProviders(opts = {}) {
  const timeout = opts.timeout || 5000;
  const results = [];

  for (const [id, provider] of registry) {
    try {
      const healthy = await Promise.race([
        provider.healthCheck(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), timeout)),
      ]);
      provider.available = !!healthy;
      provider.error = healthy ? null : "health check returned false";
      provider.lastHealthCheck = Date.now();
    } catch (e) {
      provider.available = false;
      provider.error = e.message;
      provider.lastHealthCheck = Date.now();
    }
    results.push({ id, available: provider.available, error: provider.error });
  }

  initialized = true;
  return results;
}

/**
 * Get all available providers, sorted by priority.
 */
export function getAvailableProviders(opts = {}) {
  const typeFilter = opts.type; // "local" | "cloud" | "premium"
  let providers = [...registry.values()].filter(p => p.available);
  if (typeFilter) providers = providers.filter(p => p.type === typeFilter);
  return providers.sort((a, b) => a.priority - b.priority);
}

/**
 * Get all registered providers (including unhealthy).
 */
export function getAllProviders() {
  return [...registry.values()].map(p => ({
    id: p.id,
    type: p.type,
    priority: p.priority,
    available: p.available,
    error: p.error,
    costPerMToken: p.costPerMToken,
    lastHealthCheck: p.lastHealthCheck,
    successCount: p.successCount,
    failCount: p.failCount,
  }));
}

/**
 * Generate using the best available provider matching criteria.
 * Tries each provider in priority order, gracefully falling through on failure.
 *
 * @param {string} prompt
 * @param {object} opts - { type?, maxCost?, preferredId?, maxTokens?, temperature? }
 * @returns {Promise<{ text: string, model: string, provider: string, elapsedMs: number, failedOver: boolean }>}
 */
export async function generateWithFallback(prompt, opts = {}) {
  const candidates = getAvailableProviders({ type: opts.type });
  const maxCost = opts.maxCost ?? Infinity;
  const preferred = opts.preferredId;

  // Filter by cost
  let eligible = candidates.filter(p => p.costPerMToken <= maxCost);

  // Prioritize preferred if available
  if (preferred) {
    const pref = eligible.find(p => p.id === preferred);
    if (pref) {
      eligible = [pref, ...eligible.filter(p => p.id !== preferred)];
    }
  }

  if (eligible.length === 0) {
    throw new Error(
      `No providers available. Registered: ${[...registry.keys()].join(", ")}. ` +
      `Run discoverProviders() or check health status.`
    );
  }

  const errors = [];
  for (const provider of eligible) {
    try {
      const result = await provider.generate(prompt, opts);
      provider.successCount++;
      return { ...result, provider: provider.id, failedOver: errors.length > 0 };
    } catch (e) {
      provider.failCount++;
      errors.push({ id: provider.id, error: e.message });
      continue; // Graceful degradation — try next
    }
  }

  throw new Error(
    `All eligible providers failed:\n${errors.map(e => `  - ${e.id}: ${e.error}`).join("\n")}`
  );
}

/**
 * Record a success/failure for tracking (called externally for retries).
 */
export function recordProviderResult(id, success) {
  const p = registry.get(id);
  if (!p) return;
  if (success) p.successCount++;
  else p.failCount++;
}

/**
 * Check if the registry has been initialized.
 */
export function isInitialized() {
  return initialized;
}

/**
 * Reset the registry (for testing).
 */
export function resetRegistry() {
  registry.clear();
  initialized = false;
}

// === Built-in provider definitions ===

/**
 * Register the default providers based on arsenal.json + env vars.
 * Call this at startup.
 */
export function registerDefaults() {
  // Ollama (local, free)
  registerProvider({
    id: "ollama-fast",
    type: "local",
    priority: 0,
    costPerMToken: 0,
    model: arsenalConfig.models.fast.name,
    async healthCheck() {
      const res = await fetch(`${OLLAMA_BASE}/api/tags`);
      return res.ok;
    },
    async generate(prompt, opts = {}) {
      const model = opts.model || arsenalConfig.models.fast.name;
      const t0 = Date.now();
      const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          prompt,
          stream: false,
          options: { num_predict: opts.maxTokens || 4096, temperature: opts.temperature ?? 0.3 },
        }),
      });
      if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
      const data = await res.json();
      return { text: data.response, model, elapsedMs: Date.now() - t0 };
    },
  });

  registerProvider({
    id: "ollama-specialist",
    type: "local",
    priority: 1,
    costPerMToken: 0,
    model: arsenalConfig.models.specialist.name,
    async healthCheck() {
      const res = await fetch(`${OLLAMA_BASE}/api/tags`);
      return res.ok;
    },
    async generate(prompt, opts = {}) {
      const model = opts.model || arsenalConfig.models.specialist.name;
      const t0 = Date.now();
      const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          prompt,
          stream: false,
          options: { num_predict: opts.maxTokens || 4096, temperature: opts.temperature ?? 0.3 },
        }),
      });
      if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
      const data = await res.json();
      return { text: data.response, model, elapsedMs: Date.now() - t0 };
    },
  });

  registerProvider({
    id: "ollama-reasoning",
    type: "local",
    priority: 2,
    costPerMToken: 0,
    model: arsenalConfig.models.reasoning.name,
    async healthCheck() {
      const res = await fetch(`${OLLAMA_BASE}/api/tags`);
      return res.ok;
    },
    async generate(prompt, opts = {}) {
      const model = opts.model || arsenalConfig.models.reasoning.name;
      const t0 = Date.now();
      const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          prompt,
          stream: false,
          options: { num_predict: opts.maxTokens || 4096, temperature: opts.temperature ?? 0.1 },
        }),
      });
      if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
      const data = await res.json();
      return { text: data.response, model, elapsedMs: Date.now() - t0 };
    },
  });

  // Groq (cloud, free tier)
  if (GROQ_API_KEY) {
    registerProvider({
      id: "groq",
      type: "cloud",
      priority: 10,
      costPerMToken: 0, // Free tier
      model: arsenalConfig.cloud.groq.name,
      async healthCheck() {
        return !!GROQ_API_KEY;
      },
      async generate(prompt, opts = {}) {
        const model = opts.model || arsenalConfig.cloud.groq.name;
        const t0 = Date.now();
        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_API_KEY}` },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: prompt }],
            max_tokens: opts.maxTokens || 4096,
            temperature: opts.temperature ?? 0.3,
          }),
        });
        if (!res.ok) throw new Error(`Groq HTTP ${res.status}`);
        const data = await res.json();
        return { text: data.choices[0].message.content, model, elapsedMs: Date.now() - t0 };
      },
    });
  }

  // Gemini (cloud, free tier)
  if (GEMINI_API_KEY) {
    registerProvider({
      id: "gemini",
      type: "cloud",
      priority: 11,
      costPerMToken: 0,
      model: arsenalConfig.cloud.gemini.name,
      async healthCheck() {
        return !!GEMINI_API_KEY;
      },
      async generate(prompt, opts = {}) {
        const model = opts.model || arsenalConfig.cloud.gemini.name;
        const t0 = Date.now();
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: opts.maxTokens || 8192, temperature: opts.temperature ?? 0.3 },
          }),
        });
        if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        return { text, model, elapsedMs: Date.now() - t0 };
      },
    });
  }

  // OpenRouter (cloud, free models)
  if (OPENROUTER_API_KEY) {
    registerProvider({
      id: "openrouter",
      type: "cloud",
      priority: 12,
      costPerMToken: 0,
      model: arsenalConfig.cloud.openrouter.name,
      async healthCheck() {
        return !!OPENROUTER_API_KEY;
      },
      async generate(prompt, opts = {}) {
        const model = opts.model || arsenalConfig.cloud.openrouter.name;
        const t0 = Date.now();
        const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${OPENROUTER_API_KEY}`,
            "HTTP-Referer": "https://github.com/war-council",
          },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: prompt }],
            max_tokens: opts.maxTokens || 4096,
            temperature: opts.temperature ?? 0.3,
          }),
        });
        if (!res.ok) throw new Error(`OpenRouter HTTP ${res.status}`);
        const data = await res.json();
        return { text: data.choices[0].message.content, model, elapsedMs: Date.now() - t0 };
      },
    });
  }

  // Cursor Pro (premium, OpenAI-compatible — only if CURSOR_API_KEY or CURSOR_ENDPOINT is set)
  const cursorEndpoint = process.env.CURSOR_ENDPOINT || "";
  const cursorApiKey = process.env.CURSOR_API_KEY || "";
  if (cursorEndpoint && cursorApiKey) {
    registerProvider({
      id: "cursor-pro",
      type: "premium",
      priority: 20,
      costPerMToken: 5, // Relative cost indicator
      model: process.env.CURSOR_MODEL || "claude-sonnet-4-20250514",
      async healthCheck() {
        try {
          const res = await fetch(`${cursorEndpoint}/models`, {
            headers: { Authorization: `Bearer ${cursorApiKey}` },
          });
          return res.ok;
        } catch { return false; }
      },
      async generate(prompt, opts = {}) {
        const model = opts.model || process.env.CURSOR_MODEL || "claude-sonnet-4-20250514";
        const t0 = Date.now();
        const res = await fetch(`${cursorEndpoint}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${cursorApiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: prompt }],
            max_tokens: opts.maxTokens || 4096,
            temperature: opts.temperature ?? 0.3,
          }),
        });
        if (!res.ok) throw new Error(`Cursor Pro HTTP ${res.status}`);
        const data = await res.json();
        return { text: data.choices[0].message.content, model, elapsedMs: Date.now() - t0 };
      },
    });
  }

  // Generic OpenAI-compatible (any endpoint — set CUSTOM_LLM_ENDPOINT + CUSTOM_LLM_KEY)
  const customEndpoint = process.env.CUSTOM_LLM_ENDPOINT || "";
  const customKey = process.env.CUSTOM_LLM_KEY || "";
  if (customEndpoint) {
    registerProvider({
      id: "custom",
      type: process.env.CUSTOM_LLM_TYPE || "cloud",
      priority: parseInt(process.env.CUSTOM_LLM_PRIORITY || "15", 10),
      costPerMToken: parseFloat(process.env.CUSTOM_LLM_COST || "0"),
      model: process.env.CUSTOM_LLM_MODEL || "default",
      async healthCheck() {
        try {
          const res = await fetch(`${customEndpoint}/models`, {
            headers: customKey ? { Authorization: `Bearer ${customKey}` } : {},
          });
          return res.ok;
        } catch { return false; }
      },
      async generate(prompt, opts = {}) {
        const model = opts.model || process.env.CUSTOM_LLM_MODEL || "default";
        const t0 = Date.now();
        const res = await fetch(`${customEndpoint}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(customKey ? { Authorization: `Bearer ${customKey}` } : {}),
          },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: prompt }],
            max_tokens: opts.maxTokens || 4096,
            temperature: opts.temperature ?? 0.3,
          }),
        });
        if (!res.ok) throw new Error(`Custom LLM HTTP ${res.status}`);
        const data = await res.json();
        return { text: data.choices[0].message.content, model, elapsedMs: Date.now() - t0 };
      },
    });
  }
}
