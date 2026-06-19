# ⚔️ War Council — Local AI Agent Orchestration

Local-first, Ollama-powered multi-model agent framework. Runs entirely on the workstation (RTX 5090, 32 GB VRAM). No cloud dependencies, no API keys, no subscription fees.

> **"The want to beat Claude and the want to see it happen in real time with visual aid."**

---

## What This Is

A complete toolkit for turning local LLMs into a coordinated war council:

1. **MCP Server** (`mcp-server/`) — Model Context Protocol server that exposes delegation tools so a Conductor model can invoke specialist models without manual swapping. Plugin architecture with auto-discovery.

2. **War Table Dashboard** (`battle-log/`) — Real-time SSE-powered visualization of multi-model deliberation: Ace Attorney courtroom tournaments, Council Deliberation Theatre, Memory Constellation Graph, Token Economy HUD, Activity Timeline, TTS voices, ELO rankings.

3. **Copilot Agent Framework** (`.github/agents/`) — 12 specialized sub-agents for VS Code Copilot, each with domain expertise. Tournament system for architectural decisions. Full TDD enforcement.

4. **Memory Engine** (`memory-engine/`) — RAG system with vector store, file/conversation indexing, and cosine similarity search. Prompts are auto-augmented with relevant memory chunks.

5. **Benchmark Arena** (`mcp-server/benchmark/`) — Standardized coding challenges for model evaluation. Track win rates over time across your model arsenal.

6. **Cloud Failover** (`mcp-server/shared/cloud.js`) — Gemini + Groq integration with rate limiting and automatic failover when Ollama is overloaded.

7. **Universal Client Integrations** (`integrations/` + `docs/CLIENT_COMPATIBILITY.md`) — Ready-made MCP configs for Cursor, VS Code Copilot, Cline/Roo, Claude Code/Desktop, Gemini CLI/Antigravity, and Windsurf. One command plugs the council into any workspace:

   ```powershell
   node scripts/init-workspace.js D:/path/to/your-repo --hooks
   ```

   Auto-detects which AI clients the repo uses, writes their configs with correct paths, drops AGENTS.md rules, patches .gitignore, and (with `--hooks`) installs **adherence gates** — commits above a size threshold are blocked unless the council was actually consulted (`scripts/adherence-gate.js`; bypass with `WC_SKIP_GATE=1`).

8. **Complexity Fallback** — When a task exceeds local-model guardrails (`mcp-server/shared/ship-tier.js`), tools return a CALLER_HANDOFF block tailored to whichever client invoked the council (`WC_CALLER_CLIENT`), so your IDE's strong model takes over with full council context.

---

## Stack

```
┌──────────────────────────────────────────────────────────────────┐
│  VS Code                                                         │
│   ├── GitHub Copilot (Claude Opus) — primary agent interface     │
│   ├── Roo Code (RooVeterinaryInc.roo-cline) — MCP consumer      │
│   └── Continue.dev (optional) — inline chat / autocomp           │
│                                                                  │
│  Ollama (127.0.0.1:11434)                                        │
│   ├── Models on G:\ollama\models                                 │
│   ├── OLLAMA_NUM_PARALLEL=1 (single request, max GPU util)       │
│   ├── OLLAMA_FLASH_ATTENTION=1                                   │
│   ├── OLLAMA_KV_CACHE_TYPE=q8_0 (halves KV cache)               │
│   └── OLLAMA_KEEP_ALIVE=60m (keep models hot)                    │
│                                                                  │
│  RTX 5090 (sm_120 Blackwell, 32 GB GDDR7)                        │
└──────────────────────────────────────────────────────────────────┘
```

## Model Arsenal

| Slot | Model | VRAM (Q4_K_M) | Role |
|---|---|---|---|
| Heavy | `qwen2.5-coder:32b` | ~19 GB | Conductor, deep refactors |
| Mid-A | `qwen2.5-coder:14b` | ~9 GB | Domain agents (Flask, React) |
| Mid-B | `deepseek-r1:14b` | ~9 GB | Reasoning specialist |
| Fast | `qwen2.5-coder:7b` | ~5 GB | Workhorse — TestRunner, RepoScout |
| Embed | `nomic-embed-text` | ~0.3 GB | RAG over codebase |

## Quick Start

```powershell
# 1. Start Ollama (ensure env vars are set — see docs/CLINE_SETUP.md)
ollama serve

# 2. Start the MCP server
cd mcp-server
npm install
npm start

# 3. (Optional) Start the War Table dashboard
cd battle-log
node server.js
# Open http://localhost:3737/war-table
```

## Copilot Agent Framework

The `.github/agents/` directory contains 12 specialized sub-agents. Drop this entire `.github/` folder into any VS Code workspace to get:

- **Conductor** — Master orchestrator, tournament judge
- **Hypeman** — User-facing persona (rap-god / anime-villain energy)
- **CodeReviewer** — Pre-commit diff audit
- **TestWriter** / **TestRunner** — TDD enforcement
- **RepoScout** — Deep codebase exploration
- **QualityGatekeeper** — Coverage gates, blocks merges without tests
- **UXCritic / VisualAuditor / E2EPlaywright / CommitShipper / ShowcaseBuilder** — design, visual QA, e2e, and shipping specialists

These agents work with GitHub Copilot's chat interface. They're the "war council" — each brings domain expertise, and the Conductor coordinates them.

## Project Structure

```
war-council/
├── .github/
│   ├── agents/           # 12 specialized Copilot sub-agents
│   └── copilot-instructions.md  # Master operating manual
├── integrations/         # Ready-made MCP configs for every client
├── .githooks/            # Adherence + verification commit gates
├── mcp-server/           # MCP protocol server for Ollama delegation
│   ├── server.js         # Main MCP server (stdio transport)
│   ├── tool-registry.js  # Auto-discovery plugin system
│   ├── tools/            # Tool plugins (auto-loaded)
│   │   ├── consult-fast.js
│   │   ├── consult-specialist.js
│   │   ├── consult-reasoning.js
│   │   ├── tournament-vote.js
│   │   ├── council-deliberate.js
│   │   ├── council-debate.js
│   │   ├── benchmark-run.js
│   │   └── ...
│   ├── benchmark/        # Coding challenge suite
│   │   ├── challenges.js # 8 standardized eval problems
│   │   └── runner.js     # Execution + scoring engine
│   ├── shared/           # Shared modules
│   │   ├── config.js     # Arsenal config loader
│   │   ├── ollama.js     # Ollama API client
│   │   ├── cloud.js      # Gemini + Groq failover
│   │   ├── rate-limiter.js
│   │   ├── rag-augment.js
│   │   └── battle-events.js
│   └── council-deliberation.js
├── memory-engine/        # RAG vector store + indexers
│   ├── store.js          # JSON-backed vector store
│   ├── retriever.js      # Embedding + search
│   ├── indexer.js        # File walker + chunker
│   └── conversation-indexer.js
├── battle-log/           # War Table dashboard
│   ├── server.js         # HTTP + SSE + TTS proxy
│   ├── war-table.html    # Main dashboard UI
│   └── assets/           # Generated pixel-art sprites
├── tests/                # 340+ unit tests
├── docs/                 # Setup guides
├── scripts/              # Asset generation utilities
└── arsenal.json          # Model configuration
```

## License

MIT
