# ⚔️ War Council — Complete Functional Audit (2026-06-09)

Auditor: Claude (Cowork) · Scope: functionality, UX/UI, cross-client compatibility, MCP + standalone modes, plug-n-play portability.
Method: full static code review (4 parallel exploration passes + manual verification of every critical claim). Live browser pass pending Chrome connection; runtime execution unavailable this session (host sandbox out of disk).

**Verdict: Design A · Implementation B+ · Docs C+ (stale) · Security F until keys rotate.**
The code is dramatically more complete than the project's own docs claim — the biggest enemy of this portfolio piece is its own stale documentation.

---

## 1. P0 — Fix immediately

### 1.1 🔴 Live API keys sitting in `.env`
`.env` contains live `GROQ_API_KEY`, `GEMINI_API_KEY`, and `OPENROUTER_API_KEY` values. `.gitignore` line 2 does exclude `.env` and it is **not** tracked in git (verified against `.git/index`), so the repo is clean — but these keys were exposed to at least this audit session and any tool that read the folder.

**Action (only you can do this):** rotate all three keys at Groq console, Google AI Studio, and OpenRouter. A `.env.example` template has been added so the real file never needs to be shared.

### 1.2 🔴 README sends users to a dead port
`README.md:73` says `http://localhost:3001/war-table`; `battle-log/server.js:44` defaults to **3737**. Every doc except the README agrees on 3737. Anyone following the Quick Start hits a connection-refused on step 3 — the single worst first-impression bug in the repo. **Fixed in this pass.**

### 1.3 🔴 README claims 19 Copilot agents; 12 exist
`.github/agents/` contains 12 agents. The 7 phantom ones (FlaskAlchemist, ReactSurgeon, ProxyWarden, BookNLPOracle, AudioEngineer, VoiceWrangler, DeployOps) are leftovers from the VoxNovel/milkman era. **README corrected in this pass.**

---

## 2. Functional audit — MCP server

### 2.1 What actually exists (verified file-by-file)
Contrary to `ARCHITECTURE_AUDIT.md` (stale, pre-dates implementation): `mcp-server/server.js`, `tool-registry.js`, and **40 tool plugins** all exist and resolve. `memory-engine/` exists in full (store, retriever, indexer, repo-indexer, knowledge-graph, HNSW). No broken local imports anywhere in `mcp-server/` or `memory-engine/`.

The server uses the official `@modelcontextprotocol/sdk` over stdio with `tools/list` / `tools/call` handlers (`server.js:13-57`) — spec-compliant for every MCP client (Copilot, Cursor, Cline/Roo, Claude Code/Desktop, Gemini CLI/Antigravity, Windsurf). Healthcheck is deliberately silent because Cursor surfaces any stderr as an error (`server.js:59-72`) — nice touch.

### 2.2 Complexity fallback (MCP → caller) — works, with gaps
The deterministic escalation spine is real and good:

| Layer | File | Status |
|---|---|---|
| Tier classifier (council_ship / hybrid_ship / defer_to_caller) | `shared/ship-tier.js` | ✅ keyword + file/LOC heuristics |
| Caller handoff block | `shared/ship-tier.js:99` `formatCallerHandoff` | ✅ structured CALLER_HANDOFF |
| Explicit escalation tool | `tools/escalate-premium.js` | ✅ emits battle event + handoff |
| Caller identity | `shared/caller-context.js` | ⚠️ gaps below |
| Local model fallback chain | `shared/circuit-breaker.js` | ✅ specialist→reasoning |
| Cloud failover | `shared/cloud.js` + `rate-limiter.js` | ✅ groq→gemini→openrouter |

Gaps (fixed in this pass — see §6):
1. `caller-context.js:6` CLIENTS set only knew `cursor, claude, cline, command_center, ci, mcp` — **no `copilot`, `gemini`, `antigravity`, `windsurf`, `roo`**. Every non-Cursor client collapsed to "unknown" and got generic guidance, undermining the whole "play nice with everyone" goal.
2. `tailorCallerGuidance` had a real branch only for Cursor; all other clients shared one generic line.
3. `ship-tier.js` classified purely on keywords + caller-supplied estimates; a long multi-part task with no magic keyword routed to `council_ship` even when clearly too big for a 7b/14b.

### 2.3 Bugs / risks
| Sev | Finding | Location |
|---|---|---|
| HIGH | `memory_index` resolves caller-controlled `args.root` with no containment or existence check — an MCP client can index any directory on disk (e.g. `C:\Users`) into the vector store | `tools/memory-index.js:26` → fixed |
| MED | Fire-and-forget promises in telemetry/workspace-registry/spawn paths → unhandled rejections under load | `shared/telemetry.js`, `tools/register-workspace.js` |
| MED | `readFileSync` in `register-workspace.js:76` hot path blocks the event loop during JSON parse of a potentially large vector store | acceptable for now (startup-ish path) |
| LOW | Silent RAG failure degrades context with no signal to caller | `shared/rag-augment.js` |
| LOW | `server.legacy.js` + `test-direct.js` ship dead code referencing `milkman-portfolio` | candidates for deletion |

