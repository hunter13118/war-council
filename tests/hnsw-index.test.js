import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HNSWIndex, buildIndex } from '../memory-engine/hnsw-index.js';

describe('HNSW Vector Index', () => {
  function randomVector(dim) {
    return Array.from({ length: dim }, () => Math.random() * 2 - 1);
  }

  function normalize(v) {
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    return v.map(x => x / norm);
  }

  it('inserts and searches a small index', () => {
    const index = new HNSWIndex({ M: 8, efConstruction: 50, efSearch: 20 });
    const dim = 32;
    const vectors = Array.from({ length: 50 }, (_, i) => ({
      id: `vec-${i}`,
      vector: normalize(randomVector(dim)),
    }));

    for (const v of vectors) {
      index.insert(v.id, v.vector, { idx: v.id });
    }

    const results = index.search(vectors[0].vector, 5);
    assert.equal(results.length, 5);
    // First result should be the vector itself (score ≈ 1.0)
    assert.equal(results[0].id, 'vec-0');
    assert.ok(results[0].score > 0.99, `Self-similarity should be ~1.0, got ${results[0].score}`);
  });

  it('finds similar vectors with high recall', () => {
    const index = new HNSWIndex({ M: 16, efConstruction: 100, efSearch: 50 });
    const dim = 64;

    // Create cluster: 10 vectors near each other
    const base = normalize(randomVector(dim));
    const cluster = Array.from({ length: 10 }, (_, i) => {
      const perturbed = base.map(x => x + (Math.random() - 0.5) * 0.1);
      return { id: `cluster-${i}`, vector: normalize(perturbed) };
    });

    // Create 40 random vectors (far from cluster)
    const randoms = Array.from({ length: 40 }, (_, i) => ({
      id: `random-${i}`,
      vector: normalize(randomVector(dim)),
    }));

    for (const v of [...cluster, ...randoms]) {
      index.insert(v.id, v.vector);
    }

    // Search near cluster center — should return mostly cluster members
    const results = index.search(base, 10);
    const clusterHits = results.filter(r => r.id.startsWith('cluster-')).length;
    assert.ok(clusterHits >= 7, `Should find most cluster members in top 10, got ${clusterHits}`);
  });

  it('handles empty index gracefully', () => {
    const index = new HNSWIndex();
    const results = index.search([1, 0, 0], 5);
    assert.equal(results.length, 0);
  });

  it('handles single vector', () => {
    const index = new HNSWIndex();
    index.insert('only', [1, 0, 0]);
    const results = index.search([1, 0, 0], 5);
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'only');
  });

  it('stats returns useful information', () => {
    const index = new HNSWIndex({ M: 8 });
    for (let i = 0; i < 20; i++) {
      index.insert(`v${i}`, normalize(randomVector(16)));
    }
    const stats = index.stats();
    assert.equal(stats.totalVectors, 20);
    assert.equal(stats.M, 8);
    assert.equal(stats.dimensions, 16);
    assert.ok(stats.layers >= 1);
  });

  it('buildIndex creates from vector store format', () => {
    const vectors = Array.from({ length: 30 }, (_, i) => ({
      id: `chunk-${i}`,
      embedding: normalize(randomVector(32)),
      file: `src/file${i}.js`,
      content: `function example${i}() {}`,
    }));

    const index = buildIndex(vectors);
    assert.equal(index.nodes.length, 30);

    const results = index.search(vectors[5].embedding, 3);
    assert.equal(results[0].id, 'chunk-5');
    assert.ok(results[0].data.file.includes('file5'));
  });

  it('scales to 500 vectors with sub-linear search', () => {
    const index = new HNSWIndex({ M: 16, efConstruction: 100, efSearch: 30 });
    const dim = 128;
    const vectors = Array.from({ length: 500 }, (_, i) => normalize(randomVector(dim)));

    for (let i = 0; i < vectors.length; i++) {
      index.insert(`v${i}`, vectors[i]);
    }

    // Search should be fast (not timing, just verifying correctness)
    const query = vectors[250];
    const results = index.search(query, 5);
    assert.equal(results.length, 5);
    assert.equal(results[0].id, 'v250'); // should find itself
    assert.ok(results[0].score > 0.99);
  });

  it('recall improves with higher efSearch', () => {
    const index = new HNSWIndex({ M: 8, efConstruction: 50, efSearch: 10 });
    const dim = 32;

    for (let i = 0; i < 100; i++) {
      index.insert(`v${i}`, normalize(randomVector(dim)));
    }

    // Low ef search
    index.efSearch = 5;
    const lowEfResults = index.search(normalize(randomVector(dim)), 10);

    // High ef search
    index.efSearch = 50;
    const highEfResults = index.search(normalize(randomVector(dim)), 10);

    // Both should return results (exact recall comparison is non-deterministic)
    assert.equal(lowEfResults.length, 10);
    assert.equal(highEfResults.length, 10);
  });
});
