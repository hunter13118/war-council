#!/usr/bin/env node
/**
 * War Council — Plug-n-Play Workspace Bootstrap
 * =============================================
 * Wires the War Council MCP server into ANY workspace, for ANY AI client.
 *
 *   node scripts/init-workspace.js <target-repo> [--client all|cursor,vscode,cline,claude,gemini,windsurf] [--hooks] [--force]
 *
 * What it does:
 *   1. Detects which AI clients the target workspace (or machine) uses
 *   2. Writes/merges MCP configs from integrations/ templates with correct
 *      absolute paths (no hand-editing "D:/path/to/your-repo" ever again)
 *   3. Copies the council rules file (.cursor/rules → also AGENTS.md if absent)
 *   4. Patches the target's .gitignore (.cline-context/)
 *   5. With --hooks: installs adherence git hooks (pre-commit/pre-push gates)
 *   6. Prints the one MCP call to finish: register_workspace
 *
 * Idempotent: existing war-council entries are updated, other servers preserved.
 * Files it would overwrite are skipped unless --force (except pure-merge JSON).
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const WC_ROOT = path.resolve(__dirname, "..");
const TPL_DIR = path.join(WC_ROOT, "integrations");

// --- args ---
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const positional = argv.filter((a) => !a.startsWith("--") && !argv[argv.indexOf(a) - 1]?.startsWith("--client"));
const clientArgIdx = argv.indexOf("--client");
const clientArg = clientArgIdx >= 0 ? argv[clientArgIdx + 1] : "auto";
const FORCE = flags.has("--force");
const HOOKS = flags.has("--hooks");

const target = path.resolve(positional[0] || process.cwd());
if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
  console.error(`✖ Target is not a directory: ${target}`);
  process.exit(1);
}

const ALL_CLIENTS = ["cursor", "vscode", "cline", "claude", "gemini", "windsurf"];

// --- helpers ---
const toPosix = (p) => p.replace(/\\/g, "/");
const sub = (text) =>
  text
    .replace(/\{\{WAR_COUNCIL_ROOT\}\}/g, toPosix(WC_ROOT))
    .replace(/\{\{WORKSPACE_ROOT\}\}/g, toPosix(target));

function readTemplate(rel) {
  return sub(fs.readFileSync(path.join(TPL_DIR, rel), "utf-8"));
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

/** Merge our mcpServers/servers entry into an existing JSON config. */
function mergeJsonConfig(destPath, templateText, topKey) {
  const incoming = JSON.parse(templateText);
  delete incoming._instructions;
  let result = incoming;
  if (fs.existsSync(destPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(destPath, "utf-8"));
      existing[topKey] = { ...(existing[topKey] || {}), ...(incoming[topKey] || {}) };
      result = existing;
    } catch {
      if (!FORCE) {
        console.warn(`  ⚠ ${destPath} exists but isn't valid JSON — skipped (use --force to overwrite).`);
        return false;
      }
    }
  }
  // UTF-8 WITHOUT BOM — Cline rejects BOM-prefixed configs (see docs/CLINE_SETUP.md).
  fs.writeFileSync(destPath, JSON.stringify(result, null, 2) + "\n", { encoding: "utf-8" });
  return true;
}

function copyIfAbsent(src, dest, label) {
  if (fs.existsSync(dest) && !FORCE) {
    console.log(`  ◦ ${label}: already present — left untouched.`);
    return;
  }
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
  console.log(`  ✔ ${label}: ${path.relative(target, dest) || dest}`);
}

