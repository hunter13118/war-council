import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { extractGraph, getGraph, getGraphStats, queryGraph } from '../memory-engine/knowledge-graph.js';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');

describe('Knowledge Graph Extraction', () => {
  it('extracts graph from the workspace', async () => {
    const graph = await extractGraph(REPO_ROOT, {
      extensions: ['.js'],
      ignore: ['node_modules', '.git', '.cline-context', 'dist', 'build', 'tests']
    });
    assert.ok(graph.nodes.length > 0, 'Should find some nodes');
    assert.ok(graph.edges.length > 0, 'Should find some edges');
    assert.ok(graph.extractedAt, 'Should have extraction timestamp');
  });

  it('finds file nodes', async () => {
    const graph = await extractGraph(REPO_ROOT, {
      extensions: ['.js'],
      ignore: ['node_modules', '.git', '.cline-context', 'dist', 'build', 'tests']
    });
    const fileNodes = graph.nodes.filter(n => n.type === 'file');
    assert.ok(fileNodes.length >= 5, `Should find multiple files, got ${fileNodes.length}`);
    // Should include server.js
    assert.ok(fileNodes.some(n => n.name === 'server.js'), 'Should find server.js');
  });

  it('extracts function nodes', async () => {
    const graph = await extractGraph(REPO_ROOT, {
      extensions: ['.js'],
      ignore: ['node_modules', '.git', '.cline-context', 'dist', 'build', 'tests']
    });
    const fnNodes = graph.nodes.filter(n => n.type === 'function');
    assert.ok(fnNodes.length > 0, 'Should extract functions');
    // Should find scoreConfidence from confidence.js
    assert.ok(fnNodes.some(n => n.name === 'scoreConfidence'), 'Should find scoreConfidence');
  });

  it('extracts class nodes', async () => {
    const graph = await extractGraph(REPO_ROOT, {
      extensions: ['.js'],
      ignore: ['node_modules', '.git', '.cline-context', 'dist', 'build', 'tests']
    });
    const classNodes = graph.nodes.filter(n => n.type === 'class');
    // SlidingWindowCounter in rate-limiter.js
    assert.ok(classNodes.some(n => n.name === 'SlidingWindowCounter'), 'Should find SlidingWindowCounter class');
  });

  it('extracts import edges', async () => {
    const graph = await extractGraph(REPO_ROOT, {
      extensions: ['.js'],
      ignore: ['node_modules', '.git', '.cline-context', 'dist', 'build', 'tests']
    });
    const importEdges = graph.edges.filter(e => e.type === 'imports');
    assert.ok(importEdges.length > 0, 'Should find import relationships');
  });

  it('getGraphStats returns useful summary', async () => {
    await extractGraph(REPO_ROOT, {
      extensions: ['.js'],
      ignore: ['node_modules', '.git', '.cline-context', 'dist', 'build', 'tests']
    });
    const stats = getGraphStats();
    assert.ok(stats.totalNodes > 0);
    assert.ok(stats.totalEdges > 0);
    assert.ok(stats.nodesByType.file > 0);
    assert.ok(stats.edgesByType.defines > 0);
  });

  it('queryGraph finds nodes by name', async () => {
    await extractGraph(REPO_ROOT, {
      extensions: ['.js'],
      ignore: ['node_modules', '.git', '.cline-context', 'dist', 'build', 'tests']
    });
    const result = queryGraph('confidence');
    assert.ok(result.matches.length > 0, 'Should find nodes matching "confidence"');
  });

  it('queryGraph returns connected nodes at depth 1', async () => {
    await extractGraph(REPO_ROOT, {
      extensions: ['.js'],
      ignore: ['node_modules', '.git', '.cline-context', 'dist', 'build', 'tests']
    });
    const result = queryGraph('server', 1);
    assert.ok(result.matches.length > 0);
    // Server files should have connections (imports, defines)
    assert.ok(result.connections.length > 0 || result.connectedNodes.length > 0,
      'server nodes should have connections');
  });
});
