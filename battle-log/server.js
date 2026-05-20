#!/usr/bin/env node
/**
 * Battle Log Dashboard Server
 *
 * Serves the war-room UI and streams events via Server-Sent Events (SSE).
 * Reads from the battle-log.jsonl file + accepts live pushes from the MCP server.
 *
 * Usage:
 *   node tools/war-council/battle-log/server.js [--port 3737]
 *
 * Endpoints:
 *   GET /          → Dashboard HTML
 *   GET /events    → SSE stream (live events)
 *   GET /history   → Last 100 events as JSON
 *   POST /emit     → Push a manual event (for testing)
 */
import { createServer } from "node:http";
import { readFile, readdir, stat, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { retrieve } from "../memory-engine/retriever.js";
import { existsSync, createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = parseInt(process.argv.find((a, i) => process.argv[i - 1] === "--port") || "3737", 10);
const REPO_ROOT = resolve(__dirname, "..");
const LOG_DIR = resolve(REPO_ROOT, ".cline-context");
const LOG_PATH = resolve(LOG_DIR, "battle-log.jsonl");

// Ensure .cline-context directory exists (auto-create on first use)
async function ensureLogDir() {
  await mkdir(LOG_DIR, { recursive: true });
}

// JSONL rotation — cap at 10MB, rename to .1 on overflow
const MAX_LOG_BYTES = 10 * 1024 * 1024; // 10 MB

async function appendWithRotation(entry) {
  await ensureLogDir();
  const { appendFile: af, rename, stat: fstat } = await import("node:fs/promises");
  // Check if rotation needed
  try {
    const s = await fstat(LOG_PATH);
    if (s.size >= MAX_LOG_BYTES) {
      const rotatedPath = LOG_PATH + ".1";
      await rename(LOG_PATH, rotatedPath);
    }
  } catch (e) {
    // File doesn't exist yet — that's fine
    if (e.code !== 'ENOENT') throw e;
  }
  await af(LOG_PATH, JSON.stringify(entry) + "\n");
}

// In-memory event buffer (last 500 events)
const eventBuffer = [];
const MAX_BUFFER = 500;

// Tournament state: win/loss records per agent
const tournamentRecords = {};
// { agentKey: { wins: 0, losses: 0, streak: 0, reoptimized: 0 } }

function getRecord(agent) {
  if (!tournamentRecords[agent]) {
    tournamentRecords[agent] = { wins: 0, losses: 0, streak: 0, reoptimized: 0 };
  }
  return tournamentRecords[agent];
}

// Voice assignments: agentKey → Edge TTS voice ShortName
let voiceAssignments = {};
const VOICES_PATH = resolve(__dirname, 'voices.json');

// Load persisted voice assignments
async function loadVoiceAssignments() {
  if (existsSync(VOICES_PATH)) {
    try {
      voiceAssignments = JSON.parse(await readFile(VOICES_PATH, 'utf-8'));
    } catch {}
  }
}

async function saveVoiceAssignments() {
  try {
    const { writeFile: wf } = await import('node:fs/promises');
    await wf(VOICES_PATH, JSON.stringify(voiceAssignments, null, 2));
  } catch {}
}

// SSE clients
const sseClients = new Set();

// Load existing log on start
async function loadHistory() {
  if (!existsSync(LOG_PATH)) return;
  const rl = createInterface({ input: createReadStream(LOG_PATH) });
  for await (const line of rl) {
    if (line.trim()) {
      try {
        const event = JSON.parse(line);
        eventBuffer.push(event);
        if (eventBuffer.length > MAX_BUFFER) eventBuffer.shift();
        // Rebuild tournament records from history
        if (event.type === "tournament_result" && event.winner && event.loser) {
          const w = getRecord(event.winner);
          const l = getRecord(event.loser);
          w.wins++;
          w.streak++;
          l.losses++;
          l.streak = 0;
        }
        if (event.type === "agent_reoptimized" && event.agent) {
          const r = getRecord(event.agent);
          r.reoptimized++;
          r.streak = 0;
          r.wins = 0;
          r.losses = 0;
        }
      } catch {}
    }
  }
}

function broadcast(event) {
  // Process tournament/reoptimize events (same logic as POST /emit)
  if (event.type === "tournament_result" && event.winner && event.loser) {
    const w = getRecord(event.winner);
    const l = getRecord(event.loser);
    w.wins++;
    w.streak++;
    l.losses++;
    l.streak = 0;
    event.winnerRecord = { ...w };
    event.loserRecord = { ...l };
  }
  if (event.type === "agent_reoptimized" && event.agent) {
    const r = getRecord(event.agent);
    r.reoptimized++;
    r.streak = 0;
    r.wins = 0;
    r.losses = 0;
    event.record = { ...r };
  }

  eventBuffer.push(event);
  if (eventBuffer.length > MAX_BUFFER) eventBuffer.shift();
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of sseClients) {
    try { client.write(data); } catch { sseClients.delete(client); }
  }
}

// Watch the log file for new entries (tail -f equivalent)
let lastSize = 0;
async function watchLog() {
  if (!existsSync(LOG_PATH)) {
    setTimeout(watchLog, 2000);
    return;
  }
  try {
    const s = await stat(LOG_PATH);
    if (s.size > lastSize) {
      // Read new bytes
      const { createReadStream: crs } = await import("node:fs");
      const stream = crs(LOG_PATH, { start: lastSize });
      const rl = createInterface({ input: stream });
      for await (const line of rl) {
        if (line.trim()) {
          try {
            const event = JSON.parse(line);
            broadcast(event);
          } catch {}
        }
      }
      lastSize = s.size;
    }
  } catch {}
  setTimeout(watchLog, 500); // Poll every 500ms
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/" || url.pathname === "/index.html") {
    const html = await readFile(resolve(__dirname, "index.html"), "utf-8");
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
    return;
  }

  if (url.pathname === "/war-table") {
    const html = await readFile(resolve(__dirname, "war-table.html"), "utf-8");
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
    return;
  }

  if (url.pathname === "/command-center") {
    const html = await readFile(resolve(__dirname, "command-center.html"), "utf-8");
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
    return;
  }

  // === Chat endpoint — streams Ollama response with smart routing ===
  if (url.pathname === "/chat" && req.method === "POST") {
    let body = "";
    for await (const chunk of req) body += chunk;
    try {
      const { message, mode, model: forceModel, context } = JSON.parse(body);
      if (!message) throw new Error("message required");

      const ollamaBase = process.env.OLLAMA_BASE || "http://127.0.0.1:11434";
      const route = routeMessage(message, mode);

      // Build prompt with optional RAG context
      let prompt = message;

      // Auto-retrieve from vector store (Sovereign Memory RAG)
      let ragContext = '';
      try {
        const storePath = resolve(REPO_ROOT, ".cline-context/vector-store.json");
        const ragResult = await retrieve(message, { storePath, k: 3, minRelevance: 0.35 });
        if (ragResult.relevant && ragResult.chunks.length > 0) {
          ragContext = ragResult.chunks.map(c => `[${c.source}]\n${c.text}`).join('\n\n');
        }
      } catch {} // silently skip if vector store not built yet

      if (context && context.trim()) {
        prompt = `The user has provided the following reference files for context:\n\n${context}\n\n${ragContext ? `Relevant codebase context (auto-retrieved):\n${ragContext}\n\n` : ''}User question: ${message}`;
      } else if (ragContext) {
        prompt = `Relevant codebase context (auto-retrieved):\n${ragContext}\n\nUser question: ${message}`;
      }

      // Emit tool_call event so war table shows activity
      const eventId = `chat-${Date.now()}`;
      broadcast({ type: "tool_call", tool: route.tool, text: message, model: route.model, id: eventId, timestamp: new Date().toISOString() });

      // Stream response from Ollama
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });

      // Send RAG metadata before streaming response
      if (ragContext) {
        res.write(`data: ${JSON.stringify({ rag: true, chunks: ragContext.split('\n\n').length })}\n\n`);
      }

      const startTime = Date.now();
      const ollamaRes = await fetch(`${ollamaBase}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: forceModel || route.model,
          prompt: prompt,
          stream: true,
        }),
      });

      if (!ollamaRes.ok) {
        res.write(`data: ${JSON.stringify({ error: `Ollama error: ${ollamaRes.status}` })}\n\n`);
        res.end();
        return;
      }

      let fullResponse = "";
      let tokensOut = 0;
      const reader = ollamaRes.body;

      // Node readable stream from fetch — parse NDJSON
      let buffer = "";
      for await (const chunk of reader) {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop(); // keep incomplete line

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            if (parsed.response) {
              fullResponse += parsed.response;
              tokensOut++;
              res.write(`data: ${JSON.stringify({ token: parsed.response, model: forceModel || route.model, tool: route.tool, reason: route.reason })}\n\n`);
            }
            if (parsed.done) {
              const elapsedMs = Date.now() - startTime;
              res.write(`data: ${JSON.stringify({ done: true, elapsedMs, tokensOut, model: forceModel || route.model, tool: route.tool, reason: route.reason })}\n\n`);
              // Emit completion event for war table
              broadcast({ type: "tool_call", tool: route.tool, text: fullResponse.slice(0, 100) + "...", model: forceModel || route.model, elapsedMs, tokensOut, id: eventId + "-done", timestamp: new Date().toISOString() });
            }
          } catch {}
        }
      }
      res.end();
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(400, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        res.end(JSON.stringify({ error: e.message }));
      }
    }
    return;
  }

  // === Chat: list available models ===
  if (url.pathname === "/chat/models" && req.method === "GET") {
    try {
      const arsenal = JSON.parse(await readFile(resolve(REPO_ROOT, "arsenal.json"), "utf-8"));
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify(arsenal));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // === Conversations: persistence ===
  const CONVOS_DIR = resolve(LOG_DIR, "conversations");

  if (url.pathname === "/conversations" && req.method === "GET") {
    try {
      await mkdir(CONVOS_DIR, { recursive: true });
      const files = (await readdir(CONVOS_DIR)).filter(f => f.endsWith('.json')).sort().reverse();
      const list = [];
      for (const f of files.slice(0, 50)) {
        try {
          const data = JSON.parse(await readFile(resolve(CONVOS_DIR, f), 'utf-8'));
          list.push({ id: data.id, title: data.title, updatedAt: data.updatedAt, messageCount: (data.messages || []).length });
        } catch {}
      }
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify(list));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (url.pathname.startsWith("/conversations/") && req.method === "GET") {
    const id = url.pathname.split("/")[2];
    if (!id || !/^[a-z0-9-]+$/.test(id)) { res.writeHead(400); res.end('Invalid id'); return; }
    try {
      const data = await readFile(resolve(CONVOS_DIR, `${id}.json`), 'utf-8');
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(data);
    } catch (e) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
    return;
  }

  if (url.pathname === "/conversations" && req.method === "POST") {
    let body = "";
    for await (const chunk of req) body += chunk;
    try {
      const convo = JSON.parse(body);
      if (!convo.id || !/^[a-z0-9-]+$/.test(convo.id)) throw new Error('Invalid conversation id');
      await mkdir(CONVOS_DIR, { recursive: true });
      const { writeFile: wf } = await import('node:fs/promises');
      await wf(resolve(CONVOS_DIR, `${convo.id}.json`), JSON.stringify(convo, null, 2));
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (url.pathname.startsWith("/conversations/") && req.method === "DELETE") {
    const id = url.pathname.split("/")[2];
    if (!id || !/^[a-z0-9-]+$/.test(id)) { res.writeHead(400); res.end('Invalid id'); return; }
    try {
      const { unlink } = await import('node:fs/promises');
      await unlink(resolve(CONVOS_DIR, `${id}.json`));
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
    return;
  }

  if (url.pathname === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    res.write(":\n\n"); // SSE comment (keepalive)
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }

  if (url.pathname === "/history") {
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(JSON.stringify(eventBuffer.slice(-100)));
    return;
  }

  // System stats — rate limits + memory store + Ollama VRAM + throughput
  if (url.pathname === "/stats") {
    let rateLimits = {};
    let memoryStats = {};
    let ollamaModels = [];
    let throughput = {};
    try {
      const { getAllRateLimitStats } = await import("../mcp-server/shared/rate-limiter.js");
      rateLimits = getAllRateLimitStats();
    } catch { /* MCP server not co-located */ }
    try {
      const { VectorStore } = await import("../memory-engine/store.js");
      const storePath = resolve(LOG_DIR, "vector-store.json");
      const store = new VectorStore(storePath);
      await store.load();
      memoryStats = store.stats();
    } catch { /* store not initialized */ }
    // Ollama loaded models (VRAM info)
    try {
      const ollamaBase = process.env.OLLAMA_BASE || "http://127.0.0.1:11434";
      const psRes = await fetch(`${ollamaBase}/api/ps`);
      if (psRes.ok) {
        const psData = await psRes.json();
        ollamaModels = (psData.models || []).map(m => ({
          name: m.name,
          size: m.size,
          sizeVram: m.size_vram,
          expiresAt: m.expires_at,
        }));
      }
    } catch { /* Ollama not running */ }
    // Throughput from recent events (last 60s)
    const cutoff = Date.now() - 60000;
    const recentEvents = eventBuffer.filter(e => e.timestamp && new Date(e.timestamp).getTime() > cutoff);
    const modelStats = {};
    for (const e of recentEvents) {
      if (e.model && e.tokensOut) {
        if (!modelStats[e.model]) modelStats[e.model] = { calls: 0, tokens: 0, totalMs: 0 };
        modelStats[e.model].calls++;
        modelStats[e.model].tokens += e.tokensOut || 0;
        modelStats[e.model].totalMs += e.elapsedMs || 0;
      }
    }
    for (const [model, s] of Object.entries(modelStats)) {
      s.avgTps = s.totalMs > 0 ? Math.round((s.tokens / s.totalMs) * 1000) : 0;
    }
    throughput = modelStats;

    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(JSON.stringify({ rateLimits, memoryStats, ollamaModels, throughput, timestamp: new Date().toISOString() }));
    return;
  }

  // Tournament leaderboard
  if (url.pathname === "/leaderboard") {
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(JSON.stringify(tournamentRecords));
    return;
  }

  // Benchmark results
  if (url.pathname === "/benchmark") {
    try {
      const resultsPath = resolve(LOG_DIR, "benchmark-results.json");
      const raw = await readFile(resultsPath, "utf-8");
      const data = JSON.parse(raw);
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify(data));
    } catch {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify({ runs: [], leaderboard: {} }));
    }
    return;
  }

  // Memory Graph — returns 2D-projected chunk positions for constellation visualization
  if (url.pathname === "/memory-graph") {
    try {
      const storePath = resolve(REPO_ROOT, "memory-engine", "store.json");
      const raw = await readFile(storePath, "utf-8");
      const chunks = JSON.parse(raw);
      // Random projection from high-dim to 2D (deterministic seed per chunk index)
      // This is a lightweight alternative to t-SNE for dashboard rendering
      const nodes = chunks.slice(0, 300).map((c, i) => {
        const emb = c.embedding || [];
        // Project to 2D using two fixed random vectors (seeded by position)
        let x = 0, y = 0;
        for (let j = 0; j < emb.length; j++) {
          x += emb[j] * Math.sin(j * 0.1 + 0.7);
          y += emb[j] * Math.cos(j * 0.13 + 1.1);
        }
        return {
          id: i,
          x: x,
          y: y,
          source: c.source || "unknown",
          text: (c.text || "").slice(0, 80),
          tokens: c.tokenCount || 0,
        };
      });
      // Normalize to [0, 1]
      if (nodes.length > 0) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const n of nodes) { minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x); minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y); }
        const rangeX = maxX - minX || 1;
        const rangeY = maxY - minY || 1;
        for (const n of nodes) { n.x = (n.x - minX) / rangeX; n.y = (n.y - minY) / rangeY; }
      }
      // Group by source for coloring
      const sources = [...new Set(nodes.map(n => n.source))];
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify({ nodes, sources, total: chunks.length }));
    } catch {
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify({ nodes: [], sources: [], total: 0 }));
    }
    return;
  }

  // Voice assignments
  if (url.pathname === "/voices" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(JSON.stringify(voiceAssignments));
    return;
  }

  if (url.pathname === "/voices" && req.method === "POST") {
    let body = "";
    for await (const chunk of req) body += chunk;
    try {
      const data = JSON.parse(body);
      // data: { agent: "scout", voice: "en-US-AriaNeural" }
      if (data.agent && data.voice) {
        voiceAssignments[data.agent] = data.voice;
        await saveVoiceAssignments();
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, assignments: voiceAssignments }));
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (url.pathname === "/emit" && req.method === "POST") {
    let body = "";
    for await (const chunk of req) body += chunk;
    try {
      const event = JSON.parse(body);
      event.timestamp = event.timestamp || new Date().toISOString();
      event.id = event.id || `${Date.now()}-manual`;

      // Process tournament events
      if (event.type === "tournament_result" && event.winner && event.loser) {
        const w = getRecord(event.winner);
        const l = getRecord(event.loser);
        w.wins++;
        w.streak++;
        l.losses++;
        l.streak = 0;
        event.winnerRecord = { ...w };
        event.loserRecord = { ...l };
      }

      if (event.type === "agent_reoptimized" && event.agent) {
        const r = getRecord(event.agent);
        r.reoptimized++;
        r.streak = 0;
        r.wins = 0;
        r.losses = 0;
        event.record = { ...r };
      }

      broadcast(event);
      // Persist to JSONL so events survive restarts (with rotation)
      try {
        await appendWithRotation(event);
        lastSize = (await stat(LOG_PATH)).size;
      } catch {}
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // TTS Proxy — server-side Edge Neural TTS (browser can't set WS headers)
  if (url.pathname === "/tts" && req.method === "POST") {
    let body = "";
    for await (const chunk of req) body += chunk;
    try {
      const { text, voice } = JSON.parse(body);
      if (!text || !voice) throw new Error("text and voice required");

      const audio = await edgeTtsGenerate(text, voice);
      if (audio && audio.length > 0) {
        res.writeHead(200, {
          "Content-Type": "audio/mpeg",
          "Content-Length": audio.length,
          "Access-Control-Allow-Origin": "*",
        });
        res.end(audio);
      } else {
        res.writeHead(204, { "Access-Control-Allow-Origin": "*" });
        res.end();
      }
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  // Static asset serving for generated images (assets/ directory)
  if (url.pathname.startsWith("/assets/")) {
    const safePath = url.pathname.replace(/\.\./g, ""); // prevent path traversal
    const filePath = resolve(__dirname, safePath.slice(1));
    // Ensure resolved path is within __dirname
    if (!filePath.startsWith(__dirname)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    try {
      const data = await readFile(filePath);
      const ext = filePath.split(".").pop().toLowerCase();
      const mimeTypes = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml" };
      res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream", "Cache-Control": "public, max-age=3600" });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("Asset not found");
    }
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

// === Smart Message Router (lightweight decision tree) ===
function routeMessage(message, mode) {
  // Load arsenal model names
  const FAST = "qwen2.5-coder:7b";
  const SPECIALIST = "qwen2.5-coder:14b";
  const REASONING = "deepseek-r1:14b";

  if (mode === "fast") return { model: FAST, tool: "consult_fast", reason: "User selected fast mode" };
  if (mode === "reasoning") return { model: REASONING, tool: "consult_reasoning", reason: "User selected reasoning mode" };
  if (mode === "specialist") return { model: SPECIALIST, tool: "consult_specialist", reason: "User selected specialist mode" };

  const lower = message.toLowerCase();

  // Architecture / planning → reasoning
  if (matches(lower, ["architect", "design", "plan", "strategy", "approach", "how should", "tradeoff", "compare"])) {
    return { model: REASONING, tool: "consult_reasoning", reason: "Architecture/planning detected → deep reasoning" };
  }
  // Bug / error → specialist
  if (matches(lower, ["bug", "error", "broken", "crash", "failing", "fix", "doesn't work", "not working"])) {
    return { model: SPECIALIST, tool: "consult_specialist", reason: "Bug-fix keywords → specialist analysis" };
  }
  // Code tasks → specialist
  if (matches(lower, ["implement", "refactor", "write", "code", "function", "class", "module", "create"])) {
    return { model: SPECIALIST, tool: "consult_specialist", reason: "Code task → specialist" };
  }
  // Quick questions → fast
  if (lower.length < 80 || matches(lower, ["what is", "how to", "quick", "simple", "format", "syntax"])) {
    return { model: FAST, tool: "consult_fast", reason: "Quick question → fast model" };
  }
  // Default → specialist
  return { model: SPECIALIST, tool: "consult_specialist", reason: "General query → specialist" };
}

function matches(text, keywords) {
  return keywords.some(kw => text.includes(kw));
}

await loadHistory();
await loadVoiceAssignments();
lastSize = existsSync(LOG_PATH) ? (await stat(LOG_PATH)).size : 0;
watchLog();

// === Edge Neural TTS Engine (server-side, can set headers) ===
const TRUSTED_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const SEC_MS_GEC_VERSION = '1-132.0.2957.140';

function computeSecMsGec() {
  const ticks = (BigInt(Math.floor(Date.now() / 1000)) + 11644473600n) * 10000000n;
  const rounded = ticks - (ticks % 3000000000n);
  return createHash('sha256')
    .update(`${rounded.toString()}${TRUSTED_TOKEN}`)
    .digest('hex')
    .toUpperCase();
}

async function edgeTtsGenerate(text, voice) {
  const { default: WebSocket } = await import('ws');

  const connId = randomUUID().replace(/-/g, '');
  const gec = computeSecMsGec();
  const wsUrl = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_TOKEN}&Sec-MS-GEC=${gec}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}&ConnectionId=${connId}`;

  return new Promise((resolve) => {
    const audioChunks = [];
    const timeout = setTimeout(() => { ws.close(); resolve(Buffer.alloc(0)); }, 15000);

    const ws = new WebSocket(wsUrl, {
      headers: {
        'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
        'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.2957.140 Safari/537.36 Edg/132.0.2957.140`,
        'Pragma': 'no-cache',
        'Cache-Control': 'no-cache',
        'Accept-Encoding': 'gzip, deflate, br',
      },
    });

    ws.on('open', () => {
      // Config message
      ws.send(`Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}`);

      // SSML
      const escaped = text.replace(/[<>&'"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;',"'":"&apos;",'"':'&quot;'}[c]));
      const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice name='${voice}'><prosody rate='+5%' pitch='+0Hz'>${escaped}</prosody></voice></speak>`;
      const reqId = randomUUID().replace(/-/g, '');
      ws.send(`X-RequestId:${reqId}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n${ssml}`);
    });

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        // Binary frame: [uint16BE headerLen][headerBytes][audioBytes]
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        if (buf.length < 2) return;
        const headerLen = buf.readUInt16BE(0);
        if (buf.length < 2 + headerLen) return;
        const audio = buf.subarray(2 + headerLen);
        if (audio.length > 0) {
          audioChunks.push(audio);
        }
      } else {
        // Text frame: check for turn.end
        const str = data.toString();
        if (str.includes('Path:turn.end')) {
          clearTimeout(timeout);
          ws.close();
          resolve(Buffer.concat(audioChunks));
        }
      }
    });

    ws.on('error', (e) => { clearTimeout(timeout); resolve(Buffer.alloc(0)); });
    ws.on('close', () => { clearTimeout(timeout); resolve(Buffer.concat(audioChunks)); });
  });
}

server.listen(PORT, () => {
  console.log(`⚔️  Battle Log Dashboard: http://localhost:${PORT}`);
  console.log(`📡 SSE stream: http://localhost:${PORT}/events`);
  console.log(`📜 History: http://localhost:${PORT}/history`);
});