// --- client detection ---
function detectClients() {
  const found = new Set();
  if (fs.existsSync(path.join(target, ".cursor"))) found.add("cursor");
  if (fs.existsSync(path.join(target, ".vscode")) || fs.existsSync(path.join(target, ".github"))) found.add("vscode");
  if (fs.existsSync(path.join(target, ".gemini"))) found.add("gemini");
  if (fs.existsSync(path.join(target, ".mcp.json")) || fs.existsSync(path.join(target, "CLAUDE.md"))) found.add("claude");
  const appdata = process.env.APPDATA;
  if (appdata) {
    if (fs.existsSync(path.join(appdata, "Code", "User", "globalStorage", "saoudrizwan.claude-dev"))) found.add("cline");
    if (fs.existsSync(path.join(appdata, "Code", "User", "globalStorage", "rooveterinaryinc.roo-cline"))) found.add("cline");
  }
  const home = process.env.USERPROFILE || process.env.HOME || "";
  if (home && fs.existsSync(path.join(home, ".codeium", "windsurf"))) found.add("windsurf");
  if (found.size === 0) ["cursor", "vscode", "claude"].forEach((c) => found.add(c)); // sensible default trio
  return [...found];
}

const clients =
  clientArg === "all" ? ALL_CLIENTS
  : clientArg === "auto" ? detectClients()
  : clientArg.split(",").map((s) => s.trim().toLowerCase()).filter((c) => ALL_CLIENTS.includes(c));

console.log("⚔️  WAR COUNCIL — WORKSPACE BOOTSTRAP");
console.log(`   council : ${WC_ROOT}`);
console.log(`   target  : ${target}`);
console.log(`   clients : ${clients.join(", ")}${clientArg === "auto" ? " (auto-detected)" : ""}`);
console.log("");

// --- per-client installs ---
for (const client of clients) {
  console.log(`▶ ${client}`);
  switch (client) {
    case "cursor": {
      ensureDir(path.join(target, ".cursor"));
      if (mergeJsonConfig(path.join(target, ".cursor", "mcp.json"), readTemplate("cursor/mcp.json"), "mcpServers"))
        console.log("  ✔ .cursor/mcp.json (merged)");
      const rules = path.join(WC_ROOT, ".cursor", "rules");
      if (fs.existsSync(rules)) copyIfAbsent(rules, path.join(target, ".cursor", "rules"), "council rules");
      break;
    }
    case "vscode": {
      ensureDir(path.join(target, ".vscode"));
      if (mergeJsonConfig(path.join(target, ".vscode", "mcp.json"), readTemplate("vscode/mcp.json"), "servers"))
        console.log("  ✔ .vscode/mcp.json (merged — Copilot agent mode)");
      copyIfAbsent(path.join(TPL_DIR, "vscode", "extensions.json"), path.join(target, ".vscode", "extensions.json"), "extension recommendations");
      // tasks/settings contain {{WAR_COUNCIL_ROOT}} → write substituted
      for (const f of ["tasks.json", "settings.json"]) {
        const dest = path.join(target, ".vscode", f);
        if (fs.existsSync(dest) && !FORCE) { console.log(`  ◦ .vscode/${f}: already present — left untouched.`); continue; }
        fs.writeFileSync(dest, readTemplate(`vscode/${f}`), "utf-8");
        console.log(`  ✔ .vscode/${f}`);
      }
      break;
    }
    case "cline": {
      // Cline/Roo configs are GLOBAL — we generate the exact file content and
      // tell the user where to paste, rather than silently editing global state.
      const out = path.join(target, ".war-council", "cline_mcp_settings.json");
      ensureDir(path.dirname(out));
      fs.writeFileSync(out, readTemplate("cline/cline_mcp_settings.json"), "utf-8");
      console.log("  ✔ .war-council/cline_mcp_settings.json generated");
      console.log("    → merge into %APPDATA%/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json");
      console.log("    → (Roo Code: rooveterinaryinc.roo-cline path; set WC_CALLER_CLIENT=roo)");
      console.log("    → MUST be UTF-8 without BOM (docs/CLINE_SETUP.md).");
      break;
    }
    case "claude": {
      if (mergeJsonConfig(path.join(target, ".mcp.json"), readTemplate("claude-code/mcp.json"), "mcpServers"))
        console.log("  ✔ .mcp.json (merged — Claude Code project scope)");
      const out = path.join(target, ".war-council", "claude_desktop_config.snippet.json");
      ensureDir(path.dirname(out));
      fs.writeFileSync(out, readTemplate("claude-desktop/claude_desktop_config.snippet.json"), "utf-8");
      console.log("  ✔ .war-council/claude_desktop_config.snippet.json (Desktop: merge manually)");
      break;
    }
    case "gemini": {
      ensureDir(path.join(target, ".gemini"));
      if (mergeJsonConfig(path.join(target, ".gemini", "settings.json"), readTemplate("gemini/settings.json"), "mcpServers"))
        console.log("  ✔ .gemini/settings.json (merged — Gemini CLI / Antigravity)");
      break;
    }
    case "windsurf": {
      const out = path.join(target, ".war-council", "windsurf_mcp_config.snippet.json");
      ensureDir(path.dirname(out));
      fs.writeFileSync(out, readTemplate("windsurf/mcp_config.snippet.json"), "utf-8");
      console.log("  ✔ .war-council/windsurf_mcp_config.snippet.json");
      console.log("    → merge into ~/.codeium/windsurf/mcp_config.json (global)");
      break;
    }
  }
}

