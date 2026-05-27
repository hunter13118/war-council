import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import {
  indexFull, lookupSymbol, getFileSymbols, getDependencies,
  getDependents, analyzeImpact, searchSymbols, getFileChunks,
  getIndexStats, getDepGraphData, resetIndex
} from '../memory-engine/repo-indexer.js';

const REPO_ROOT = resolve(import.meta.dirname, '..');

describe('Repo Graph AST Indexer', () => {
  beforeEach(() => {
    resetIndex();
  });

  it('indexes the full repository', async () => {
    const result = await indexFull(REPO_ROOT, {
      extensions: ['.js'],
      ignore: ['node_modules', '.git', '.cline-context', 'dist', 'build', 'tests']
    });
    assert.ok(result.stats.filesIndexed > 5, `Should index multiple files, got ${result.stats.filesIndexed}`);
    assert.ok(result.stats.symbolsFound > 0, 'Should find symbols');
    assert.ok(result.stats.chunksCreated > 0, 'Should create chunks');
  });

  it('lookupSymbol finds known functions', async () => {
    await indexFull(REPO_ROOT, { extensions: ['.js'], ignore: ['node_modules', '.git', '.cline-context', 'tests'] });
    const results = lookupSymbol('scoreConfidence');
    assert.ok(results.length > 0, 'Should find scoreConfidence');
    assert.equal(results[0].type, 'function');
    assert.ok(results[0].file.includes('confidence'));
  });

  it('lookupSymbol finds classes', async () => {
    await indexFull(REPO_ROOT, { extensions: ['.js'], ignore: ['node_modules', '.git', '.cline-context', 'tests'] });
    const results = lookupSymbol('SlidingWindowCounter');
    assert.ok(results.length > 0, 'Should find SlidingWindowCounter');
    assert.equal(results[0].type, 'class');
  });

  it('getFileSymbols returns all symbols in a file', async () => {
    await indexFull(REPO_ROOT, { extensions: ['.js'], ignore: ['node_modules', '.git', '.cline-context', 'tests'] });
    const symbols = getFileSymbols('mcp-server/shared/confidence.js');
    assert.ok(symbols.length > 0, 'Should have symbols in confidence.js');
    assert.ok(symbols.some(s => s.name === 'scoreConfidence'));
  });

  it('getDependencies returns imports', async () => {
    await indexFull(REPO_ROOT, { extensions: ['.js'], ignore: ['node_modules', '.git', '.cline-context', 'tests'] });
    const deps = getDependencies('battle-log/server.js');
    assert.ok(deps.length > 3, `server.js should import multiple files, got ${deps.length}`);
  });

  it('getDependents finds reverse deps', async () => {
    await indexFull(REPO_ROOT, { extensions: ['.js'], ignore: ['node_modules', '.git', '.cline-context', 'tests'] });
    // confidence.js is imported by server.js
    const dependents = getDependents('mcp-server/shared/confidence.js');
    assert.ok(dependents.length > 0, 'confidence.js should have dependents');
  });

  it('analyzeImpact shows transitive impact', async () => {
    await indexFull(REPO_ROOT, { extensions: ['.js'], ignore: ['node_modules', '.git', '.cline-context', 'tests'] });
    const impact = analyzeImpact('mcp-server/shared/ollama.js');
    assert.ok(impact.totalAffected > 0, 'ollama.js changes should affect other files');
  });

  it('searchSymbols finds by partial name', async () => {
    await indexFull(REPO_ROOT, { extensions: ['.js'], ignore: ['node_modules', '.git', '.cline-context', 'tests'] });
    const results = searchSymbols('record');
    assert.ok(results.length > 0, 'Should find symbols containing "record"');
  });

  it('getFileChunks returns chunks for a file', async () => {
    await indexFull(REPO_ROOT, { extensions: ['.js'], ignore: ['node_modules', '.git', '.cline-context', 'tests'] });
    const chunks = getFileChunks('mcp-server/shared/confidence.js');
    assert.ok(chunks.length > 0, 'Should have chunks for confidence.js');
    assert.ok(chunks.some(c => c.name === 'scoreConfidence'));
  });

  it('getIndexStats returns summary', async () => {
    await indexFull(REPO_ROOT, { extensions: ['.js'], ignore: ['node_modules', '.git', '.cline-context', 'tests'] });
    const stats = getIndexStats();
    assert.ok(stats.filesIndexed > 0);
    assert.ok(stats.totalSymbols > 0);
    assert.ok(stats.totalChunks > 0);
    assert.ok(stats.lastIndexedAt);
  });

  it('getDepGraphData returns visualization-ready data', async () => {
    await indexFull(REPO_ROOT, { extensions: ['.js'], ignore: ['node_modules', '.git', '.cline-context', 'tests'] });
    const data = getDepGraphData();
    assert.ok(data.nodes.length > 0);
    assert.ok(data.edges.length > 0);
    assert.ok(data.edges[0].from);
    assert.ok(data.edges[0].to);
  });
});
