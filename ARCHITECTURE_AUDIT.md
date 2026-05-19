# Phase 1 — Architecture Audit: War Council

**Auditor:** Copilot (Claude Opus 4.6)
**Date:** 2026-05-18
**Scope:** Full system reverse-engineering, no redesign proposals

---

## 1. Subsystem Map

### 1.1 MCP Server (`mcp-server/server.js` — ~2100 LOC, monolith)

The core orchestration brain. Exposes 25+ tools over stdio JSON-RPC (MCP protocol). Single-file monolith with all logic co-located.

**Sub-modules imported:**
| Module | File | Status |
|---|---|---|
| Task Chains | `task-chains.js` | ✅ Present, functional |
| Decision Router | `decision-router.js` | ✅ Present, functional |
| Council Deliberation | `council-deliberation.js` | ✅ Present, functional |
| Memory Retriever | `../memory-engine/retriever.js` | ❌ **MISSING** — import will crash |
| Memory Indexer | `../memory-engine/indexer.js` | ❌ **MISSING** — import will crash |
| Conversation Indexer | `../memory-engine/conversation-indexer.js` | ❌ **MISSING** — import will crash |
| Vector Store | `../memory-engine/store.js` | ❌ **MISSING** — import will crash |

**Tool Categories:**
1. **Delegation** (4): `consult_fast`, `consult_specialist`, `consult_reasoning`, `tournament_vote`
2. **Cloud Escalation** (3): `consult_cloud`, `strategic_plan`, `rapid_fan_out`
3. **Agentic/Workflow** (5): `invoke_agent`, `prewarm_loadout`, `request_user_feedback`, `review_diff`, `run_tests`
4. **Sovereign Memory** (6): `memory_query`, `memory_recall_conversation`, `memory_index`, `memory_index_conversations`, `memory_stats`, `log_decision`
5. **Orchestration** (6): `run_chain`, `smart_route`, `self_eval`, `compress_context`, `council_deliberate`, `council_debate`
6. **Utility** (3): `scratchpad_read`, `scratchpad_write`, `launch_battle_log`
7. **Vision** (1): `visual_consult`

### 1.2 Battle Log Dashboard (`battle-log/` — 2 HTML files + Node server)

| Component | Role |
|---|---|
| `server.js` | HTTP + SSE server on port 3737. Serves HTML, streams events, persists to JSONL, proxy TTS |
| `index.html` | Timeline-style battle log viewer (dark theme, SSE-fed) |
| `war-table.html` | Pixel-art round-table visualization with agent sprites + speech bubbles |

**Capabilities:**
- Real-time SSE streaming of all tool calls
- Tournament leaderboard tracking (win/loss/streak)
- Manual event injection (`POST /emit`)
- Voice assignment per agent (persisted to `voices.json`)
- Edge Neural TTS proxy (server-side WebSocket to Bing)
- File-watching log tail (polls every 500ms)
- Static asset serving with path-traversal guard

### 1.3 Copilot Agent Framework (`.github/agents/` — 19 agent files)

Markdown persona definitions loaded at runtime by `invoke_agent` tool. Each file defines:
- Role description
- Delegation matrix
- Pipeline templates
- Domain constraints

**Agents:** AudioEngineer, BookNLPOracle, BugMapper, CodeReviewer, CommitShipper, Conductor, DeployOps, E2EPlaywright, FlaskAlchemist, Hypeman, ProxyWarden, QualityGatekeeper, ReactSurgeon, RepoScout, TestRunner, TestWriter, UXCritic, VisualAuditor, VoiceWrangler

### 1.4 Memory Engine (`memory-engine/` — **DOES NOT EXIST**)

Referenced in 4 imports from `server.js`:
- `retriever.js` — cosine similarity search over embedded chunks
- `indexer.js` — walks git-tracked files, chunks, embeds via Ollama
- `conversation-indexer.js` — indexes past Copilot/Cline transcripts
- `store.js` — JSON-backed vector store class

**Impact:** Server cannot start. This is a **hard blocker** for the entire MCP server.

### 1.5 Task Chain Engine (`task-chains.js`)

