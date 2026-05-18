# 🐉 Jedi War Council — Local LLM Stack

Local-first, Ollama-powered replacement for the cloud Copilot agent loop.
Runs entirely on the workstation (RTX 5090, 32 GB VRAM).

---

## Stack

```
┌──────────────────────────────────────────────────────────────────┐
│  VS Code                                                         │
│   ├── Roo Code (RooVeterinaryInc.roo-cline) — agentic interface │
│   └── Continue.dev (optional sidekick) — inline chat / autocomp │
│                                                                  │
│  Ollama (127.0.0.1:11434)                                        │
│   ├── Models on G:\ollama\models                                 │
│   ├── OLLAMA_MAX_LOADED_MODELS=4 (parallel models)               │
│   ├── OLLAMA_NUM_PARALLEL=4 (concurrent requests per model)      │
│   ├── OLLAMA_FLASH_ATTENTION=1                                   │
│   ├── OLLAMA_KV_CACHE_TYPE=q8_0 (halves KV cache)                │
│   └── OLLAMA_KEEP_ALIVE=30m (keep models hot)                    │
│                                                                  │
│  RTX 5090 (sm_120 Blackwell, 32 GB GDDR7)                        │
└──────────────────────────────────────────────────────────────────┘
```

## Arsenal (target)

| Slot | Model | VRAM (Q4_K_M) | Role |
|---|---|---|---|
| Heavy | `qwen2.5-coder:32b` | ~19 GB | Conductor, deep refactors |
| Mid-A | `qwen2.5-coder:14b` | ~9 GB | Domain agents (Flask, React) |
| Mid-B | `deepseek-r1:14b` | ~9 GB | Reasoning specialist |
| Fast | `qwen2.5-coder:7b` | ~5 GB | Workhorse — TestRunner, RepoScout |
| Tiny | `qwen2.5-coder:1.5b` | ~1.5 GB | Linters, quick tasks |
| Embed | `nomic-embed-text` | ~0.3 GB | RAG over codebase |

## Concurrent Loadouts (29 GB working budget)

**Loadout A — Solo Heavy + Swarm (~29 GB):**
- 1× 32B (19) + 2× 7B (10) + embed (0.3)
- Conductor + 2 worker agents in parallel

**Loadout B — Tournament Voting (~27 GB):**
- 3× 14B (qwen-coder, deepseek-r1, swap third) + embed (0.3)
- Real architectural diversity for tournament decisions

## Validated (2026-05-03)

- ✅ Ollama 0.22.1 installed, GPU acceleration confirmed on Blackwell sm_120
- ✅ Storage routed to `G:\ollama\models` (327 GB free, NVMe)
- ✅ qwen2.5-coder:1.5b smoke test: **443 tok/s** sustained generation
- ✅ Cold load 986 MB → VRAM in 55s; warm response 7.6s for 365 tokens

## Quick Commands

```powershell
# Server status
Invoke-RestMethod http://127.0.0.1:11434/api/version

# List models
ollama list

# Pull new model (lands on G:)
ollama pull qwen2.5-coder:14b

# Test generate
$body = @{ model = "qwen2.5-coder:7b"; prompt = "..."; stream = $false } | ConvertTo-Json
Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/generate" -Method Post -Body $body -ContentType "application/json"

# GPU check
nvidia-smi --query-gpu=memory.used,memory.free,utilization.gpu --format=csv
```

## Roo Code setup

1. Open Roo Code from VS Code sidebar (whale icon)
2. Click ⚙ settings
3. **API Provider:** `Ollama`
4. **Base URL:** `http://localhost:11434`
5. **Model:** `qwen2.5-coder:7b` (or whichever is pulled)
6. Save → first task in chat panel to validate

## Roo Code custom modes

`.roo/` directory in workspace will hold ports of `.github/agents/*.agent.md`
mapped to specific Ollama models. See `MODES.md` (TODO).

## Next milestones

- [ ] Pull full arsenal (`qwen2.5-coder:32b`, `:14b`, `deepseek-r1:14b`, `:7b` ✅, `:1.5b` ✅, `nomic-embed-text`)
- [ ] First Roo Code task against local Ollama
- [ ] Port Conductor agent → Roo custom mode
- [ ] Port Hypeman, FlaskAlchemist, ReactSurgeon, etc.
- [ ] Build `war-council-router/` Node service for parallel tournament voting
- [ ] MCP tool exposure (test runners, deploy, BookNLP)
