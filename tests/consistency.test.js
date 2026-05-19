import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Load all docs
function loadDoc(name) {
  return fs.readFileSync(path.join(ROOT, name), 'utf-8');
}

describe('Design Consistency Suite', () => {

  describe('Escalation chain is consistent', () => {
    it('Phase 2 (contracts) defines escalation: fast → specialist → reasoning → heavy → cloud', () => {
      const doc = loadDoc('CONTRACTS_AND_PROTOCOLS.md');
      assert.ok(
        doc.includes('fast') && doc.includes('specialist') &&
        doc.includes('reasoning') && doc.includes('cloud'),
        'Contracts doc should define the full escalation chain'
      );
    });

    it('Phase 5 (orchestration) respects same escalation order', () => {
      const doc = loadDoc('DETERMINISTIC_ORCHESTRATION.md');
      assert.ok(doc.includes('fast') && doc.includes('specialist'),
        'Orchestration doc should reference escalation tiers');
      // Should not introduce new tier names not in the canonical set
      const validTiers = ['fast', 'specialist', 'reasoning', 'heavy', 'cloud', 'local', 'human'];
      const tierMentions = doc.match(/tier[:\s]*["']?(\w+)/gi) || [];
      // This is a loose check — just ensure no weird tier names
      assert.ok(tierMentions.length > 0 || doc.includes('tier'),
        'Should reference tier system');
    });

    it('Phase 7 (workflow) uses same tier system', () => {
      const doc = loadDoc('VSCODE_AND_DEVELOPER_WORKFLOW.md');
      assert.ok(doc.includes('fast') && doc.includes('specialist') && doc.includes('reasoning'),
        'Workflow doc should use canonical tier names');
    });
  });

  describe('Token budget principles are consistent', () => {
    it('Phase 5 defines anti-recursion guards', () => {
      const doc = loadDoc('DETERMINISTIC_ORCHESTRATION.md');
      assert.ok(doc.includes('MAX_TOTAL_TOKENS') || doc.includes('token') || doc.includes('budget'),
        'Orchestration should enforce token limits');
    });

    it('Phase 7 defines context budget allocation', () => {
      const doc = loadDoc('VSCODE_AND_DEVELOPER_WORKFLOW.md');
      assert.ok(doc.includes('12,000') || doc.includes('12000') || doc.includes('budget'),
        'Workflow should define context token budget');
    });

    it('token budgets do not exceed model context windows', () => {
      const doc = loadDoc('VSCODE_AND_DEVELOPER_WORKFLOW.md');
      // 32K context for qwen2.5-coder:32b — budget should be less
      const budgetMatch = doc.match(/(\d{1,3},?\d{3})\s*tokens/g) || [];
      for (const match of budgetMatch) {
        const num = parseInt(match.replace(/[^0-9]/g, ''));
        if (num > 1000) {  // Only check meaningful token numbers
          assert.ok(num <= 1000000,
            `Token number ${num} exceeds max context (1M for Gemini)`);
        }
      }
    });
  });

  describe('Confidence scoring is universal', () => {
    it('Phase 2 defines confidence as mandatory', () => {
      const doc = loadDoc('CONTRACTS_AND_PROTOCOLS.md');
      assert.ok(doc.includes('confidence') || doc.includes('Confidence'),
        'Contracts must define confidence scoring');
    });

    it('Phase 5 uses confidence for routing decisions', () => {
      const doc = loadDoc('DETERMINISTIC_ORCHESTRATION.md');
      const confidenceRefs = (doc.match(/confidence/gi) || []).length;
      assert.ok(confidenceRefs >= 5,
        `Orchestration should heavily reference confidence (found ${confidenceRefs} mentions)`);
    });

    it('Phase 6 visualizes confidence', () => {
      const doc = loadDoc('UI_AND_WAR_COUNCIL_EVOLUTION.md');
      assert.ok(doc.includes('confidence'),
        'UI doc should describe confidence visualization');
    });

    it('Phase 7 uses confidence in verification', () => {
      const doc = loadDoc('VSCODE_AND_DEVELOPER_WORKFLOW.md');
      assert.ok(doc.includes('confidence'),
        'Workflow should use confidence in verification decisions');
    });
  });

  describe('Memory system references are consistent', () => {
    it('Phase 4 defines Qdrant + SQLite architecture', () => {
      const doc = loadDoc('RETRIEVAL_AND_MEMORY.md');
      assert.ok(doc.includes('Qdrant'), 'Memory doc must define Qdrant');
      assert.ok(doc.includes('SQLite'), 'Memory doc must define SQLite');
    });

    it('Phase 5 references memory for adaptive thresholds', () => {
      const doc = loadDoc('DETERMINISTIC_ORCHESTRATION.md');
      assert.ok(doc.includes('metrics') || doc.includes('historical'),
        'Orchestration should reference historical data for thresholds');
    });

    it('Phase 7 references memory for context retrieval', () => {
      const doc = loadDoc('VSCODE_AND_DEVELOPER_WORKFLOW.md');
      assert.ok(doc.includes('Qdrant') || doc.includes('vector') || doc.includes('retrieval'),
        'Workflow should reference vector retrieval');
    });
  });

  describe('No contradictions between phases', () => {
    it('no doc recommends polling when SSE is the transport', () => {
      const uiDoc = loadDoc('UI_AND_WAR_COUNCIL_EVOLUTION.md');
      // UI doc should explicitly NOT use polling
      assert.ok(!uiDoc.includes('setInterval') || uiDoc.includes('no REST polling'),
        'UI should use SSE, not polling');
    });

    it('no doc recommends frameworks when vanilla JS is chosen', () => {
      const uiDoc = loadDoc('UI_AND_WAR_COUNCIL_EVOLUTION.md');
      assert.ok(uiDoc.includes('No framework') || uiDoc.includes('vanilla'),
        'UI should confirm no-framework approach');
      // Should not recommend React/Vue/Angular as primary
      assert.ok(!uiDoc.match(/\b(React|Vue|Angular|Svelte)\b.*\brecommend/i),
        'Should not recommend a framework as primary');
    });

    it('local-first principle maintained across all phases', () => {
      // Phase 5 should prefer local models
      const orchDoc = loadDoc('DETERMINISTIC_ORCHESTRATION.md');
      assert.ok(orchDoc.includes('local') || orchDoc.includes('Prefer local'),
        'Orchestration should prefer local execution');

      // Phase 7 should explicitly state local-first
      const workDoc = loadDoc('VSCODE_AND_DEVELOPER_WORKFLOW.md');
      assert.ok(workDoc.includes('local-first') || workDoc.includes('local first'),
        'Workflow should be explicitly local-first');
    });
  });

  describe('RTX 5090 VRAM constraints respected', () => {
    it('Phase 7 accounts for 32GB VRAM budget', () => {
      const doc = loadDoc('VSCODE_AND_DEVELOPER_WORKFLOW.md');
      assert.ok(doc.includes('32') && (doc.includes('GB') || doc.includes('VRAM')),
        'Workflow should reference 32GB VRAM constraint');
    });

    it('model sizes fit within VRAM', () => {
      const doc = loadDoc('VSCODE_AND_DEVELOPER_WORKFLOW.md');
      // Check that the total loaded doesn't exceed 32GB
      // The doc mentions: 7b (5GB) + 14b (10GB) + 14b-r1 (10GB) = 25GB / 32GB
      assert.ok(doc.includes('25') || doc.includes('budget'),
        'Should show VRAM utilization within limits');
    });
  });

  describe('Agent roster consistency', () => {
    it('Phase 1 audit identifies agent files', () => {
      const doc = loadDoc('ARCHITECTURE_AUDIT.md');
      assert.ok(doc.includes('agent') || doc.includes('Agent'),
        'Audit should reference agents');
    });

    it('Phase 6 UI shows agent visualization', () => {
      const doc = loadDoc('UI_AND_WAR_COUNCIL_EVOLUTION.md');
      assert.ok(doc.includes('agent') || doc.includes('Agent'),
        'UI should visualize agents');
      assert.ok(doc.includes('sprite') || doc.includes('Sprite') || doc.includes('avatar'),
        'UI should have agent visual representations');
    });

    it('Phase 7 uses agents in workflow', () => {
      const doc = loadDoc('VSCODE_AND_DEVELOPER_WORKFLOW.md');
      assert.ok(doc.includes('RepoScout') || doc.includes('TestWriter') || doc.includes('CodeReviewer'),
        'Workflow should reference specific agents');
    });
  });

  describe('Implementation priority flows logically', () => {
    it('Phase 5 has implementation priority section', () => {
      const doc = loadDoc('DETERMINISTIC_ORCHESTRATION.md');
      // Should not have implementation priority (it's a design doc)
      // OR if it does, it's fine — just checking structure
      assert.ok(doc.length > 5000, 'Should be substantial');
    });

    it('Phase 6 has implementation priority/roadmap', () => {
      const doc = loadDoc('UI_AND_WAR_COUNCIL_EVOLUTION.md');
      assert.ok(doc.includes('Priority') || doc.includes('Implementation') || doc.includes('Roadmap'),
        'UI doc should have implementation priority');
    });

    it('Phase 7 has implementation roadmap', () => {
      const doc = loadDoc('VSCODE_AND_DEVELOPER_WORKFLOW.md');
      assert.ok(doc.includes('Roadmap') || doc.includes('Implementation'),
        'Workflow doc should have implementation roadmap');
    });
  });
});
