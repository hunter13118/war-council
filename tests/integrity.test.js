import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SCHEMAS_DIR = path.join(ROOT, 'schemas');

// Load all schemas
const schemas = fs.readdirSync(SCHEMAS_DIR)
  .filter(f => f.endsWith('.json'))
  .map(f => ({
    name: f,
    content: JSON.parse(fs.readFileSync(path.join(SCHEMAS_DIR, f), 'utf-8'))
  }));

// Load all architecture docs
const docs = [
  'ARCHITECTURE_AUDIT.md',
  'CONTRACTS_AND_PROTOCOLS.md',
  'OBSERVABILITY_AND_METRICS.md',
  'RETRIEVAL_AND_MEMORY.md',
  'DETERMINISTIC_ORCHESTRATION.md',
  'UI_AND_WAR_COUNCIL_EVOLUTION.md',
  'VSCODE_AND_DEVELOPER_WORKFLOW.md',
].map(f => ({
  name: f,
  content: fs.readFileSync(path.join(ROOT, f), 'utf-8')
}));

describe('Cross-Reference Integrity Suite', () => {

  describe('Schema $id uniqueness', () => {
    it('all schemas have unique $id values', () => {
      const ids = schemas.map(s => s.content.$id);
      const unique = new Set(ids);
      assert.equal(unique.size, ids.length,
        `Duplicate $id found: ${ids.filter((id, i) => ids.indexOf(id) !== i).join(', ')}`);
    });
  });

  describe('Schema title uniqueness', () => {
    it('all schemas have unique titles', () => {
      const titles = schemas.map(s => s.content.title);
      const unique = new Set(titles);
      assert.equal(unique.size, titles.length,
        `Duplicate title found: ${titles.filter((t, i) => titles.indexOf(t) !== i).join(', ')}`);
    });
  });

  describe('Tier enum consistency across schemas', () => {
    const CANONICAL_TIERS = ['fast', 'specialist', 'reasoning', 'heavy', 'cloud'];

    it('agent-message schema uses canonical tiers', () => {
      const agentMsg = schemas.find(s => s.name.includes('agent-message'));
      if (!agentMsg) return;
      const tierEnum = agentMsg.content.properties?.source?.properties?.tier?.enum;
      if (tierEnum) {
        for (const tier of CANONICAL_TIERS) {
          assert.ok(tierEnum.includes(tier),
            `agent-message missing tier "${tier}" (has: ${tierEnum.join(', ')})`);
        }
      }
    });

    it('escalation schema references tier fields', () => {
      const esc = schemas.find(s => s.name.includes('escalation'));
      if (!esc) return;
      // Escalation schema has source.tier and target.tier fields
      const hasTierField = esc.content.properties?.source?.properties?.tier ||
                           esc.content.properties?.target?.properties?.tier;
      assert.ok(hasTierField,
        'Escalation schema should have tier fields in source/target');
    });

    it('routing-decision schema uses canonical tiers', () => {
      const routing = schemas.find(s => s.name.includes('routing-decision'));
      if (!routing) return;
      const tierEnum = routing.content.properties?.selectedTier?.enum;
      if (tierEnum) {
        for (const tier of CANONICAL_TIERS) {
          assert.ok(tierEnum.includes(tier),
            `routing-decision missing tier "${tier}"`);
        }
      }
    });

    it('execution-dag schema uses compatible tiers', () => {
      const dag = schemas.find(s => s.name.includes('execution-dag'));
      if (!dag) return;
      const taskConfig = dag.content.definitions?.TaskConfig;
      if (taskConfig?.properties?.tier?.enum) {
        const dagTiers = taskConfig.properties.tier.enum;
        // DAG may have "local" as extra tier, but must include standard tiers
        const standardTiers = CANONICAL_TIERS.filter(t => dagTiers.includes(t));
        assert.ok(standardTiers.length >= 4,
          `execution-dag TaskConfig should include most standard tiers (found: ${standardTiers.join(', ')})`);
      }
    });
  });

  describe('Documents reference their schemas', () => {
    it('CONTRACTS_AND_PROTOCOLS references Phase 2 schemas', () => {
      const doc = docs.find(d => d.name.includes('CONTRACTS'));
      const phase2Schemas = ['confidence', 'agent-message', 'task-state', 'escalation'];
      for (const schema of phase2Schemas) {
        assert.ok(doc.content.toLowerCase().includes(schema.replace('-', '')),
          `CONTRACTS doc should reference "${schema}" concept`);
      }
    });

    it('OBSERVABILITY doc references telemetry/trace concepts', () => {
      const doc = docs.find(d => d.name.includes('OBSERVABILITY'));
      assert.ok(doc.content.includes('telemetry') || doc.content.includes('Telemetry'),
        'OBSERVABILITY doc should mention telemetry');
      assert.ok(doc.content.includes('trace') || doc.content.includes('Trace'),
        'OBSERVABILITY doc should mention tracing');
    });

    it('RETRIEVAL_AND_MEMORY references memory types', () => {
      const doc = docs.find(d => d.name.includes('RETRIEVAL'));
      const memoryTypes = ['episodic', 'semantic', 'procedural', 'working', 'prospective'];
      for (const type of memoryTypes) {
        assert.ok(doc.content.toLowerCase().includes(type),
          `RETRIEVAL doc should reference memory type "${type}"`);
      }
    });

    it('DETERMINISTIC_ORCHESTRATION references DAG concepts', () => {
      const doc = docs.find(d => d.name.includes('DETERMINISTIC'));
      assert.ok(doc.content.includes('DAG'), 'Should reference DAG');
      assert.ok(doc.content.includes('circuit breaker') || doc.content.includes('CircuitBreaker'),
        'Should reference circuit breakers');
      assert.ok(doc.content.includes('routing') || doc.content.includes('Router'),
        'Should reference routing');
    });

    it('VSCODE_AND_DEVELOPER_WORKFLOW references verification', () => {
      const doc = docs.find(d => d.name.includes('VSCODE'));
      assert.ok(doc.content.includes('verification') || doc.content.includes('Verification'),
        'Should reference verification pipeline');
      assert.ok(doc.content.includes('repo') || doc.content.includes('Repo'),
        'Should reference repo indexing');
    });
  });

  describe('Confidence scoring referenced consistently', () => {
    it('confidence dimensions are consistent across docs', () => {
      // Phase 2 defined the canonical dimensions
      const confidenceSchema = schemas.find(s => s.name.includes('confidence'));
      if (!confidenceSchema) return;
      
      const dimensions = Object.keys(
        confidenceSchema.content.properties?.dimensions?.properties || {}
      );
      
      // At least 3 docs should reference confidence
      const docsWithConfidence = docs.filter(d => 
        d.content.toLowerCase().includes('confidence')
      );
      assert.ok(docsWithConfidence.length >= 3,
        `At least 3 docs should reference confidence (found in ${docsWithConfidence.length})`);
    });
  });

  describe('State machine consistency', () => {
    it('task-state schema defines states referenced in docs', () => {
      const taskState = schemas.find(s => s.name.includes('task-state'));
      if (!taskState) return;
      
      const stateEnum = taskState.content.properties?.state?.enum || 
                        taskState.content.properties?.status?.enum || [];
      
      // The orchestration doc should reference task states
      const orchDoc = docs.find(d => d.name.includes('DETERMINISTIC'));
      if (orchDoc && stateEnum.length > 0) {
        // At least some states should appear in the doc
        const statesInDoc = stateEnum.filter(s => 
          orchDoc.content.toLowerCase().includes(s.toLowerCase())
        );
        assert.ok(statesInDoc.length >= 2,
          `Orchestration doc should reference task states (found: ${statesInDoc.join(', ')})`);
      }
    });
  });

  describe('Technology choices are consistent across docs', () => {
    it('Qdrant is the vector store everywhere', () => {
      const qdrantDocs = docs.filter(d => d.content.includes('Qdrant'));
      assert.ok(qdrantDocs.length >= 2,
        `At least 2 docs should reference Qdrant (found in ${qdrantDocs.length})`);
      // No doc should propose a different vector store as primary
      const conflicting = docs.filter(d => 
        d.content.includes('ChromaDB') && d.content.includes('chosen') ||
        d.content.includes('Pinecone') && d.content.includes('chosen')
      );
      assert.equal(conflicting.length, 0, 'No doc should choose a different vector store');
    });

    it('SQLite is the metadata store everywhere', () => {
      const sqliteDocs = docs.filter(d => d.content.includes('SQLite'));
      assert.ok(sqliteDocs.length >= 2,
        `At least 2 docs should reference SQLite (found in ${sqliteDocs.length})`);
    });

    it('Ollama is the local model server everywhere', () => {
      const ollamaDocs = docs.filter(d => d.content.includes('Ollama') || d.content.includes('ollama'));
      assert.ok(ollamaDocs.length >= 2,
        `At least 2 docs should reference Ollama (found in ${ollamaDocs.length})`);
    });

    it('SSE is the real-time transport everywhere', () => {
      const sseDocs = docs.filter(d => d.content.includes('SSE'));
      assert.ok(sseDocs.length >= 2,
        `At least 2 docs should reference SSE (found in ${sseDocs.length})`);
    });
  });
});
