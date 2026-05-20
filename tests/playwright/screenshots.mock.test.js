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

  // Screenshot 3: After sending (with response)
  await page.click('#sendBtn');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: resolve(SCREENSHOTS, '03-command-center-response.png') });

  // Screenshot 4: Show routing reason
  await page.check('#showReason');
  await page.screenshot({ path: resolve(SCREENSHOTS, '04-command-center-routing.png') });

  // Screenshot 5: Tournament mode with multiple agents talking
  await page.selectOption('#modeSelect', 'auto');
  await page.check('#tournamentToggle');
  await page.fill('#chatInput', 'Which is better: Rust or Go?');
  await page.screenshot({ path: resolve(SCREENSHOTS, '05-command-center-tournament-mode.png') });
});

test('Capture tournament dialogue exchange', async ({ page }) => {
  let callCount = 0;
  const tournamentResponses = [
    { text: 'Rust offers zero-cost abstractions and memory safety without garbage collection. The borrow checker catches entire classes of bugs at compile time.', tool: 'consult_fast', model: 'qwen2.5-coder:7b', frame: 'frame-red' },
    { text: 'Go prioritizes simplicity and fast compilation. Goroutines make concurrent programming accessible to all developers, not just experts.', tool: 'consult_specialist', model: 'qwen2.5-coder:14b', frame: 'frame-blue' },
    { text: 'Both languages serve different niches. Rust for systems programming where safety is paramount. Go for networked services where developer velocity matters. The winner depends on the domain.', tool: 'self_eval', model: 'deepseek-r1:14b', frame: 'frame-judge' },
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
  await page.waitForTimeout(4000);

  await page.screenshot({ path: resolve(SCREENSHOTS, '06-command-center-tournament-dialogue.png') });
});