Pre-built multi-step workflows:
- `fix_bug` — memory → plan → test-first → implement → review (5 steps)
- `new_feature` — search patterns → strategic plan → implement → tests → batch review (5 steps)
- `refactor` — understand → plan → baseline tests → implement → behavioral diff (5 steps)
- `investigate` — memory + conversations → parallel analysis → synthesis (4 steps)

Chains reference previous step outputs via `context.results[N]`. Conditional steps and optional failure tolerance supported.

### 1.6 Decision Router (`decision-router.js`)

Keyword-pattern-matching router. Analyzes task description → recommends tool or chain.
8 keyword categories: bug, feature, refactor, investigate, architecture, testing, review, performance.
Default fallback: `memory_query`.

### 1.7 Council Deliberation (`council-deliberation.js`)

Three deliberation modes:
1. **Sequential Deliberation** — N panelists speak in order, each sees prior responses → synthesis
2. **Adversarial Debate** — 2 models argue N rounds → judge picks winner
3. **Consensus Building** — parallel fan-out → merge insights

Plus a shared scratchpad (file-based, timestamped entries in `.cline-context/`).

### 1.8 Cloud Escalation Layer

| Provider | Model | Free Tier Limits | Use Case |
|---|---|---|---|
| Google Gemini | `gemini-2.5-flash` | 15 RPM, 1500 req/day, 1M context | Strategic planning, massive context analysis |
| Groq | `llama-3.3-70b-versatile` | 30 RPM, 14400 req/day | Fast parallel fan-out, self-eval, compression |

Both gated behind env var API keys. Graceful error if not set.

---

## 2. Dependency Map

```
┌─────────────────────────────────────────────────────────────────────┐
│                       VS Code (Host)                                 │
│                                                                     │
│  ┌─────────────┐    ┌───────────────────┐    ┌──────────────────┐  │
│  │ Copilot     │    │ Roo Code/Cline    │    │ Continue.dev     │  │
│  │ (19 agents) │    │ (MCP consumer)    │    │ (optional)       │  │
│  └─────────────┘    └───────┬───────────┘    └──────────────────┘  │
│                             │ stdio JSON-RPC                        │
└─────────────────────────────┼──────────────────────────────────────┘
                              │
                    ┌─────────▼─────────┐
                    │  MCP Server        │
                    │  (server.js)       │
                    │                   │
                    │  ┌─────────────┐  │
                    │  │task-chains  │  │
                    │  │decision-rtr │  │
                    │  │deliberation │  │
                    │  └─────────────┘  │
                    └───┬────┬────┬─────┘
                        │    │    │
           ┌────────────┘    │    └───────────────┐
           │                 │                    │
  ┌────────▼────────┐  ┌────▼─────┐    ┌────────▼────────┐
  │ Ollama          │  │ Cloud    │    │ memory-engine   │
  │ (127.0.0.1:     │  │ APIs     │    │ (❌ MISSING)    │
  │  11434)         │  │          │    │                 │
  │                 │  │ • Gemini │    │ • retriever     │
  │ • fast (7b)    │  │ • Groq   │    │ • indexer       │
  │ • specialist   │  │          │    │ • conv-indexer  │
  │   (14b)        │  └──────────┘    │ • vector store  │
  │ • reasoning    │                   └─────────────────┘
  │   (14b)        │
  │ • heavy (32b)  │         ┌─────────────────────────┐
  │ • embed        │         │ Battle Log Dashboard    │
  │ • vision       │         │ (port 3737)             │
  └────────────────┘         │                         │
                             │ • SSE stream            │
          ┌─────────────────►│ • Tournament tracker    │
          │  events via      │ • TTS proxy (Edge)      │
          │  JSONL file      │ • War Table UI          │
          │                  └─────────────────────────┘
          │
  ┌───────┴──────────┐
  │ .cline-context/  │
  │ battle-log.jsonl │
  │ council-scratch  │
  │ (❌ DIR MISSING)  │
  └──────────────────┘
```

### External Dependencies (npm)
- `@modelcontextprotocol/sdk` ^1.0.4 — MCP protocol implementation
- `ws` ^8.20.0 — WebSocket client (for Edge TTS proxy)

