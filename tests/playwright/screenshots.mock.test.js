/**
 * Screenshot capture for Command Center UI showcase.
 * Runs headless, saves PNGs to tests/screenshots/
 */
import { test } from '@playwright/test';
import { mkdir } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const SCREENSHOTS = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'screenshots');

test.beforeAll(async () => {
  await mkdir(SCREENSHOTS, { recursive: true });
});

test('Capture Command Center screenshots', async ({ page }) => {
  // Mock /chat so we get responses without Ollama
  await page.route('**/api/generate', route => route.abort());
  await page.route('**/chat', async (route, request) => {
    if (request.method() !== 'POST') return route.continue();
    const body = JSON.parse(request.postData());
    const text = 'The Model Context Protocol (MCP) is a JSON-RPC based protocol for AI tool orchestration. It allows language models to discover and invoke tools exposed by a server over stdio transport.';
    const tokens = text.split(/(?<=\s)/);
    let sseBody = '';
    for (const t of tokens) sseBody += `data: ${JSON.stringify({ token: t, model: 'qwen2.5-coder:7b', tool: 'consult_fast', reason: 'Quick question → fast model' })}\n\n`;
    sseBody += `data: ${JSON.stringify({ done: true, elapsedMs: 1340, tokensOut: tokens.length, model: 'qwen2.5-coder:7b', tool: 'consult_fast', reason: 'Quick question → fast model' })}\n\n`;
    await route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body: sseBody });
  });

  await page.goto('http://localhost:3737/command-center', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);

  // Screenshot 1: Empty state
  await page.screenshot({ path: resolve(SCREENSHOTS, '01-command-center-empty.png') });

  // Screenshot 2: Typing a message
  await page.fill('#chatInput', 'What is the MCP protocol?');
  await page.screenshot({ path: resolve(SCREENSHOTS, '02-command-center-typing.png') });

  // Screenshot 3: After sending (with response) — single speaker in stage
  await page.click('#sendBtn');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: resolve(SCREENSHOTS, '03-command-center-response.png') });

  // Screenshot 4: Show routing reason
  await page.check('#showReason');
  await page.screenshot({ path: resolve(SCREENSHOTS, '04-command-center-routing.png') });

  // Screenshot 5: Tournament mode ready
  await page.selectOption('#modeSelect', 'auto');
  await page.check('#tournamentToggle');
  await page.fill('#chatInput', 'Which is better: Rust or Go?');
  await page.screenshot({ path: resolve(SCREENSHOTS, '05-command-center-tournament-mode.png') });
});

test('Capture tournament dialogue exchange', async ({ page }) => {
  let callCount = 0;
  const tournamentResponses = [
    { text: 'Rust offers zero-cost abstractions and memory safety without garbage collection. The borrow checker catches entire classes of bugs at compile time.', tool: 'consult_fast', model: 'qwen2.5-coder:7b' },
    { text: 'Go prioritizes simplicity and fast compilation. Goroutines make concurrent programming accessible to all developers, not just experts.', tool: 'consult_specialist', model: 'qwen2.5-coder:14b' },
    { text: 'Both languages serve different niches. Rust for systems programming where safety is paramount. Go for networked services where developer velocity matters. The winner depends on the domain.', tool: 'self_eval', model: 'deepseek-r1:14b' },
  ];

  await page.route('**/chat', async (route, request) => {
    if (request.method() !== 'POST') return route.continue();
    const resp = tournamentResponses[callCount % 3];
    callCount++;
    const tokens = resp.text.split(/(?<=\s)/);
    let sseBody = '';
    for (const t of tokens) sseBody += `data: ${JSON.stringify({ token: t, model: resp.model, tool: resp.tool, reason: 'Tournament round' })}\n\n`;
    sseBody += `data: ${JSON.stringify({ done: true, elapsedMs: 2100 + callCount * 500, tokensOut: tokens.length, model: resp.model, tool: resp.tool, reason: 'Tournament round' })}\n\n`;
    await route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body: sseBody });
  });

  await page.goto('http://localhost:3737/command-center', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);

  // Enable tournament and send
  await page.check('#tournamentToggle');
  await page.fill('#chatInput', 'Rust vs Go: which is better for backend?');
  await page.click('#sendBtn');

  // Wait for first response (challenger)
  await page.waitForTimeout(2500);
  await page.screenshot({ path: resolve(SCREENSHOTS, '06-tournament-challenger.png') });

  // Wait for all three to complete (the last speaker shown = judge)
  await page.waitForTimeout(5000);
  await page.screenshot({ path: resolve(SCREENSHOTS, '07-tournament-judge-verdict.png') });

  // Navigate back to challenger using prev arrows
  await page.click('#navPrev');
  await page.waitForTimeout(300);
  await page.click('#navPrev');
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(SCREENSHOTS, '08-tournament-nav-back.png') });
});

