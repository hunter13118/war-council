import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { checkGateway, getResponseFooter, getSessionState, resetSession } from '../mcp-server/shared/protocol-gateway.js';

describe('Protocol Gateway', () => {
  beforeEach(() => {
    resetSession();
  });

  describe('Gate 1: workspace registration', () => {
    it('warns when workspace not registered', () => {
      const result = checkGateway('consult_fast', { prompt: 'test' });
      assert.ok(result, 'should return a warning');
      assert.ok(result.warning.includes('register_workspace'));
    });

    it('no warning after registration', () => {
      checkGateway('register_workspace', { path: '/test' });
      // Now memory_query to satisfy gate 2
      checkGateway('memory_query', { query: 'test' });
      const result = checkGateway('consult_fast', { prompt: 'test' });
      assert.equal(result, null, 'should pass after registration + memory_query');
    });
  });

  describe('Gate 2: memory_query before work', () => {
    it('warns when work tool called without memory_query', () => {
      checkGateway('register_workspace', { path: '/test' });
      const result = checkGateway('consult_specialist', { prompt: 'explain X' });
      assert.ok(result);
      assert.ok(result.warning.includes('memory_query'));
      assert.equal(result.autoInject, true);
    });

    it('passes when memory_query was called recently', () => {
      checkGateway('register_workspace', {});
      checkGateway('memory_query', { query: 'test' });
      const result = checkGateway('consult_fast', { prompt: 'hi' });
      assert.equal(result, null);
    });

    it('exempt tools skip the check', () => {
      const result = checkGateway('memory_stats', {});
      assert.equal(result, null);
    });
  });

  describe('Gate 3: report_action enforcement', () => {
    it('warns after 3+ work calls without report', () => {
      checkGateway('register_workspace', {});
      checkGateway('memory_query', { query: 'x' });
      checkGateway('consult_fast', { prompt: '1' });
      checkGateway('consult_fast', { prompt: '2' });
      const result = checkGateway('consult_fast', { prompt: '3' });
      assert.ok(result);
      assert.ok(result.warning.includes('report_action'));
    });

    it('resets after report_action', () => {
      checkGateway('register_workspace', {});
      checkGateway('memory_query', { query: 'x' });
      checkGateway('consult_fast', { prompt: '1' });
      checkGateway('consult_fast', { prompt: '2' });
      checkGateway('report_action', { action: 'did stuff' });
      const result = checkGateway('consult_fast', { prompt: '3' });
      // Should not warn about reporting (counter reset)
      assert.ok(!result || !result.warning?.includes('report_action'));
    });
  });

  describe('Response footers', () => {
    it('register_workspace footer points to memory_query', () => {
      checkGateway('register_workspace', {});
      const footer = getResponseFooter('register_workspace');
      assert.ok(footer.includes('memory_query'));
    });

    it('memory_query footer points to report_action', () => {
      checkGateway('memory_query', { query: 'x' });
      const footer = getResponseFooter('memory_query');
      assert.ok(footer.includes('report_action'));
    });

    it('work tool footer reminds about report after 2+ calls', () => {
      checkGateway('register_workspace', {});
      checkGateway('memory_query', { query: 'x' });
      checkGateway('consult_fast', { prompt: '1' });
      checkGateway('consult_fast', { prompt: '2' });
      const footer = getResponseFooter('consult_fast');
      assert.ok(footer.includes('report_action'));
    });
  });

  describe('Session state tracking', () => {
    it('tracks total calls', () => {
      checkGateway('memory_query', { query: 'a' });
      checkGateway('consult_fast', { prompt: 'b' });
      const state = getSessionState();
      assert.equal(state.totalCalls, 2);
    });

    it('resets cleanly', () => {
      checkGateway('register_workspace', {});
      checkGateway('memory_query', { query: 'x' });
      resetSession();
      const state = getSessionState();
      assert.equal(state.workspaceRegistered, false);
      assert.equal(state.memoryQueried, false);
      assert.equal(state.totalCalls, 0);
    });
  });
});
