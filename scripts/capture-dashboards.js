#!/usr/bin/env node
/**
 * Capture every War Table dashboard page for visual audit.
 *
 *   node scripts/capture-dashboards.js [--base http://localhost:3737]
 *
 * Requires the dashboard running and Playwright installed:
 *   cd tests && npm install && npx playwright install chromium
 *
 * Output: .war-council/audit-screens/<page>.<desktop|mobile>.png
 *         .war-council/audit-screens/console-report.json (per-page JS errors)
 */
"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { createRequire } = require("node:module");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, ".war-council", "audit-screens");
const baseIdx = process.argv.indexOf("--base");
const BASE = baseIdx >= 0 ? process.argv[baseIdx + 1] : "http://localhost:3737";

const PAGES = [
  ["index", "/"],
  ["war-table", "/war-table"],
  ["command-center", "/command-center"],
  ["metrics-hud", "/metrics-hud"],
  ["dag-theater", "/dag-theater"],
  ["knowledge-graph-viz", "/knowledge-graph-viz"],
  ["memory-archive", "/memory-archive"],
  ["adaptive-thresholds", "/adaptive-thresholds"],
  ["arbitration-court", "/arbitration-court"],
  ["embed", "/embed"],
];

const VIEWPORTS = [
  ["desktop", { width: 1440, height: 900 }],
  ["mobile", { width: 390, height: 844 }],
];

function loadPlaywright() {
  try {
    const req = createRequire(path.join(ROOT, "tests", "package.json"));
    return req("playwright");
  } catch {
    console.error(
      "✖ Playwright not found. Install it first:\n    cd tests && npm install && npx playwright install chromium",
    );
    process.exit(1);
  }
}

(async () => {
  const { chromium } = loadPlaywright();
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch();
  const consoleReport = {};

  for (const [vpName, viewport] of VIEWPORTS) {
    const context = await browser.newContext({ viewport });
    for (const [name, route] of PAGES) {
      const page = await context.newPage();
      const errors = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") errors.push(msg.text().slice(0, 300));
      });
      page.on("pageerror", (err) => errors.push(`pageerror: ${String(err).slice(0, 300)}`));
      try {
        await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 45_000 }).catch(() =>
          page.goto(BASE + route, { waitUntil: "domcontentloaded", timeout: 45_000 }),
        );
        await page.waitForTimeout(2500); // let SSE/animations settle
        await page.screenshot({
          path: path.join(OUT, `${name}.${vpName}.png`),
          fullPage: vpName === "desktop",
        });
        console.log(`✔ ${name} (${vpName})${errors.length ? ` — ${errors.length} console error(s)` : ""}`);
      } catch (e) {
        console.error(`✖ ${name} (${vpName}): ${e.message}`);
        errors.push(`capture failed: ${e.message}`);
      }
      consoleReport[`${name}.${vpName}`] = errors;
      await page.close();
    }
    await context.close();
  }

  await browser.close();
  fs.writeFileSync(path.join(OUT, "console-report.json"), JSON.stringify(consoleReport, null, 2));
  const total = Object.values(consoleReport).flat().length;
  console.log(`\nDone → ${OUT}\nConsole errors across all pages: ${total} (see console-report.json)`);
})();
