#!/usr/bin/env node
/**
 * war-council MCP server
 * Exposes model-delegation + agentic tools for a local Ollama Conductor pattern.
 *
 * The Conductor model (typically qwen2.5-coder:14b or 32b) calls these tools
 * to delegate sub-tasks to smaller / specialized / parallel models without
 * the user ever switching the active model in the UI.
 *
 * Delegation tools:
 *   consult_fast        - delegate to qwen2.5-coder:7b (fast, ~200 tok/s)
 *   consult_specialist  - delegate to qwen2.5-coder:14b (balanced)
 *   consult_reasoning   - delegate to deepseek-r1:14b (chain-of-thought)
 *   tournament_vote     - fan out same prompt to N models in parallel
 *   list_arsenal        - return list of currently-pulled local models
 *
 * Agentic / workflow tools:
 *   invoke_agent          - run any .github/agents/<name>.agent.md as a worker
 *   prewarm_loadout       - load specified models into VRAM proactively
 *   request_user_feedback - format a feedback question for the Conductor to present
 *   review_diff           - pipe `git diff` through the reasoning model for review
 *   run_tests             - execute Jest / Python / Playwright suite, return summary
 *
 * Transport: stdio (Cline / Claude Desktop spec compliant).
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { retrieve } from "../memory-engine/retriever.js";
import { indexRepo } from "../memory-engine/indexer.js";
import { indexConversations } from "../memory-engine/conversation-indexer.js";
import { VectorStore } from "../memory-engine/store.js";
import { appendFile } from "node:fs/promises";
import { CHAINS, executeChain } from "./task-chains.js";
import { routeTask } from "./decision-router.js";
import { deliberate, debate, buildConsensus, readScratchpad, appendScratchpad } from "./council-deliberation.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load centralized arsenal config
const arsenalPath = resolve(__dirname, "..", "arsenal.json");
const arsenalConfig = JSON.parse(readFileSync(arsenalPath, "utf-8"));

const OLLAMA_BASE = process.env.OLLAMA_BASE || arsenalConfig.defaults.ollama_base;
const OLLAMA_CONTEXT_LENGTH = parseInt(process.env.OLLAMA_CONTEXT_LENGTH || "32768", 10);
const OLLAMA_KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE || "30m";
const REPO_ROOT =
  process.env.REPO_ROOT || resolve(__dirname, "..", "..");
const BATTLE_LOG_PATH = resolve(REPO_ROOT, ".cline-context", "battle-log.jsonl");

// ===== Battle Log Event System =====
// Every tool call emits an event to the battle log for the dashboard to consume.
const battleLogListeners = new Set(); // SSE listeners (res objects)

async function emitBattleEvent(event) {
  const entry = {
    ...event,
    timestamp: new Date().toISOString(),
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  };
  // Write to JSONL file
  try {
    await appendFile(BATTLE_LOG_PATH, JSON.stringify(entry) + "\n");
  } catch {}
  // Push to SSE listeners
  const data = `data: ${JSON.stringify(entry)}\n\n`;
  for (const listener of battleLogListeners) {
    try { listener.write(data); } catch { battleLogListeners.delete(listener); }
  }
}

// Export for dashboard server to import
export { battleLogListeners, BATTLE_LOG_PATH };

/**
 * Retry wrapper with exponential backoff.
 * Retries up to `maxRetries` times on failure. Logs each attempt.
 * @param {Function} fn - async function to retry
 * @param {object} opts - { maxRetries: 3, baseDelayMs: 1000, label: "operation" }
 */
async function withRetry(fn, opts = {}) {
  const { maxRetries = 3, baseDelayMs = 1000, label = "operation" } = opts;
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        process.stderr.write(
          `[war-council] ${label} attempt ${attempt}/${maxRetries} failed: ${err.message}. Retrying in ${delay}ms...\n`
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw new Error(
    `${label} failed after ${maxRetries} attempts. Last error: ${lastError.message}`
  );
}
const MEMORY_STORE_PATH =
  process.env.MEMORY_STORE_PATH ||
  resolve(__dirname, "..", "memory-engine", "store.json");

const MEMORY_EMBED_MODEL =
  process.env.MEMORY_EMBED_MODEL || arsenalConfig.models.embed.name;

// Cloud API config — free tiers
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || arsenalConfig.cloud.gemini.name;
const GROQ_MODEL = process.env.GROQ_MODEL || arsenalConfig.cloud.groq.name;

// Model roster — loaded from arsenal.json, overridable via env vars.
const ARSENAL = {
  fast: process.env.MODEL_FAST || arsenalConfig.models.fast.name,
  specialist: process.env.MODEL_SPECIALIST || arsenalConfig.models.specialist.name,
  reasoning: process.env.MODEL_REASONING || arsenalConfig.models.reasoning.name,
  heavy: process.env.MODEL_HEAVY || arsenalConfig.models.heavy.name,
};

/**
 * Hit the Ollama generate endpoint with a prompt, return the text response.
 * Non-streaming for simplicity — MCP tool result is a single payload.
 */
async function ollamaGenerate(model, prompt, options = {}) {
  const t0 = Date.now();
  const body = {
    model,
    prompt,
    stream: false,
    keep_alive: options.keepAlive ?? OLLAMA_KEEP_ALIVE,
    options: {
      temperature: options.temperature ?? 0.2,
      num_predict: options.maxTokens ?? 2048,
      num_ctx: options.contextLength ?? OLLAMA_CONTEXT_LENGTH,
    },
  };

  const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  const elapsedMs = Date.now() - t0;
  const tps =
    data.eval_count && data.eval_duration
      ? Math.round((data.eval_count / data.eval_duration) * 1e9)
      : null;

  return {
    text: data.response || "",
    thinking: data.thinking || "",
    // For reasoning models, combine thinking + response for pattern matching
    fullText: ((data.thinking || "") + "\n" + (data.response || "")).trim(),
    model,
    elapsedMs,
    tokensIn: data.prompt_eval_count ?? null,
    tokensOut: data.eval_count ?? null,
    tokensPerSec: tps,
  };
}

/**
 * Resilient Ollama generate — wraps ollamaGenerate with retry logic.
 */
async function ollamaGenerateWithRetry(model, prompt, options = {}) {
  return withRetry(() => ollamaGenerate(model, prompt, options), {
    maxRetries: 3,
    baseDelayMs: 2000,
    label: `ollama/${model}`,
  });
}

/**
 * Load a model into VRAM without generating output. Ollama's /api/generate
 * with empty prompt + keep_alive triggers a load-only path.
 */
async function ollamaLoad(model, keepAlive = "30m") {
  const t0 = Date.now();
  const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, keep_alive: keepAlive }),
  });
  if (!res.ok) {
    throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);
  }
  await res.json();
  return { model, elapsedMs: Date.now() - t0 };
}

async function listLocalModels() {
  const res = await fetch(`${OLLAMA_BASE}/api/tags`);
  if (!res.ok) throw new Error(`Ollama tags HTTP ${res.status}`);
  const data = await res.json();
  return (data.models ?? []).map((m) => ({
    name: m.name,
    sizeMB: Math.round(m.size / (1024 * 1024)),
    modified: m.modified_at,
  }));
}

// ===== Cloud API functions (free tiers) =====

/**
 * Call Google Gemini API (free tier: 15 RPM, 1500 req/day, 1M context).
 */
