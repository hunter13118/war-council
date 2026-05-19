# Suggestions — Post-Phase Review

These are observations and improvement ideas noted during the Phase 1 audit.
**Not directives. Not approvals. Just notes for discussion after all phases complete.**

---

## Quick Wins (< 1 hour each)

1. **Stub `memory-engine/`** — Create minimal module that returns empty results. Unblocks server startup without building full RAG.

2. **Auto-create `.cline-context/` on first write** — Add `mkdir(recursive: true)` before JSONL append in server.js.

3. **Centralize ARSENAL config** — Single `arsenal.json` imported by server.js, test-direct.js, and docs generation. Eliminates drift.

4. **Startup healthcheck** — On server boot, ping `OLLAMA_BASE/api/version`. If unreachable, emit clear error + exit 1.

5. **Add `package-lock.json`** — Run `npm install` and commit the lock file. Deterministic builds.

---

## Medium Effort (1-4 hours)

6. **Tool handler registry** — Replace monolith switch with `Map<string, (args) => Promise<result>>`. Each handler in its own file under `mcp-server/tools/`.

7. **Context budget for chains** — Before passing `ctx.results[N]` into next step's prompt, truncate to a character budget (e.g., 4000 chars per prior result). Prevents 32K overflow.

8. **Unify event broadcast** — Remove SSE listener set from MCP server. Let the dashboard be the single SSE source. MCP server only writes to JSONL.

9. **Tournament judge extraction** — Move judge prompt + WINNER parsing into `judge.js` with dedicated tests. Handle `<think>` tags deterministically.

10. **JSONL rotation** — Cap battle-log at 10MB. On overflow, rename to `.1` and start fresh. Dashboard loads current + recent archive.

---

## Larger Items (half-day+)

11. **Real vector store** — Replace planned JSON linear scan with HNSW (e.g., `hnswlib-node`) or use SQLite with `sqlite-vss`. Sub-10ms queries at 50K chunks.

12. **Integration test harness** — Mock Ollama server (return canned responses). Run full MCP protocol test: initialize → list_tools → call each tool → verify output schema.

13. **Agent persona compression** — At `invoke_agent` time, extract only the relevant section of the .md file (strip examples, tables of other agents, etc.). Save ~50% of context budget.

14. **Rate limit tracking for cloud APIs** — Maintain a sliding window counter. If approaching limit, queue or warn instead of 429ing.

15. **Generalize away from VoxNovel** — Find-replace VoxNovel references in agent files. Make agents project-agnostic. Project-specific context should come from memory/context, not baked into persona.

---

## Architecture Questions for Decision

These aren't suggestions — they're open questions that need your input:

- **Should the memory-engine be a full RAG system or a lightweight grep-and-embed approach?**
- **Is the MCP server the permanent orchestration layer, or should Copilot agents eventually bypass it for direct Ollama calls?**
- **Should tournaments run actual parallel inference (OLLAMA_NUM_PARALLEL > 1) or serialize with the appearance of parallelism?**
- **Is the battle-log dashboard for active monitoring during work, or post-hoc analysis, or both?**
- **Should cloud escalation (Gemini/Groq) be always-available or explicit opt-in per session?**

---

*These suggestions will be reviewed after all phases are complete.*
