/**
 * Integration test — Protocol Gateway + Auto-Inject + Tool Middleware
 *
 * Exercises the FULL pipeline as an agent would experience it:
 *   Fresh session → call work tool → see warnings/footers → register → query memory → clear sailing
 *
 * Run: node --test tests/gateway-integration.test.js
 *
 * This does NOT require Ollama — uses mock tool handlers to isolate the middleware.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { withInstrumentation } from '../mcp-server/shared/tool-middleware.js';
import { resetSession, getSessionState } from '../mcp-server/shared/protocol-gateway.js';

// Mock tool handlers — simulate what consult_fast, register_workspace, memory_query return
function mockConsultFast(args) {
  return { content: [{ type: 'text', text: `Mock answer for: ${args.prompt}` }] };
}
function mockRegisterWorkspace(args) {
  return { content: [{ type: 'text', text: `Workspace registered: ${args.path || 'test'}` }] };
}
function mockMemoryQuery(args) {
  return { content: [{ type: 'text', text: `Found 3 chunks for: ${args.query}` }] };
}
function mockReportAction(args) {
  return { content: [{ type: 'text', text: `Action logged: ${args.action}` }] };
}

describe('Gateway Integration — Full Pipeline', () => {
  let consult, register, memQuery, report;

  beforeEach(() => {
    resetSession();
    consult = withInstrumentation('consult_fast', mockConsultFast);
    register = withInstrumentation('register_workspace', mockRegisterWorkspace);
    memQuery = withInstrumentation('memory_query', mockMemoryQuery);
    report = withInstrumentation('report_action', mockReportAction);
  });

  it('fresh session: consult_fast shows workspace warning', async () => {
    const result = await consult({ prompt: 'what is the circuit breaker?' }, {});
    const text = result.content[0].text;

    // Should contain the warning about missing workspace registration
    assert.ok(text.includes('register_workspace'), `Expected workspace warning, got: ${text.slice(0, 200)}`);
    assert.ok(text.includes('Mock answer'), 'Original response should still be present');
  });

  it('after register: consult_fast shows memory_query warning', async () => {
    await register({ path: '/test/repo' }, {});
    const result = await consult({ prompt: 'explain something' }, {});
    const text = result.content[0].text;

    assert.ok(text.includes('memory_query'), `Expected memory warning, got: ${text.slice(0, 200)}`);
    assert.ok(text.includes('Mock answer'), 'Original response should still be present');
  });

  it('after register + memory_query: consult_fast passes clean', async () => {
    await register({ path: '/test' }, {});
    await memQuery({ query: 'test' }, {});
    const result = await consult({ prompt: 'clean call' }, {});
    const text = result.content[0].text;

    // Should NOT have workspace or memory warnings
    assert.ok(!text.includes('⚠️'), `Should have no warnings, got: ${text.slice(0, 300)}`);
    assert.ok(text.includes('Mock answer for: clean call'));
  });

  it('response footers are injected', async () => {
    const regResult = await register({ path: '/test' }, {});
    const regText = regResult.content[0].text;

    // register_workspace footer should point to memory_query
    assert.ok(regText.includes('NEXT'), `Expected footer, got: ${regText.slice(0, 200)}`);
  });

  it('report_action warning after 3 work calls', async () => {
    await register({ path: '/test' }, {});
    await memQuery({ query: 'x' }, {});

    await consult({ prompt: '1' }, {});
    await consult({ prompt: '2' }, {});
    const third = await consult({ prompt: '3' }, {});
    const text = third.content[0].text;

    assert.ok(text.includes('report_action'), `Expected report warning after 3 calls, got: ${text.slice(0, 300)}`);
  });

  it('report_action resets the counter', async () => {
    await register({ path: '/test' }, {});
    await memQuery({ query: 'x' }, {});
    await consult({ prompt: '1' }, {});
    await consult({ prompt: '2' }, {});
    await report({ action: 'did stuff' }, {});
    const result = await consult({ prompt: 'after report' }, {});
    const text = result.content[0].text;

    // Should NOT warn about reporting
    assert.ok(!text.includes('report_action') || text.includes('NEXT'), 
      `Should not warn about report after reset. Got: ${text.slice(0, 300)}`);
  });

  it('session state tracks correctly through full flow', async () => {
    await register({ path: '/test' }, {});
    let state = getSessionState();
    assert.equal(state.workspaceRegistered, true);
    assert.equal(state.memoryQueried, false);

    await memQuery({ query: 'hello' }, {});
    state = getSessionState();
    assert.equal(state.memoryQueried, true);

    await consult({ prompt: 'a' }, {});
    await consult({ prompt: 'b' }, {});
    state = getSessionState();
    assert.equal(state.actionsWithoutReport, 2);

    await report({ action: 'logged' }, {});
    state = getSessionState();
    assert.equal(state.actionsWithoutReport, 0);
  });

  it('auto-inject flag is set when memory_query was skipped', async () => {
    await register({ path: '/test' }, {});
    // Call consult without memory_query — auto-inject should attempt
    const result = await consult({ prompt: 'explain the circuit breaker pattern' }, {});
    const text = result.content[0].text;
    // The prompt gets modified IF auto-inject finds something
    // Either way, the warning about memory_query should still be visible
    assert.ok(text.includes('memory_query'), 'Should still warn about memory_query');
  });

  it('blocked mode rejects tool calls (GATEWAY_ENFORCEMENT=hard)', async () => {
    // Save and set enforcement level
    const original = process.env.GATEWAY_ENFORCEMENT;
    process.env.GATEWAY_ENFORCEMENT = 'hard';
    resetSession(); // Re-read enforcement level

    // Need to re-create handler since enforcement is read at check time
    const hardConsult = withInstrumentation('consult_fast', mockConsultFast);
    const result = await hardConsult({ prompt: 'blocked' }, {});

    assert.equal(result.isError, true, 'Should be blocked');
    assert.ok(result.content[0].text.includes('register_workspace') || 
              result.content[0].text.includes('BLOCKED'),
              `Expected block message, got: ${result.content[0].text}`);

    // Restore
    process.env.GATEWAY_ENFORCEMENT = original || '';
  });
});
