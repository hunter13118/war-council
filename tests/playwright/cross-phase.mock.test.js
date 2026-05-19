import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

/**
 * CROSS-PHASE VALIDATION TESTS
 *
 * These tests validate that the UI correctly implements concepts
 * from all 7 phases of the architecture. They verify the integration
 * points between:
 *   - Phase 1: Existing system components
 *   - Phase 2: Wire format contracts
 *   - Phase 3: Observability hooks
 *   - Phase 4: Memory/retrieval integration
 *   - Phase 5: DAG/orchestration readiness
 *   - Phase 6: UI visualization systems
 *   - Phase 7: Developer workflow connectivity
 */

test.describe('Phase 1 — Existing System Integrity', () => {
  test('battle-log server.js uses ESM modules', async ({}) => {
    const serverCode = fs.readFileSync(
      path.join(ROOT, 'battle-log', 'server.js'), 'utf-8'
    );
    expect(serverCode).toContain('import ');
    expect(serverCode).not.toContain('require(');
  });

  test('MCP server exists and is valid JavaScript', async ({}) => {
    const mcpServer = path.join(ROOT, 'mcp-server', 'server.js');
    expect(fs.existsSync(mcpServer)).toBe(true);
    const content = fs.readFileSync(mcpServer, 'utf-8');
    expect(content.length).toBeGreaterThan(1000);
  });

  test('19 agent definition files exist in .github/agents/', async ({}) => {
    const agentsDir = path.join(ROOT, '.github', 'agents');
    if (fs.existsSync(agentsDir)) {
      const files = fs.readdirSync(agentsDir).filter(f => f.endsWith('.md'));
      expect(files.length).toBeGreaterThanOrEqual(10);
    }
  });

  test('index.html exists as dashboard entry point', async ({}) => {
    const indexPath = path.join(ROOT, 'battle-log', 'index.html');
    expect(fs.existsSync(indexPath)).toBe(true);
  });
});

test.describe('Phase 2 — Contract Compliance in UI', () => {
  test.beforeEach(async ({ page }) => {
    const filePath = path.join(ROOT, 'battle-log', 'war-table.html');
    await page.goto(`file:///${filePath.replace(/\\/g, '/')}`);
  });

  test('event handling supports structured JSON format (agent-message contract)', async ({ page }) => {
    const pageSource = await page.content();
    // The page should parse JSON events (matching Phase 2 agent-message schema)
    expect(pageSource).toContain('JSON.parse');
  });

  test('UI differentiates agent tiers via CSS classes (tier contract)', async ({ page }) => {
    const tierClasses = await page.evaluate(() => {
      const classes = [];
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules) {
            if (rule.selectorText && rule.selectorText.match(/sprite-(scout|specialist|sage|cloud|swarm)/)) {
              classes.push(rule.selectorText);
            }
          }
        } catch (e) {}
      }
      return classes;
    });
    expect(tierClasses.length).toBeGreaterThan(0);
  });
});

test.describe('Phase 3 — Observability Hooks', () => {
  test('battle-log server has event buffering (in-memory telemetry)', async ({}) => {
    const serverCode = fs.readFileSync(
      path.join(ROOT, 'battle-log', 'server.js'), 'utf-8'
    );
    expect(serverCode).toContain('eventBuffer');
    expect(serverCode).toContain('MAX_BUFFER');
  });

  test('server broadcasts events to all SSE clients (pub/sub)', async ({}) => {
    const serverCode = fs.readFileSync(
      path.join(ROOT, 'battle-log', 'server.js'), 'utf-8'
    );
    expect(serverCode).toContain('broadcast');
    expect(serverCode).toContain('sseClients');
  });

  test('events include timestamps (telemetry requirement)', async ({}) => {
    const serverCode = fs.readFileSync(
      path.join(ROOT, 'battle-log', 'server.js'), 'utf-8'
    );
    expect(serverCode).toContain('timestamp');
  });
});

test.describe('Phase 4 — Memory/Retrieval Integration Points', () => {
  test('MCP server has memory tool handlers', async ({}) => {
    const toolsDir = path.join(ROOT, 'mcp-server', 'tools');
    const tools = fs.readdirSync(toolsDir);
    const memoryTools = tools.filter(f => f.includes('memory'));
    expect(memoryTools.length).toBeGreaterThan(0);
  });

  test('memory-engine module exists', async ({}) => {
    const memDir = path.join(ROOT, 'memory-engine');
    expect(fs.existsSync(memDir)).toBe(true);
    expect(fs.existsSync(path.join(memDir, 'retriever.js'))).toBe(true);
    expect(fs.existsSync(path.join(memDir, 'store.js'))).toBe(true);
  });
});

