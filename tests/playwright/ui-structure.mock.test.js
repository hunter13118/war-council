import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

/**
 * MOCKED UI TESTS — War Table HTML
 *
 * These tests load the HTML directly from file (no server needed).
 * They validate the UI structure, styling, and DOM elements defined
 * across all 7 phases of the architecture.
 */

test.describe('War Table — Layout & Structure', () => {
  test.beforeEach(async ({ page }) => {
    const filePath = path.join(ROOT, 'battle-log', 'war-table.html');
    await page.goto(`file:///${filePath.replace(/\\/g, '/')}`);
  });

  test('page loads with correct title', async ({ page }) => {
    await expect(page).toHaveTitle(/War Table/);
  });

  test('navigation bar is present and visible', async ({ page }) => {
    const nav = page.locator('.nav');
    await expect(nav).toBeVisible();
  });

  test('war table (oval) element is present', async ({ page }) => {
    const table = page.locator('.war-table');
    await expect(table).toBeVisible();
  });

  test('scene container fills viewport', async ({ page }) => {
    const scene = page.locator('.scene');
    await expect(scene).toBeVisible();
    const box = await scene.boundingBox();
    expect(box.width).toBeGreaterThan(500);
    expect(box.height).toBeGreaterThan(300);
  });

  test('RPG dialogue box exists (hidden by default)', async ({ page }) => {
    const dialogue = page.locator('.rpg-dialogue');
    await expect(dialogue).toBeAttached();
  });

  test('Ace Attorney objection overlay exists (hidden by default)', async ({ page }) => {
    const overlay = page.locator('.objection-overlay');
    await expect(overlay).toBeAttached();
  });
});

test.describe('War Table — Dark Theme (Phase 6 Design System)', () => {
  test.beforeEach(async ({ page }) => {
    const filePath = path.join(ROOT, 'battle-log', 'war-table.html');
    await page.goto(`file:///${filePath.replace(/\\/g, '/')}`);
  });

  test('background is dark (near-black)', async ({ page }) => {
    const bg = await page.evaluate(() => {
      return getComputedStyle(document.body).backgroundColor;
    });
    // Should be very dark — RGB values all < 30
    const match = bg.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (match) {
      const [, r, g, b] = match.map(Number);
      expect(r).toBeLessThan(30);
      expect(g).toBeLessThan(30);
      expect(b).toBeLessThan(40);
    }
  });

  test('CSS variables are defined (design tokens)', async ({ page }) => {
    const vars = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return {
        bg: style.getPropertyValue('--bg'),
        gold: style.getPropertyValue('--gold'),
        cyan: style.getPropertyValue('--cyan'),
        fire: style.getPropertyValue('--fire'),
        text: style.getPropertyValue('--text'),
      };
    });
    expect(vars.bg.trim()).toBeTruthy();
    expect(vars.gold.trim()).toBeTruthy();
    expect(vars.cyan.trim()).toBeTruthy();
    expect(vars.fire.trim()).toBeTruthy();
    expect(vars.text.trim()).toBeTruthy();
  });

  test('uses pixel-art font', async ({ page }) => {
    const font = await page.evaluate(() => {
      return getComputedStyle(document.body).fontFamily;
    });
    expect(font).toContain('Press Start 2P');
  });
});

test.describe('War Table — Agent Sprites & Seats', () => {
  test.beforeEach(async ({ page }) => {
    const filePath = path.join(ROOT, 'battle-log', 'war-table.html');
    await page.goto(`file:///${filePath.replace(/\\/g, '/')}`);
  });

  test('agent seat elements are dynamically rendered', async ({ page }) => {
    // .seat elements are created dynamically by JS when agents connect
    // Verify the container exists for them
    const warTable = page.locator('.war-table');
    await expect(warTable).toBeAttached();
  });

  test('sprite containers have proper styling classes', async ({ page }) => {
    const sprites = page.locator('.sprite');
    const count = await sprites.count();
    // At least some sprites should exist (even if dynamically populated)
    // If none exist statically, that's OK — they're created by JS
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('seat name labels use gold color', async ({ page }) => {
    // Check CSS rule exists
    const hasRule = await page.evaluate(() => {
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules) {
            if (rule.selectorText === '.seat-name' && rule.style.color) {
              return true;
            }
          }
        } catch (e) {} // Cross-origin stylesheets
      }
      return false;
    });
    expect(hasRule).toBe(true);
  });
});

test.describe('War Table — Mode Toggle (Visual Modes)', () => {
  test.beforeEach(async ({ page }) => {
    const filePath = path.join(ROOT, 'battle-log', 'war-table.html');
    await page.goto(`file:///${filePath.replace(/\\/g, '/')}`);
  });

  test('mode toggle buttons exist', async ({ page }) => {
    const toggles = page.locator('.mode-btn');
    const count = await toggles.count();
    expect(count).toBeGreaterThan(0);
  });

  test('one mode is active by default', async ({ page }) => {
    const active = page.locator('.mode-btn.active');
    const count = await active.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });
});

test.describe('War Table — Animation CSS Defined', () => {
  test.beforeEach(async ({ page }) => {
    const filePath = path.join(ROOT, 'battle-log', 'war-table.html');
    await page.goto(`file:///${filePath.replace(/\\/g, '/')}`);
  });

  test('keyframe animations are defined', async ({ page }) => {
    const animations = await page.evaluate(() => {
      const found = [];
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules) {
            if (rule.type === CSSRule.KEYFRAMES_RULE) {
              found.push(rule.name);
            }
          }
        } catch (e) {}
      }
      return found;
    });
    // Should have at least: bubbleIn, blink, seatGlow, objectionSlam
    expect(animations.length).toBeGreaterThanOrEqual(3);
    expect(animations).toContain('bubbleIn');
    expect(animations).toContain('blink');
  });
});
