import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { runPipeline, checkSyntax, checkArchitecture, checkSecurity } from '../mcp-server/shared/verification-pipeline.js';

const TMP_DIR = resolve(import.meta.dirname, '..', '.tmp-verify-test');

describe('Verification Pipeline', () => {
  before(async () => {
    await mkdir(resolve(TMP_DIR, 'src'), { recursive: true });
  });

  after(async () => {
    await rm(TMP_DIR, { recursive: true, force: true });
  });

  describe('syntax check', () => {
    it('passes on valid JS', async () => {
      await writeFile(resolve(TMP_DIR, 'good.js'), 'const x = 1;\nconsole.log(x);\n');
      const result = await checkSyntax(TMP_DIR);
      assert.equal(result.status, 'pass');
    });

    it('fails on invalid JS', async () => {
      await writeFile(resolve(TMP_DIR, 'src', 'bad.js'), 'const x = {{{;\n');
      const result = await checkSyntax(TMP_DIR);
      assert.equal(result.status, 'fail');
      assert.ok(result.message.includes('syntax'));
      // clean up so it doesn't affect other checks
      await rm(resolve(TMP_DIR, 'src', 'bad.js'));
    });
  });

  describe('architecture check', () => {
    it('passes when no issues found', async () => {
      const result = await checkArchitecture(TMP_DIR);
      assert.equal(result.status, 'pass');
    });
  });

  describe('security check', () => {
    it('passes on clean code', async () => {
      await writeFile(resolve(TMP_DIR, 'clean.js'), 'const greet = (name) => `Hello ${name}`;\n');
      const result = await checkSecurity(TMP_DIR);
      assert.equal(result.status, 'pass');
    });

    it('warns on eval usage', async () => {
      await writeFile(resolve(TMP_DIR, 'evil.js'), 'const x = eval("1+1");\n');
      const result = await checkSecurity(TMP_DIR);
      assert.equal(result.status, 'warn');
      assert.ok(result.message.includes('eval'));
      await rm(resolve(TMP_DIR, 'evil.js'));
    });

    it('warns on hardcoded secrets', async () => {
      await writeFile(resolve(TMP_DIR, 'secrets.js'), 'const password = "super-secret-value-123";\n');
      const result = await checkSecurity(TMP_DIR);
      assert.equal(result.status, 'warn');
      assert.ok(result.message.includes('secret'));
      await rm(resolve(TMP_DIR, 'secrets.js'));
    });
  });

  describe('full pipeline', () => {
    it('runs all checks and returns overall pass', async () => {
      await writeFile(resolve(TMP_DIR, 'app.js'), 'export const main = () => "hello";\n');
      const result = await runPipeline(TMP_DIR, { skip: ['tests'] });
      assert.equal(result.overall, 'pass');
      assert.ok(result.checks.length >= 3);
      assert.ok(result.totalMs >= 0);
      // Each check has required fields
      for (const check of result.checks) {
        assert.ok(['pass', 'fail', 'warn', 'skip'].includes(check.status));
        assert.ok(typeof check.durationMs === 'number');
      }
    });

    it('skips checks listed in options.skip', async () => {
      const result = await runPipeline(TMP_DIR, { skip: ['tests', 'security', 'architecture'] });
      const skipped = result.checks.filter(c => c.status === 'skip');
      assert.equal(skipped.length, 3);
    });

    it('reports fail when syntax errors exist', async () => {
      await writeFile(resolve(TMP_DIR, 'broken.js'), 'function {{{}}}\n');
      const result = await runPipeline(TMP_DIR, { skip: ['tests'] });
      assert.equal(result.overall, 'fail');
      assert.equal(result.checks.find(c => c.name === 'syntax').status, 'fail');
      await rm(resolve(TMP_DIR, 'broken.js'));
    });
  });
});