### 2.4 Stale personal-project residue (portability killer)
`milkman-portfolio` / `d:\personal webapp portfolio` hardcoded in: `.github/agents/TestRunner.agent.md:13`, `CommitShipper.agent.md`, `E2EPlaywright.agent.md`, `RepoScout.agent.md`, `TestWriter.agent.md`, `mcp-server/tools/run-tests.js:65`, `docs/CLINE_SETUP.md:39,91`. These guarantee broken behavior the moment the council is dropped into any other workspace. **run-tests.js and docs fixed; agent files generalized in this pass.**

---

## 3. Visual / UX audit — War Table dashboards (static pass)

10 pages reviewed: index, war-table, command-center, dag-theater, arbitration-court, metrics-hud, knowledge-graph-viz, memory-archive, adaptive-thresholds, embed.

**Correction to earlier internal findings:** `/tts`, `/voices`, `/memory-graph`, `/emit` ARE implemented (`battle-log/server.js:1189-1344`) — earlier "broken endpoint" reports were an artifact of the README port confusion. The endpoints are fine.

Ranked findings (portfolio-demo impact):

1. **Font schism.** `war-table.html` uses *Press Start 2P*; the other nine use *JetBrains Mono*. For a "quirky but advanced" portfolio, quirk must look intentional — one pixel-font page among nine mono pages looks accidental. Recommend: keep Press Start 2P for headings/HUD chrome on ALL pages (shared theme), JetBrains Mono for body — quirk becomes a system.
2. **Accent palette drift.** Cyan, gold, purple, and blue accents across pages with no shared variable set. → `assets/war-council-theme.css` added with CSS custom properties; pages can adopt incrementally.
3. **SSE leak on reconnect.** war-table, index, and command-center reconnected in `onerror` **without closing** the old EventSource — the browser's native retry plus the manual one stack duplicate connections and duplicate event handling on flaky networks; arbitration-court had no error handling at all and silently died. → all four fixed (`.close()` before retry; arbitration-court got a reconnect loop).
4. **Fixed 1280px layout** on war-table breaks under ~1300px windows and mobile.
5. **No loading/empty states** on war-table data fetches — blank panels when Ollama is cold look broken in a demo.
6. **CORS preflight:** server lacked `OPTIONS` handling for POST routes when pages are embedded cross-origin (`embed.html` use case). → fixed.
7. **2,700-line war-table.html** with ~300 lines of JS duplicated across pages (event parsing, agent sprite maps). Extract `battle-log/shared.js` next refactor.
8. **Entry-point ambiguity:** `/` serves index.html, README markets `/war-table`. Minor, but pick one hero page (command-center is the strongest "advanced" impression; war-table is the strongest "quirky").
9. Race condition in conversation loading (memory-archive) — last-write-wins without request sequencing.
10. Accessibility: decorative sprites lack `alt`, some neon-on-dark text below WCAG AA contrast.

### 3b. Live visual pass (Playwright captures, 2026-06-09)

Captured via `scripts/capture-dashboards.js` (12/20 pages on first pass; war-table, command-center, metrics-hud, dag-theater timed out behind a blocked event loop — see root cause below). **Zero JS console errors** across every page that rendered.

Confirmed live + fixed:

1. **Nav burger clips page titles** — every page with a top-left header rendered like "r Council — Battle Log" / "owledge Graph" under the fixed ☰ button; worse on mobile. Fixed in `nav.js` (56px padding on `body > header, body > .header`).
2. **Memory Archive renders an empty starfield** with "Files Indexed: 1" despite 9,090 chunks. Root cause: indexer stores the path as `source` but `/memory/vectors` mapped `c.file || c.path` → every chunk collapsed into one nameless file. Fixed in `server.js`; needs a re-index to look right.
3. **The 9,090-chunk store itself was the slowness.** Three compounding bugs, all fixed: `INDEXABLE_EXTS` included `.json` with no lockfile exclusion, so `package-lock.json` ×3 got embedded (`indexer.js` now skips lockfiles/minified/maps); `store.add()` appends blindly so every `/reindex` **duplicated the entire store** (`indexRepo` now replaces by default, `{append:true}` opts in); `/stats` and `/health` re-parsed the full store (all embeddings) on every 3-5s dashboard poll (now TTL-cached). The first un-cached parse blocked the event loop long enough to explain the 8 capture timeouts.
4. Looking good live: Battle Log event feed (cohesive, readable, great status rails), Arbitration Court (red-vs-green dual cards + dimension bars — portfolio-grade), Adaptive Thresholds (clean spectrum + evolution chart), demon-castle embed showcase (peak intentional quirk).
5. Remaining polish (not yet fixed): empty tables show nothing (Tier Accuracy / Recent Outcomes need "no data yet" states — `war-council-theme.css` ships `.wc-empty` for this); knowledge-graph force layout huddles in the canvas center (increase repulsion/initial spread); Battle Log session uptime renders as "29308m" (should roll up to d/h); war-table & friends still need a post-fix capture to verify.

