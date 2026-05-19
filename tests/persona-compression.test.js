import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compressPersona } from '../mcp-server/tools/invoke-agent.js';

describe('compressPersona', () => {
  it('strips YAML frontmatter', () => {
    const input = '---\ndescription: "test"\ntools: [read]\n---\n\n# Agent\n\nDo stuff.';
    const result = compressPersona(input);
    assert.ok(!result.includes('---'));
    assert.ok(result.includes('# Agent'));
  });

  it('strips markdown tables', () => {
    const input = '# Role\n\n| Col1 | Col2 |\n| --- | --- |\n| a | b |\n\nKeep this.';
    const result = compressPersona(input);
    assert.ok(!result.includes('| Col1'));
    assert.ok(!result.includes('| a'));
    assert.ok(result.includes('Keep this.'));
  });

  it('collapses multiple blank lines', () => {
    const input = 'Line1\n\n\n\n\nLine2';
    const result = compressPersona(input);
    assert.ok(!result.includes('\n\n\n'));
    assert.ok(result.includes('Line1\n\nLine2'));
  });

  it('truncates when over budget', () => {
    const input = 'x'.repeat(5000);
    const result = compressPersona(input, 3000);
    assert.ok(result.length < 5000);
    assert.ok(result.includes('[...truncated'));
  });

  it('preserves content under budget', () => {
    const input = '# My Agent\n\nDo the thing.';
    const result = compressPersona(input, 3000);
    assert.equal(result, input);
  });
});
