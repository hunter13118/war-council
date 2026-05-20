#!/usr/bin/env node
/**
 * War Council — Setup Wizard
 * 
 * Validates prerequisites and configures the workspace for first use.
 * Run: node scripts/setup.js
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const OK = "\x1b[32m✓\x1b[0m";
const FAIL = "\x1b[31m✗\x1b[0m";
const WARN = "\x1b[33m⚠\x1b[0m";

console.log("\n⚔️  War Council Setup Wizard\n");

// 1. Check Node.js version
const nodeVer = process.versions.node.split(".").map(Number);
if (nodeVer[0] >= 20) {
  console.log(`${OK} Node.js v${process.versions.node}`);
} else {
  console.log(`${FAIL} Node.js v${process.versions.node} — requires v20+`);
  process.exit(1);
}

// 2. Check Ollama
try {
  const ollamaVer = execSync("ollama --version", { encoding: "utf-8" }).trim();
  console.log(`${OK} Ollama: ${ollamaVer}`);
} catch {
  console.log(`${FAIL} Ollama not found. Install from https://ollama.ai`);
  process.exit(1);
}

// 3. Check if Ollama is running
try {
  const res = await fetch("http://127.0.0.1:11434/api/tags");
  if (res.ok) {
    const data = await res.json();
    console.log(`${OK} Ollama running — ${data.models?.length || 0} models available`);
  } else {
    console.log(`${WARN} Ollama API responded with ${res.status}. Is it running?`);
  }
} catch {
  console.log(`${WARN} Ollama not responding on port 11434. Run 'ollama serve' first.`);
}

// 4. Check arsenal.json
const arsenalPath = resolve(ROOT, "arsenal.json");
if (existsSync(arsenalPath)) {
  console.log(`${OK} arsenal.json found`);
} else {
  console.log(`${WARN} arsenal.json not found — creating default...`);
  const defaultArsenal = {
    defaults: { ollama_base: "http://127.0.0.1:11434" },
    models: {
      fast: { name: "qwen2.5-coder:7b", vram: "5GB" },
      specialist: { name: "qwen2.5-coder:14b", vram: "9GB" },
      reasoning: { name: "deepseek-r1:14b", vram: "9GB" },
      heavy: { name: "qwen2.5-coder:32b", vram: "19GB" },
      embed: { name: "nomic-embed-text", vram: "0.3GB" },
    },
    cloud: {
      gemini: { name: "gemini-2.5-flash", rpm: 14 },
      groq: { name: "llama-3.3-70b-versatile", rpm: 28 },
    },
  };
  await writeFile(arsenalPath, JSON.stringify(defaultArsenal, null, 2));
  console.log(`${OK} Default arsenal.json created — edit to match your GPU/models`);
}

// 5. Install MCP server deps
console.log("\nInstalling dependencies...");
try {
  execSync("npm install", { cwd: resolve(ROOT, "mcp-server"), stdio: "pipe" });
  console.log(`${OK} mcp-server dependencies installed`);
} catch (e) {
  console.log(`${FAIL} Failed to install mcp-server deps: ${e.message}`);
}

// 6. Create .cline-context directory
const contextDir = resolve(ROOT, ".cline-context");
await mkdir(contextDir, { recursive: true });
console.log(`${OK} .cline-context/ directory ready`);

// 7. Check models pulled — auto-pull if missing
try {
  const arsenal = JSON.parse(await readFile(arsenalPath, "utf-8"));
  const needed = Object.values(arsenal.models).map(m => m.name);
  const tags = await (await fetch("http://127.0.0.1:11434/api/tags")).json();
  const available = (tags.models || []).map(m => m.name);

  for (const model of needed) {
    if (available.some(a => a.startsWith(model.split(":")[0]))) {
      console.log(`${OK} Model available: ${model}`);
    } else {
      console.log(`${WARN} Model not pulled: ${model} — pulling now...`);
      try {
        execSync(`ollama pull ${model}`, { stdio: "inherit" });
        console.log(`${OK} Pulled: ${model}`);
      } catch {
        console.log(`${FAIL} Failed to pull ${model} — run 'ollama pull ${model}' manually`);
      }
    }
  }
} catch {
  console.log(`${WARN} Could not verify models (Ollama not running?)`);
}

console.log(`
\x1b[36m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m
  Setup complete! Next steps:

  1. Start Ollama:        ollama serve
  2. Start MCP server:    cd mcp-server && npm start
  3. Start dashboard:     cd battle-log && node server.js
  4. Open dashboard:      http://localhost:3737/war-table

  Run tests:              node --test tests/*.test.js
  Run benchmarks (MCP):   Use the benchmark_run tool
\x1b[36m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m
`);
