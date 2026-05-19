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

// All schema files
const schemaFiles = fs.readdirSync(SCHEMAS_DIR)
  .filter(f => f.endsWith('.json'))
  .map(f => ({ name: f, path: path.join(SCHEMAS_DIR, f) }));

// Initialize AJV (JSON Schema validator)
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

// First pass: register all schemas by $id (enables $ref resolution)
for (const schema of schemaFiles) {
  const content = JSON.parse(fs.readFileSync(schema.path, 'utf-8'));
  try { ajv.addSchema(content); } catch (e) { /* will be caught in individual tests */ }
}

describe('Schema Validation Suite', () => {

  describe('All schemas are valid JSON', () => {
    for (const schema of schemaFiles) {
      it(`${schema.name} parses as valid JSON`, () => {
        const content = fs.readFileSync(schema.path, 'utf-8');
        let parsed;
        assert.doesNotThrow(() => { parsed = JSON.parse(content); }, `${schema.name} is not valid JSON`);
        assert.ok(parsed, 'Parsed result should be truthy');
      });
    }
  });

  describe('All schemas are valid JSON Schema (draft-07)', () => {
    for (const schema of schemaFiles) {
      it(`${schema.name} compiles as valid JSON Schema`, () => {
        const content = JSON.parse(fs.readFileSync(schema.path, 'utf-8'));
        // Schema was already added in first pass; try to retrieve the compiled validator
        const validate = ajv.getSchema(content.$id);
        assert.ok(validate, `${schema.name} failed to compile or resolve (id: ${content.$id})`);
      });
    }
  });

  describe('All schemas have required metadata', () => {
    for (const schema of schemaFiles) {
      it(`${schema.name} has $schema, $id, title, description`, () => {
        const content = JSON.parse(fs.readFileSync(schema.path, 'utf-8'));
        assert.ok(content.$schema, `${schema.name} missing $schema`);
        assert.ok(content.$id, `${schema.name} missing $id`);
        assert.ok(content.title, `${schema.name} missing title`);
        assert.ok(content.description, `${schema.name} missing description`);
      });
    }
  });

  describe('All schemas use consistent $id format', () => {
    for (const schema of schemaFiles) {
      it(`${schema.name} uses war-council:// $id prefix`, () => {
        const content = JSON.parse(fs.readFileSync(schema.path, 'utf-8'));
        assert.match(content.$id, /^war-council:\/\/schemas\//, 
          `${schema.name} $id should start with war-council://schemas/`);
      });
    }
  });

  describe('All schemas use draft-07', () => {
    for (const schema of schemaFiles) {
      it(`${schema.name} declares draft-07`, () => {
        const content = JSON.parse(fs.readFileSync(schema.path, 'utf-8'));
        assert.equal(content.$schema, 'http://json-schema.org/draft-07/schema#',
          `${schema.name} should use draft-07`);
      });
    }
  });

  describe('All schemas have a root type or definitions', () => {
    for (const schema of schemaFiles) {
      it(`${schema.name} declares a root type or definitions block`, () => {
        const content = JSON.parse(fs.readFileSync(schema.path, 'utf-8'));
        const hasType = content.type && ['object', 'array', 'string', 'number', 'boolean'].includes(content.type);
        const hasDefinitions = content.definitions && Object.keys(content.definitions).length > 0;
        const hasOneOf = Array.isArray(content.oneOf) || Array.isArray(content.anyOf);
        assert.ok(hasType || hasDefinitions || hasOneOf,
          `${schema.name} should have root type, definitions, or oneOf/anyOf`);
      });
    }
  });

  describe('Object schemas have required fields defined', () => {
    for (const schema of schemaFiles) {
      it(`${schema.name} defines "required" array if type is object`, () => {
        const content = JSON.parse(fs.readFileSync(schema.path, 'utf-8'));
        if (content.type === 'object') {
          assert.ok(Array.isArray(content.required), 
            `${schema.name} is type:object but missing "required" array`);
          assert.ok(content.required.length > 0, 
            `${schema.name} has empty "required" array`);
        }
        // For definition-only schemas, check that at least one definition has required
        if (!content.type && content.definitions) {
          const defs = Object.values(content.definitions);
          const hasRequired = defs.some(d => Array.isArray(d.required) && d.required.length > 0);
          assert.ok(hasRequired,
            `${schema.name} is definition-only but no definition has "required" fields`);
        }
      });
    }
  });

  describe('Required fields exist in properties', () => {
    for (const schema of schemaFiles) {
      it(`${schema.name} — all required fields are defined in properties`, () => {
        const content = JSON.parse(fs.readFileSync(schema.path, 'utf-8'));
        
        // Check root level
        if (content.type === 'object' && content.required && content.properties) {
          for (const field of content.required) {
            assert.ok(content.properties[field], 
              `${schema.name} lists "${field}" as required but it's not in properties`);
          }
        }
        
        // Check definitions
        if (content.definitions) {
          for (const [defName, def] of Object.entries(content.definitions)) {
            if (def.type === 'object' && def.required && def.properties) {
              for (const field of def.required) {
                assert.ok(def.properties[field],
                  `${schema.name} definition "${defName}" lists "${field}" as required but it's not in properties`);
              }
            }
          }
        }
      });
    }
  });

  describe('Schema count meets expectations', () => {
    it('should have at least 20 schema files (all phases produced schemas)', () => {
      assert.ok(schemaFiles.length >= 20, 
        `Expected >=20 schemas, found ${schemaFiles.length}`);
    });

    it('should have schemas from Phase 2 (contracts)', () => {
      const phase2 = ['agent-message', 'agent-contract', 'confidence', 'task-state', 
                      'execution-result', 'escalation', 'retrieval', 'memory-write',
                      'verification', 'retry-policy', 'token-budget', 'arbitration'];
      for (const name of phase2) {
        const found = schemaFiles.some(s => s.name.includes(name));
        assert.ok(found, `Missing Phase 2 schema: ${name}`);
      }
    });

    it('should have schemas from Phase 3 (observability)', () => {
      const phase3 = ['telemetry-event', 'trace', 'benchmark', 'session-summary'];
      for (const name of phase3) {
        const found = schemaFiles.some(s => s.name.includes(name));
        assert.ok(found, `Missing Phase 3 schema: ${name}`);
      }
    });

    it('should have schemas from Phase 4 (memory)', () => {
      const phase4 = ['memory-types', 'knowledge-graph'];
      for (const name of phase4) {
        const found = schemaFiles.some(s => s.name.includes(name));
        assert.ok(found, `Missing Phase 4 schema: ${name}`);
      }
    });

    it('should have schemas from Phase 5 (orchestration)', () => {
      const phase5 = ['execution-dag', 'routing-decision', 'circuit-breaker-state'];
      for (const name of phase5) {
        const found = schemaFiles.some(s => s.name.includes(name));
        assert.ok(found, `Missing Phase 5 schema: ${name}`);
      }
    });

    it('should have schemas from Phase 7 (workflow)', () => {
      const phase7 = ['repo-index-entry', 'verification-result'];
      for (const name of phase7) {
        const found = schemaFiles.some(s => s.name.includes(name));
        assert.ok(found, `Missing Phase 7 schema: ${name}`);
      }
    });
  });
});