### Runtime Dependencies
- **Node.js** — both servers
- **Ollama** — local model inference (REQUIRED for all delegation tools)
- **Gemini API Key** — optional, for strategic_plan + consult_cloud(gemini)
- **Groq API Key** — optional, for rapid_fan_out + self_eval + compress_context
- **Git** — for review_diff tool
- **.github/agents/*.agent.md** — for invoke_agent tool

---

## 3. Orchestration Flow

### 3.1 Primary Tool Call Lifecycle

```
Consumer (Roo/Cline) → stdio → MCP Server
  → emitBattleEvent("tool_start")
  → [execute tool logic]
    → Ollama generate / Cloud API / local computation
  → emitBattleEvent("tool_complete" | "tool_error")
  → return MCP result to consumer
```

### 3.2 Task Chain Execution Flow

```
smart_route(task_description)
  → keyword matching → chain recommendation

run_chain(chain_name, inputs)
  → validate required inputs
  → for each step:
    → check condition (skip if false)
    → resolve args (may reference ctx.results[N])
    → internalExecute(tool, args)
    → store result in context.results
  → return aggregated step summary
```

### 3.3 Tournament Vote Flow

```
tournament_vote(prompt, voters)
  → Promise.all(voters.map(ollamaGenerate))
  → emit debate_round events per pair
  → judge pass (reasoning model)
    → parse WINNER/REASON from judge response
  → emit tournament_result (winner/loser + rationale)
  → return all responses + verdict
```

### 3.4 Council Deliberation Flow

```
deliberate(topic, panelists)
  → for each panelist (sequential):
    → build prompt with all previous responses
    → generate response
    → append to transcript
  → synthesis pass (specialist model reads all)
  → append to scratchpad
  → return rounds + synthesis
```

---

## 4. Current State Assessment

### ✅ What Works Well

1. **MCP protocol compliance** — Proper JSON-RPC, ListTools/CallTool handlers, stdio transport. Verified by `test-mcp-client.js`.

2. **Tool-call architecture** — Clean switch-case dispatch. Each tool is self-contained. Good error handling with try/catch wrapping.

3. **Retry logic** — `withRetry()` with exponential backoff is solid. Used consistently for Ollama + cloud calls.

4. **Battle event system** — Dual-write (JSONL file + SSE push). All tools emit start/complete/error events. Dashboard gets full visibility.

5. **Cloud escalation design** — Gemini for strategic planning (1M context), Groq for speed (parallel fan-out). Smart division of labor.

6. **Agent persona system** — Loading .md files as system prompts for `invoke_agent` is elegant and extensible. No code changes needed to add agents.

7. **Task chains** — Well-designed pipeline abstraction. Steps can be conditional, optional, and reference prior outputs. Clean separation from tool dispatch.

8. **Dashboard UX** — War Table pixel-art round table is creative. SSE real-time feed works. Tournament tracking, TTS voice proxy, multiple views.

9. **VRAM awareness** — Arsenal config, loadout documentation, prewarm tool. Understanding of single-GPU constraints.

10. **Path traversal guard** — Static asset serving validates resolved paths stay within `__dirname`.

### ⚠️ What Is Fragile

1. **Memory Engine is a hard crash** — 4 imports from a nonexistent `../memory-engine/` directory. Server will fail at import time. 6 tools + chain internals depend on it. This blocks everything.

2. **Single-file monolith (server.js ~2100 LOC)** — All tool handlers in one switch statement. Growing complexity makes changes risky. No unit tests for individual handlers.

3. **Log file polling** — Dashboard uses `setTimeout(watchLog, 500)` to poll the JSONL file. Under high tool-call volume, this could miss events or create read-during-write races.

4. **No input validation on MCP tool args** — Tool handlers trust consumer input directly. Missing prompt strings, null args, or oversized inputs could cause unexpected behavior.

5. **Hardcoded model names in ARSENAL** — If a model isn't pulled or is renamed, tools silently fail or get cryptic Ollama errors. No startup health check.

6. **Tournament judge parsing** — Multiple regex patterns to extract WINNER/REASON from free-form model output. Reasoning models (deepseek-r1) produce `<think>` tags that complicate parsing. Fragile string matching.

7. **Chain step error propagation** — If `memory_query` fails (no memory-engine), ALL chains abort at step 1 since memory is always the first step and not marked optional.

8. **Cloud API keys in env vars** — If keys are missing, strategic_plan and self_eval throw at call time with no graceful degradation. Chains that use these tools would half-execute.

9. **Edge TTS WebSocket** — Uses hardcoded `TRUSTED_TOKEN` and version-specific `SEC_MS_GEC_VERSION`. When Microsoft updates Edge, this silently breaks.

10. **`.cline-context/` directory** — Expected by both JSONL persistence and scratchpad. If missing, `appendFile` will fail (no `mkdir -p` before first write in battle-log path). Scratchpad has `mkdir` logic, but battle-log does not.

### 🔄 What Is Redundant

1. **Battle event emit in BOTH server.js** — MCP server has `emitBattleEvent()` writing to JSONL + pushing to SSE listeners. Dashboard server ALSO watches that file and re-broadcasts. Two systems doing overlapping work.

2. **Tournament tracking duplicated** — Dashboard server maintains `tournamentRecords` in-memory AND rebuilds from JSONL on startup. MCP server also emits structured tournament events. The logic for win/loss/streak is duplicated across POST /emit handler AND broadcast() AND loadHistory().

3. **Decision router vs. chain system** — `smart_route` recommends a chain, but chains themselves don't call `smart_route`. Two layers of routing that could conflict if used together incorrectly.

4. **ARSENAL defined 3 times** — Once in `server.js` (source of truth), once in `test-direct.js` (duplicated), and implicitly in README docs. Drift risk.

5. **invoke_agent re-implements what Copilot agents already do** — The `.github/agents/` files are designed for VS Code Copilot's native agent system. `invoke_agent` loads the same files for Ollama consumption. Parallel paths to same persona.

### 🚫 What Should Remain Untouched

1. **MCP protocol layer** — The `@modelcontextprotocol/sdk` integration and stdio transport are working correctly. Don't touch.

2. **Agent persona files** (`.github/agents/`) — These are mature, well-written, and work with VS Code Copilot natively. Only update content, not format.

3. **Cloud API functions** (`geminiGenerate`, `groqGenerate`) — Clean, well-structured, proper error handling. No changes needed.

4. **Retry wrapper** (`withRetry`) — Correct implementation, good defaults. Leave as-is.

5. **Ollama generate/load functions** — Well-tested, proper response parsing, timing metrics. Stable.

### 🔧 What Should Be Isolated/Refactored

1. **Memory Engine** — Must be created or the server is non-functional. Should be its own module with clear interface.

2. **Tool handlers** — Extract from monolith switch into individual files or a handler registry.

3. **Battle event system** — Unify the two broadcast paths (MCP server direct SSE vs. JSONL file watching).

4. **Tournament judge parsing** — Extract into its own function with tests. The regex/string-matching logic is complex enough to warrant isolation.

5. **TTS proxy** — Move from battle-log server into a separate utility. It's an independent feature that doesn't belong in the event server.

---

## 5. Risk Analysis

### 🔴 Critical — Immediate Blockers

| Risk | Impact | Location |
|---|---|---|
| Missing `memory-engine/` | Server won't start AT ALL | `server.js` lines 40-44 |
| Missing `.cline-context/` dir | JSONL writes fail silently | `server.js` line 69, `battle-log/server.js` |
| No `package-lock.json` | Non-deterministic dependency resolution | Both `package.json` files |

### 🟡 High — Stability Risks

| Risk | Impact | Location |
|---|---|---|
| Single OLLAMA_NUM_PARALLEL=1 | All tools serialize; tournament "parallel" is actually sequential | System architecture |
| No health check on startup | Tools fail with cryptic errors if Ollama is down | `server.js` |
| Unbounded prompt concatenation in chains | Context overflow for local models (32K limit) | `task-chains.js` |
| Log file polling race | Events dropped under high throughput | `battle-log/server.js` line 141 |
| Edge TTS token/version hardcoded | Will break silently on next Edge update | `battle-log/server.js` line ~400 |

### 🟠 Medium — Scaling Risks

| Risk | Impact | Location |
|---|---|---|
| JSON vector store (no indexing) | O(n) linear scan on every query | (planned) `memory-engine/store.js` |
| Tournament judge on reasoning model | Adds ~10-30s latency to every tournament | `server.js` tournament_vote handler |
| Full agent .md loaded per invoke_agent call | Wastes tokens on boilerplate | `server.js` invoke_agent handler |
| JSONL unbounded growth | Dashboard load time degrades over weeks | `.cline-context/battle-log.jsonl` |
| No rate limiting on cloud APIs | Could exhaust free tiers in one burst session | `server.js` cloud handlers |

### 🟢 Low — Technical Debt

| Risk | Impact | Location |
|---|---|---|
| README claims OLLAMA_NUM_PARALLEL=1 but CLINE_SETUP says =4 | Config confusion | `README.md` vs `docs/MCP_SERVER.md` |
| `test-direct.js` duplicates ARSENAL | Drift from server config | `test-direct.js` |
| VoxNovel references in agent files | Confusing for new contributors | `.github/agents/Conductor.agent.md` |
| No TypeScript / no JSDoc types | Refactoring without IDE support | All files |
| Dashboard dashboard launch path wrong | `launch_battle_log` resolves to non-existent subdir | `server.js` line ~2095 |

---

## 6. Highest-ROI Improvements

| Priority | Improvement | Why |
|---|---|---|
| **P0** | Create `memory-engine/` module (even a stub that returns empty results) | Unblocks server startup entirely |
| **P0** | Ensure `.cline-context/` directory creation | Prevents silent write failures |
| **P1** | Startup health check (Ollama reachable? Required models pulled?) | Fail fast with actionable error |
| **P1** | Extract tool handlers into registry pattern | Enables unit testing, reduces monolith risk |
| **P2** | Unify battle event system (single path, not dual file+SSE) | Eliminates race conditions and duplication |
| **P2** | Add context truncation/budgeting to chains | Prevents context overflow on local models |
| **P3** | Generalize agent files (remove VoxNovel specifics) | Makes framework reusable |
| **P3** | Add integration test suite (MCP protocol + mock Ollama) | Regression safety for 25+ tools |

---

## 7. Dangerous Architectural Debt

1. **Memory Engine Phantom Dependency** — The most critical debt. The server.js imports code that doesn't exist. Every feature downstream of memory (chains, queries, conversation recall, indexing) is dead code. This creates a false sense of completeness in the tool listing.

2. **Monolith Tool Switch** — At 2100 LOC in one file with a single switch statement handling 25+ tools, one misplaced bracket or early return corrupts all tools. No isolation between tool failures.

3. **Dual Event System** — The MCP server pushes directly to SSE listeners AND writes to file. The dashboard server watches the file AND maintains its own state. If either gets out of sync (crash, restart, partial write), the dashboard shows stale or duplicated events.

4. **Unbudgeted Context in Chains** — Chains concatenate results from prior steps into prompts for next steps. With 5 steps, each returning 2048 tokens, you can easily exceed 32K context. No truncation, no compression, no budget enforcement.

5. **OLLAMA_NUM_PARALLEL Conflict** — README says 1 (max GPU util), MCP_SERVER doc says 4. Tournament_vote uses `Promise.all()` for parallel inference. If NUM_PARALLEL=1, these serialize anyway and the "wall time" metric is misleading.

---

## 8. Likely Future Bottlenecks

1. **Vector store at scale** — A JSON file with linear cosine search will become unacceptable past ~10K chunks. Need HNSW or similar ANN index.

2. **VRAM contention during tournaments** — Loading 3 different models for a tournament requires model swaps. With 32GB VRAM, only certain loadout combinations fit simultaneously.

3. **Cloud rate limits during intensive sessions** — A single `run_chain("new_feature")` touches Gemini (strategic_plan) + Groq (rapid_fan_out) + local models. A few chains in rapid succession will hit free tier limits.

4. **JSONL log growth** — No rotation, no compression, no TTL. After months of use, the battle log file will grow unbounded.

5. **Agent persona token overhead** — Loading full `.agent.md` files (some 100+ lines) as system prompts for every `invoke_agent` call wastes significant context on a 32K window model.

---

*End of audit. No redesign proposals included per directive. System is ready for Phase 2 when directives arrive.*
