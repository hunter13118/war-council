/**
 * WAR COUNCIL — Visual Demo (Headed Mode)
 *
 * Run with: npx playwright test --config=playwright.config.js --project=demo demo-walkthrough.test.js
 *
 * This runs in a VISIBLE browser window with deliberate pauses so you can
 * watch each feature fire in real time. The battle-log server must be running.
 */
import { test, expect } from '@playwright/test';

const PAUSE = 3000; // ms between demo steps
const BASE = 'http://localhost:3737';

test.describe('War Council — Live Demo Walkthrough', () => {
  test('Full feature showcase', async ({ page }) => {
    // === SCENE 1: Load War Table ===
    await page.goto(`${BASE}/war-table`, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.waitForTimeout(PAUSE);

    // === SCENE 2: Toggle DEMON mode + VOICES ===
    await page.click('button:has-text("DEMON")');
    await page.waitForTimeout(1500);
    await page.check('#voiceToggle');
    await page.waitForTimeout(PAUSE);

    // === SCENE 3: Seat some agents at the table ===
    await emitEvent(page, {
      type: 'tool_call', tool: 'consult_fast',
      text: 'Quick lookup: What is the default port for the battle-log server?',
      model: 'qwen2.5-coder:7b', elapsedMs: 340, tokensOut: 28
    });
    await page.waitForTimeout(2000);

    await emitEvent(page, {
      type: 'tool_call', tool: 'consult_specialist',
      text: 'Refactoring the tool registry to support hot-reloading of plugin modules...',
      model: 'qwen2.5-coder:14b', elapsedMs: 2100, tokensOut: 156
    });
    await page.waitForTimeout(2000);

    await emitEvent(page, {
      type: 'tool_call', tool: 'consult_reasoning',
      text: 'Analyzing architectural implications of switching from JSON store to SQLite for vector persistence...',
      model: 'deepseek-r1:14b', elapsedMs: 8400, tokensOut: 312
    });
    await page.waitForTimeout(PAUSE);

    // === SCENE 4: Tournament — Ace Attorney Mode ===
    await emitEvent(page, {
      type: 'debate_round',
      agent1: 'consult_specialist',
      agent2: 'consult_reasoning',
      text1: 'I recommend a plugin architecture with dynamic imports. Each tool lives in its own file, exports a schema and handler. The registry walks the directory at startup and registers them. Hot reload via fs.watch on the tools folder.',
      text2: 'While the plugin approach is clean, consider the cold-start cost. Dynamic imports add latency on first call. A better pattern: static registry with lazy initialization. Register schemas upfront, but defer handler loading until first invocation. This gives us fast startup AND modularity.',
      prompt: 'How should we architect the tool registry for maximum extensibility?',
      verdict: 'WINNER: consult_reasoning. The lazy-init hybrid approach addresses both extensibility AND performance. Pure dynamic loading sacrifices startup speed unnecessarily.',
      winner: 'consult_reasoning'
    });
    // Wait for the full tournament animation (typewriter + verdict + TTS voices)
    await page.waitForTimeout(35000);

    // === SCENE 5: Tournament result (updates ELO + crowns) ===
    await emitEvent(page, {
      type: 'tournament_result',
      winner: 'consult_reasoning',
      loser: 'consult_specialist',
      winnerRecord: { wins: 3, losses: 1, streak: 2, elo: 1248 },
      loserRecord: { wins: 1, losses: 3, streak: 0, elo: 1152 },
      rationale: 'Lazy-init hybrid wins on both extensibility and performance metrics.',
      winnerArg: 'Static registry with lazy initialization — fast startup AND modularity.',
      loserArg: 'Dynamic imports with fs.watch for hot reload.'
    });
    await page.waitForTimeout(PAUSE);

    // === SCENE 6: More agent activity (fills timeline) ===
    const quickEvents = [
      { type: 'tool_call', tool: 'memory_query', text: 'Retrieving context for: vector store implementation patterns', model: 'nomic-embed-text', elapsedMs: 120, tokensOut: 0 },
      { type: 'tool_call', tool: 'invoke_agent', text: 'CodeReviewer analyzing diff for potential regressions...', model: 'qwen2.5-coder:14b', elapsedMs: 3200, tokensOut: 245 },
      { type: 'tool_call', tool: 'consult_fast', text: 'Formatting the commit message per conventional commits spec.', model: 'qwen2.5-coder:7b', elapsedMs: 280, tokensOut: 15 },
      { type: 'tool_call', tool: 'run_chain', text: 'Executing fix_bug chain: investigate → plan → implement → test', model: 'qwen2.5-coder:14b', elapsedMs: 12000, tokensOut: 890 },
    ];
    for (const ev of quickEvents) {
      await emitEvent(page, ev);
      await page.waitForTimeout(1500);
    }
    await page.waitForTimeout(PAUSE);

    // === SCENE 7: Toggle to PIXEL mode ===
    await page.click('button:has-text("PIXEL")');
    await page.waitForTimeout(PAUSE);

    // === SCENE 8: Another tournament with different agents ===
    await emitEvent(page, {
      type: 'debate_round',
      agent1: 'consult_fast',
      agent2: 'consult_specialist',
      text1: 'Just use console.log for debugging. Simple, fast, no dependencies.',
      text2: 'Structured logging with pino gives you JSON output, log levels, and zero-overhead in production. The two extra lines of setup pay for themselves immediately in any non-trivial system.',
      prompt: 'What logging approach for the MCP server?',
      verdict: 'WINNER: consult_specialist. Structured logging is objectively superior for production systems. Console.log is fine for scripts, not servers.',
      winner: 'consult_specialist'
    });
    await page.waitForTimeout(30000);

    // === SCENE 9: Council deliberation ===
    await emitEvent(page, {
      type: 'council_deliberation',
      prompt: 'Should we add WebSocket streaming for real-time model output?',
      agents: [
        { name: 'consult_fast', response: 'Yes — users expect streaming in 2024. SSE works but WebSocket gives bidirectional control.' },
        { name: 'consult_specialist', response: 'Agree on streaming, but SSE is simpler and already works. WebSocket adds complexity for minimal gain in a read-heavy system.' },
        { name: 'consult_reasoning', response: 'The question is wrong. We already HAVE SSE streaming via /events. The real ask is: should individual tool responses stream tokens? That requires Ollama stream:true, which changes the entire response contract.' },
      ],
      synthesis: 'Keep SSE for dashboard events. Add optional token streaming at the tool level with stream:true flag. No WebSocket needed.'
    });
    await page.waitForTimeout(25000);

    // === SCENE 10: Final pause — admire the war table ===
    await page.waitForTimeout(5000);
  });
});

async function emitEvent(page, event) {
  await page.evaluate(async (ev) => {
    await fetch('/emit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ev),
    });
  }, event);
}
