import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scoreConfidence, confidenceLevel } from '../mcp-server/shared/confidence.js';

describe('Confidence Scoring', () => {
  const baseOpts = {
    response: 'The vector store uses cosine similarity for nearest-neighbor search across embedded code chunks.',
    question: 'How does the vector store work?',
    latencyMs: 500,
    tokensOut: 20,
    tier: 'specialist',
    ragHit: true,
    turnCount: 2,
  };

  it('returns composite score between 0 and 1', () => {
    const result = scoreConfidence(baseOpts);
    assert.ok(result.composite >= 0);
    assert.ok(result.composite <= 1);
  });

  it('returns all four dimensions', () => {
    const result = scoreConfidence(baseOpts);
    assert.ok('relevance' in result.dimensions);
    assert.ok('completeness' in result.dimensions);
    assert.ok('certainty' in result.dimensions);
    assert.ok('consistency' in result.dimensions);
    for (const score of Object.values(result.dimensions)) {
      assert.ok(score >= 0 && score <= 1);
    }
  });

  it('RAG hit boosts consistency', () => {
    const withRag = scoreConfidence({ ...baseOpts, ragHit: true });
    const withoutRag = scoreConfidence({ ...baseOpts, ragHit: false });
    assert.ok(withRag.dimensions.consistency > withoutRag.dimensions.consistency);
  });

  it('hedging language reduces certainty', () => {
    const confident = scoreConfidence({ ...baseOpts, response: 'The vector store definitely uses cosine similarity.' });
    const hedging = scoreConfidence({ ...baseOpts, response: 'I think maybe the vector store possibly uses cosine similarity, but I\'m not sure.' });
    assert.ok(confident.dimensions.certainty > hedging.dimensions.certainty);
  });

  it('reasoning tier gets higher trust than fast', () => {
    const reasoning = scoreConfidence({ ...baseOpts, tier: 'reasoning' });
    const fast = scoreConfidence({ ...baseOpts, tier: 'fast' });
    assert.ok(reasoning.composite >= fast.composite);
  });

  it('longer relevant response gets higher completeness', () => {
    const short = scoreConfidence({ ...baseOpts, response: 'Cosine.' });
    const long = scoreConfidence({ ...baseOpts, response: 'The vector store implements cosine similarity between the query embedding and all stored chunk embeddings, returning the top-k most similar chunks above a minimum relevance threshold.' });
    assert.ok(long.dimensions.completeness > short.dimensions.completeness);
  });

  it('includes metadata in result', () => {
    const result = scoreConfidence(baseOpts);
    assert.equal(result.tier, 'specialist');
    assert.equal(result.ragAugmented, true);
  });
});

describe('Confidence Level Classification', () => {
  it('classifies high (>= 0.8)', () => {
    assert.equal(confidenceLevel(0.9), 'high');
    assert.equal(confidenceLevel(0.8), 'high');
  });

  it('classifies medium (>= 0.6)', () => {
    assert.equal(confidenceLevel(0.7), 'medium');
    assert.equal(confidenceLevel(0.6), 'medium');
  });

  it('classifies low (>= 0.4)', () => {
    assert.equal(confidenceLevel(0.5), 'low');
    assert.equal(confidenceLevel(0.4), 'low');
  });

  it('classifies uncertain (< 0.4)', () => {
    assert.equal(confidenceLevel(0.3), 'uncertain');
    assert.equal(confidenceLevel(0.0), 'uncertain');
  });
});
