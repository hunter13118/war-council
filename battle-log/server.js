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
import { readFile, readdir, stat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = parseInt(process.argv.find((a, i) => process.argv[i - 1] === "--port") || "3737", 10);
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const LOG_PATH = resolve(REPO_ROOT, ".cline-context", "battle-log.jsonl");

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

  // Tournament leaderboard
  if (url.pathname === "/leaderboard") {
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(JSON.stringify(tournamentRecords));
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
      // Persist to JSONL so events survive restarts
      try {
        const { appendFile: af } = await import("node:fs/promises");
        await af(LOG_PATH, JSON.stringify(event) + "\n");
        lastSize = (await stat(LOG_PATH)).size; // Update cursor to avoid re-reading
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
