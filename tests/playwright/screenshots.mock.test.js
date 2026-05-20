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

  // === Showcase Card ===
  await page.goto('http://localhost:3737/showcase/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: resolve(SCREENSHOTS, '13-showcase-card.png') });

  // === Embed page ===
  await page.goto('http://localhost:3737/embed', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: resolve(SCREENSHOTS, '14-embed-view.png') });

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
