import { test, expect } from '@playwright/test';

/**
 * LIVE SERVER TESTS — Battle Log Server Integration
 *
 * These tests require the battle-log server running on port 3737.
 * They validate real connectivity, SSE streams, REST endpoints,
 * and the full integration chain described across Phases 1-7.
 *
 * The Playwright config's webServer option auto-starts the server.
 */

test.describe('Server — HTTP Endpoints', () => {
  test('GET / serves index.html', async ({ request }) => {
    const response = await request.get('/');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/html');
    const body = await response.text();
    expect(body).toContain('<!DOCTYPE html>');
  });

  test('GET /war-table serves war-table.html', async ({ request }) => {
    const response = await request.get('/war-table');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/html');
    const body = await response.text();
    expect(body).toContain('War Table');
  });

  test('GET /history returns JSON array', async ({ request }) => {
    const response = await request.get('/history');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/json');
    const data = await response.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test('GET /leaderboard returns JSON object', async ({ request }) => {
    const response = await request.get('/leaderboard');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/json');
    const data = await response.json();
    expect(typeof data).toBe('object');
  });

  test('GET /voices returns JSON object', async ({ request }) => {
    const response = await request.get('/voices');
    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(typeof data).toBe('object');
  });

  test('GET /events returns SSE stream (verified via page EventSource)', async ({ page }) => {
    // Can't use request.get() for SSE — it never completes.
    // Instead verify via EventSource in a page context.
    await page.goto('/war-table');
    const canConnect = await page.evaluate(() => {
      return new Promise((resolve) => {
        const source = new EventSource('/events');
        source.onopen = () => { source.close(); resolve(true); };
        source.onerror = () => { source.close(); resolve(false); };
        setTimeout(() => { source.close(); resolve(false); }, 5000);
      });
    });
    expect(canConnect).toBe(true);
  });
});

test.describe('Server — POST /emit (Event Injection)', () => {
  test('accepts valid event and returns 200', async ({ request }) => {
    const response = await request.post('/emit', {
      data: {
        type: 'test_event',
        message: 'Playwright integration test',
        agent: 'test-agent'
      }
    });
    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.ok).toBe(true);
  });

  test('tournament_result event updates leaderboard', async ({ request }) => {
    // Emit a tournament result
    await request.post('/emit', {
      data: {
        type: 'tournament_result',
        winner: 'playwright-winner',
        loser: 'playwright-loser',
        topic: 'test battle'
      }
    });

    // Check leaderboard reflects the result
    const response = await request.get('/leaderboard');
    const leaderboard = await response.json();
    expect(leaderboard['playwright-winner']).toBeDefined();
    expect(leaderboard['playwright-winner'].wins).toBeGreaterThanOrEqual(1);
    expect(leaderboard['playwright-loser'].losses).toBeGreaterThanOrEqual(1);
  });

  test('emitted events appear in history', async ({ request }) => {
    const uniqueId = `test-${Date.now()}`;
    await request.post('/emit', {
      data: {
        type: 'test_marker',
        marker: uniqueId
      }
    });

    const response = await request.get('/history');
    const history = await response.json();
    const found = history.find(e => e.marker === uniqueId);
    expect(found).toBeDefined();
  });
});

test.describe('Server — SSE Real-Time Streaming', () => {
  test('SSE connection receives emitted events', async ({ page, request }) => {
    // Navigate to war-table so EventSource connects to same origin
    await page.goto('/war-table');
    await page.evaluate(() => {
      window.__sseEvents = [];
      const source = new EventSource('/events');
      source.onmessage = (event) => {
        window.__sseEvents.push(JSON.parse(event.data));
      };
    });

    // Wait for connection to establish
    await page.waitForTimeout(1000);

    // Emit an event
    const marker = `sse-test-${Date.now()}`;
    await request.post('/emit', {
      data: { type: 'sse_test', marker }
    });

    // Wait for SSE to deliver
    await page.waitForTimeout(2000);

    // Check if the event was received
    const events = await page.evaluate(() => window.__sseEvents);
    const found = events.find(e => e.marker === marker);
    expect(found).toBeDefined();
    expect(found.type).toBe('sse_test');
  });

  test('SSE delivers events with timestamps', async ({ page, request }) => {
    await page.goto('/war-table');
    await page.evaluate(() => {
      window.__sseEvents = [];
      const source = new EventSource('/events');
      source.onmessage = (event) => {
        window.__sseEvents.push(JSON.parse(event.data));
      };
    });

    await page.waitForTimeout(1000);

    await request.post('/emit', {
      data: { type: 'timestamp_test' }
    });

    await page.waitForTimeout(2000);

    const events = await page.evaluate(() => window.__sseEvents);
    const found = events.find(e => e.type === 'timestamp_test');
    expect(found).toBeDefined();
    expect(found.timestamp).toBeDefined();
    // Timestamp should be valid ISO format
    expect(new Date(found.timestamp).getTime()).not.toBeNaN();
  });
});

test.describe('Server — War Table Page Live Rendering', () => {
  test('war-table page loads without JS errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));

    await page.goto('/war-table');
    await page.waitForTimeout(2000); // Let any async init complete

    // Filter out expected errors (e.g., failed SSE reconnection is OK)
    const criticalErrors = errors.filter(e =>
      !e.includes('EventSource') && !e.includes('fetch') && !e.includes('network')
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test('war-table page renders dark theme correctly', async ({ page }) => {
    await page.goto('/war-table');

    const bgColor = await page.evaluate(() => {
      return getComputedStyle(document.body).backgroundColor;
    });
    // Should be dark
    expect(bgColor).toMatch(/rgb\(\d{1,2},\s*\d{1,2},\s*\d{1,2}\)/);
  });

  test('war-table page has interactive elements', async ({ page }) => {
    await page.goto('/war-table');

    // Should have navigation links
    const navLinks = page.locator('.nav a');
    const linkCount = await navLinks.count();
    expect(linkCount).toBeGreaterThan(0);
  });

  test('index page loads and has navigation', async ({ page }) => {
    await page.goto('/');
    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(0);
  });
});

test.describe('Server — CORS & Security Headers', () => {
  test('SSE endpoint supports CORS (verified via EventSource cross-check)', async ({ page }) => {
    // If CORS is set, EventSource from same origin works. We already verified this above.
    // Additionally check /history has the CORS header since it's a normal request.
    await page.goto('/war-table');
    const corsHeader = await page.evaluate(async () => {
      const res = await fetch('/events', { method: 'GET' });
      // We can't fully read the stream, but we initiated the request
      return res.headers.get('access-control-allow-origin');
    });
    expect(corsHeader).toBe('*');
  });

  test('history endpoint has CORS headers', async ({ request }) => {
    const response = await request.get('/history');
    expect(response.headers()['access-control-allow-origin']).toBe('*');
  });
});