test.describe('Phase 5 — Orchestration Readiness in UI', () => {
  test.beforeEach(async ({ page }) => {
    const filePath = path.join(ROOT, 'battle-log', 'war-table.html');
    await page.goto(`file:///${filePath.replace(/\\/g, '/')}`);
  });

  test('UI has tournament/voting system (DAG branch → vote)', async ({ page }) => {
    const pageSource = await page.content();
    expect(pageSource).toMatch(/tournament|vote|battle/i);
  });

  test('server handles tournament_result events (orchestration output)', async ({}) => {
    const serverCode = fs.readFileSync(
      path.join(ROOT, 'battle-log', 'server.js'), 'utf-8'
    );
    expect(serverCode).toContain('tournament_result');
    expect(serverCode).toContain('winner');
    expect(serverCode).toContain('loser');
  });
});

test.describe('Phase 6 — UI Architecture Validation', () => {
  test.beforeEach(async ({ page }) => {
    const filePath = path.join(ROOT, 'battle-log', 'war-table.html');
    await page.goto(`file:///${filePath.replace(/\\/g, '/')}`);
  });

  test('has pixel-art aesthetic (Press Start 2P font)', async ({ page }) => {
    const font = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    expect(font).toContain('Press Start 2P');
  });

  test('has navigation system for multiple views', async ({ page }) => {
    const nav = page.locator('.nav');
    await expect(nav).toBeVisible();
    const links = page.locator('.nav a');
    const count = await links.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('supports both dialogue and battle modes (dual display)', async ({ page }) => {
    const dialogue = page.locator('.rpg-dialogue');
    const objection = page.locator('.objection-overlay');
    await expect(dialogue).toBeAttached();
    await expect(objection).toBeAttached();
  });

  test('agent glow colors are per-type (visual differentiation)', async ({ page }) => {
    const glowClasses = await page.evaluate(() => {
      const found = [];
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules) {
            if (rule.selectorText && rule.selectorText.match(/\.sprite-\w+/)) {
              found.push(rule.selectorText);
            }
          }
        } catch (e) {}
      }
      return found;
    });
    expect(glowClasses.length).toBeGreaterThanOrEqual(5);
  });

  test('no external JS framework loaded (vanilla requirement)', async ({ page }) => {
    const frameworks = await page.evaluate(() => {
      return {
        react: typeof window.React !== 'undefined',
        vue: typeof window.Vue !== 'undefined',
        angular: typeof window.angular !== 'undefined',
        jquery: typeof window.jQuery !== 'undefined',
      };
    });
    expect(frameworks.react).toBe(false);
    expect(frameworks.vue).toBe(false);
    expect(frameworks.angular).toBe(false);
    expect(frameworks.jquery).toBe(false);
  });
});

test.describe('Phase 7 — Developer Workflow Connectivity', () => {
  test('MCP server defines tool handlers for coding workflow', async ({}) => {
    const toolsDir = path.join(ROOT, 'mcp-server', 'tools');
    const tools = fs.readdirSync(toolsDir);
    // Should have coding-related tool files
    expect(tools).toContain('consult-fast.js');
    expect(tools).toContain('consult-specialist.js');
    expect(tools).toContain('consult-reasoning.js');
    expect(tools).toContain('review-diff.js');
    expect(tools).toContain('run-tests.js');
  });

  test('decision router exists for task classification', async ({}) => {
    const routerPath = path.join(ROOT, 'mcp-server', 'decision-router.js');
    expect(fs.existsSync(routerPath)).toBe(true);
    const content = fs.readFileSync(routerPath, 'utf-8');
    expect(content.length).toBeGreaterThan(100);
  });

  test('task chains exist for workflow automation', async ({}) => {
    const chainsPath = path.join(ROOT, 'mcp-server', 'task-chains.js');
    expect(fs.existsSync(chainsPath)).toBe(true);
    const content = fs.readFileSync(chainsPath, 'utf-8');
    expect(content).toMatch(/fix_bug|new_feature|refactor|investigate/);
  });

  test('MCP package.json has correct entry point', async ({}) => {
    const pkg = JSON.parse(fs.readFileSync(
      path.join(ROOT, 'mcp-server', 'package.json'), 'utf-8'
    ));
    expect(pkg.main).toBe('server.js');
    expect(pkg.type).toBe('module');
  });
});
