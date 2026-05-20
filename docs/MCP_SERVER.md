# 🐉 Jedi War Council — Local LLM Stack

Local-first, Ollama-powered AI orchestration system.
Runs on RTX 5090 (32 GB VRAM) with cloud fallback (Groq + Gemini).

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  VS Code + Copilot Agent                                         │
│   ├── MCP Server (stdio) — 30 auto-discovered tools             │
│   └── Battle Log Server (HTTP :3737) — Dashboard + API          │
│                                                                  │
│  Ollama (127.0.0.1:11434)                                        │
│   ├── qwen2.5-coder:7b   → Fast tier (200+ tok/s)              │
│   ├── qwen2.5-coder:14b  → Specialist tier                     │
│   ├── deepseek-r1:14b    → Reasoning tier (chain-of-thought)   │
│   └── nomic-embed-text   → RAG embeddings                      │
│                                                                  │
│  Cloud (free tiers)                                              │
│   ├── Groq (llama-3.3-70b) → 500+ tok/s, rate limited          │
│   └── Gemini (2.5-flash)   → 1M context window                 │
│                                                                  │
│  Shared Infrastructure (mcp-server/shared/)                      │
│   ├── circuit-breaker.js  → Per-model fault isolation           │
│   ├── telemetry.js        → Metrics collection + JSONL          │
│   ├── conversation-memory.js → Multi-turn context              │
│   ├── workspace-registry.js → Multi-workspace management       │
│   ├── confidence.js       → 4-dimension scoring                │
│   ├── dag-engine.js       → Multi-step task orchestration      │
│   ├── verification-pipeline.js → Pre-commit quality gates      │
│   └── tool-middleware.js  → Auto-instrumentation wrapper       │
└──────────────────────────────────────────────────────────────────┘
```

## Tri-Mode Operation

| Mode | Behavior |
|------|----------|
| `cloud` | Groq + Gemini only. No local models needed. |
| `local` | Ollama only. Zero network dependency. |
| `hybrid` | Local primary, cloud fallback when breaker trips. |

Auto-detected on boot based on Ollama availability + API keys.

## HTTP Endpoints (port 3737)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/command-center` | GET | Chat UI with routing + tournaments |
| `/metrics-hud` | GET | Live metrics dashboard |
| `/showcase` | GET | Scroll-driven portfolio page |
| `/health` | GET | System readiness + model status |
| `/chat` | POST | Smart-routed streaming chat (SSE) |
| `/breakers` | GET | Circuit breaker states |
| `/metrics` | GET | Aggregated telemetry (p50/p95/p99) |
| `/metrics/events` | GET | Raw event feed |
| `/workspaces` | GET/POST | Multi-workspace registry |
| `/workspaces/active` | POST | Switch active workspace |
| `/dag/run` | POST | Execute a task DAG |
| `/dag/status/:id` | GET | DAG execution status |
| `/dag/list` | GET | Recent DAG executions |
| `/verify` | POST | Run verification pipeline |
| `/conversations` | GET/POST | Conversation persistence |
| `/reindex` | POST | Re-index workspace for RAG |
| `/mode` | GET/POST | Get/set operational mode |
| `/events` | GET | SSE stream (live events) |

## MCP Tools (30 tools, auto-discovered)

All tools are auto-instrumented with circuit breakers, telemetry, and confidence scoring via `tool-middleware.js`.

| Category | Tools |
|----------|-------|
| Model delegation | `consult_fast`, `consult_specialist`, `consult_reasoning`, `consult_cloud` |
| Multi-model | `tournament_vote`, `council_debate`, `council_deliberate`, `rapid_fan_out` |
| Routing | `smart_route`, `run_chain`, `strategic_plan` |
| Memory/RAG | `memory_query`, `memory_index`, `memory_stats`, `memory_recall_conversation` |
| Code quality | `review_diff`, `self_eval`, `run_tests`, `benchmark_run` |
| Utilities | `list_arsenal`, `launch_battle_log`, `scratchpad_read/write`, `compress_context` |
| Agents | `invoke_agent`, `visual_consult`, `request_user_feedback` |

## Circuit Breakers

Each model tier has its own breaker:

| Tier | Threshold | Reset Time |
|------|-----------|------------|
| fast | 5 failures | 30s |
| specialist | 3 failures | 60s |
| reasoning | 3 failures | 60s |
| groq | 3 failures | 300s |
| gemini | 3 failures | 300s |

States: CLOSED → OPEN (after threshold) → HALF-OPEN (after reset) → CLOSED (on success)

## Pre-commit Hook

Install: `node scripts/install-hooks.js`

Automatically runs syntax + architecture + security checks before every commit.
Set `WAR_COUNCIL_FULL_VERIFY=1` to include test execution.

## Quick Start

```powershell
# Start the server
node battle-log/server.js --port 3737

# Start with a specific workspace
node battle-log/server.js --workspace D:\my-project

# Install pre-commit hook
node scripts/install-hooks.js

# Run tests
node --test tests/*.test.js

# Run verification pipeline manually
curl -X POST http://localhost:3737/verify -H "Content-Type: application/json" -d "{}"
```

## Test Suite

| File | Tests | Coverage |
|------|-------|----------|
| circuit-breaker.test.js | 16 | State transitions, registry, fallback |
| telemetry.test.js | 9 | Record, aggregate, time windows |
| conversation-memory.test.js | 9 | Multi-turn, token budgets, persistence |
| workspace-registry.test.js | 10 | Register, switch, auto-activate |
| confidence.test.js | 11 | Scoring, dimensions, classification |
| dag-engine.test.js | 11 | Validation, execution, gates, timeouts |
| verification-pipeline.test.js | 9 | Syntax, security, architecture |
| tool-middleware.test.js | 11 | Instrumentation, breaker bypass, telemetry |
| rag-integration.test.js | 17 | Vector store, embeddings, retrieval |
| **Playwright (mocked)** | **60** | Screenshots, UI interactions |

**Total: 163 tests**