async function geminiGenerate(prompt, options = {}) {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not set. Get one free at https://aistudio.google.com/apikey");
  const t0 = Date.now();
  const model = options.model ?? GEMINI_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      maxOutputTokens: options.maxTokens ?? 8192,
      temperature: options.temperature ?? 0.3,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini HTTP ${res.status}: ${errText}`);
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const usage = data.usageMetadata ?? {};

  return {
    text,
    model,
    provider: "gemini",
    elapsedMs: Date.now() - t0,
    tokensIn: usage.promptTokenCount ?? null,
    tokensOut: usage.candidatesTokenCount ?? null,
  };
}

/**
 * Call Groq API (free tier: 30 RPM, 14400 req/day, Llama 3.3 70B).
 */
async function groqGenerate(prompt, options = {}) {
  if (!GROQ_API_KEY) throw new Error("GROQ_API_KEY not set. Get one free at https://console.groq.com/keys");
  const t0 = Date.now();
  const model = options.model ?? GROQ_MODEL;

  const body = {
    model,
    messages: [{ role: "user", content: prompt }],
    max_tokens: options.maxTokens ?? 8192,
    temperature: options.temperature ?? 0.3,
  };

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Groq HTTP ${res.status}: ${errText}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content ?? "";
  const usage = data.usage ?? {};

  return {
    text,
    model,
    provider: "groq",
    elapsedMs: Date.now() - t0,
    tokensIn: usage.prompt_tokens ?? null,
    tokensOut: usage.completion_tokens ?? null,
  };
}

/**
 * Strategic Planning — sends task + massive context to Gemini (1M window).
 * Gemini acts as a "war room" sub-conductor: analyzes the full picture,
 * returns a structured plan the local 32b can execute step-by-step.
 */
async function strategicPlan(task, codeContext, options = {}) {
  const systemPrompt = `You are a senior software architect acting as a strategic planner.
You receive a task description and relevant code context from a codebase.
Your job is to produce a STRUCTURED EXECUTION PLAN that a coding AI can follow step-by-step.

Rules:
- Break complex tasks into 3-7 atomic steps
- Each step must be specific and verifiable (not vague)
- Include file paths and line numbers when relevant
- Flag risks, edge cases, and dependencies between steps
- If you see bugs or issues in the provided code, note them
- Output format: numbered steps with brief rationale

Do NOT write code. Write the PLAN to write code.`;

  const fullPrompt = `${systemPrompt}\n\n## TASK\n${task}\n\n## CODE CONTEXT\n${codeContext}`;
  return withRetry(
    () => geminiGenerate(fullPrompt, { maxTokens: options.maxTokens ?? 4096, temperature: 0.2 }),
    { maxRetries: 2, baseDelayMs: 3000, label: "strategic_plan/gemini" }
  );
}

/**
 * Rapid Fan-Out — sends multiple prompts to Groq in parallel.
 * Each prompt gets its own fresh context. Results aggregated.
 * Use for: batch code review, multi-file analysis, parallel opinions.
 */
async function rapidFanOut(prompts, options = {}) {
  const t0 = Date.now();
  const results = await Promise.all(
    prompts.map((prompt) =>
      withRetry(() => groqGenerate(prompt, { maxTokens: options.maxTokens ?? 2048 }), {
        maxRetries: 2,
        baseDelayMs: 1500,
        label: "rapid_fan_out/groq",
      })
    )
  );
  return {
    results,
    totalElapsedMs: Date.now() - t0,
    count: results.length,
  };
}

/**
 * Send an image + prompt to a vision model via Ollama's chat endpoint.
 * The `images` field on a chat message accepts base64-encoded image bytes.
 * Tested on qwen2.5vl, llava, minicpm-v, llama3.2-vision, gemma3.
 */
async function ollamaVisualize(model, imagePath, question, options = {}) {
  const t0 = Date.now();
  const bytes = await readFile(imagePath);
  const b64 = bytes.toString("base64");
  const body = {
    model,
    stream: false,
    keep_alive: options.keepAlive ?? "30m",
    messages: [
      {
        role: "user",
        content: question,
        images: [b64],
      },
    ],
    options: {
      temperature: options.temperature ?? 0.2,
      num_predict: options.maxTokens ?? 1024,
    },
  };
  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Ollama vision HTTP ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  const elapsedMs = Date.now() - t0;
  const tps =
    data.eval_count && data.eval_duration
      ? Math.round((data.eval_count / data.eval_duration) * 1e9)
      : null;
  return {
    text: data.message?.content ?? "",
    model,
    elapsedMs,
    imageBytes: bytes.length,
    tokensIn: data.prompt_eval_count ?? null,
    tokensOut: data.eval_count ?? null,
    tokensPerSec: tps,
  };
}

function formatConsultResult(label, result) {
  return [
    `=== ${label} ${result.model} ===`,
    `(${result.tokensOut ?? "?"} tokens in ${result.elapsedMs}ms${
      result.tokensPerSec ? `, ${result.tokensPerSec} tok/s` : ""
    })`,
    "",
    result.text.trim(),
  ].join("\n");
}

/**
 * Run a shell command, capture stdout+stderr+exit code.
 * No shell interpolation — args passed safely.
 */
function runCommand(command, args, cwd, timeoutMs = 600_000) {
  return new Promise((resolvePromise) => {
    const t0 = Date.now();
    const child = spawn(command, args, {
      cwd,
      shell: process.platform === "win32",
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill();
    }, timeoutMs);

    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({
        exitCode: code,
        stdout,
        stderr,
        elapsedMs: Date.now() - t0,
        timedOut: killed,
      });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolvePromise({
        exitCode: -1,
        stdout,
        stderr: stderr + `\n[spawn error] ${err.message}`,
        elapsedMs: Date.now() - t0,
        timedOut: false,
      });
    });
  });
}

