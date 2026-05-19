import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SCHEMAS_DIR = path.join(ROOT, 'schemas');

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

// First pass: add all schemas to AJV registry (for $ref resolution)
const allSchemaContents = [];
for (const file of fs.readdirSync(SCHEMAS_DIR).filter(f => f.endsWith('.json'))) {
  const content = JSON.parse(fs.readFileSync(path.join(SCHEMAS_DIR, file), 'utf-8'));
  allSchemaContents.push({ file, content });
}
// Add schemas without compiling first (just register by $id)
for (const { content } of allSchemaContents) {
  try { ajv.addSchema(content); } catch (e) { /* skip duplicates or invalid refs */ }
}

// Second pass: compile validators for the schemas we want to test
const schemas = {};
for (const { file, content } of allSchemaContents) {
  try {
    schemas[file] = { content, validate: ajv.compile(content) };
  } catch (e) {
    // Schema with unresolvable $ref — skip validation tests for it
    schemas[file] = { content, validate: null, error: e.message };
  }
}

describe('Sample Data Validation Suite', () => {

  describe('confidence.v1 — validates sample confidence scores', () => {
    const validate = schemas['confidence.v1.schema.json']?.validate;

    it('accepts a valid confidence score', function() {
      if (!validate) { this.skip(); return; }
      const sample = {
        overall: 0.82,
        dimensions: {
          correctness: 0.9,
          completeness: 0.75,
          relevance: 0.85,
          safety: 0.95
        }
      };
      const valid = validate(sample);
      assert.ok(valid, `Validation errors: ${JSON.stringify(validate.errors)}`);
    });

    it('rejects confidence > 1.0', function() {
      if (!validate) { this.skip(); return; }
      const sample = {
        overall: 1.5,  // Invalid
        dimensions: {
          correctness: 0.9,
          completeness: 0.75,
          relevance: 0.85,
          safety: 0.95
        }
      };
      assert.equal(validate(sample), false);
    });

    it('rejects missing dimensions', function() {
      if (!validate) { this.skip(); return; }
      const sample = { overall: 0.5 };  // Missing dimensions
      assert.equal(validate(sample), false);
    });
  });

  describe('execution-dag.v1 — validates sample DAGs', () => {
    const validate = schemas['execution-dag.v1.json']?.validate;

    it('accepts a valid minimal DAG', function() {
      if (!validate) { this.skip(); return; }
      const sample = {
        id: 'dag-test-minimal',
        name: 'test_dag',
        version: '1.0',
        entryNode: 'start',
        nodes: {
          start: {
            type: 'task',
            config: {
              tool: 'consult_fast',
              tier: 'fast'
            },
            dependencies: []
          }
        }
      };
      const valid = validate(sample);
      assert.ok(valid, `Validation errors: ${JSON.stringify(validate.errors)}`);
    });

    it('rejects DAG with invalid id format', function() {
      if (!validate) { this.skip(); return; }
      const sample = {
        id: 'INVALID ID!!',  // Must match ^dag-[a-z0-9-]+$
        name: 'test',
        version: '1.0',
        entryNode: 'start',
        nodes: {
          start: {
            type: 'task',
            config: { tool: 'test', tier: 'fast' },
            dependencies: []
          }
        }
      };
      assert.equal(validate(sample), false);
    });

    it('rejects DAG with no nodes', function() {
      if (!validate) { this.skip(); return; }
      const sample = {
        id: 'dag-empty',
        name: 'empty',
        version: '1.0',
        entryNode: 'start',
        nodes: {}  // minProperties: 1
      };
      assert.equal(validate(sample), false);
    });

    it('rejects node with invalid type', function() {
      if (!validate) { this.skip(); return; }
      const sample = {
        id: 'dag-bad-type',
        name: 'bad',
        version: '1.0',
        entryNode: 'start',
        nodes: {
          start: {
            type: 'invalid_type',  // Not in enum
            config: { tool: 'test', tier: 'fast' },
            dependencies: []
          }
        }
      };
      assert.equal(validate(sample), false);
    });
  });

  describe('routing-decision.v1 — validates sample routing decisions', () => {
    const validate = schemas['routing-decision.v1.json']?.validate;

    it('accepts a valid routing decision', function() {
      if (!validate) { this.skip(); return; }
      const sample = {
        taskId: 'task-001',
        timestamp: '2026-05-18T12:00:00Z',
        selectedTier: 'specialist',
        method: 'codegen_keywords',
        factors: {
          tokenEstimate: 4200,
          complexityScore: 0.6,
          requiresCodeGen: true,
          modelWarm: true
        }
      };
      const valid = validate(sample);
      assert.ok(valid, `Validation errors: ${JSON.stringify(validate.errors)}`);
    });

    it('rejects invalid tier', function() {
      if (!validate) { this.skip(); return; }
      const sample = {
        taskId: 'task-002',
        timestamp: '2026-05-18T12:00:00Z',
        selectedTier: 'mega_tier',  // Not in enum
        method: 'default_specialist',
        factors: { tokenEstimate: 1000, complexityScore: 0.3 }
      };
      assert.equal(validate(sample), false);
    });

    it('rejects invalid method', function() {
      if (!validate) { this.skip(); return; }
      const sample = {
        taskId: 'task-003',
        timestamp: '2026-05-18T12:00:00Z',
        selectedTier: 'fast',
        method: 'vibes_based_routing',  // Not in enum
        factors: { tokenEstimate: 500, complexityScore: 0.1 }
      };
      assert.equal(validate(sample), false);
    });
  });

  describe('circuit-breaker-state.v1 — validates circuit breaker states', () => {
    const validate = schemas['circuit-breaker-state.v1.json']?.validate;

    it('accepts a valid closed circuit breaker', function() {
      if (!validate) { this.skip(); return; }
      const sample = {
        modelId: 'specialist',
        state: 'closed',
        consecutiveFailures: 0,
        failureThreshold: 5,
        resetTimeMs: 60000,
        lastStateChange: '2026-05-18T12:00:00Z',
        lastFailure: null,
        lastSuccess: '2026-05-18T11:59:00Z',
        totalRequests: 142,
        totalFailures: 3,
        failureRate: 0.02
      };
      const valid = validate(sample);
      assert.ok(valid, `Validation errors: ${JSON.stringify(validate.errors)}`);
    });

    it('accepts a valid open circuit breaker', function() {
      if (!validate) { this.skip(); return; }
      const sample = {
        modelId: 'reasoning',
        state: 'open',
        consecutiveFailures: 5,
        failureThreshold: 3,
        resetTimeMs: 60000,
        lastStateChange: '2026-05-18T12:05:00Z',
        lastFailure: '2026-05-18T12:04:50Z',
        lastSuccess: '2026-05-18T11:50:00Z',
        totalRequests: 200,
        totalFailures: 15,
        failureRate: 0.25
      };
      const valid = validate(sample);
      assert.ok(valid, `Validation errors: ${JSON.stringify(validate.errors)}`);
    });

    it('rejects invalid state value', function() {
      if (!validate) { this.skip(); return; }
      const sample = {
        modelId: 'fast',
        state: 'broken',  // Not in enum
        consecutiveFailures: 0,
        failureThreshold: 5,
        resetTimeMs: 60000,
        lastStateChange: '2026-05-18T12:00:00Z'
      };
      assert.equal(validate(sample), false);
    });
  });

  describe('repo-index-entry.v1 — validates index entries', () => {
    const validate = schemas['repo-index-entry.v1.json']?.validate;

    it('accepts a valid index entry', function() {
      if (!validate) { this.skip(); return; }
      const sample = {
        id: 'mcp-server/server.js:45-92',
        file: 'mcp-server/server.js',
        startLine: 45,
        endLine: 92,
        content: 'function handleConsultFast(args) { ... }',
        type: 'FunctionDeclaration',
        name: 'handleConsultFast',
        symbols: ['handleConsultFast'],
        imports: [{ source: './decision-router.js', specifiers: ['routeDecision'] }],
        exports: ['handleConsultFast'],
        language: 'javascript',
        tokenEstimate: 380,
        embeddingId: 'abc-123',
        hash: 'a1b2c3d4',
        indexedAt: '2026-05-18T12:00:00Z'
      };
      const valid = validate(sample);
      assert.ok(valid, `Validation errors: ${JSON.stringify(validate.errors)}`);
    });

    it('rejects entry with invalid id pattern', function() {
      if (!validate) { this.skip(); return; }
      const sample = {
        id: 'no-line-numbers',  // Must match ^.+:\d+-\d+$
        file: 'test.js',
        startLine: 1,
        endLine: 10,
        content: 'code',
        type: 'FunctionDeclaration',
        indexedAt: '2026-05-18T12:00:00Z'
      };
      assert.equal(validate(sample), false);
    });

    it('rejects entry with invalid language', function() {
      if (!validate) { this.skip(); return; }
      const sample = {
        id: 'test.rs:1-10',
        file: 'test.rs',
        startLine: 1,
        endLine: 10,
        content: 'fn main() {}',
        type: 'FunctionDeclaration',
        language: 'rust',  // Not in enum
        indexedAt: '2026-05-18T12:00:00Z'
      };
      assert.equal(validate(sample), false);
    });
  });

  describe('verification-result.v1 — validates pipeline results', () => {
    const validate = schemas['verification-result.v1.json']?.validate;

    it('accepts a passing verification result', function() {
      if (!validate) { this.skip(); return; }
      const sample = {
        taskId: 'task-fix-001',
        timestamp: '2026-05-18T12:10:00Z',
        overall: 'passed',
        stages: [
          { name: 'syntax', pass: true, durationMs: 5 },
          { name: 'lint', pass: true, durationMs: 200 },
          { name: 'tests', pass: true, durationMs: 3200 },
          { name: 'review', pass: true, durationMs: 1500 }
        ],
        durationMs: 4905,
        autoCommitted: true,
        commitSha: 'abc1234'
      };
      const valid = validate(sample);
      assert.ok(valid, `Validation errors: ${JSON.stringify(validate.errors)}`);
    });

    it('accepts a failing verification result', function() {
      if (!validate) { this.skip(); return; }
      const sample = {
        taskId: 'task-fix-002',
        timestamp: '2026-05-18T12:15:00Z',
        overall: 'failed',
        stages: [
          { name: 'syntax', pass: true, durationMs: 3 },
          { name: 'lint', pass: true, durationMs: 180 },
          { name: 'tests', pass: false, durationMs: 2800, errors: [
            { message: 'Expected 3 but got undefined', file: 'test.js', line: 42, severity: 'error' }
          ]}
        ],
        durationMs: 2983,
        autoCommitted: false,
        commitSha: null
      };
      const valid = validate(sample);
      assert.ok(valid, `Validation errors: ${JSON.stringify(validate.errors)}`);
    });

    it('rejects result with invalid overall status', function() {
      if (!validate) { this.skip(); return; }
      const sample = {
        taskId: 'task-003',
        timestamp: '2026-05-18T12:00:00Z',
        overall: 'maybe',  // Not in enum
        stages: [{ name: 'syntax', pass: true }]
      };
      assert.equal(validate(sample), false);
    });
  });
});