test('Capture RAG file drop', async ({ page }) => {
  await page.route('**/chat', async (route, request) => {
    if (request.method() !== 'POST') return route.continue();
    const body = JSON.parse(request.postData());
    const hasContext = body.context && body.context.includes('FILE:');
    const text = hasContext
      ? 'Based on the provided package.json, this project uses Node.js with Express for the server and Playwright for testing. The main entry point is server.js.'
      : 'No files attached — ask me anything.';
    const tokens = text.split(/(?<=\s)/);
    let sseBody = '';
    for (const t of tokens) sseBody += `data: ${JSON.stringify({ token: t, model: 'qwen2.5-coder:14b', tool: 'consult_specialist', reason: 'File analysis → specialist' })}\n\n`;
    sseBody += `data: ${JSON.stringify({ done: true, elapsedMs: 2400, tokensOut: tokens.length, model: 'qwen2.5-coder:14b', tool: 'consult_specialist', reason: 'File analysis → specialist' })}\n\n`;
    await route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body: sseBody });
  });

  await page.goto('http://localhost:3737/command-center', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);

  // Simulate file drop via DataTransfer
  const fileContent = JSON.stringify({ name: 'war-council', version: '1.0.0', scripts: { test: 'playwright test' } }, null, 2);
  await page.evaluate((content) => {
    const file = new File([content], 'package.json', { type: 'application/json' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const dropEvent = new DragEvent('drop', { dataTransfer: dt, bubbles: true });
    document.getElementById('chatPanel').dispatchEvent(dropEvent);
  }, fileContent);
  await page.waitForTimeout(500);

  // Screenshot: file chip visible
  await page.screenshot({ path: resolve(SCREENSHOTS, '09-rag-file-attached.png') });

  // Send a question about the file
  await page.fill('#chatInput', 'What does this project use for testing?');
  await page.click('#sendBtn');
  await page.waitForTimeout(2500);

  // Screenshot: response informed by file context
  await page.screenshot({ path: resolve(SCREENSHOTS, '10-rag-response-with-context.png') });
});

test('Conversation persistence flow', async ({ page }) => {
  // Mock chat response
  await page.route('**/chat', async (route, request) => {
    if (request.method() !== 'POST') return route.continue();
    const text = 'This is a persisted response for testing conversation history.';
    const tokens = text.split(/(?<=\s)/);
    let sseBody = '';
    for (const t of tokens) sseBody += `data: ${JSON.stringify({ token: t, model: 'qwen2.5-coder:7b', tool: 'consult_fast' })}\n\n`;
    sseBody += `data: ${JSON.stringify({ done: true, elapsedMs: 800, tokensOut: tokens.length, model: 'qwen2.5-coder:7b', tool: 'consult_fast' })}\n\n`;
    await route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body: sseBody });
  });

  await page.goto('http://localhost:3737/command-center', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);

  // Click new chat to start fresh
  await page.click('text=+ New');
  await page.waitForTimeout(300);

  // Send a message (triggers auto-save)
  await page.fill('#chatInput', 'Testing conversation persistence');
  await page.click('#sendBtn');
  await page.waitForTimeout(2000);

  // Screenshot: conversation with title updated
  await page.screenshot({ path: resolve(SCREENSHOTS, '11-conversation-saved.png') });

  // Open history list
  await page.click('text=📂 History');
  await page.waitForTimeout(500);
  await page.screenshot({ path: resolve(SCREENSHOTS, '12-conversation-history.png') });
});

