#!/usr/bin/env node
/**
 * War Council Adherence Gate
 * ==========================
 * Enforces that AI-assisted work actually went THROUGH the council instead
 * of around it. Designed to run as a git hook (pre-commit / pre-push) or
 * standalone (`node scripts/adherence-gate.js --report`).
 *
 * How it works
 * ------------
 * Every MCP tool call is appended to `<workspace>/.cline-context/battle-log.jsonl`
 * by the server's battle-events module. This gate inspects that log:
 *
 *   pre-commit  → BLOCKS large staged changes when no council activity is
 *                 found within the recency window. Small diffs pass free.
 *   pre-push    → WARNS on low adherence (blocks only if WC_GATE_STRICT=1).
 *   --report    → prints a 24h adherence scorecard.
 *
 * Escape hatches (deliberate — gates should guide, not imprison):
 *   WC_SKIP_GATE=1        skip entirely (emergencies)
 *   WC_GATE_WINDOW_MIN    council-activity recency window (default 120)
 *   WC_GATE_FREE_LINES    staged lines that pass without consultation (default 40)
 *   WC_GATE_STRICT=1      pre-push warnings become blocks
 */
"use strict";

const { execSync } = require("node:child_process");
const { existsSync, readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const WINDOW_MIN = parseInt(process.env.WC_GATE_WINDOW_MIN || "120", 10);
const FREE_LINES = parseInt(process.env.WC_GATE_FREE_LINES || "40", 10);
const STRICT = process.env.WC_GATE_STRICT === "1";

const args = process.argv.slice(2);
const hook = args.includes("--hook") ? args[args.indexOf("--hook") + 1] : null;
const reportMode = args.includes("--report");

function gitRoot() {
  try {
    return execSync("git rev-parse --show-toplevel", { encoding: "utf-8" }).trim();
  } catch {
    return process.cwd();
  }
}

function readBattleLog(root) {
  const p = resolve(root, ".cline-context", "battle-log.jsonl");
  if (!existsSync(p)) return { path: p, events: [] };
  const events = [];
  for (const line of readFileSync(p, "utf-8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { events.push(JSON.parse(line)); } catch { /* tolerate partial writes */ }
  }
  return { path: p, events };
}

function eventTime(e) {
  const t = e.timestamp || e.time || e.ts;
  const ms = t ? Date.parse(t) : NaN;
  return Number.isFinite(ms) ? ms : 0;
}

function recentEvents(events, minutes) {
  const cutoff = Date.now() - minutes * 60_000;
  return events.filter((e) => eventTime(e) >= cutoff);
}

function stagedLines() {
  try {
    const out = execSync("git diff --cached --numstat", { encoding: "utf-8" });
    let total = 0;
    for (const line of out.split("\n")) {
      const m = line.match(/^(\d+)\t(\d+)\t/);
      if (m) total += parseInt(m[1], 10) + parseInt(m[2], 10);
    }
    return total;
  } catch {
    return 0;
  }
}

function summarize(events) {
  const byType = {};
  for (const e of events) {
    const k = e.type || e.tool || "unknown";
    byType[k] = (byType[k] || 0) + 1;
  }
  return byType;
}

function printReport(root) {
  const { path, events } = readBattleLog(root);
  const day = recentEvents(events, 24 * 60);
  const window = recentEvents(events, WINDOW_MIN);
  console.log("=== WAR COUNCIL ADHERENCE REPORT ===");
  console.log(`workspace : ${root}`);
  console.log(`battle log: ${path} (${events.length} events total)`);
  console.log(`last 24h  : ${day.length} council events`);
  console.log(`last ${WINDOW_MIN}m : ${window.length} council events`);
  const byType = summarize(day);
  const keys = Object.keys(byType).sort((a, b) => byType[b] - byType[a]);
  if (keys.length) {
    console.log("breakdown (24h):");
    for (const k of keys.slice(0, 12)) console.log(`  ${String(byType[k]).padStart(4)}  ${k}`);
  } else {
    console.log("No council activity in 24h — the war table is gathering dust, fam.");
  }
}

function main() {
  if (process.env.WC_SKIP_GATE === "1") {
    console.log("[wc-gate] WC_SKIP_GATE=1 — gate bypassed.");
    return 0;
  }

  const root = gitRoot();

  if (reportMode || !hook) {
    printReport(root);
    return 0;
  }

  const { path, events } = readBattleLog(root);
  const recent = recentEvents(events, WINDOW_MIN);

  if (hook === "pre-commit") {
    const lines = stagedLines();
    if (lines <= FREE_LINES) {
      console.log(`[wc-gate] ${lines} staged lines ≤ ${FREE_LINES} — small change, no consultation required.`);
      return 0;
    }
    if (recent.length > 0) {
      console.log(`[wc-gate] ✅ ${recent.length} council event(s) in last ${WINDOW_MIN}m — adherence confirmed.`);
      return 0;
    }
    console.error(
      [
        "",
        "⚔️  [wc-gate] COMMIT BLOCKED — no War Council consultation found.",
        `   Staged change: ${lines} lines (> ${FREE_LINES} free-pass threshold)`,
        `   Battle log:    ${path}`,
        `   Window:        last ${WINDOW_MIN} minutes`,
        "",
        "   Before committing work this size, run it past the council:",
        "     • memory_query / consult_fast for context + a free second opinion",
        "     • review_diff for a pre-commit audit",
        "     • log_decision to record WHY this change is shaped this way",
        "",
        "   Emergency bypass: WC_SKIP_GATE=1 git commit ...",
        "",
      ].join("\n"),
    );
    return 1;
  }

  if (hook === "pre-push") {
    if (recent.length === 0) {
      const msg = `[wc-gate] ⚠️ pushing with no council activity in last ${WINDOW_MIN}m.`;
      if (STRICT) {
        console.error(msg + " WC_GATE_STRICT=1 — push blocked.");
        return 1;
      }
      console.warn(msg + " (set WC_GATE_STRICT=1 to enforce)");
    } else {
      console.log(`[wc-gate] ✅ ${recent.length} council event(s) in window — push approved.`);
    }
    return 0;
  }

  console.warn(`[wc-gate] unknown hook '${hook}' — passing through.`);
  return 0;
}

process.exit(main());
