import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildJudgePrompt, parseJudgeVerdict } from '../mcp-server/shared/judge.js';

describe('Tournament Judge Module', () => {
  describe('buildJudgePrompt', () => {
    it('includes question and contestant responses', () => {
      const prompt = buildJudgePrompt('What is 2+2?', [
        { voterKey: 'fast', text: 'It is 4' },
        { voterKey: 'reasoning', text: 'Two plus two equals four' },
      ]);
      assert.ok(prompt.includes('What is 2+2?'));
      assert.ok(prompt.includes('CONTESTANT 1 (fast)'));
      assert.ok(prompt.includes('CONTESTANT 2 (reasoning)'));
      assert.ok(prompt.includes('It is 4'));
      assert.ok(prompt.includes('Two plus two equals four'));
    });

    it('truncates long responses to 500 chars', () => {
      const longText = 'x'.repeat(1000);
      const prompt = buildJudgePrompt('question', [
        { voterKey: 'fast', text: longText },
      ]);
      // Should not contain the full 1000 chars
      assert.ok(!prompt.includes('x'.repeat(600)));
      assert.ok(prompt.includes('x'.repeat(500)));
    });
  });

  describe('parseJudgeVerdict', () => {
    it('parses clean WINNER and REASON', () => {
      const result = parseJudgeVerdict(
        { text: 'WINNER: 2\nREASON: Better explanation with examples.' },
        [{ voterKey: 'fast' }, { voterKey: 'reasoning' }],
        ['fast', 'reasoning']
      );
      assert.equal(result.winnerKey, 'reasoning');
      assert.equal(result.loserKey, 'fast');
      assert.ok(result.verdict.includes('Better explanation'));
    });

    it('handles "contestant N" format', () => {
      const result = parseJudgeVerdict(
        { text: 'WINNER: contestant 1\nREASON: Concise and correct.' },
        [{ voterKey: 'specialist' }, { voterKey: 'reasoning' }],
        ['specialist', 'reasoning']
      );
      assert.equal(result.winnerKey, 'specialist');
    });

    it('strips <think> tags from deepseek-r1 output', () => {
      const result = parseJudgeVerdict(
        {
          text: '<think>Let me analyze both responses carefully...</think>\nWINNER: 1\nREASON: More accurate.',
          fullText: '<think>Let me analyze both responses carefully...</think>\nWINNER: 1\nREASON: More accurate.',
        },
        [{ voterKey: 'fast' }, { voterKey: 'reasoning' }],
        ['fast', 'reasoning']
      );
      assert.equal(result.winnerKey, 'fast');
      assert.equal(result.verdict, 'More accurate.');
    });

    it('falls back to thinking content when no REASON found', () => {
      const result = parseJudgeVerdict(
        {
          text: 'WINNER: 2',
          thinking: 'The second response is clearly better. It provides more detail. The examples are solid.',
        },
        [{ voterKey: 'fast' }, { voterKey: 'specialist' }],
        ['fast', 'specialist']
      );
      assert.equal(result.winnerKey, 'specialist');
      assert.ok(result.verdict.length > 0);
    });

    it('defaults to first voter when parsing fails', () => {
      const result = parseJudgeVerdict(
        { text: 'I cannot decide' },
        [{ voterKey: 'fast' }, { voterKey: 'reasoning' }],
        ['fast', 'reasoning']
      );
      assert.equal(result.winnerKey, 'fast');
      assert.equal(result.loserKey, 'reasoning');
    });

    it('handles out-of-range winner index gracefully', () => {
      const result = parseJudgeVerdict(
        { text: 'WINNER: 99\nREASON: nonexistent.' },
        [{ voterKey: 'fast' }, { voterKey: 'reasoning' }],
        ['fast', 'reasoning']
      );
      // Should default since index 98 is out of range
      assert.equal(result.winnerKey, 'fast');
    });
  });
});