test('Showcase card + mode toggle + RAG badge', async ({ page }) => {
  // Mock /health for the showcase card
  await page.route('**/health', async (route) => {
    await route.fulfill({ status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      status: 'ready', mode: 'hybrid', ollama: true,
      models: ['qwen2.5-coder:7b', 'qwen2.5-coder:14b', 'deepseek-r1:14b', 'nomic-embed-text'],
      rag: { vectorStore: true, chunks: 2168, path: '.cline-context/vector-store.json' },
      workspace: 'D:\\war-council'
    })});
  });
  await page.route('**/mode', async (route, request) => {
    if (request.method() === 'GET') {
      await route.fulfill({ status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'hybrid' }) });
    } else {
      await route.fulfill({ status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'cloud', previous: 'hybrid' }) });
    }
  });

  // === Showcase Scroll Experience ===
  await page.goto('http://localhost:3737/showcase', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500); // let animations trigger
  await page.screenshot({ path: resolve(SCREENSHOTS, '13-showcase-hero.png') });

  // Scroll to features section
  await page.evaluate(() => document.getElementById('s1').scrollIntoView({ behavior: 'instant' }));
  await page.waitForTimeout(800);
  await page.screenshot({ path: resolve(SCREENSHOTS, '14-showcase-features.png') });

  // Scroll to architecture
  await page.evaluate(() => document.getElementById('s2').scrollIntoView({ behavior: 'instant' }));
  await page.waitForTimeout(800);
  await page.screenshot({ path: resolve(SCREENSHOTS, '15-showcase-architecture.png') });

  // Scroll to modes
  await page.evaluate(() => document.getElementById('s3').scrollIntoView({ behavior: 'instant' }));
  await page.waitForTimeout(800);
  await page.screenshot({ path: resolve(SCREENSHOTS, '16-showcase-modes.png') });

  // === Mode toggle + RAG badge in Command Center ===
  await page.route('**/chat', async (route, request) => {
    if (request.method() !== 'POST') return route.continue();
    const text = 'Based on the retrieved context from your codebase, the VectorStore class uses cosine similarity for nearest-neighbor search.';
    const tokens = text.split(/(?<=\s)/);
    let sseBody = `data: ${JSON.stringify({ rag: true, chunks: 3 })}\n\n`;
    sseBody += `data: ${JSON.stringify({ mode: 'hybrid' })}\n\n`;
    for (const t of tokens) sseBody += `data: ${JSON.stringify({ token: t, model: 'qwen2.5-coder:14b', tool: 'consult_specialist', reason: '[HYBRID] Code task → specialist' })}\n\n`;
    sseBody += `data: ${JSON.stringify({ done: true, elapsedMs: 2100, tokensOut: tokens.length, model: 'qwen2.5-coder:14b', tool: 'consult_specialist', reason: '[HYBRID] Code task → specialist' })}\n\n`;
    await route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body: sseBody });
  });

  await page.goto('http://localhost:3737/command-center', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);

  // Show mode toggle is set to hybrid
  await page.screenshot({ path: resolve(SCREENSHOTS, '15-mode-toggle-hybrid.png') });

  // Send a message — should show RAG badge
  await page.fill('#chatInput', 'How does the vector store work?');
  await page.click('#sendBtn');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: resolve(SCREENSHOTS, '16-rag-badge-active.png') });
});

test('Metrics HUD dashboard', async ({ page }) => {
  // Mock all endpoints the HUD polls
  await page.route('**/health', async (route) => {
    await route.fulfill({ status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      status: 'ready', mode: 'hybrid', ollama: true,
      models: ['qwen2.5-coder:7b', 'qwen2.5-coder:14b', 'deepseek-r1:14b'],
      rag: { vectorStore: true, chunks: 2168, path: '.cline-context/vector-store.json' },
      workspace: 'D:\\war-council',
      circuitBreakers: {
        fast: { state: 'closed', failures: 0, threshold: 5 },
        specialist: { state: 'closed', failures: 1, threshold: 3 },
        reasoning: { state: 'half-open', failures: 2, threshold: 3 },
        groq: { state: 'open', failures: 3, threshold: 3 },
        gemini: { state: 'closed', failures: 0, threshold: 3 },
      }
    })});
  });
  await page.route('**/breakers', async (route) => {
    await route.fulfill({ status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      fast: { state: 'closed', failures: 0, threshold: 5 },
      specialist: { state: 'closed', failures: 1, threshold: 3 },
      reasoning: { state: 'half-open', failures: 2, threshold: 3 },
      groq: { state: 'open', failures: 3, threshold: 3 },
      gemini: { state: 'closed', failures: 0, threshold: 3 },
    })});
  });
  await page.route('**/metrics', async (route) => {
    await route.fulfill({ status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      fast: { latencyP50: 1200, latencyP95: 3400, latencyP99: 5100, successes: 42, errors: 2, tokensPerSec: 38.5 },
      specialist: { latencyP50: 4500, latencyP95: 8900, latencyP99: 12000, successes: 18, errors: 1, tokensPerSec: 22.1 },
      reasoning: { latencyP50: 8200, latencyP95: 15000, latencyP99: 22000, successes: 7, errors: 2, tokensPerSec: 12.3 },
      groq: { latencyP50: 800, latencyP95: 1500, latencyP99: 2200, successes: 31, errors: 3, tokensPerSec: 85.0 },
      gemini: { latencyP50: 1100, latencyP95: 2800, latencyP99: 4000, successes: 15, errors: 0, tokensPerSec: 45.2 },
    })});
  });
  await page.route('**/metrics/events**', async (route) => {
    const events = [
      { timestamp: Date.now() - 5000, tier: 'fast', latencyMs: 1150, tokens: 120, ragChunks: 3 },
      { timestamp: Date.now() - 12000, tier: 'specialist', latencyMs: 4800, tokens: 340, ragChunks: 5 },
      { timestamp: Date.now() - 20000, tier: 'groq', latencyMs: 750, tokens: 200, ragChunks: 0 },
      { timestamp: Date.now() - 30000, tier: 'reasoning', latencyMs: 9100, tokens: 580, ragChunks: 2 },
      { timestamp: Date.now() - 45000, tier: 'gemini', latencyMs: 1200, tokens: 150, ragChunks: 4, error: 'rate limited' },
    ];
    await route.fulfill({ status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(events) });
  });
  await page.route('**/dag/list', async (route) => {
    await route.fulfill({ status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([
      { dagId: 'refactor-pipeline', dagName: 'Code Refactor', status: 'completed', duration: 12400 },
      { dagId: 'test-gen', dagName: 'Test Generation', status: 'running', duration: null },
    ])});
  });

  await page.goto('http://localhost:3737/metrics-hud', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000); // let polling tick fire
  await page.screenshot({ path: resolve(SCREENSHOTS, '17-metrics-hud-overview.png') });

  // Scroll to event feed
  await page.evaluate(() => document.querySelector('.events-feed')?.scrollIntoView({ behavior: 'instant' }));
  await page.waitForTimeout(500);
  await page.screenshot({ path: resolve(SCREENSHOTS, '18-metrics-hud-events.png') });
});

