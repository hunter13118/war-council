/**
 * WAR COUNCIL — Command Center Demo (Headed Mode)
 *
 * Run with: npx playwright test --config=playwright.config.js --project=demo command-center-demo.test.js
 *
 * Demonstrates the Command Center chat UI with mocked Ollama responses.
 */
import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:3737';
const PAUSE = 2500;

test.describe('Command Center — Live Demo', () => {
  test('Chat interface showcase', async ({ page }) => {
    // Mock the /chat POST endpoint so demo works without Ollama running
    await page.route('**/chat', async (route, request) => {
      if (request.method() !== 'POST') { await route.continue(); return; }
      const body = JSON.parse(request.postData());
      const responses = generateMockResponse(body.message, body.mode);

      // Simulate SSE streaming
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
        body: responses,
      });
    });

    // === SCENE 1: Load Command Center ===
    await page.goto(`${BASE}/command-center`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(PAUSE);

    // === SCENE 2: Send a quick question (auto-routes to fast) ===
    await page.fill('#chatInput', 'What is the MCP protocol?');
    await page.waitForTimeout(1000);
    await page.click('#sendBtn');
    await page.waitForTimeout(3000);

    // === SCENE 3: Enable "Show routing" to see WHY model was chosen ===
    await page.check('#showReason');
    await page.waitForTimeout(1000);

    // === SCENE 4: Send a code task (routes to specialist) ===
    await page.fill('#chatInput', 'Write a function to validate email addresses with regex');
    await page.waitForTimeout(1000);
    await page.click('#sendBtn');
    await page.waitForTimeout(3000);

    // === SCENE 5: Switch to reasoning mode manually ===
    await page.selectOption('#modeSelect', 'reasoning');
    await page.waitForTimeout(800);
    await page.fill('#chatInput', 'Should I use SQLite or PostgreSQL for a vector store with 100k embeddings?');
    await page.waitForTimeout(1000);
    await page.click('#sendBtn');
    await page.waitForTimeout(3500);

    // === SCENE 6: Tournament mode! ===
    await page.selectOption('#modeSelect', 'auto');
    await page.check('#tournamentToggle');
    await page.waitForTimeout(800);
    await page.fill('#chatInput', 'Best approach for hot-reloading plugin modules in Node.js?');
    await page.waitForTimeout(1000);
    await page.click('#sendBtn');
    await page.waitForTimeout(8000);

    // === SCENE 7: Final pause — admire the interface ===
    await page.waitForTimeout(3000);
  });
});

function generateMockResponse(message, mode) {
  const responses = {
    fast: {
      model: 'qwen2.5-coder:7b',
      tool: 'consult_fast',
      reason: 'Quick question → fast model',
      text: 'The Model Context Protocol (MCP) is a JSON-RPC based protocol for AI tool orchestration. It allows language models to discover and invoke tools exposed by a server over stdio or HTTP transport. Each tool declares an input schema and returns structured results.',
    },
    specialist: {
      model: 'qwen2.5-coder:14b',
      tool: 'consult_specialist',
      reason: 'Code task → specialist',
      text: `function validateEmail(email) {\n  const regex = /^[a-zA-Z0-9.!#$%&'*+/=?^_\`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;\n  return regex.test(email);\n}\n\n// Handles most RFC 5322 cases including:\n// - Local part: dots, special chars, quoted strings\n// - Domain: multiple labels, hyphens (not leading/trailing)\n// - TLD: 2+ chars required`,
    },
    reasoning: {
      model: 'deepseek-r1:14b',
      tool: 'consult_reasoning',
      reason: 'Architecture/planning detected → deep reasoning',
      text: 'For 100k embeddings with vector search:\n\n**SQLite + sqlite-vss**: Better for single-machine, local-first apps. Zero config, file-based, ~5ms query on 100k vectors with IVF index. Perfect for your use case since War Council is single-node.\n\n**PostgreSQL + pgvector**: Better for multi-user, networked deployments. HNSW indexes give <1ms at scale, but adds ops complexity (daemon, auth, backups).\n\n**Verdict**: SQLite. You\'re local-first, single-user, and 100k vectors is well within sqlite-vss\'s sweet spot. No reason to add PG complexity.',
    },
  };

  // Determine which response to use
  let resp;
  if (mode === 'fast') resp = responses.fast;
  else if (mode === 'reasoning') resp = responses.reasoning;
  else if (mode === 'specialist') resp = responses.specialist;
  else {
    // Auto-route based on message content
    const lower = message.toLowerCase();
    if (lower.includes('write') || lower.includes('function') || lower.includes('code')) resp = responses.specialist;
    else if (lower.includes('should') || lower.includes('approach') || lower.includes('best')) resp = responses.reasoning;
    else resp = responses.fast;
  }

  // Build SSE response (simulate streaming token by token)
  const tokens = resp.text.split(/(?<=\s)/); // split on whitespace boundaries
  let sseBody = '';
  for (const token of tokens) {
    sseBody += `data: ${JSON.stringify({ token, model: resp.model, tool: resp.tool, reason: resp.reason })}\n\n`;
  }
  sseBody += `data: ${JSON.stringify({ done: true, elapsedMs: 1200 + Math.random() * 2000, tokensOut: tokens.length, model: resp.model, tool: resp.tool, reason: resp.reason })}\n\n`;
  return sseBody;
}
