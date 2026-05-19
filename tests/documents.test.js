import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Expected architecture documents (one per phase)
const EXPECTED_DOCS = [
  { file: 'ARCHITECTURE_AUDIT.md', phase: 1, minSections: 3 },
  { file: 'CONTRACTS_AND_PROTOCOLS.md', phase: 2, minSections: 5 },
  { file: 'OBSERVABILITY_AND_METRICS.md', phase: 3, minSections: 4 },
  { file: 'RETRIEVAL_AND_MEMORY.md', phase: 4, minSections: 4 },
  { file: 'DETERMINISTIC_ORCHESTRATION.md', phase: 5, minSections: 8 },
  { file: 'UI_AND_WAR_COUNCIL_EVOLUTION.md', phase: 6, minSections: 6 },
  { file: 'VSCODE_AND_DEVELOPER_WORKFLOW.md', phase: 7, minSections: 8 },
];

// Supporting documents
const SUPPORTING_DOCS = [
  'progress.md',
  'SUGGESTIONS.md',
];

describe('Document Structure Suite', () => {

  describe('All phase documents exist', () => {
    for (const doc of EXPECTED_DOCS) {
      it(`Phase ${doc.phase}: ${doc.file} exists`, () => {
        const fullPath = path.join(ROOT, doc.file);
        assert.ok(fs.existsSync(fullPath), `${doc.file} not found at ${fullPath}`);
      });
    }
  });

  describe('Supporting documents exist', () => {
    for (const doc of SUPPORTING_DOCS) {
      it(`${doc} exists`, () => {
        const fullPath = path.join(ROOT, doc);
        assert.ok(fs.existsSync(fullPath), `${doc} not found`);
      });
    }
  });

  describe('Documents are non-trivial (minimum size)', () => {
    for (const doc of EXPECTED_DOCS) {
      it(`Phase ${doc.phase}: ${doc.file} is substantial (>2KB)`, () => {
        const fullPath = path.join(ROOT, doc.file);
        const stats = fs.statSync(fullPath);
        assert.ok(stats.size > 2048, 
          `${doc.file} is only ${stats.size} bytes (expected >2KB)`);
      });
    }
  });

  describe('Documents have proper markdown structure', () => {
    for (const doc of EXPECTED_DOCS) {
      it(`Phase ${doc.phase}: ${doc.file} starts with H1 header`, () => {
        const content = fs.readFileSync(path.join(ROOT, doc.file), 'utf-8');
        const firstLine = content.split('\n').find(l => l.trim().length > 0);
        assert.match(firstLine, /^#\s/, 
          `${doc.file} should start with an H1 header`);
      });
    }
  });

  describe('Documents have minimum required sections (H2 headers)', () => {
    for (const doc of EXPECTED_DOCS) {
      it(`Phase ${doc.phase}: ${doc.file} has >=${doc.minSections} sections`, () => {
        const content = fs.readFileSync(path.join(ROOT, doc.file), 'utf-8');
        const h2Headers = content.match(/^## .+/gm) || [];
        assert.ok(h2Headers.length >= doc.minSections,
          `${doc.file} has ${h2Headers.length} sections (expected >=${doc.minSections})`);
      });
    }
  });

  describe('Documents contain code examples', () => {
    for (const doc of EXPECTED_DOCS) {
      it(`Phase ${doc.phase}: ${doc.file} has code blocks`, () => {
        const content = fs.readFileSync(path.join(ROOT, doc.file), 'utf-8');
        const codeBlocks = content.match(/```/g) || [];
        // Code blocks come in pairs (open + close)
        assert.ok(codeBlocks.length >= 2, 
          `${doc.file} should have at least one code block`);
        assert.equal(codeBlocks.length % 2, 0, 
          `${doc.file} has unmatched code block fences (${codeBlocks.length} backtick-triples)`);
      });
    }
  });

  describe('Documents contain diagrams (ASCII art or tables)', () => {
    for (const doc of EXPECTED_DOCS) {
      it(`Phase ${doc.phase}: ${doc.file} has visual diagrams or tables`, () => {
        const content = fs.readFileSync(path.join(ROOT, doc.file), 'utf-8');
        // Look for ASCII box drawing, tables, or diagram indicators
        const hasDiagram = content.includes('┌') || content.includes('├') || 
                          content.includes('│') || content.includes('───');
        const hasTable = (content.match(/\|.*\|/g) || []).length >= 3;
        assert.ok(hasDiagram || hasTable,
          `${doc.file} should contain at least one diagram or table`);
      });
    }
  });

  describe('Progress file tracks all phases', () => {
    it('progress.md mentions all 7 phases', () => {
      const content = fs.readFileSync(path.join(ROOT, 'progress.md'), 'utf-8');
      for (let i = 1; i <= 7; i++) {
        assert.ok(content.includes(`Phase ${i}`), 
          `progress.md missing reference to Phase ${i}`);
      }
    });

    it('progress.md marks all phases as complete', () => {
      const content = fs.readFileSync(path.join(ROOT, 'progress.md'), 'utf-8');
      const completeMarkers = content.match(/✅ Complete/g) || [];
      assert.ok(completeMarkers.length >= 7, 
        `Expected 7 completion markers, found ${completeMarkers.length}`);
    });

    it('progress.md has deliverable checklists', () => {
      const content = fs.readFileSync(path.join(ROOT, 'progress.md'), 'utf-8');
      const checkboxes = content.match(/- \[x\]/g) || [];
      assert.ok(checkboxes.length >= 14, 
        `Expected >=14 completed deliverables, found ${checkboxes.length}`);
    });
  });
});
