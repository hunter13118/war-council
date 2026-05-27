import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  registerProvider,
  unregisterProvider,
  discoverProviders,
  getAvailableProviders,
  getAllProviders,
  generateWithFallback,
  recordProviderResult,
  isInitialized,
  resetRegistry,
} from "../mcp-server/shared/provider-registry.js";

describe("Provider Registry", () => {
  beforeEach(() => {
    resetRegistry();
  });

  function mockProvider(id, opts = {}) {
    return {
      id,
      type: opts.type || "local",
      priority: opts.priority ?? 0,
      costPerMToken: opts.cost ?? 0,
      healthCheck: opts.healthCheck || (async () => true),
      generate: opts.generate || (async (prompt) => ({ text: `${id}: ${prompt}`, model: "mock", elapsedMs: 10 })),
    };
  }

  it("registers and discovers providers", async () => {
    registerProvider(mockProvider("local-fast"));
    registerProvider(mockProvider("cloud-groq", { type: "cloud", priority: 10 }));

    const results = await discoverProviders();
    assert.equal(results.length, 2);
    assert.ok(results.every(r => r.available));
    assert.ok(isInitialized());
  });

  it("marks unhealthy providers as unavailable", async () => {
    registerProvider(mockProvider("healthy"));
    registerProvider(mockProvider("sick", {
      healthCheck: async () => { throw new Error("connection refused"); },
    }));

    await discoverProviders();
    const available = getAvailableProviders();
    assert.equal(available.length, 1);
    assert.equal(available[0].id, "healthy");

    const all = getAllProviders();
    const sick = all.find(p => p.id === "sick");
    assert.equal(sick.available, false);
    assert.ok(sick.error.includes("connection refused"));
  });

  it("health check timeout marks provider unavailable", async () => {
    registerProvider(mockProvider("slow", {
      healthCheck: async () => new Promise(resolve => setTimeout(resolve, 10000)),
    }));

    await discoverProviders({ timeout: 50 });
    const available = getAvailableProviders();
    assert.equal(available.length, 0);

    const all = getAllProviders();
    assert.equal(all[0].error, "timeout");
  });

  it("generates with first available provider", async () => {
    registerProvider(mockProvider("fast", { priority: 0 }));
    registerProvider(mockProvider("slow", { priority: 10 }));
    await discoverProviders();

    const result = await generateWithFallback("hello");
    assert.equal(result.text, "fast: hello");
    assert.equal(result.provider, "fast");
    assert.equal(result.failedOver, false);
  });

  it("fails over to next provider on error", async () => {
    registerProvider(mockProvider("broken", {
      priority: 0,
      generate: async () => { throw new Error("GPU OOM"); },
    }));
    registerProvider(mockProvider("backup", { priority: 5 }));
    await discoverProviders();

    const result = await generateWithFallback("hello");
    assert.equal(result.text, "backup: hello");
    assert.equal(result.provider, "backup");
    assert.equal(result.failedOver, true);
  });

  it("respects type filter", async () => {
    registerProvider(mockProvider("local1", { type: "local", priority: 0 }));
    registerProvider(mockProvider("cloud1", { type: "cloud", priority: 10 }));
    registerProvider(mockProvider("premium1", { type: "premium", priority: 20 }));
    await discoverProviders();

    const clouds = getAvailableProviders({ type: "cloud" });
    assert.equal(clouds.length, 1);
    assert.equal(clouds[0].id, "cloud1");
  });

  it("respects maxCost filter in generateWithFallback", async () => {
    registerProvider(mockProvider("free", { priority: 5, cost: 0 }));
    registerProvider(mockProvider("expensive", { priority: 0, cost: 10 }));
    await discoverProviders();

    // Should skip expensive even though it's higher priority
    const result = await generateWithFallback("hello", { maxCost: 1 });
    assert.equal(result.provider, "free");
  });

  it("prefers preferredId when specified", async () => {
    registerProvider(mockProvider("a", { priority: 0 }));
    registerProvider(mockProvider("b", { priority: 5 }));
    await discoverProviders();

    const result = await generateWithFallback("hello", { preferredId: "b" });
    assert.equal(result.provider, "b");
  });

  it("throws when no providers available", async () => {
    await assert.rejects(
      () => generateWithFallback("hello"),
      /No providers available/
    );
  });

  it("throws when all eligible providers fail", async () => {
    registerProvider(mockProvider("a", { generate: async () => { throw new Error("fail a"); } }));
    registerProvider(mockProvider("b", { generate: async () => { throw new Error("fail b"); } }));
    await discoverProviders();

    await assert.rejects(
      () => generateWithFallback("hello"),
      /All eligible providers failed/
    );
  });

  it("tracks success and failure counts", async () => {
    registerProvider(mockProvider("tracker", { priority: 0 }));
    await discoverProviders();

    await generateWithFallback("one");
    await generateWithFallback("two");
    recordProviderResult("tracker", false); // External failure record

    const all = getAllProviders();
    const t = all.find(p => p.id === "tracker");
    assert.equal(t.successCount, 2);
    assert.equal(t.failCount, 1);
  });

  it("unregister removes provider", async () => {
    registerProvider(mockProvider("temp"));
    await discoverProviders();
    assert.equal(getAvailableProviders().length, 1);

    unregisterProvider("temp");
    assert.equal(getAvailableProviders().length, 0);
  });

  it("sorts by priority order", async () => {
    registerProvider(mockProvider("c", { priority: 20 }));
    registerProvider(mockProvider("a", { priority: 0 }));
    registerProvider(mockProvider("b", { priority: 10 }));
    await discoverProviders();

    const avail = getAvailableProviders();
    assert.deepEqual(avail.map(p => p.id), ["a", "b", "c"]);
  });
});
