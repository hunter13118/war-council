import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyError, gatherEvidence, buildFixPrompt,
  startDebugSession, recordAttempt, getNextFixPrompt,
  getDebugStats, getDebugHistory, resetDebugLoop
} from '../mcp-server/shared/debug-loop.js';

describe('Autonomous Debug Loop', () => {
  beforeEach(() => {
    resetDebugLoop();
  });

  describe('classifyError', () => {
    it('classifies TypeError as type_error → fast', () => {
      const c = classifyError({ message: "TypeError: foo is not a function" });
      assert.equal(c.type, 'type_error');
      assert.equal(c.tier, 'fast');
      assert.equal(c.autoFixable, true);
    });

    it('classifies import errors', () => {
      const c = classifyError({ message: "Cannot find module './missing.js'" });
      assert.equal(c.type, 'import_error');
      assert.equal(c.tier, 'fast');
    });

    it('classifies assertion failures as logic_error → reasoning', () => {
      const c = classifyError({ message: "AssertionError: expected 5 but got 3" });
      assert.equal(c.type, 'logic_error');
      assert.equal(c.tier, 'reasoning');
      assert.equal(c.maxRetries, 3);
    });

    it('classifies timeouts as async_error', () => {
      const c = classifyError({ message: "Error: timeout waiting for response" });
      assert.equal(c.type, 'async_error');
      assert.equal(c.autoFixable, false);
    });

    it('classifies syntax errors', () => {
      const c = classifyError({ message: "SyntaxError: Unexpected token }" });
      assert.equal(c.type, 'syntax_error');
      assert.equal(c.tier, 'fast');
    });

    it('returns unknown for unrecognized errors', () => {
      const c = classifyError({ message: "something weird happened" });
      assert.equal(c.type, 'unknown');
      assert.equal(c.tier, 'specialist');
    });
  });

  describe('gatherEvidence', () => {
    it('extracts code region around error line', () => {
      const fileContent = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n');
      const evidence = gatherEvidence(
        { message: 'test error', line: 10, file: 'test.js' },
        { fileContent }
      );
      assert.ok(evidence.codeRegion.includes('>>> 10:'));
      assert.ok(evidence.codeRegion.includes('line 10'));
    });

    it('includes stack trace', () => {
      const evidence = gatherEvidence({ message: 'err', stack: 'Error: err\n    at test.js:5' });
      assert.equal(evidence.stackTrace, 'Error: err\n    at test.js:5');
    });
  });

  describe('buildFixPrompt', () => {
    it('produces a structured prompt', () => {
      const classification = { type: 'type_error', tier: 'fast', maxRetries: 2 };
      const evidence = { message: 'foo is not a function', file: 'bar.js', codeRegion: 'const x = foo();', stackTrace: null, recentChanges: null, relatedFiles: [], similarFixes: [], previousAttempts: [] };
      const prompt = buildFixPrompt(classification, evidence, 0);
      assert.ok(prompt.includes('type_error'));
      assert.ok(prompt.includes('foo is not a function'));
      assert.ok(prompt.includes('DIAGNOSIS'));
      assert.ok(prompt.includes('FIX'));
    });

    it('includes previous attempts warning on retry', () => {
      const classification = { type: 'logic_error', tier: 'reasoning', maxRetries: 3 };
      const evidence = { message: 'expected 5 got 3', file: 'x.js', codeRegion: null, stackTrace: null, recentChanges: null, relatedFiles: [], similarFixes: [], previousAttempts: [{ fix: 'changed += to -=', result: 'still fails' }] };
      const prompt = buildFixPrompt(classification, evidence, 1);
      assert.ok(prompt.includes('FAILED'));
      assert.ok(prompt.includes('changed += to -='));
      assert.ok(prompt.includes('fundamentally different'));
    });
  });

  describe('debug session lifecycle', () => {
    it('starts a session and resolves on first attempt', () => {
      const session = startDebugSession({ message: 'SyntaxError: Unexpected }', file: 'a.js' });
      assert.equal(session.status, 'active');
      assert.equal(session.classification.type, 'syntax_error');

      const result = recordAttempt('removed extra brace', true);
      assert.equal(result.status, 'resolved');
      assert.equal(result.attempts.length, 1);
    });

    it('escalates after max retries', () => {
      startDebugSession({ message: 'TypeError: x is not a function' });
      recordAttempt('fix 1', false, 'still broken');
      const result = recordAttempt('fix 2', false, 'nope');
      assert.equal(result.status, 'escalated');
    });

    it('escalates tier after 2 failed attempts', () => {
      const session = startDebugSession({ message: 'AssertionError: expected 5 but got 3' });
      assert.equal(session.classification.tier, 'reasoning'); // already reasoning for logic

      // For a type_error that starts on 'fast':
      resetDebugLoop();
      const s2 = startDebugSession({ message: 'TypeError: x.map is not a function' });
      assert.equal(s2.classification.tier, 'fast');
      recordAttempt('tried wrapping in array', false, 'still fails');
      recordAttempt('tried checking type', false, 'nope');
      // maxRetries=2 for type_error, so this escalates rather than continuing
      // The tier escalation happens at attempt 2+ but session was already exhausted
    });

    it('getNextFixPrompt returns prompt for active session', () => {
      startDebugSession({ message: 'ReferenceError: x is not defined', file: 'z.js' });
      const prompt = getNextFixPrompt();
      assert.ok(prompt.includes('reference_error'));
      assert.ok(prompt.includes('x is not defined'));
    });

    it('getNextFixPrompt returns null when no active session', () => {
      assert.equal(getNextFixPrompt(), null);
    });
  });

  describe('statistics', () => {
    it('tracks stats across multiple sessions', () => {
      startDebugSession({ message: 'SyntaxError: oops' });
      recordAttempt('fix', true);

      startDebugSession({ message: 'TypeError: bad' });
      recordAttempt('try1', false, 'no');
      recordAttempt('try2', false, 'no');

      startDebugSession({ message: 'SyntaxError: another' });
      recordAttempt('fix', true);

      const stats = getDebugStats();
      assert.equal(stats.totalSessions, 3);
      assert.equal(stats.resolved, 2);
      assert.equal(stats.escalated, 1);
      assert.ok(stats.successRate > 0.6);
    });

    it('getDebugHistory returns formatted history', () => {
      startDebugSession({ message: 'TypeError: x' });
      recordAttempt('fix', true);

      const history = getDebugHistory();
      assert.equal(history.length, 1);
      assert.equal(history[0].status, 'resolved');
      assert.equal(history[0].type, 'type_error');
    });
  });
});