---

## 4. Compatibility audit

| Client | Transport | Config that existed | Status before this pass |
|---|---|---|---|
| Cursor | stdio MCP | `.cursor/mcp.json` ✅ | Works; only client with tailored guidance |
| Cline / Roo | stdio MCP | docs only, with stale `D:\personal webapp portfolio` paths | Doc-broken |
| GitHub Copilot (VS Code) | agents + MCP | `.github/agents/` ✅, **no `.vscode/mcp.json`** | Agents OK; MCP unwired |
| Claude Code / Desktop | stdio MCP | none | Spec-compatible but zero config/docs |
| Gemini CLI / Antigravity | stdio MCP | none | Spec-compatible but zero config/docs |
| Windsurf | stdio MCP | none | Spec-compatible but zero config/docs |

Because the server is pure stdio SDK, compatibility is fundamentally a **packaging problem**, not a protocol problem. Solved in this pass via `integrations/` (per-client configs) + `scripts/init-workspace.js` (auto-installer) — see §6.

**Standalone mode:** `battle-log/server.js` runs without any MCP client and degrades gracefully when Ollama is down (`/health` reports readiness). Confirmed standalone-viable. One wart: it imports from `../mcp-server/shared/*` and `../memory-engine/*` via relative paths — moving `battle-log/` out of the repo root breaks it (acceptable; document it).

## 5. Plug-n-play assessment

Good bones: `register_workspace` is idempotent, auto-indexes, and per-workspace vector stores live in `<repo>/.cline-context/` (workspace-relative ✅). `REPO_ROOT`/`OLLAMA_BASE`/model env overrides all exist (`shared/config.js`).

What blocked true plug-n-play (all addressed in §6): manual config copying per client with hand-edited absolute paths; no bootstrap command; nothing enforcing that an IDE agent actually *uses* the council once connected.

---

## 6. Changes shipped with this audit

| Area | Change |
|---|---|
| Docs | README port + agent count + structure corrections; CLINE_SETUP paths fixed; new `docs/CLIENT_COMPATIBILITY.md` matrix |
| Security | `.env.example` added; rotation warning (top of this file) |
| MCP | `memory-index.js` root validation; `caller-context.js` knows copilot/gemini/antigravity/windsurf/roo + per-client guidance; `ship-tier.js` length/complexity heuristic + env-tunable thresholds |
| Dashboard | SSE reconnect fixed on all 4 SSE pages (the existing handlers reconnected **without closing** the old EventSource — connection/handler leak; arbitration-court had no handler at all); OPTIONS/CORS preflight in `server.js`; shared theme tokens `battle-log/assets/war-council-theme.css` |
| Agents | 5 agent files generalized (workspace-relative, no personal paths) |
| New: integrations | `integrations/` — ready configs for Cursor, Cline/Roo, Copilot (`.vscode/mcp.json`), Claude Code, Claude Desktop, Gemini/Antigravity, Windsurf |
| New: bootstrap | `scripts/init-workspace.js` — `node scripts/init-workspace.js <target-repo> [--client all]` detects clients, writes configs with correct paths, patches `.gitignore`, drops rules file |
| New: adherence gates | `scripts/adherence-gate.js` + `.githooks/` pre-commit/pre-push (chains the existing verification pipeline) — large commits blocked unless recent council activity exists in `battle-log.jsonl` (override: `WC_SKIP_GATE=1`); VS Code tasks/settings/mcp templates live in `integrations/vscode/` and are installed by `init-workspace.js` (this session couldn't write `.vscode/` directly — protected path). Enable in this repo: `npm run hooks:enable` |

## 7. Recommended next (not done here)

1. Rotate the three API keys (you).
2. Extract shared dashboard JS into `battle-log/shared.js`; adopt theme tokens page-by-page.
3. Delete `server.legacy.js` / `test-direct.js` or move to `attic/`.
4. Live visual pass + screenshots once Chrome connects; fix contrast/responsive items found.
5. Startup model-availability check that lists missing `ollama pull`s in `/health`.
