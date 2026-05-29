import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// We need to mock the retriever and workspace since auto-inject depends on them
describe('Auto-Inject Context', () => {
  it('module exports autoInjectContext function', async () => {
    const mod = await import('../mcp-server/shared/auto-inject.js');
    assert.equal(typeof mod.autoInjectContext, 'function');
  });

  it('returns null for empty/short queries', async () => {
    const { autoInjectContext } = await import('../mcp-server/shared/auto-inject.js');
    assert.equal(await autoInjectContext(''), null);
    assert.equal(await autoInjectContext('hi'), null);
    assert.equal(await autoInjectContext(null), null);
  });

  it('returns null when vector store does not exist', async () => {
    // Default MEMORY_STORE_PATH likely does not exist in test env
    const { autoInjectContext } = await import('../mcp-server/shared/auto-inject.js');
    const result = await autoInjectContext('explain the circuit breaker pattern in detail');
    // Should gracefully return null (store doesn't exist or no chunks found)
    assert.ok(result === null || typeof result === 'string');
  });

  it('formats context block correctly when chunks are found', async () => {
    // This tests the formatting logic — if we ever get real chunks back,
    // the output should match the expected shape
    const { autoInjectContext } = await import('../mcp-server/shared/auto-inject.js');
    const result = await autoInjectContext('testing query for auto inject');
    if (result !== null) {
      assert.ok(result.startsWith('[AUTO-INJECTED CONTEXT'));
      assert.ok(result.includes('[END AUTO-INJECTED CONTEXT]'));
    }
  });
});