const server = new Server(
  { name: "war-council", version: "0.5.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    // ===== Delegation tools =====
    {
      name: "consult_fast",
      description:
        "Delegate to fast worker (qwen2.5-coder:7b, ~200 tok/s). " +
        "Use for: simple lookups, short summaries, well-defined transforms. " +
        "NOT for complex reasoning or large refactors.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description:
              "Self-contained prompt. Include all context (worker has no memory of conversation).",
          },
          maxTokens: {
            type: "number",
            description: "Max output tokens (default 2048).",
          },
        },
        required: ["prompt"],
      },
    },
    {
      name: "consult_specialist",
      description:
        "Delegate to balanced specialist (qwen2.5-coder:14b). " +
        "Use for: code generation, refactors, mid-difficulty design questions.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Self-contained prompt." },
          maxTokens: { type: "number" },
        },
        required: ["prompt"],
      },
    },
    {
      name: "consult_reasoning",
      description:
        "Delegate to reasoning specialist (deepseek-r1:14b). Returns chain-of-thought. " +
        "Use for: tricky bugs, architectural decisions, debugging.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Self-contained prompt." },
          maxTokens: { type: "number" },
        },
        required: ["prompt"],
      },
    },
    {
      name: "tournament_vote",
      description:
        "Fan out SAME prompt to multiple models in parallel, return all responses. " +
        "Use for diverse perspectives before deciding architectural questions. " +
        "You (Conductor) synthesize the verdict.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "The question to vote on." },
          voters: {
            type: "array",
            items: {
              type: "string",
              enum: ["fast", "specialist", "reasoning"],
            },
            description: "Default: ['specialist','reasoning']. Run in parallel.",
          },
        },
        required: ["prompt"],
      },
    },
    {
      name: "list_arsenal",
      description:
        "List local Ollama models with sizes. Useful to know what tools you actually have available.",
      inputSchema: { type: "object", properties: {} },
    },

    // ===== Agentic / workflow tools =====
    {
      name: "invoke_agent",
      description:
        "Load a persona definition from .github/agents/<name>.agent.md and run it on a worker model. " +
        "This unlocks the whole sub-agent roster (Hypeman, FlaskAlchemist, ReactSurgeon, " +
        "BookNLPOracle, AudioEngineer, VoiceWrangler, E2EPlaywright, TestRunner, DeployOps, " +
        "CodeReviewer, CommitShipper, VisualAuditor, UXCritic, RepoScout, QualityGatekeeper, " +
        "Conductor, ProxyWarden) without porting any of them. Returns the agent's response.",
      inputSchema: {
        type: "object",
        properties: {
          agent_name: {
            type: "string",
            description:
              "Name of the agent file (without .agent.md extension). Examples: 'FlaskAlchemist', 'CodeReviewer', 'Hypeman'.",
          },
          task: {
            type: "string",
            description:
              "The specific task/question for this agent. Will be appended to the agent persona as the user request.",
          },
          tier: {
            type: "string",
            enum: ["fast", "specialist", "reasoning", "heavy"],
            description:
              "Which model tier runs this agent. Default 'specialist'. Use 'reasoning' for debugging-heavy agents, 'heavy' (32b) for architecture, 'fast' for simple agents.",
          },
          maxTokens: { type: "number", description: "Default 4096." },
        },
        required: ["agent_name", "task"],
      },
    },
    {
      name: "prewarm_loadout",
      description:
        "Pre-load specified models into VRAM with 30min keep-alive. " +
        "Use at session start to avoid cold-load latency on first call. " +
        "Total VRAM budget on 32GB card: 32b=20GB, 14b=10GB, 7b=5GB, 1.5b=1GB. " +
        "Common loadouts: ['specialist','fast'] = ~15GB, ['heavy','fast'] = ~25GB.",
      inputSchema: {
        type: "object",
        properties: {
          models: {
            type: "array",
            items: { type: "string" },
            description:
              "Arsenal keys ('fast','specialist','reasoning','heavy') or raw model names. Each loaded sequentially.",
          },
          keepAlive: {
            type: "string",
            description: "Ollama keep-alive duration. Default '30m'.",
          },
        },
        required: ["models"],
      },
    },
    {
      name: "request_user_feedback",
      description:
        "Format a structured feedback request to present to the user before declaring task done. " +
        "Use this at the END of substantive work to enforce the feedback gate from .clinerules. " +
        "Returns a markdown-formatted block; YOU then display this to the user and WAIT for their reply.",
      inputSchema: {
        type: "object",
        properties: {
          summary: {
            type: "string",
            description: "1-2 sentence summary of what was done.",
          },
          test_results: {
            type: "string",
            description:
              "Test suite results (Jest/Python/Playwright counts and pass/fail). Empty string if N/A.",
          },
          question: {
            type: "string",
            description:
              "Specific freeform question for the user. Default: 'Is the work acceptable? Adjustments needed, or are we good?'",
          },
        },
        required: ["summary"],
      },
    },
    {
      name: "review_diff",
      description:
        "Run `git diff` and pipe the result through the reasoning model for code review. " +
        "Use before committing. Returns the model's review of changes (security, bugs, style).",
      inputSchema: {
        type: "object",
        properties: {
          staged: {
            type: "boolean",
            description:
              "If true, review staged changes (`git diff --cached`). Else unstaged (`git diff`). Default false.",
          },
          tier: {
            type: "string",
            enum: ["specialist", "reasoning", "heavy"],
            description: "Reviewer model tier. Default 'reasoning'.",
          },
        },
      },
    },
    {
      name: "run_tests",
      description:
        "Execute a test suite via npm and return structured output. " +
        "Suites: jest (React unit), python (backend unittest), e2e (Playwright), all (everything). " +
        "Use before claiming work is done — enforces .clinerules HARD GATE.",
      inputSchema: {
        type: "object",
        properties: {
          suite: {
            type: "string",
            enum: ["jest", "python", "e2e", "all"],
            description: "Which suite to run.",
          },
          timeout_ms: {
            type: "number",
            description: "Max ms before kill. Default 600000 (10min).",
          },
        },
        required: ["suite"],
      },
    },

    // ===== Sovereign Memory tools (local RAG) =====
    {
      name: "memory_query",
      description:
        "Retrieve top-K most relevant code/doc chunks from the local Sovereign Memory vector store. " +
        "Returns an augmented prompt ready to ground a worker model in actual project context. " +
        "USE THIS as the FIRST step for any question about the codebase — it escapes the small " +
        "context windows of local models by surfacing only the relevant slice. " +
        "Backed by Ollama nomic-embed-text + cosine search. Sub-300ms target.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Natural-language question/topic to retrieve context for.",
          },
          k: {
            type: "number",
            description: "Number of chunks to return. Default 5.",
          },
          min_relevance: {
            type: "number",
            description:
              "Minimum cosine score (0-1) to include a chunk. Default 0.30. Below threshold means 'not relevant'.",
          },
          source: {
            type: "string",
            enum: ["code", "conversation", "all"],
            description:
              "Filter by chunk source. 'code' = repo files. 'conversation' = past Copilot/Cline transcripts. 'all' = both. Default 'all'.",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "memory_recall_conversation",
      description:
        "Retrieve relevant chunks from past Copilot/Cline conversation history. " +
        "Use when user asks 'what did we decide about X?' or 'remember when we worked on Y?'. " +
        "Convenience wrapper for memory_query with source='conversation'.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "What past discussion to recall." },
          k: { type: "number", description: "Default 5." },
        },
        required: ["query"],
      },
    },
    {
      name: "memory_index",
      description:
        "Re-index the repository CODE into the Sovereign Memory vector store. " +
        "Walks files via `git ls-files`, chunks with recursive char split (500/50), " +
        "embeds via Ollama, persists to JSON. Idempotent — safe to re-run after edits.",
      inputSchema: {
        type: "object",
        properties: {
          root: {
            type: "string",
            description: "Directory to index. Default: REPO_ROOT.",
          },
          chunk_size: { type: "number", description: "Default 500." },
          chunk_overlap: { type: "number", description: "Default 50." },
          embed_model: {
            type: "string",
            description: "Default 'nomic-embed-text'.",
          },
        },
      },
    },
    {
      name: "memory_index_conversations",
      description:
        "Index past Copilot transcripts and Cline tasks into the Sovereign Memory store " +
        "so the model has recall across previous sessions. Synthetic file paths " +
        "`conv://copilot/<id>` and `conv://cline/<id>` keep them queryable but distinct.",
      inputSchema: {
        type: "object",
        properties: {
          days_back: {
            type: "number",
            description: "Only index conversations modified within this window. Default 30.",
          },
          chunk_size: { type: "number", description: "Default 800 (turn-aware)." },
          chunk_overlap: { type: "number", description: "Default 80." },
        },
      },
    },
    {
      name: "memory_stats",
      description:
        "Report on the Sovereign Memory vector store health: total chunks, unique files, " +
        "embedding model + dimension, store size on disk. Use to verify the index is populated " +
        "and consistent before trusting `memory_query`.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "log_decision",
      description:
        "Append a structured decision entry to decisions.jsonl at repo root. " +
        "Use at the END of substantive work to record what was decided, why, and what alternatives were rejected. " +
        "These entries are eligible for indexing into Sovereign Memory so future sessions remember.",
      inputSchema: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "1-line decision title (e.g. 'Use JSON cosine store instead of Chroma').",
          },
          rationale: {
            type: "string",
            description: "Why this choice, including data/measurements that support it.",
          },
          alternatives_rejected: {
            type: "string",
            description: "Other options considered and why they were rejected.",
          },
          related_files: {
            type: "array",
            items: { type: "string" },
            description: "Files affected by this decision.",
          },
        },
        required: ["title", "rationale"],
      },
    },
    {
      name: "visual_consult",
      description:
        "Pass an image (file path on disk) + a question to a local vision-language model. " +
        "Use for UI screenshot analysis, layout debugging, design audits, error-screenshot triage, " +
        "diagram interpretation. Models like qwen2.5vl:7b are excellent for code/UI imagery; " +
        "minicpm-v:8b is strong on OCR and document understanding. Defaults to qwen2.5vl:7b.",
      inputSchema: {
        type: "object",
        properties: {
          image_path: {
            type: "string",
            description: "Absolute path to a PNG/JPG/WEBP image file on disk.",
          },
          question: {
            type: "string",
            description:
              "What to analyze. Be specific (e.g. 'identify any layout overflow on mobile breakpoint').",
          },
          model: {
            type: "string",
            description:
              "Vision model to use. Default 'qwen2.5vl:7b'. Alternatives: minicpm-v:8b (OCR), llama3.2-vision:11b, llava-llama3:8b.",
          },
          max_tokens: {
            type: "number",
            description: "Default 1024.",
          },
        },
        required: ["image_path", "question"],
      },
    },

    // ===== Cloud delegation tools (free tiers) =====
    {
      name: "consult_cloud",
      description:
        "Delegate to a FREE cloud model for tasks needing large context or superior reasoning. " +
        "Providers: 'gemini' (Google, 1M context, 15 RPM free), 'groq' (Llama 70B, 500+ tok/s, 30 RPM free). " +
        "Use when: you need to analyze large amounts of code at once, need reasoning beyond local model capability, " +
        "or need a fast second opinion. The cloud model has NO memory of this conversation — " +
        "include ALL necessary context in the prompt.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "Self-contained prompt with all context. Cloud model has no conversation memory.",
          },
          provider: {
            type: "string",
            enum: ["gemini", "groq"],
            description: "Which cloud provider. 'gemini' for huge context/complex reasoning, 'groq' for speed.",
          },
          maxTokens: {
            type: "number",
            description: "Max output tokens. Default 8192.",
          },
          temperature: {
            type: "number",
            description: "Temperature 0-1. Default 0.3.",
          },
        },
        required: ["prompt", "provider"],
      },
    },
    {
      name: "strategic_plan",
      description:
        "Send a complex task + code context to Gemini's 1M-token context window for strategic planning. " +
        "Gemini acts as a 'war room' — it analyzes the full picture and returns a structured execution plan " +
        "you (the local 32b) can follow step-by-step. Use for: feature planning, large refactors, " +
        "architecture decisions, bug hunts across multiple files. " +
        "Include as much code context as possible — Gemini can handle 500K+ tokens easily.",
      inputSchema: {
        type: "object",
        properties: {
          task: {
            type: "string",
            description: "What you need to accomplish. Be specific about requirements and constraints.",
          },
          code_context: {
            type: "string",
            description: "All relevant code, file contents, error messages, etc. Gemini has 1M context — dump everything relevant.",
          },
          maxTokens: {
            type: "number",
            description: "Max plan output tokens. Default 4096.",
          },
        },
        required: ["task", "code_context"],
      },
    },
    {
      name: "rapid_fan_out",
      description:
        "Send MULTIPLE prompts to Groq (70B) in parallel and get all responses back. " +
        "Each prompt is independent (fresh context). Use for: batch code review of multiple files, " +
        "getting parallel opinions on different aspects, multi-file analysis, rapid testing of alternatives. " +
        "Groq is blazing fast (500+ tok/s) so even 5 parallel prompts return in seconds.",
      inputSchema: {
        type: "object",
        properties: {
          prompts: {
            type: "array",
            items: { type: "string" },
            description: "Array of self-contained prompts. Each runs independently in parallel.",
          },
          maxTokens: {
            type: "number",
            description: "Max tokens per response. Default 2048.",
          },
        },
        required: ["prompts"],
      },
    },
    // ===== Task Chains + Routing + Council =====
    {
      name: "run_chain",
      description:
        "Execute a pre-built task chain (multi-step workflow). Available chains: " +
        Object.keys(CHAINS).join(", ") +
        ". Each chain is a full pipeline (e.g. fix_bug = memory→plan→test→fix→review). " +
        "Use smart_route first to find the best chain for your task.",
      inputSchema: {
        type: "object",
        properties: {
          chain: {
            type: "string",
            description: `Chain name. One of: ${Object.keys(CHAINS).join(", ")}`,
          },
          inputs: {
            type: "object",
            description: "Key-value inputs required by the chain (see chain description for required keys).",
          },
        },
        required: ["chain", "inputs"],
      },
    },
    {
      name: "smart_route",
      description:
        "Given a task description, automatically determines the best tool or chain to use. " +
        "Returns a recommendation with reasoning. Use this when you're unsure which tool to call — " +
        "it analyzes keywords and patterns to route to the optimal workflow.",
      inputSchema: {
        type: "object",
        properties: {
          task: {
            type: "string",
            description: "Natural language description of what needs to be done.",
          },
        },
        required: ["task"],
      },
    },
    {
      name: "self_eval",
      description:
        "Self-evaluation gate: sends generated code to a second model for quick review. " +
        "Use after generating code but before applying it. Returns pass/fail + issues found.",
      inputSchema: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description: "The generated code to evaluate.",
          },
          context: {
            type: "string",
            description: "What this code is supposed to do (the original task/requirement).",
          },
        },
        required: ["code", "context"],
      },
    },
    {
      name: "compress_context",
      description:
        "Compress a long text (conversation history, tool output, etc.) into a concise summary. " +
        "Use this to fit more information into your 32K context window. " +
        "Preserves key facts, decisions, and action items while dropping filler.",
      inputSchema: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "The text to compress/summarize.",
          },
          focus: {
            type: "string",
            description: "What aspects to prioritize in the summary (optional).",
          },
          maxLength: {
            type: "number",
            description: "Target max length in characters for the summary. Default 1000.",
          },
        },
        required: ["text"],
      },
    },
    {
      name: "council_deliberate",
      description:
        "Convene a council deliberation: multiple models discuss a topic sequentially, " +
        "each seeing previous responses. Produces a synthesized final answer. " +
        "Use for important decisions where you want multiple perspectives merged intelligently.",
      inputSchema: {
        type: "object",
        properties: {
          topic: {
            type: "string",
            description: "The topic/question for the council to deliberate on.",
          },
          panelists: {
            type: "array",
            items: {
              type: "object",
              properties: {
                role: { type: "string", description: "e.g. 'Architect', 'Security Expert', 'Performance Engineer'" },
                model: { type: "string", description: "Model key: fast, specialist, reasoning" },
              },
              required: ["role", "model"],
            },
            description: "The council panel. Each sees all previous responses.",
          },
        },
        required: ["topic"],
      },
    },
    {
      name: "council_debate",
      description:
        "Run an adversarial debate between two models. One argues FOR, one argues AGAINST. " +
        "After N rounds, a judge (reasoning model) declares a winner. " +
        "Use for decisions with strong tradeoffs where you need both sides explored.",
      inputSchema: {
        type: "object",
        properties: {
          topic: {
            type: "string",
            description: "The proposition to debate.",
          },
          pro_stance: {
            type: "string",
            description: "The 'FOR' position statement.",
          },
          con_stance: {
            type: "string",
            description: "The 'AGAINST' position statement.",
          },
          rounds: {
            type: "number",
            description: "Number of back-and-forth rounds. Default 2.",
          },
        },
        required: ["topic", "pro_stance", "con_stance"],
      },
    },
    {
      name: "scratchpad_read",
      description:
        "Read the shared council scratchpad. This is persistent memory that survives " +
        "between tool calls within a session. Use to check what previous deliberations concluded.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "scratchpad_write",
      description:
        "Append a note to the shared council scratchpad. Use to record decisions, " +
        "conclusions, or context that should persist for later tool calls in this session.",
      inputSchema: {
        type: "object",
        properties: {
          entry: {
            type: "string",
            description: "The note to append (timestamped automatically).",
          },
        },
        required: ["entry"],
      },
    },
    {
      name: "launch_battle_log",
      description:
        "Launch the Battle Log dashboard in the default browser. " +
        "Shows a real-time war-room visualization of all army activity — " +
        "which models are active, tool calls, timing, errors. " +
        "Starts the dashboard server if not already running.",
      inputSchema: { type: "object", properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const callStart = Date.now();

  // Emit "tool started" event
  emitBattleEvent({
    type: "tool_start",
    tool: name,
    args: Object.keys(args || {}),
    preview: JSON.stringify(args || {}).slice(0, 200),
  });

  try {
    switch (name) {
      // ===== Delegation =====
      case "consult_fast": {
        const r = await ollamaGenerateWithRetry(ARSENAL.fast, args.prompt, {
          maxTokens: args.maxTokens,
        });
        emitBattleEvent({ type: "tool_complete", tool: name, model: ARSENAL.fast, durationMs: Date.now() - callStart, tokensOut: r.tokensOut, tps: r.tokensPerSec });
        return {
          content: [{ type: "text", text: formatConsultResult("FAST", r) }],
        };
      }
      case "consult_specialist": {
        const r = await ollamaGenerateWithRetry(ARSENAL.specialist, args.prompt, {
          maxTokens: args.maxTokens,
        });
        emitBattleEvent({ type: "tool_complete", tool: name, model: ARSENAL.specialist, durationMs: Date.now() - callStart, tokensOut: r.tokensOut, tps: r.tokensPerSec });
        return {
          content: [
            { type: "text", text: formatConsultResult("SPECIALIST", r) },
          ],
        };
      }
      case "consult_reasoning": {
        const r = await ollamaGenerateWithRetry(ARSENAL.reasoning, args.prompt, {
          maxTokens: args.maxTokens,
        });
        emitBattleEvent({ type: "tool_complete", tool: name, model: ARSENAL.reasoning, durationMs: Date.now() - callStart, tokensOut: r.tokensOut, tps: r.tokensPerSec });
        return {
          content: [
            { type: "text", text: formatConsultResult("REASONING", r) },
          ],
        };
      }
      case "tournament_vote": {
        let voterKeys = args.voters ?? ["specialist", "reasoning"];
        if (typeof voterKeys === 'string') voterKeys = voterKeys.split(',').map(s => s.trim());
        const voterToAgent = { fast: "consult_fast", specialist: "consult_specialist", reasoning: "consult_reasoning", heavy: "consult_specialist" };
        const t0 = Date.now();
        const results = await Promise.all(
          voterKeys.map(async (k) => {
            const model = ARSENAL[k];
            if (!model) {
              return {
                voterKey: k,
                model: `unknown:${k}`,
                text: `(unknown voter '${k}')`,
                elapsedMs: 0,
                tokensOut: 0,
              };
            }
            try {
              const r = await ollamaGenerate(model, args.prompt);
              return { ...r, voterKey: k };
            } catch (e) {
              return {
                voterKey: k,
                model,
                text: `(error: ${e.message})`,
                elapsedMs: 0,
                tokensOut: 0,
              };
            }
          }),
        );
        const totalMs = Date.now() - t0;

        // Emit debate_round events for each pair of voters
        for (let i = 0; i < results.length - 1; i++) {
          const a1 = voterToAgent[results[i].voterKey] || "consult_fast";
          const a2 = voterToAgent[results[i + 1].voterKey] || "consult_specialist";
          emitBattleEvent({
            type: "debate_round",
            agent1: a1,
            agent2: a2,
            text1: results[i].text.slice(0, 400),
            text2: results[i + 1].text.slice(0, 400),
            prompt: args.prompt.slice(0, 200),
          });
        }

        // Judge pass — reasoning model picks a winner
        let judgeVerdict = "";
        let winnerKey = voterKeys[0];
        let loserKey = voterKeys[voterKeys.length - 1];
        try {
          const judgePrompt = `You are a tournament judge. Multiple AI models answered the same question. Pick the BEST response and explain why in 2-3 sentences.

QUESTION: ${args.prompt}

${results.map((r, i) => `--- CONTESTANT ${i + 1} (${r.voterKey}) ---\n${r.text.slice(0, 500)}`).join("\n\n")}

Respond in this exact format:
WINNER: <contestant number>
REASON: <2-3 sentence explanation>`;

          const judgeResult = await ollamaGenerateWithRetry(
            ARSENAL.reasoning,
            judgePrompt,
            { maxTokens: 512 }
          );
          // Use fullText (thinking + response) for pattern matching
          const judgeFullText = judgeResult.fullText || judgeResult.text;
          judgeVerdict = judgeResult.text || judgeResult.thinking || "";

          // Strip <think> tags if present
          const cleanedVerdict = judgeFullText.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

          // Parse winner from judge response (check both raw and cleaned)
          const winnerMatch = (cleanedVerdict || judgeFullText).match(/WINNER:\s*(?:contestant\s*)?(\d+)/i);

          // Extract REASON from judge response
          const reasonMatch = (cleanedVerdict || judgeFullText).match(/REASON:\s*(.+?)(?:\n|$)/is);
          if (reasonMatch) {
            judgeVerdict = reasonMatch[1].trim();
          } else {
            // No REASON label - extract meaningful content from thinking
            const thinkingContent = judgeResult.thinking || "";
            // Find the most relevant sentence about the winner
            const sentences = thinkingContent.split(/[.!?]+/).filter(s => s.trim().length > 20);
            const lastFew = sentences.slice(-3).join('. ').trim();
            if (lastFew) {
              judgeVerdict = lastFew.slice(0, 300);
            }
          }
          if (winnerMatch) {
            const winIdx = parseInt(winnerMatch[1], 10) - 1;
            if (winIdx >= 0 && winIdx < results.length) {
              winnerKey = results[winIdx].voterKey;
              // Loser is the other one (or first non-winner)
              loserKey = results.find((r, i) => i !== winIdx)?.voterKey || voterKeys[0];
            }
          }
        } catch (e) {
          judgeVerdict = `(judge error: ${e.message})`;
        }

        // Emit tournament_result with winner/loser + their arguments
        const winnerAgent = voterToAgent[winnerKey] || "consult_fast";
        const loserAgent = voterToAgent[loserKey] || "consult_specialist";
        const winnerResult = results.find(r => r.voterKey === winnerKey);
        const loserResult = results.find(r => r.voterKey === loserKey);
        emitBattleEvent({
          type: "tournament_result",
          winner: winnerAgent,
          loser: loserAgent,
          rationale: judgeVerdict.slice(0, 500),
          prompt: args.prompt.slice(0, 200),
          winnerArg: winnerResult ? winnerResult.text.slice(0, 400) : "",
          loserArg: loserResult ? loserResult.text.slice(0, 400) : "",
        });

        const blocks = [
          `=== TOURNAMENT VOTE (${results.length} voters, ${totalMs}ms wall) ===`,
          "",
          ...results.map((r, i) => formatConsultResult(`VOTER ${i + 1} [${r.voterKey}]`, r)),
          "",
          `=== JUDGE VERDICT ===`,
          judgeVerdict,
          "",
          `🏆 WINNER: ${winnerKey} | 💀 LOSER: ${loserKey}`,
        ];
        emitBattleEvent({ type: "tool_complete", tool: name, durationMs: Date.now() - callStart, preview: `🏆 ${winnerKey} defeats ${loserKey}` });
        return { content: [{ type: "text", text: blocks.join("\n\n") }] };
      }
      case "list_arsenal": {
        const models = await listLocalModels();
        const lines = [
          `Local Ollama arsenal (${models.length} models):`,
          "",
          ...models.map((m) => `  ${m.name.padEnd(28)} ${m.sizeMB} MB`),
          "",
          "Conductor delegation map:",
          ...Object.entries(ARSENAL).map(
            ([role, model]) => `  ${role.padEnd(12)} → ${model}`,
          ),
        ];
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      // ===== Agentic =====
      case "invoke_agent": {
        const tier = args.tier ?? "specialist";
        const model = ARSENAL[tier];
        if (!model) {
          return {
            content: [
              { type: "text", text: `Unknown tier '${tier}'. Use fast|specialist|reasoning|heavy.` },
            ],
            isError: true,
          };
        }
        const agentPath = join(
          REPO_ROOT,
          ".github",
          "agents",
          `${args.agent_name}.agent.md`,
        );
        let persona;
        try {
          persona = await readFile(agentPath, "utf-8");
        } catch (e) {
          return {
            content: [
              {
                type: "text",
                text: `Could not read agent file at ${agentPath}: ${e.message}`,
              },
            ],
            isError: true,
          };
        }
        const fullPrompt = [
          "You are operating as the following sub-agent persona. Adhere to all its rules.",
          "",
          "===== AGENT PERSONA START =====",
          persona,
          "===== AGENT PERSONA END =====",
          "",
          "===== TASK =====",
          args.task,
          "",
          "Respond strictly within the persona's domain. If the task is outside your scope, say so.",
        ].join("\n");
        const r = await ollamaGenerate(model, fullPrompt, {
          maxTokens: args.maxTokens ?? 4096,
        });
        return {
          content: [
            {
              type: "text",
              text: formatConsultResult(`AGENT[${args.agent_name}@${tier}]`, r),
            },
          ],
        };
      }
      case "prewarm_loadout": {
        const t0 = Date.now();
        const results = [];
        for (const m of args.models) {
          const target = ARSENAL[m] ?? m;
          try {
            const r = await ollamaLoad(target, args.keepAlive ?? "30m");
            results.push(`  ✅ ${target} loaded in ${r.elapsedMs}ms`);
          } catch (e) {
            results.push(`  ❌ ${target} failed: ${e.message}`);
          }
        }
        return {
          content: [
            {
              type: "text",
              text: [
                `=== PREWARM_LOADOUT (${args.models.length} models, ${
                  Date.now() - t0
                }ms wall) ===`,
                "",
                ...results,
                "",
                `Keep-alive: ${args.keepAlive ?? "30m"}. Models will stay hot until idle timeout.`,
              ].join("\n"),
            },
          ],
        };
      }
      case "request_user_feedback": {
        const q =
          args.question ??
          "Is the work acceptable? Adjustments needed, or are we good?";
        const block = [
          "=== USER FEEDBACK GATE ===",
          "",
          "**Summary:** " + args.summary,
          "",
          ...(args.test_results
            ? ["**Test results:**", args.test_results, ""]
            : []),
          "**Question:** " + q,
          "",
          "⚠️ DO NOT close the turn until the user explicitly approves. " +
            "Display this block to the user verbatim and wait for their reply.",
        ].join("\n");
        return { content: [{ type: "text", text: block }] };
      }
      case "review_diff": {
        const diffArgs = args.staged
          ? ["diff", "--cached"]
          : ["diff"];
        const cmdRes = await runCommand("git", diffArgs, REPO_ROOT, 60_000);
        if (cmdRes.exitCode !== 0) {
          return {
            content: [
              {
                type: "text",
                text: `git diff failed (exit ${cmdRes.exitCode}):\n${cmdRes.stderr}`,
              },
            ],
            isError: true,
          };
        }
        const diff = cmdRes.stdout.trim();
        if (!diff) {
          return {
            content: [
              {
                type: "text",
                text: `No ${args.staged ? "staged" : "unstaged"} changes to review.`,
              },
            ],
          };
        }
        // Truncate massive diffs to stay within model context
        const MAX_DIFF_CHARS = 60_000;
        const truncated = diff.length > MAX_DIFF_CHARS
          ? diff.slice(0, MAX_DIFF_CHARS) + "\n\n[... diff truncated ...]"
          : diff;
        const tier = args.tier ?? "reasoning";
        const model = ARSENAL[tier];
        const reviewPrompt = [
          "You are a senior code reviewer. Review the following git diff for:",
          "1. Security issues (OWASP Top 10, path traversal, injection, secrets)",
          "2. Bugs (off-by-one, null deref, race conditions, error handling)",
          "3. Style violations (vs project conventions)",
          "4. Test coverage gaps (changes without corresponding tests)",
          "",
          "Be concise. Use a numbered list. Mark each finding [CRITICAL] [WARN] [NIT].",
          "If the diff looks fine, say 'LGTM' and explain in one sentence why.",
          "",
          "===== DIFF =====",
          truncated,
        ].join("\n");
        const r = await ollamaGenerate(model, reviewPrompt, { maxTokens: 4096 });
        return {
          content: [
            {
              type: "text",
              text: formatConsultResult(`DIFF REVIEW [${tier}]`, r),
            },
          ],
        };
      }
      case "run_tests": {
        const timeout = args.timeout_ms ?? 600_000;
        const suite = args.suite;
        const npmScript =
          suite === "all"
            ? "test"
            : suite === "jest"
              ? "test:jest"
              : suite === "python"
                ? "test:python"
                : suite === "e2e"
                  ? "test:e2e"
                  : null;
        if (!npmScript) {
          return {
            content: [
              { type: "text", text: `Unknown suite '${suite}'. Use jest|python|e2e|all.` },
            ],
            isError: true,
          };
        }
        const cmdRes = await runCommand(
          "npm",
          ["run", npmScript],
          REPO_ROOT,
          timeout,
        );
        // Extract last ~2000 chars of combined output for summary
        const combined = (cmdRes.stdout + "\n" + cmdRes.stderr).trim();
        const tail = combined.length > 4000 ? combined.slice(-4000) : combined;
        const passText =
          cmdRes.exitCode === 0
            ? "✅ PASSED"
            : cmdRes.timedOut
              ? "⏱️ TIMED OUT"
              : `❌ FAILED (exit ${cmdRes.exitCode})`;
        const lines = [
          `=== run_tests: ${suite} (npm run ${npmScript}) ===`,
          `Status: ${passText}`,
          `Duration: ${cmdRes.elapsedMs}ms`,
          "",
          "----- output (last 4000 chars) -----",
          tail || "(no output captured)",
        ];

        // On E2E failure: find fresh screenshots for visual debugging
        if (cmdRes.exitCode !== 0 && (suite === "e2e" || suite === "all")) {
          try {
            const { readdirSync, statSync } = await import("node:fs");
            const resultsDir = resolve(REPO_ROOT, "milkman-portfolio", "test-results");
            const now = Date.now();
            const freshScreenshots = [];

            function findScreenshots(dir) {
              try {
                for (const entry of readdirSync(dir, { withFileTypes: true })) {
                  const full = resolve(dir, entry.name);
                  if (entry.isDirectory()) findScreenshots(full);
                  else if (entry.name.endsWith(".png")) {
                    const stat = statSync(full);
                    // Only screenshots from the last 5 minutes
                    if (now - stat.mtimeMs < 300_000) {
                      freshScreenshots.push(full);
                    }
                  }
                }
              } catch {}
            }
            findScreenshots(resultsDir);

            if (freshScreenshots.length > 0) {
              lines.push(
                "",
                "----- FAILURE SCREENSHOTS (use visual_consult to analyze) -----",
                ...freshScreenshots.slice(0, 5).map((p) => `  📸 ${p}`),
                "",
                "💡 TIP: Call visual_consult with any screenshot path above to get AI analysis of the failure."
              );
            }
          } catch {}
        }

        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      // ===== Sovereign Memory =====
      case "memory_query": {
        const t0 = Date.now();
        const result = await retrieve(args.query, {
          storePath: MEMORY_STORE_PATH,
          k: args.k ?? 5,
          embedModel: MEMORY_EMBED_MODEL,
          minRelevance: args.min_relevance ?? 0.30,
          source: args.source ?? "all",
        });
        const lines = [
          `=== MEMORY_QUERY (${Date.now() - t0}ms total, ` +
            `embed=${result.latency.embed}ms, search=${result.latency.search}ms) ===`,
          `Query: "${args.query}" | Source filter: ${args.source ?? "all"}`,
          `Relevant: ${result.relevant} | Chunks returned: ${result.chunks.length} ` +
            `| Store: ${result.stats.totalChunks} chunks across ${result.stats.uniqueFiles} files`,
          "",
          ...(result.chunks.length > 0
            ? [
                "Retrieved chunks:",
                ...result.chunks.map(
                  (c, i) =>
                    `  ${i + 1}. [${c.score.toFixed(3)}] ${c.file}:${c.startLine}`,
                ),
                "",
              ]
            : ["(no chunks above relevance threshold)", ""]),
          "----- AUGMENTED PROMPT (paste this as system context to a worker) -----",
          result.augmentedPrompt,
        ];
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }
      case "memory_recall_conversation": {
        const t0 = Date.now();
        const result = await retrieve(args.query, {
          storePath: MEMORY_STORE_PATH,
          k: args.k ?? 5,
          embedModel: MEMORY_EMBED_MODEL,
          source: "conversation",
        });
        const lines = [
          `=== MEMORY_RECALL_CONVERSATION (${Date.now() - t0}ms) ===`,
          `Query: "${args.query}"`,
          `Relevant: ${result.relevant} | Past conversation chunks: ${result.chunks.length}`,
          "",
          ...result.chunks.map(
            (c, i) =>
              `--- Recall ${i + 1} [${c.score.toFixed(3)}] ${c.file} turn ${c.startLine} ---\n${c.text}`,
          ),
          ...(result.chunks.length === 0
            ? [
                "No past conversations matched. Either: (a) memory_index_conversations hasn't been run yet, (b) the topic is brand new, or (c) the cosine threshold needs lowering via memory_query with min_relevance arg.",
              ]
            : []),
        ];
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }
      case "memory_index": {
        const lines = [];
        const result = await indexRepo({
          rootDir: args.root ? resolve(args.root) : REPO_ROOT,
          storePath: MEMORY_STORE_PATH,
          embedModel: args.embed_model ?? MEMORY_EMBED_MODEL,
          chunkSize: args.chunk_size ?? 500,
          chunkOverlap: args.chunk_overlap ?? 50,
          onProgress: (p) => {
            if (p.phase !== "embed_progress") {
              lines.push(`  [${p.phase}] ${p.message ?? ""}`);
            }
          },
        });
        return {
          content: [
            {
              type: "text",
              text: [
                "=== MEMORY_INDEX COMPLETE ===",
                ...lines,
                "",
                "Result:",
                JSON.stringify(result, null, 2),
              ].join("\n"),
            },
          ],
        };
      }
      case "memory_stats": {
        const store = new VectorStore(MEMORY_STORE_PATH);
        await store.load();
        const stats = store.stats();
        // Count code vs conversation chunks
        let codeChunks = 0, convChunks = 0;
        for (const c of store.chunks) {
          if (c.file.startsWith("conv://")) convChunks++;
          else codeChunks++;
        }
        return {
          content: [
            {
              type: "text",
              text: [
                "=== MEMORY_STATS ===",
                JSON.stringify({
                  ...stats,
                  codeChunks,
                  conversationChunks: convChunks,
                }, null, 2),
              ].join("\n"),
            },
          ],
        };
      }
      case "memory_index_conversations": {
        const lines = [];
        const result = await indexConversations({
          storePath: MEMORY_STORE_PATH,
          embedModel: MEMORY_EMBED_MODEL,
          chunkSize: args.chunk_size ?? 800,
          chunkOverlap: args.chunk_overlap ?? 80,
          daysBack: args.days_back ?? 30,
          onProgress: (p) => {
            if (p.phase !== "embed_progress") {
              lines.push(`  [${p.phase}] ${p.message ?? ""}`);
            }
          },
        });
        return {
          content: [
            {
              type: "text",
              text: [
                "=== MEMORY_INDEX_CONVERSATIONS COMPLETE ===",
                ...lines,
                "",
                JSON.stringify(result, null, 2),
              ].join("\n"),
            },
          ],
        };
      }
      case "log_decision": {
        const entry = {
          timestamp: new Date().toISOString(),
          title: args.title,
          rationale: args.rationale,
          alternativesRejected: args.alternatives_rejected ?? null,
          relatedFiles: args.related_files ?? [],
        };
        const path = join(REPO_ROOT, "decisions.jsonl");
        await appendFile(path, JSON.stringify(entry) + "\n", "utf-8");
        return {
          content: [
            {
              type: "text",
              text: [
                "=== DECISION LOGGED ===",
                `File: ${path}`,
                JSON.stringify(entry, null, 2),
                "",
                "Tip: run memory_index to make this decision retrievable via memory_query.",
              ].join("\n"),
            },
          ],
        };
      }
      case "visual_consult": {
        const model = args.model ?? "qwen2.5vl:7b";
        const result = await ollamaVisualize(model, args.image_path, args.question, {
          maxTokens: args.max_tokens ?? 1024,
        });
        return {
          content: [
            {
              type: "text",
              text: [
                `=== VISUAL_CONSULT ${result.model} ===`,
                `Image: ${args.image_path} (${(result.imageBytes / 1024).toFixed(1)} KB)`,
                `${result.tokensOut ?? "?"} tokens in ${result.elapsedMs}ms` +
                  (result.tokensPerSec ? `, ${result.tokensPerSec} tok/s` : ""),
                "",
                result.text.trim(),
              ].join("\n"),
            },
          ],
        };
      }

      // ===== Cloud delegation =====
      case "consult_cloud": {
        const provider = args.provider;
        const opts = { maxTokens: args.maxTokens, temperature: args.temperature };
        let result;
        if (provider === "gemini") {
          result = await geminiGenerate(args.prompt, opts);
        } else if (provider === "groq") {
          result = await groqGenerate(args.prompt, opts);
        } else {
          throw new Error(`Unknown cloud provider: ${provider}. Use 'gemini' or 'groq'.`);
        }
        return {
          content: [
            {
              type: "text",
              text: [
                `=== CLOUD (${result.provider}/${result.model}) ===`,
                `${result.tokensIn ?? "?"} in → ${result.tokensOut ?? "?"} out, ${result.elapsedMs}ms`,
                "",
                result.text.trim(),
              ].join("\n"),
            },
          ],
        };
      }

      case "strategic_plan": {
        const result = await strategicPlan(args.task, args.code_context, {
          maxTokens: args.maxTokens,
        });
        return {
          content: [
            {
              type: "text",
              text: [
                `=== STRATEGIC PLAN (${result.provider}/${result.model}) ===`,
                `${result.tokensIn ?? "?"} tokens analyzed → ${result.tokensOut ?? "?"} tokens plan, ${result.elapsedMs}ms`,
                "",
                result.text.trim(),
              ].join("\n"),
            },
          ],
        };
      }

      case "rapid_fan_out": {
        if (!Array.isArray(args.prompts) || args.prompts.length === 0) {
          throw new Error("prompts must be a non-empty array");
        }
        if (args.prompts.length > 10) {
          throw new Error("Max 10 parallel prompts (Groq rate limit protection)");
        }
        const result = await rapidFanOut(args.prompts, { maxTokens: args.maxTokens });
        const formatted = result.results.map((r, i) => [
          `--- [${i + 1}/${result.count}] (${r.tokensOut ?? "?"} tokens, ${r.elapsedMs}ms) ---`,
          r.text.trim(),
        ].join("\n")).join("\n\n");
        return {
          content: [
            {
              type: "text",
              text: [
                `=== RAPID FAN-OUT (${result.count} prompts, ${result.totalElapsedMs}ms total) ===`,
                "",
                formatted,
              ].join("\n"),
            },
          ],
        };
      }

      // ===== Task Chains + Routing + Council =====
      case "run_chain": {
        // Internal tool dispatch function for chain steps
        const internalExecute = async (toolName, toolArgs) => {
          // Directly call the relevant functions instead of going through MCP handler
          switch (toolName) {
            case "memory_query": {
              const r = await retrieve(toolArgs.query, {
                storePath: MEMORY_STORE_PATH, k: toolArgs.k ?? 5,
                embedModel: MEMORY_EMBED_MODEL, minRelevance: 0.30,
              });
              return r.chunks.map((c) => `[${c.file}:${c.startLine}] ${c.text}`).join("\n\n");
            }
            case "memory_recall_conversation": {
              const r = await retrieve(toolArgs.query, {
                storePath: MEMORY_STORE_PATH, k: toolArgs.k ?? 5,
                embedModel: MEMORY_EMBED_MODEL, source: "conversations",
              });
              return r.chunks.map((c) => `[${c.file}] ${c.text}`).join("\n\n");
            }
            case "consult_fast": {
              const r = await ollamaGenerateWithRetry(ARSENAL.fast, toolArgs.prompt, { maxTokens: toolArgs.maxTokens });
              return r.text;
            }
            case "consult_specialist": {
              const r = await ollamaGenerateWithRetry(ARSENAL.specialist, toolArgs.prompt, { maxTokens: toolArgs.maxTokens });
              return r.text;
            }
            case "consult_reasoning": {
              const r = await ollamaGenerateWithRetry(ARSENAL.reasoning, toolArgs.prompt, { maxTokens: toolArgs.maxTokens });
              return r.text;
            }
            case "strategic_plan": {
              const r = await strategicPlan(toolArgs.task, toolArgs.code_context, toolArgs);
              return r.text;
            }
            case "rapid_fan_out": {
              const r = await rapidFanOut(toolArgs.prompts, toolArgs);
              return r.results.map((x) => x.text).join("\n---\n");
            }
            case "run_tests": {
              const cmd = await runCommand("npm", ["run", toolArgs.suite === "all" ? "test" : `test:${toolArgs.suite}`], REPO_ROOT, toolArgs.timeout_ms ?? 300000);
              return cmd.exitCode === 0 ? "✅ ALL TESTS PASSED" : `❌ FAILED (exit ${cmd.exitCode})\n${(cmd.stdout + cmd.stderr).slice(-2000)}`;
            }
            default:
              return `(tool '${toolName}' not available in chain context)`;
          }
        };

        const chainResult = await executeChain(args.chain, args.inputs, internalExecute);

        const stepSummary = chainResult.steps.map((s, i) => {
          if (s.skipped) return `  ${s.label}: ⏭️ SKIPPED (${s.reason})`;
          if (s.error) return `  ${s.label}: ❌ FAILED (${s.error})`;
          const preview = (s.result || "").slice(0, 200);
          return `  ${s.label}: ✅ (${preview}${preview.length >= 200 ? "..." : ""})`;
        }).join("\n");

        return {
          content: [{
            type: "text",
            text: [
              `=== CHAIN: ${args.chain} (${chainResult.success ? "✅ SUCCESS" : "❌ FAILED"}) ===`,
              "",
              stepSummary,
              "",
              chainResult.success
                ? `Final output:\n${chainResult.steps[chainResult.steps.length - 1]?.result || "(chain complete)"}`
                : `Failed at step ${chainResult.failedAt}: ${chainResult.steps[chainResult.failedAt]?.error}`,
            ].join("\n"),
          }],
        };
      }

      case "smart_route": {
        const route = routeTask(args.task);
        return {
          content: [{
            type: "text",
            text: [
              `=== SMART ROUTE ===`,
              `Task: "${args.task}"`,
              `Recommended: ${route.chain ? `run_chain('${route.chain}')` : route.tool}`,
              `Reason: ${route.reason}`,
              "",
              route.args ? `Suggested args: ${JSON.stringify(route.args, null, 2)}` : "",
            ].join("\n"),
          }],
        };
      }

      case "self_eval": {
        const evalResult = await withRetry(
          () => groqGenerate(
            `You are a code reviewer. Evaluate this code for correctness, security, and quality.

TASK (what this code should do): ${args.context}

CODE:
\`\`\`
${args.code}
\`\`\`

Respond with:
1. VERDICT: PASS or FAIL
2. ISSUES (if any): bullet list of problems
3. SUGGESTIONS (if any): improvements

Be concise and specific.`,
            { maxTokens: 1024 }
          ),
          { maxRetries: 2, baseDelayMs: 1500, label: "self_eval/groq" }
        );

        return {
          content: [{
            type: "text",
            text: [
              `=== SELF-EVAL (${evalResult.elapsedMs}ms) ===`,
              evalResult.text.trim(),
            ].join("\n"),
          }],
        };
      }

      case "compress_context": {
        const maxLen = args.maxLength ?? 1000;
        const compressResult = await withRetry(
          () => groqGenerate(
            `Compress the following text into a concise summary of ~${maxLen} characters.
${args.focus ? `Focus on: ${args.focus}` : ""}

Preserve: key facts, decisions, action items, file paths, function names.
Drop: filler, repetition, verbose explanations, pleasantries.
Format: bullet points for quick scanning.

TEXT TO COMPRESS:
${args.text}`,
            { maxTokens: Math.max(512, Math.ceil(maxLen / 3)) }
          ),
          { maxRetries: 2, baseDelayMs: 1000, label: "compress/groq" }
        );

        return {
          content: [{
            type: "text",
            text: [
              `=== COMPRESSED (${args.text.length} chars → ${compressResult.text.length} chars, ${Math.round((1 - compressResult.text.length / args.text.length) * 100)}% reduction) ===`,
              "",
              compressResult.text.trim(),
            ].join("\n"),
          }],
        };
      }

      case "council_deliberate": {
        const panelists = args.panelists || [
          { role: "Architect", model: "specialist" },
          { role: "Devil's Advocate", model: "reasoning" },
          { role: "Pragmatist", model: "fast" },
        ];

        const generateFn = async (modelKey, prompt) => {
          const model = ARSENAL[modelKey] || ARSENAL.specialist;
          const r = await ollamaGenerateWithRetry(model, prompt, { maxTokens: 1024 });
          return r.text;
        };

        const result = await deliberate(args.topic, panelists, generateFn);
        await appendScratchpad(`[DELIBERATION] ${args.topic}\nSynthesis: ${result.synthesis}`);

        return {
          content: [{
            type: "text",
            text: [
              `=== COUNCIL DELIBERATION (${result.rounds.length} panelists) ===`,
              `Topic: ${args.topic}`,
              "",
              ...result.rounds.map((r) => `### ${r.role} (${r.model}):\n${r.response}`),
              "",
              `### SYNTHESIS:\n${result.synthesis}`,
            ].join("\n"),
          }],
        };
      }

      case "council_debate": {
        const rounds = args.rounds ?? 2;
        const voterToAgent = { fast: "consult_fast", specialist: "consult_specialist", reasoning: "consult_reasoning" };

        const generateFn = async (modelKey, prompt) => {
          const model = ARSENAL[modelKey] || ARSENAL.specialist;
          const r = await ollamaGenerateWithRetry(model, prompt, { maxTokens: 512 });
          return r.text;
        };

        const result = await debate(
          args.topic,
          { model: "specialist", stance: args.pro_stance },
          { model: "fast", stance: args.con_stance },
          rounds,
          generateFn
        );
        await appendScratchpad(`[DEBATE] ${args.topic}\nVerdict: ${result.verdict}`);

        // Emit debate_round events for each PRO/CON exchange pair
        const proAgent = voterToAgent["specialist"] || "consult_specialist";
        const conAgent = voterToAgent["fast"] || "consult_fast";
        for (let i = 0; i < result.exchanges.length - 1; i += 2) {
          const pro = result.exchanges[i];
          const con = result.exchanges[i + 1];
          if (pro && con) {
            emitBattleEvent({
              type: "debate_round",
              agent1: proAgent,
              agent2: conAgent,
              text1: pro.response.slice(0, 150),
              text2: con.response.slice(0, 150),
            });
          }
        }

        // Determine winner from verdict text
        let winnerAgent = proAgent;
        let loserAgent = conAgent;
        const verdictLower = result.verdict.toLowerCase();
        if (verdictLower.includes("con wins") || verdictLower.includes("con side") ||
            verdictLower.includes("against") || verdictLower.includes("con makes the stronger")) {
          winnerAgent = conAgent;
          loserAgent = proAgent;
        }

        // Emit tournament_result
        emitBattleEvent({
          type: "tournament_result",
          winner: winnerAgent,
          loser: loserAgent,
          rationale: result.verdict.slice(0, 300),
          topic: args.topic,
        });

        emitBattleEvent({ type: "tool_complete", tool: name, durationMs: Date.now() - callStart, preview: `Debate verdict: ${winnerAgent} wins` });

        return {
          content: [{
            type: "text",
            text: [
              `=== COUNCIL DEBATE (${rounds} rounds) ===`,
              `Topic: ${args.topic}`,
              `PRO: ${args.pro_stance}`,
              `CON: ${args.con_stance}`,
              "",
              ...result.exchanges.map((e) => `[${e.side}]: ${e.response}`),
              "",
              `### VERDICT (reasoning model):\n${result.verdict}`,
              "",
              `🏆 Winner: ${winnerAgent} | 💀 Loser: ${loserAgent}`,
            ].join("\n"),
          }],
        };
      }

      case "scratchpad_read": {
        const content = await readScratchpad();
        return {
          content: [{
            type: "text",
            text: content || "(scratchpad is empty)",
          }],
        };
      }

      case "scratchpad_write": {
        const updated = await appendScratchpad(args.entry);
        return {
          content: [{
            type: "text",
            text: `✅ Note appended to scratchpad (${updated.length} chars total).`,
          }],
        };
      }

      case "launch_battle_log": {
        const dashboardScript = resolve(__dirname, "battle-log", "server.js");
        // Start dashboard server in background
        const child = spawn("node", [dashboardScript], {
          detached: true,
          stdio: "ignore",
          env: { ...process.env, NODE_NO_WARNINGS: "1" },
        });
        child.unref();
        // Give it a moment to start
        await new Promise((r) => setTimeout(r, 1500));
        // Open in browser
        const openCmd = process.platform === "win32" ? "start" : process.platform === "darwin" ? "open" : "xdg-open";
        spawn(openCmd, ["http://localhost:3737"], { shell: true, detached: true, stdio: "ignore" }).unref();
        emitBattleEvent({ type: "system", tool: "battle_log", preview: "Dashboard launched at http://localhost:3737" });
        return {
          content: [{
            type: "text",
            text: "⚔️ Battle Log dashboard launched at http://localhost:3737\nOpen your browser to watch the war unfold in real-time.",
          }],
        };
      }

      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (e) {
    emitBattleEvent({
      type: "tool_error",
      tool: name,
      error: e.message,
      durationMs: Date.now() - callStart,
    });
    return {
      content: [{ type: "text", text: `Tool '${name}' failed: ${e.message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
// Keep process alive — MCP server runs until parent closes stdio.
