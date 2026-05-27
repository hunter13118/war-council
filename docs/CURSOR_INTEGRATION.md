# Cursor Pro + War Council Integration

## How It Works

Cursor connects to War Council as an **MCP tool provider** via stdio. This means Cursor's AI agent can call War Council's tools directly — routing cheap tasks to local models (free) and expensive tasks through Cursor's own Claude budget.

## Setup

1. **Start the War Council dashboard** (optional but recommended for monitoring):
   ```powershell
   node --env-file=.env battle-log/server.js --port 3737
   ```

2. **Open Cursor** in the `war-council` directory. Cursor reads `.cursor/mcp.json` and auto-connects to the MCP server.

3. **Use normally.** Cursor's agent will see War Council's tools in its tool list and can call them.

## Available Tools (33 total)

### Model Consultation (free, local)
| Tool | What it does |
|------|--------------|
| `consult_fast` | Quick answer from 7b model (~200 tok/s) |
| `consult_specialist` | Domain answer from 14b model (~80 tok/s) |
| `consult_reasoning` | Deep reasoning from deepseek-r1 (~60 tok/s) |
| `consult_cloud` | Cloud escalation (Gemini/Groq/OpenRouter — free tiers) |
| `tournament_vote` | Multi-model vote on a decision |
| `council_debate` | Full council debate with multiple perspectives |
| `council_deliberate` | Structured deliberation with verdict |

### Memory & RAG (free, no LLM needed)
| Tool | What it does |
|------|--------------|
| `memory_index` | Index workspace files into vector store |
| `memory_query` | Semantic search over codebase (HNSW) |
| `memory_stats` | Vector store statistics |
| `memory_index_conversations` | Index conversation history |
| `memory_recall_conversation` | Retrieve relevant past conversations |

### Code Intelligence (free, no LLM needed)
| Tool | What it does |
|------|--------------|
| `smart_route` | Auto-route task to best tool/chain |
| `run_chain` | Execute multi-step task pipelines |
| `run_dag` | Execute parallel task DAGs |
| `review_diff` | Code review on git diffs |
| `run_tests` | Execute test suites |
| `self_eval` | Self-evaluate a response for quality |

### Operations
| Tool | What it does |
|------|--------------|
| `list_arsenal` | Show available models and their roles |
| `prewarm_loadout` | Pre-load models into VRAM |
| `switch_workspace` | Change active workspace |
| `log_decision` | Log a decision to battle-log |
| `launch_battle_log` | Open dashboard in browser |
| `benchmark_run` | Run model benchmarks |

### Context Management
| Tool | What it does |
|------|--------------|
| `compress_context` | Compress long context for token savings |
| `scratchpad_read` | Read from persistent scratchpad |
| `scratchpad_write` | Write to persistent scratchpad |
| `strategic_plan` | Generate multi-step strategic plan |

## Token Savings Strategy

When Cursor's agent encounters a task:

1. **RAG first** — `memory_query` retrieves relevant code context without any LLM call (zero tokens)
2. **Local draft** — `consult_fast` gets a quick answer from the 7b model (free)
3. **Verify locally** — `self_eval` checks quality with local model (free)
4. **Only if needed** — Cursor's own Claude budget handles genuinely hard synthesis

This can reduce Cursor Pro token consumption by **40-70%** depending on workload.

## Monitoring

Open `http://localhost:3737/command-center` to see:
- Every tool call in real-time (SSE stream)
- Model usage stats
- Provider health status
- Confidence scores and routing decisions

## Environment Variables

Set in `.env` at repo root:
```
OLLAMA_BASE=http://127.0.0.1:11434
GROQ_API_KEY=your_key          # Optional: cloud fallback
GEMINI_API_KEY=your_key        # Optional: cloud fallback
OPENROUTER_API_KEY=your_key    # Optional: cloud fallback
```