// --- AGENTS.md (universal rules surface most agents read) ---
const cursorRules = path.join(WC_ROOT, ".cursor", "rules");
const agentsMd = path.join(target, "AGENTS.md");
if (fs.existsSync(cursorRules) && !fs.existsSync(agentsMd)) {
  fs.writeFileSync(
    agentsMd,
    `# War Council — Agent Operating Rules\n\n> Installed by war-council init. Universal rules surface (Cursor reads .cursor/rules; most other agents read AGENTS.md).\n\n${fs.readFileSync(cursorRules, "utf-8")}\n`,
    "utf-8",
  );
  console.log("\n✔ AGENTS.md written (universal agent rules)");
}

// --- .gitignore patch ---
const gi = path.join(target, ".gitignore");
const giEntries = [".cline-context/", ".war-council/"];
let giText = fs.existsSync(gi) ? fs.readFileSync(gi, "utf-8") : "";
const missing = giEntries.filter((e) => !giText.split(/\r?\n/).some((l) => l.trim() === e || l.trim() === e.replace(/\/$/, "")));
if (missing.length) {
  giText += (giText.endsWith("\n") || giText === "" ? "" : "\n") + "\n# War Council artifacts\n" + missing.join("\n") + "\n";
  fs.writeFileSync(gi, giText, "utf-8");
  console.log(`✔ .gitignore patched (${missing.join(", ")})`);
}

// --- adherence hooks ---
if (HOOKS) {
  const hooksDir = path.join(target, ".githooks");
  ensureDir(hooksDir);
  for (const h of ["pre-commit", "pre-push"]) {
    fs.copyFileSync(path.join(WC_ROOT, ".githooks", h), path.join(hooksDir, h));
    try { fs.chmodSync(path.join(hooksDir, h), 0o755); } catch {}
  }
  try {
    execSync("git config core.hooksPath .githooks", { cwd: target });
    execSync(`git config war-council.root "${toPosix(WC_ROOT)}"`, { cwd: target });
    console.log("✔ Adherence hooks installed (.githooks + core.hooksPath). Set WC_ROOT env or keep war-council checkout reachable.");
  } catch {
    console.warn("⚠ Not a git repo (or git missing) — hooks copied but core.hooksPath not set.");
  }
} else {
  console.log("◦ Adherence hooks not installed (re-run with --hooks to gate commits through the council).");
}

console.log(`
============================================================
⚔️  Bootstrap complete. Final step — in your AI client, run:

    register_workspace(path="${toPosix(target)}")

This indexes the repo into ${toPosix(path.join(target, ".cline-context"))}
and points memory_query at YOUR code. Requires Ollama running
(ollama serve) with nomic-embed-text pulled.
============================================================`);