test('DAG Theater — visual pipeline renderer', async ({ page }) => {
  await page.goto('http://localhost:3737/dag-theater', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);

  // Screenshot 19: Demo DAG (Code Refactor) in pending state
  await page.screenshot({ path: resolve(SCREENSHOTS, '19-dag-theater-refactor.png') });

  // Load Complex Pipeline (Multi-Model Tournament)
  await page.click('#btn-complex');
  await page.waitForTimeout(500);
  await page.screenshot({ path: resolve(SCREENSHOTS, '20-dag-theater-tournament.png') });

  // Run animation and capture mid-execution
  await page.click('#btn-run');
  await page.waitForTimeout(4000); // ~6 nodes through animation
  await page.screenshot({ path: resolve(SCREENSHOTS, '21-dag-theater-running.png') });

  // Wait for completion
  await page.waitForTimeout(8000);
  await page.screenshot({ path: resolve(SCREENSHOTS, '22-dag-theater-completed.png') });
});

test('Memory Archive — vector space visualization', async ({ page }) => {
  // Mock the memory/vectors endpoint
  await page.route('**/memory/vectors', async (route) => {
    await route.fulfill({ status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chunks: [], total: 0 }) });
  });

  await page.goto('http://localhost:3737/memory-archive', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500); // let canvas render with demo data

  // Screenshot 23: Full archive view with clusters
  await page.screenshot({ path: resolve(SCREENSHOTS, '23-memory-archive-overview.png') });

  // Search filter
  await page.fill('#search', 'circuit');
  await page.waitForTimeout(500);
  await page.screenshot({ path: resolve(SCREENSHOTS, '24-memory-archive-search.png') });
});

test('Adaptive Thresholds — self-calibrating confidence', async ({ page }) => {
  // Mock the thresholds endpoint with rich demo data
  await page.route('**/thresholds', async (route) => {
    await route.fulfill({ status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      thresholds: { high: 0.76, medium: 0.54, low: 0.35, adapted: true, samples: 60, adaptationCount: 12 },
      tierAccuracy: {
        fast: { total: 15, accepted: 8, rate: 0.53 },
        specialist: { total: 18, accepted: 14, rate: 0.78 },
        reasoning: { total: 10, accepted: 9, rate: 0.9 },
        groq: { total: 9, accepted: 6, rate: 0.67 },
        gemini: { total: 8, accepted: 6, rate: 0.75 }
      }
    }) });
  });

  await page.goto('http://localhost:3737/adaptive-thresholds', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  // Screenshot 25: Full adaptive thresholds dashboard
  await page.screenshot({ path: resolve(SCREENSHOTS, '25-adaptive-thresholds-overview.png') });

  // Screenshot 26: Scroll to see threshold evolution chart
  await page.evaluate(() => window.scrollTo(0, 400));
  await page.waitForTimeout(500);
  await page.screenshot({ path: resolve(SCREENSHOTS, '26-adaptive-thresholds-chart.png') });
});

test('Arbitration Court — tournament verdict visualization', async ({ page }) => {
  await page.goto('http://localhost:3737/arbitration-court', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500); // let first case load + animations finish

  // Screenshot 27: Full arbitration court with first case (composition vs inheritance)
  await page.screenshot({ path: resolve(SCREENSHOTS, '27-arbitration-court-verdict.png') });

  // Screenshot 28: Scroll to score bars + case history
  await page.evaluate(() => window.scrollTo(0, 500));
  await page.waitForTimeout(500);
  await page.screenshot({ path: resolve(SCREENSHOTS, '28-arbitration-court-scores.png') });
});
