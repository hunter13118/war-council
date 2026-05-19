import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

/**
 * MOCKED E2E — Stats Widget, Rate Limiter, Vector Store UI
 */

test.describe('War Table — Stats Widget', () => {
  test.beforeEach(async ({ page }) => {
    const filePath = path.join(ROOT, 'battle-log', 'war-table.html');
    await page.goto(`file:///${filePath.replace(/\\/g, '/')}`);
  });

  test('stats widget element exists on page', async ({ page }) => {
    // Widget is injected by JS on load — give it a tick
    await page.waitForTimeout(500);
    const widget = page.locator('#stats-widget');
    await expect(widget).toBeVisible();
  });

  test('stats widget has title text', async ({ page }) => {
    await page.waitForTimeout(500);
    const widget = page.locator('#stats-widget');
    await expect(widget).toContainText('System Stats');
  });

  test('stats content element exists', async ({ page }) => {
    await page.waitForTimeout(500);
    const content = page.locator('#stats-content');
    await expect(content).toBeVisible();
    // Will show "Offline" or "Loading..." since no server is running
    const text = await content.textContent();
    expect(text.length).toBeGreaterThan(0);
  });
});

test.describe('Rate Limiter Module', () => {
  test('SlidingWindowCounter blocks at limit', async () => {
    const { SlidingWindowCounter } = await import('../../mcp-server/shared/rate-limiter.js');
    const counter = new SlidingWindowCounter(60000, 2);
    expect(counter.record()).toBe(true);
    expect(counter.record()).toBe(true);
    expect(counter.record()).toBe(false);
  });

  test('checkRateLimit function is available', async () => {
    const { checkRateLimit } = await import('../../mcp-server/shared/rate-limiter.js');
    expect(typeof checkRateLimit).toBe('function');
  });
});

test.describe('Vector Store Module', () => {
  test('VectorStore can add and search', async () => {
    const { VectorStore } = await import('../../memory-engine/store.js');
    const store = new VectorStore(':memory:');
    await store.add([
      { text: 'hello', embedding: [1, 0, 0], source: '/test.js' },
      { text: 'world', embedding: [0, 1, 0], source: '/other.js' },
    ]);
    const results = await store.search([1, 0, 0], 1);
    expect(results[0].chunk.text).toBe('hello');
  });

  test('compressPersona strips frontmatter', async () => {
    const { compressPersona } = await import('../../mcp-server/tools/invoke-agent.js');
    const result = compressPersona('---\nfoo: bar\n---\n\n# Agent\nContent');
    expect(result).not.toContain('---');
    expect(result).toContain('# Agent');
  });
});
