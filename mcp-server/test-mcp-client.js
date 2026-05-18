/**
 * Standalone MCP client — proves the war-council server speaks proper
 * MCP protocol. Bypasses Cline entirely.
 *
 * Spawns server.js as subprocess, talks to it via stdio JSON-RPC,
 * lists tools, calls list_arsenal, reports result.
 *
 * Usage: node test-mcp-client.js
 */

import { spawn } from "child_process";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function send(proc, msg) {
  proc.stdin.write(JSON.stringify(msg) + "\n");
}

async function main() {
  console.log("=== MCP standalone client test ===\n");

  const serverPath = path.join(__dirname, "server.js");
  console.log(`Spawning: node ${serverPath}\n`);

  const proc = spawn("node", [serverPath], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, OLLAMA_BASE: "http://127.0.0.1:11434" },
  });

  let buffer = "";
  const responses = [];

  proc.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    // Try to parse JSON objects from buffer (server may not newline-terminate)
    while (buffer.trim().length > 0) {
      const trimmed = buffer.trimStart();
      if (!trimmed.startsWith("{")) {
        // skip non-json prefix
        const next = trimmed.indexOf("{");
        if (next < 0) break;
        buffer = trimmed.slice(next);
        continue;
      }
      // Find balanced closing brace
      let depth = 0, inStr = false, esc = false, end = -1;
      for (let i = 0; i < trimmed.length; i++) {
        const c = trimmed[i];
        if (esc) { esc = false; continue; }
        if (c === "\\") { esc = true; continue; }
        if (c === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (c === "{") depth++;
        else if (c === "}") {
          depth--;
          if (depth === 0) { end = i + 1; break; }
        }
      }
      if (end < 0) break; // incomplete
      const obj = trimmed.slice(0, end);
      buffer = trimmed.slice(end);
      try {
        responses.push(JSON.parse(obj));
      } catch (e) {
        console.log("[parse fail]", obj.slice(0, 100));
      }
    }
  });

  proc.stderr.on("data", (chunk) => {
    process.stderr.write(`[server stderr] ${chunk}`);
  });

  proc.on("exit", (code) => {
    console.log(`\nServer exited with code ${code}`);
  });

  // Wait briefly for server boot
  await new Promise((r) => setTimeout(r, 500));

  // 1. Initialize handshake
  console.log("[1] Sending initialize...");
  send(proc, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test-client", version: "0.1.0" },
    },
  });
  await new Promise((r) => setTimeout(r, 800));

  send(proc, {
    jsonrpc: "2.0",
    method: "notifications/initialized",
    params: {},
  });
  await new Promise((r) => setTimeout(r, 200));

  // 2. List tools
  console.log("[2] Sending tools/list...");
  send(proc, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  await new Promise((r) => setTimeout(r, 500));

  // 3. Call list_arsenal
  console.log("[3] Calling list_arsenal tool...");
  send(proc, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "list_arsenal", arguments: {} },
  });
  await new Promise((r) => setTimeout(r, 2000));

  // 4. Call request_user_feedback (no network/disk needed - pure formatting)
  console.log("[4] Calling request_user_feedback tool...");
  send(proc, {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: {
      name: "request_user_feedback",
      arguments: {
        summary: "Test summary for validation",
        test_results: "Jest 100/100, Python 50/50, Playwright 20/20",
        question: "Does this validation block look correct?",
      },
    },
  });
  await new Promise((r) => setTimeout(r, 500));

  // 5. Call invoke_agent with Hypeman (small persona, fast model)
  console.log("[5] Calling invoke_agent (Hypeman, fast)...");
  send(proc, {
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: {
      name: "invoke_agent",
      arguments: {
        agent_name: "Hypeman",
        task: "In one short sentence, hype up the user for completing a refactor.",
        tier: "fast",
        maxTokens: 200,
      },
    },
  });
  await new Promise((r) => setTimeout(r, 8000));

  // 6. Call memory_stats
  console.log("[6] Calling memory_stats...");
  send(proc, {
    jsonrpc: "2.0",
    id: 6,
    method: "tools/call",
    params: { name: "memory_stats", arguments: {} },
  });
  await new Promise((r) => setTimeout(r, 1500));

  // 7. Call memory_query (cold)
  console.log("[7] Calling memory_query (cold path)...");
  send(proc, {
    jsonrpc: "2.0",
    id: 7,
    method: "tools/call",
    params: {
      name: "memory_query",
      arguments: {
        query: "How does the audio worker handle GPU model loading?",
        k: 3,
      },
    },
  });
  await new Promise((r) => setTimeout(r, 3000));

  // 8. Call memory_query AGAIN (warm — should be much faster)
  console.log("[8] Calling memory_query (warm path — store cached)...");
  send(proc, {
    jsonrpc: "2.0",
    id: 8,
    method: "tools/call",
    params: {
      name: "memory_query",
      arguments: {
        query: "What is the React 7-step wizard flow?",
        k: 3,
      },
    },
  });
  await new Promise((r) => setTimeout(r, 3000));

  // 9. Phase 3: memory_recall_conversation
  console.log("[9] Calling memory_recall_conversation (Phase 3)...");
  send(proc, {
    jsonrpc: "2.0",
    id: 9,
    method: "tools/call",
    params: {
      name: "memory_recall_conversation",
      arguments: {
        query: "Sprint 6 cleanup feedback gate",
        k: 3,
      },
    },
  });
  await new Promise((r) => setTimeout(r, 2000));

  // 10. Phase 3: memory_query with source=code (filter excludes conversations)
  console.log("[10] Calling memory_query with source='code'...");
  send(proc, {
    jsonrpc: "2.0",
    id: 10,
    method: "tools/call",
    params: {
      name: "memory_query",
      arguments: {
        query: "audio worker XTTS GPU",
        k: 3,
        source: "code",
      },
    },
  });
  await new Promise((r) => setTimeout(r, 2000));

  // 11. Phase 3: log_decision
  console.log("[11] Calling log_decision...");
  send(proc, {
    jsonrpc: "2.0",
    id: 11,
    method: "tools/call",
    params: {
      name: "log_decision",
      arguments: {
        title: "MCP Phase 3 validation test entry",
        rationale: "Test that log_decision appends to decisions.jsonl correctly.",
        alternatives_rejected: "Skipping the test (rejected — TDD requires validation).",
        related_files: ["tools/war-council/server.js", "tools/war-council/test-mcp-client.js"],
      },
    },
  });
  await new Promise((r) => setTimeout(r, 1000));

  // 12. Phase 4: visual_consult on a real Playwright screenshot
  console.log("[12] Calling visual_consult (qwen2.5vl:7b on regen-review screenshot)...");
  const screenshotPath = path.resolve(
    __dirname,
    "..",
    "..",
    "milkman-portfolio",
    "e2e",
    "screenshots",
    "regen-review-audit",
    "01-modal-open-fullpage.png",
  );
  send(proc, {
    jsonrpc: "2.0",
    id: 12,
    method: "tools/call",
    params: {
      name: "visual_consult",
      arguments: {
        image_path: screenshotPath,
        question:
          "Describe this UI screenshot in 2 sentences. List any speaker names and button labels visible.",
        max_tokens: 300,
      },
    },
  });
  // Vision can be slow on cold load — give it 45s
  await new Promise((r) => setTimeout(r, 45000));

  // Report
  console.log("\n=== RESPONSES ===");
  for (const r of responses) {
    if (r.id === 1) {
      console.log(`[init] OK — server: ${r.result?.serverInfo?.name} v${r.result?.serverInfo?.version}`);
    } else if (r.id === 2) {
      const toolNames = (r.result?.tools ?? []).map((t) => t.name);
      console.log(`[tools/list] OK — ${toolNames.length} tools: ${toolNames.join(", ")}`);
    } else if (r.id === 3) {
      const text = r.result?.content?.[0]?.text ?? "(no text)";
      console.log(`[list_arsenal] OK — first 200 chars:\n  ${text.slice(0, 200).replace(/\n/g, "\n  ")}`);
    } else if (r.id === 4) {
      const text = r.result?.content?.[0]?.text ?? "(no text)";
      const ok = text.includes("USER FEEDBACK GATE") && text.includes("Test summary");
      console.log(`[request_user_feedback] ${ok ? "OK" : "FAIL"} — formatted block returned`);
    } else if (r.id === 5) {
      const text = r.result?.content?.[0]?.text ?? "(no text)";
      const ok = !r.result?.isError && text.length > 50;
      console.log(`[invoke_agent Hypeman] ${ok ? "OK" : "FAIL"} — response preview:\n  ${text.slice(0, 300).replace(/\n/g, "\n  ")}`);
    } else if (r.id === 6) {
      const text = r.result?.content?.[0]?.text ?? "(no text)";
      const ok = text.includes("totalChunks") && text.includes("768");
      console.log(`[memory_stats] ${ok ? "OK" : "FAIL"} — preview:\n  ${text.slice(0, 300).replace(/\n/g, "\n  ")}`);
    } else if (r.id === 7) {
      const text = r.result?.content?.[0]?.text ?? "(no text)";
      const m = text.match(/MEMORY_QUERY \((\d+)ms total/);
      const ms = m ? parseInt(m[1]) : -1;
      const ok = !r.result?.isError && text.includes("Relevant: true");
      console.log(`[memory_query cold] ${ok ? "OK" : "FAIL"} — ${ms}ms total`);
    } else if (r.id === 8) {
      const text = r.result?.content?.[0]?.text ?? "(no text)";
      const m = text.match(/MEMORY_QUERY \((\d+)ms total/);
      const ms = m ? parseInt(m[1]) : -1;
      const ok = !r.result?.isError && text.includes("Relevant: true") && ms < 300;
      console.log(`[memory_query warm] ${ok ? "OK" : "FAIL"} — ${ms}ms total (target <300ms)`);
    } else if (r.id === 9) {
      const text = r.result?.content?.[0]?.text ?? "(no text)";
      const ok = !r.result?.isError && (text.includes("conv://") || text.includes("Past conversation chunks"));
      console.log(`[memory_recall_conversation] ${ok ? "OK" : "FAIL"} — preview:\n  ${text.slice(0, 250).replace(/\n/g, "\n  ")}`);
    } else if (r.id === 10) {
      const text = r.result?.content?.[0]?.text ?? "(no text)";
      // source=code should NOT return any conv:// paths
      const hasConv = text.includes("conv://");
      const ok = !r.result?.isError && !hasConv && text.includes("Source filter: code");
      console.log(`[memory_query source=code] ${ok ? "OK" : "FAIL"} — filter excluded conversations: ${!hasConv}`);
    } else if (r.id === 11) {
      const text = r.result?.content?.[0]?.text ?? "(no text)";
      const ok = !r.result?.isError && text.includes("DECISION LOGGED") && text.includes("decisions.jsonl");
      console.log(`[log_decision] ${ok ? "OK" : "FAIL"} — entry written to decisions.jsonl`);
    } else if (r.id === 12) {
      const text = r.result?.content?.[0]?.text ?? "(no text)";
      const m = text.match(/in (\d+)ms/);
      const ms = m ? parseInt(m[1]) : -1;
      // Validate the model actually saw the image: should mention buttons OR speakers OR waveform
      const sawUI = /button|select|done|narrator|alice|waveform|clip|audio/i.test(text);
      const ok = !r.result?.isError && sawUI;
      console.log(`[visual_consult] ${ok ? "OK" : "FAIL"} — ${ms}ms, image understood: ${sawUI}`);
      console.log(`  preview: ${text.slice(0, 250).replace(/\n/g, "\n  ")}`);
    } else {
      console.log("[other]", JSON.stringify(r));
    }
  }

  console.log("\n=== Test complete ===");
  proc.kill();
  process.exit(0);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
