# ⚔️ War Council — Local AI Agent Orchestration

Local-first, Ollama-powered multi-model agent framework. Runs entirely on the workstation (RTX 5090, 32 GB VRAM). No cloud dependencies, no API keys, no subscription fees.

---

## What This Is

A complete toolkit for turning local LLMs into a coordinated war council:

1. **MCP Server** (`mcp-server/`) — Model Context Protocol server that exposes delegation tools so a Conductor model can invoke specialist models without manual swapping.

2. **War Table Dashboard** (`battle-log/`) — Real-time SSE-powered visualization of multi-model deliberation: who's thinking, what they said, tournament voting, battle logs with JSONL persistence.

3. **Copilot Agent Framework** (`.github/agents/`) — 19 specialized sub-agents for VS Code Copilot, each with domain expertise. Tournament system for architectural decisions. Full TDD enforcement.

4. **Cline/Roo Integration** (`docs/CLINE_SETUP.md`) — Wire the MCP server into Roo Code or Cline for local-first agentic coding.

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
# Open http://localhost:3001/war-table
```

## Copilot Agent Framework

The `.github/agents/` directory contains 19 specialized sub-agents. Drop this entire `.github/` folder into any VS Code workspace to get:

- **Conductor** — Master orchestrator, tournament judge
- **Hypeman** — User-facing persona (rap-god / anime-villain energy)
- **CodeReviewer** — Pre-commit diff audit
- **TestWriter** / **TestRunner** — TDD enforcement
- **RepoScout** — Deep codebase exploration
- **QualityGatekeeper** — Coverage gates, blocks merges without tests
- And 13 more domain specialists...

These agents work with GitHub Copilot's chat interface. They're the "war council" — each brings domain expertise, and the Conductor coordinates them.

## Project Structure

```
war-council/
├── .github/
│   ├── agents/           # 19 specialized Copilot sub-agents
│   ├── copilot-instructions.md.reference  # Full instruction template
├── mcp-server/           # MCP protocol server for Ollama delegation
│   ├── server.js         # Main MCP server (stdio transport)
│   ├── council-deliberation.js
│   ├── decision-router.js
│   └── task-chains.js
├── battle-log/           # War Table dashboard (SSE + HTML)
│   ├── server.js         # HTTP + SSE server
│   ├── war-table.html    # Main dashboard UI
│   ├── index.html        # Battle log viewer
│   └── assets/           # Generated pixel-art agent sprites
├── docs/                 # Setup guides
├── scripts/              # Asset generation, utilities
└── .prompt.md.reference  # Persona/style template
```

## License

MIT
