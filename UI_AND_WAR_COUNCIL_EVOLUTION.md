# Phase 6 — UI & War Council Evolution

**Purpose:** Evolve the Battle Log UI from a passive event viewer into a living cognition visualization system — a developer-grade tactical command center that communicates what agents are doing, why, with what evidence, and where things went sideways.

**Design Philosophy:** Immersive theater meets engineering observability. The existing pixel-art council aesthetic stays — we enhance it with real-time data feeds, execution graphs, and confidence heatmaps.

---

## 1. UI Architecture

### 1.1 System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         WAR TABLE UI ARCHITECTURE                             │
│                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                        PRESENTATION LAYER                              │ │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐  │ │
│  │  │ Council  │ │ DAG      │ │ Memory   │ │ Metrics  │ │ Arbitration│  │ │
│  │  │ Chamber  │ │ Theater  │ │ Archive  │ │ HUD      │ │ Court      │  │ │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └────────────┘  │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                        RENDERING ENGINE                                │ │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐  │ │
│  │  │ Canvas2D │ │ CSS      │ │ SVG      │ │ Particle │ │ Animation  │  │ │
│  │  │ Graphs   │ │ Sprites  │ │ Diagrams │ │ System   │ │ Timeline   │  │ │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └────────────┘  │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                        STATE MANAGEMENT                                │ │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────────────┐  │ │
│  │  │ Event    │ │ View     │ │ Timeline │ │ Derived State            │  │ │
│  │  │ Store    │ │ State    │ │ Cursor   │ │ (computed from events)   │  │ │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                        DATA LAYER (SSE + REST)                         │ │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────────────┐  │ │
│  │  │ SSE      │ │ REST     │ │ Event    │ │ Reconnection             │  │ │
│  │  │ Client   │ │ Fetcher  │ │ Buffer   │ │ + Backfill               │  │ │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 View System (Tab-Based, No Framework)

The UI uses vanilla HTML/CSS/JS (matching existing `war-table.html` approach). Views are tab-swapped panels, not SPAs:

| View | Purpose | Primary Visuals |
|---|---|---|
| **Council Chamber** | Agent activity, debates, deliberation | Pixel-art sprites, speech bubbles, Ace Attorney battles |
| **DAG Theater** | Execution graph visualization | SVG DAG renderer, animated node states |
| **Memory Archive** | Vector space + knowledge graph | Force-directed graph, search interface |
| **Metrics HUD** | Live performance dashboard | Sparklines, gauges, heatmaps |
| **Arbitration Court** | Conflict history + resolution | Timeline, side-by-side diff view |

### 1.3 File Structure

```
battle-log/
├── index.html              // Entry point (navigation frame)
├── war-table.html          // Council Chamber (existing, enhanced)
├── dag-theater.html        // Execution DAG visualization
├── memory-archive.html     // Memory + retrieval viz
├── metrics-hud.html        // Live metrics dashboard
├── arbitration-court.html  // Conflict resolution history
├── server.js               // Enhanced SSE server
├── shared/
│   ├── event-bus.js        // Cross-view pub/sub
│   ├── sse-client.js       // Reconnecting SSE with backfill
│   ├── state-store.js      // Centralized event-sourced state
│   ├── animations.js       // Shared animation utilities
│   ├── theme.css           // Design tokens (dark theme)
│   └── sprites.js          // Pixel-art sprite registry
└── assets/
    ├── sprites/            // Agent pixel art (existing)
    └── sounds/             // UI feedback sounds (optional)
```

---

## 2. Event System Design

### 2.1 SSE Event Types (Server → UI)

All events flow through a single SSE connection. The server broadcasts structured events:

```jsonc
// Base envelope for all SSE events
{
  "type": "string",          // Event type discriminator
  "timestamp": "ISO-8601",
  "traceId": "string",       // Links related events
  "data": {}                 // Type-specific payload
}
```

**Event Type Catalog:**

| Type | Trigger | UI Response |
|---|---|---|
| `agent.activate` | Agent begins working | Sprite glows, status indicator |
| `agent.complete` | Agent finishes task | Glow fades, result badge |
| `agent.speak` | Agent produces output | Speech bubble animation |
| `dag.start` | DAG execution begins | DAG Theater: render graph |
| `dag.node.start` | Node begins executing | Node pulses blue |
| `dag.node.complete` | Node finishes | Node turns green/red |
| `dag.node.skip` | Node skipped (gate fail) | Node greys out |
| `dag.gate.eval` | Gate evaluates condition | Gate flashes, shows result |
| `dag.branch.fork` | Parallel branch starts | Edges animate outward |
| `dag.branch.terminate` | Branch killed early | Red X, collapse animation |
| `route.decision` | Tier selection made | Routing panel highlights tier |
| `escalation.trigger` | Escalation fired | Alert flash, tier arrow |
| `confidence.update` | Confidence score changes | Gauge animation |
| `memory.query` | Retrieval triggered | Memory Archive highlights |
| `memory.write` | New memory stored | Particle flies to archive |
| `memory.decay` | Memory decayed | Fade animation |
| `circuit.open` | Circuit breaker tripped | Red indicator on model |
| `circuit.close` | Circuit breaker reset | Green indicator restored |
| `conflict.detected` | Agents disagree | OBJECTION! overlay |
| `conflict.resolved` | Arbitration complete | Winner highlighted |
| `retry.attempt` | Retry in progress | Pulse animation on node |
| `metrics.tick` | Periodic metrics update | Sparkline/gauge refresh |
| `tournament.start` | Multi-model vote begins | Battle mode UI |
| `tournament.result` | Tournament concluded | Winner announcement |
| `cost.alert` | Budget threshold hit | Warning badge |

### 2.2 SSE Client with Reconnection + Backfill

```javascript
class ReconnectingSSE {
  constructor(url, options = {}) {
    this.url = url;
    this.lastEventId = null;
    this.reconnectDelay = 1000;
    this.maxReconnectDelay = 30000;
    this.handlers = new Map();
    this.buffer = [];  // Buffer events during reconnection
    this.connect();
  }

  connect() {
    const url = this.lastEventId
      ? `${this.url}?lastEventId=${this.lastEventId}`
      : this.url;

    this.source = new EventSource(url);

    this.source.onmessage = (event) => {
      this.reconnectDelay = 1000;  // Reset on success
      const parsed = JSON.parse(event.data);
      this.lastEventId = event.lastEventId || parsed.timestamp;
      this.dispatch(parsed);
    };

    this.source.onerror = () => {
      this.source.close();
      setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
    };
  }

  on(eventType, handler) {
    if (!this.handlers.has(eventType)) this.handlers.set(eventType, []);
    this.handlers.get(eventType).push(handler);
  }

  dispatch(event) {
    const handlers = this.handlers.get(event.type) || [];
    handlers.forEach(h => h(event));
    // Wildcard listeners
    const wildcards = this.handlers.get('*') || [];
    wildcards.forEach(h => h(event));
  }
}
```

### 2.3 State Store (Event-Sourced)

UI state is derived entirely from the event stream — no REST polling:

```javascript
class StateStore {
  constructor() {
    this.state = {
      agents: {},          // agentId → { status, lastOutput, confidence }
      dag: null,           // Current DAG execution state
      metrics: {},         // Live metric values
      memory: { recent: [], total: 0 },
      conflicts: [],       // Active/recent conflicts
      circuitBreakers: {}, // modelId → state
      tokens: { consumed: 0, budget: 0 },
      timeline: []         // Ordered event history for scrubbing
    };
    this.subscribers = new Set();
  }

  apply(event) {
    // Reducer pattern: event → state mutation
    switch (event.type) {
      case 'agent.activate':
        this.state.agents[event.data.agentId] = {
          ...this.state.agents[event.data.agentId],
          status: 'active',
          task: event.data.task
        };
        break;
      case 'dag.node.complete':
        if (this.state.dag) {
          this.state.dag.nodes[event.data.nodeId].status = event.data.success ? 'done' : 'failed';
          this.state.dag.nodes[event.data.nodeId].confidence = event.data.confidence;
        }
        break;
      case 'confidence.update':
        if (this.state.agents[event.data.agentId]) {
          this.state.agents[event.data.agentId].confidence = event.data.score;
        }
        break;
      // ... reducers for each event type
    }

    this.state.timeline.push(event);
    this.notify();
  }

  subscribe(fn) { this.subscribers.add(fn); return () => this.subscribers.delete(fn); }
  notify() { this.subscribers.forEach(fn => fn(this.state)); }
  getState() { return this.state; }
}
```

---

## 3. View Designs

### 3.1 Council Chamber (Enhanced War Table)

Existing: Pixel-art agents around oval table, speech bubbles, RPG dialogue box, Ace Attorney battles.

**Enhancements:**

```
┌─────────────────────────────────────────────────────────────────┐
│  NAV: [Chamber] [DAG] [Memory] [Metrics] [Court]    🔴 LIVE    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│         [Scout]                       [Specialist]              │
│           💬                              💬                    │
│                    ┌─────────────┐                              │
│    [Router]        │  ⚔️ WAR     │          [Reasoning]         │
│      💬           │  COUNCIL    │             💬                │
│                    │             │                              │
│    [Memory]        │   ● ● ●    │          [Judge]             │
│                    └─────────────┘                              │
│         [Test]                       [Hypeman]                  │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  STATUS BAR: Tier: specialist | Confidence: 0.82 | Tokens: 4.2K│
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ [Speaker Portrait] CONDUCTOR:                                ││
│  │ "Routing to specialist tier — complexity score 0.6,          ││
│  │  codegen keywords detected. Budget: 2048 tokens out."        ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

**New elements:**
- **Status bar** — live tier, confidence gauge, token counter
- **Activity indicators** — subtle particle effects on active agents
- **Confidence ring** — colored ring around sprite (green → yellow → red)
- **Escalation arrows** — animated arrows between agents when escalating
- **Bubble enrichment** — confidence badges inside speech bubbles

### 3.2 DAG Theater (New View)

Live visualization of execution DAGs as they run:

```
┌─────────────────────────────────────────────────────────────────┐
│  NAV: [Chamber] [DAG] [Memory] [Metrics] [Court]    🔴 LIVE    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  DAG: fix_bug v2.0                    Elapsed: 12.4s            │
│  ══════════════════════════════════════════════════════════════  │
│                                                                 │
│    ┌──────────────┐                                             │
│    │ retrieve-ctx │ ✅ 1.2s                                      │
│    └──────┬───────┘                                             │
│           │                                                     │
│    ┌──────▼───────┐                                             │
│    │assess-complex│ → PASS                                      │
│    └──────┬───────┘                                             │
│           │                                                     │
│    ┌──────▼───────┐                                             │
│    │ gen-test     │ ⏳ specialist (8.3s)                         │
│    │ conf: 0.74  │                                              │
│    └──────┬───────┘                                             │
│           │                                                     │
│    ┌──────▼───────┐                                             │
│    │ gen-fix      │ ⬜ pending                                   │
│    └──────┬───────┘                                             │
│           │                                                     │
│    ┌──────▼───────┐                                             │
│    │ quality-gate │ ⬜ pending                                   │
│    └──────────────┘                                             │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  TOKENS: ████████░░░░░ 34,200 / 100,000                        │
│  CALLS:  ████░░░░░░░░░ 7 / 20                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Rendering approach:** SVG with CSS transitions for node state changes.

**Node states → visual:**
| State | Visual |
|---|---|
| Pending | Grey fill, dotted border |
| Executing | Blue pulse, spinning indicator |
| Complete (pass) | Green fill, checkmark |
| Complete (fail) | Red fill, X mark |
| Skipped | Grey, strikethrough label |
| Terminated | Red X overlay, collapse animation |

**Interactive features:**
- Click node → side panel with full output, confidence breakdown, token usage
- Hover edge → show data flowing between nodes
- Timeline scrubber → replay execution state at any point
- Zoom/pan for complex DAGs

### 3.3 Memory Archive (New View)

Visualize the vector space and knowledge graph:

```
┌─────────────────────────────────────────────────────────────────┐
│  NAV: [Chamber] [DAG] [Memory] [Metrics] [Court]    🔴 LIVE    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─ VECTOR SPACE (2D projection) ─────────────────────────────┐ │
│  │                                                             │ │
│  │      ● episodic      ○ semantic                             │ │
│  │         ●  ●         ○   ○ ○                                │ │
│  │       ●      ●      ○        ○                              │ │
│  │          ●         ○   ○                                    │ │
│  │                  ◆ query                                    │ │
│  │        △ procedural                                         │ │
│  │         △   △                                               │ │
│  │                                                             │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌─ KNOWLEDGE GRAPH ──────────────────────────────────────────┐ │
│  │                                                             │ │
│  │   [server.js] ──uses──▶ [Ollama]                            │ │
│  │       │                    │                                │ │
│  │    imports              hosts                               │ │
│  │       │                    │                                │ │
│  │   [task-chains] ◀─calls─ [qwen2.5-coder]                   │ │
│  │                                                             │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  SEARCH: [________________________] [Semantic] [Keyword] [Graph]│
│  RECENT: query "fix bug in router" → 8 chunks (12ms)           │
└─────────────────────────────────────────────────────────────────┘
```

**Rendering:**
- Vector space: Canvas2D with UMAP/t-SNE 2D projection of embeddings
- Knowledge graph: Force-directed SVG layout (d3-force or custom)
- Real-time: New memories animate in (particle effect → landing position)
- Decay visualization: Older memories fade in opacity
- Query highlight: When retrieval fires, matching points glow

### 3.4 Metrics HUD (New View)

Real-time operational metrics dashboard:

```
┌─────────────────────────────────────────────────────────────────┐
│  NAV: [Chamber] [DAG] [Memory] [Metrics] [Court]    🔴 LIVE    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌── TIER USAGE ──────┐  ┌── CONFIDENCE DIST ────┐             │
│  │ fast:     ████ 42%  │  │        ▁▂▄███▆▃▁     │             │
│  │ spec:     ██   23%  │  │  0.0 ─────────── 1.0 │             │
│  │ reason:   █    12%  │  │  avg: 0.78            │             │
│  │ heavy:    ░     3%  │  └───────────────────────┘             │
│  │ cloud:    ██   20%  │                                        │
│  └────────────────────┘  ┌── TOKENS (24h) ────────┐             │
│                           │  ▂▃▅██▅▃▂▁▁▂▃▆███▅▃   │             │
│  ┌── LATENCY ─────────┐  │  Total: 847K           │             │
│  │ P50: 2.3s          │  │  Budget: 12% used      │             │
│  │ P95: 8.1s          │  └────────────────────────┘             │
│  │ P99: 14.2s         │                                        │
│  │    ▁▁▂▃▃▂▂▁▁▃▅▂▁  │  ┌── CIRCUIT BREAKERS ────┐            │
│  └────────────────────┘  │  fast:     🟢 CLOSED    │            │
│                           │  spec:     🟢 CLOSED    │            │
│  ┌── ESCALATIONS ─────┐  │  reason:   🟡 HALF-OPEN │            │
│  │ Today: 14          │  │  heavy:    🟢 CLOSED    │            │
│  │ ▃▅██▃▁▁▂▃▅█▃▂▁    │  │  gemini:   🟢 CLOSED    │            │
│  │ Success rate: 72%  │  │  groq:     🟢 CLOSED    │            │
│  └────────────────────┘  └─────────────────────────┘            │
│                                                                 │
│  ┌── ACTIVE TASKS ────────────────────────────────────────────┐ │
│  │ #47 fix_bug [specialist] 8.2s ████████░░ conf: 0.74       │ │
│  │ #48 explain  [fast]      1.1s ██░░░░░░░░ conf: 0.91       │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

**Rendering:**
- Sparklines: Canvas2D mini-charts (rolling 100-point window)
- Gauges: CSS radial gradients with animated fills
- Heatmaps: Color-coded grids for hourly activity
- All metrics update via SSE `metrics.tick` events (1/sec)

### 3.5 Arbitration Court (New View)

Conflict history with full reasoning trace:

```
┌─────────────────────────────────────────────────────────────────┐
│  NAV: [Chamber] [DAG] [Memory] [Metrics] [Court]    🔴 LIVE    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  CONFLICT #23 — "How to fix race condition in event emitter"    │
│  Status: RESOLVED | Method: confidence_gap | Duration: 0ms      │
│                                                                 │
│  ┌─ POSITION A ───────────┐  ┌─ POSITION B ───────────────────┐│
│  │ Agent: Specialist       │  │ Agent: Reasoning               ││
│  │ Tier: specialist        │  │ Tier: reasoning                ││
│  │ Confidence: 0.62        │  │ Confidence: 0.87 ← WINNER     ││
│  │                         │  │                                ││
│  │ "Use mutex lock on the  │  │ "Root cause is the shared     ││
│  │  shared buffer..."      │  │  buffer being accessed from   ││
│  │                         │  │  both the SSE handler and     ││
│  │                         │  │  the file watcher callback.   ││
│  │                         │  │  Use event queue pattern..."  ││
│  └─────────────────────────┘  └────────────────────────────────┘│
│                                                                 │
│  ARBITRATION CASCADE:                                           │
│  [1] Confidence gap: 0.87 - 0.62 = 0.25 > 0.2 threshold ✅     │
│  [2] Tier hierarchy: (not needed)                               │
│  [3] Historical accuracy: (not needed)                          │
│  [4] LLM Judge: (not needed)                                    │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│  HISTORY: [#23] [#22] [#21] [#20] [#19] ...                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Rendering Engine Recommendations

### 4.1 Technology Selection

| Component | Technology | Rationale |
|---|---|---|
| DAG rendering | SVG + CSS transitions | Crisp at all zooms, CSS handles state animations |
| Sparklines/charts | Canvas2D | High performance for rapid updates |
| Sprites/avatars | CSS + pixel-art PNGs | Already implemented, extend existing approach |
| Knowledge graph | SVG + d3-force layout | Standard for interactive force-directed graphs |
| Vector space viz | Canvas2D | Need to render thousands of points |
| Particles/effects | CSS animations | GPU-accelerated, no extra library |
| Transitions | CSS transitions + `requestAnimationFrame` | Smooth, compositor-friendly |

### 4.2 Why No Framework

The existing codebase uses vanilla HTML/CSS/JS. Staying framework-free for this project because:
1. **No build step** — HTML files served directly, instant reload
2. **Performance** — No virtual DOM overhead for real-time updates
3. **Simplicity** — SSE + event store + DOM manipulation is sufficient
4. **Size** — Zero bundle size, loads in <100ms
5. **Consistency** — Matches `war-table.html` and `index.html` already in place

### 4.3 Animation System

```javascript
class AnimationSystem {
  constructor() {
    this.queue = [];
    this.running = false;
  }

  // Schedule an animation (CSS class toggle or direct style manipulation)
  animate(element, animation, duration = 300) {
    return new Promise(resolve => {
      element.classList.add(animation);
      element.addEventListener('animationend', () => {
        element.classList.remove(animation);
        resolve();
      }, { once: true });
    });
  }

  // Sequence: run animations one after another
  async sequence(animations) {
    for (const { element, animation, duration } of animations) {
      await this.animate(element, animation, duration);
    }
  }

  // Particle burst (for memory writes, escalations, etc.)
  particleBurst(origin, target, count = 8, color = 'var(--cyan)') {
    for (let i = 0; i < count; i++) {
      const particle = document.createElement('div');
      particle.className = 'particle';
      particle.style.cssText = `
        position: absolute;
        left: ${origin.x}px;
        top: ${origin.y}px;
        width: 4px;
        height: 4px;
        background: ${color};
        border-radius: 50%;
        pointer-events: none;
      `;
      document.body.appendChild(particle);

      // Animate to target with random arc
      const angle = (i / count) * Math.PI * 2;
      const midX = (origin.x + target.x) / 2 + Math.cos(angle) * 50;
      const midY = (origin.y + target.y) / 2 + Math.sin(angle) * 50;

      particle.animate([
        { left: `${origin.x}px`, top: `${origin.y}px`, opacity: 1 },
        { left: `${midX}px`, top: `${midY}px`, opacity: 0.8 },
        { left: `${target.x}px`, top: `${target.y}px`, opacity: 0 }
      ], { duration: 600 + i * 50, easing: 'ease-out' });

      setTimeout(() => particle.remove(), 800 + i * 50);
    }
  }
}
```

---

## 5. DAG Renderer Design

### 5.1 Layout Algorithm (Sugiyama-style)

```javascript
class DAGRenderer {
  constructor(svgElement) {
    this.svg = svgElement;
    this.nodeWidth = 160;
    this.nodeHeight = 60;
    this.levelGap = 80;
    this.nodeGap = 30;
  }

  render(dag, state) {
    // 1. Topological sort → assign levels
    const levels = this.assignLevels(dag);

    // 2. Position nodes (centered per level)
    const positions = this.positionNodes(levels);

    // 3. Draw edges (bezier curves)
    this.drawEdges(dag, positions);

    // 4. Draw nodes with state-based styling
    this.drawNodes(dag, positions, state);
  }

  assignLevels(dag) {
    // Longest-path algorithm for level assignment
    const levels = {};
    const visited = new Set();

    function dfs(nodeId, depth) {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      levels[nodeId] = Math.max(levels[nodeId] || 0, depth);

      // Find nodes that depend on this one
      for (const [id, node] of Object.entries(dag.nodes)) {
        if (node.dependencies?.includes(nodeId)) {
          dfs(id, depth + 1);
        }
      }
    }

    dfs(dag.entryNode, 0);
    return levels;
  }

  drawNode(nodeId, node, pos, state) {
    const nodeState = state?.nodes?.[nodeId]?.status || 'pending';
    const confidence = state?.nodes?.[nodeId]?.confidence;

    const colors = {
      pending: { fill: '#1a1a2e', stroke: '#3a3a5a' },
      executing: { fill: '#1a2a4a', stroke: '#00e5ff' },
      done: { fill: '#1a3a2a', stroke: '#44ff88' },
      failed: { fill: '#3a1a1a', stroke: '#ff4444' },
      skipped: { fill: '#1a1a1a', stroke: '#333333' },
      terminated: { fill: '#2a1a1a', stroke: '#ff4444' }
    };

    const { fill, stroke } = colors[nodeState];

    // SVG rect + text + state indicator
    return `
      <g class="dag-node dag-node-${nodeState}" transform="translate(${pos.x}, ${pos.y})">
        <rect width="${this.nodeWidth}" height="${this.nodeHeight}"
              rx="6" fill="${fill}" stroke="${stroke}" stroke-width="2"/>
        <text x="${this.nodeWidth / 2}" y="20" text-anchor="middle"
              fill="#e0e0f0" font-size="10" font-family="monospace">${nodeId}</text>
        <text x="${this.nodeWidth / 2}" y="40" text-anchor="middle"
              fill="${stroke}" font-size="8">${node.type} | ${node.config?.tier || ''}</text>
        ${confidence ? `<text x="${this.nodeWidth / 2}" y="54" text-anchor="middle"
              fill="#ffd700" font-size="8">conf: ${confidence.toFixed(2)}</text>` : ''}
        ${nodeState === 'executing' ? '<circle cx="10" cy="10" r="4" fill="#00e5ff"><animate attributeName="opacity" values="1;0.3;1" dur="1s" repeatCount="indefinite"/></circle>' : ''}
      </g>
    `;
  }
}
```

### 5.2 Live Update Flow

```
SSE event (dag.node.complete)
  → StateStore.apply(event)
  → DAGRenderer.updateNode(nodeId, newState)
  → CSS transition animates color change
  → Optional: particle burst from completed node to next
```

---

## 6. Confidence Visualization

### 6.1 Per-Agent Confidence Ring

Around each agent sprite, a colored ring shows current confidence:

```css
.confidence-ring {
  position: absolute;
  inset: -4px;
  border-radius: 50%;
  border: 3px solid transparent;
  transition: border-color 0.5s ease, box-shadow 0.5s ease;
}

.confidence-ring[data-level="high"] {
  border-color: #44ff88;
  box-shadow: 0 0 8px rgba(68, 255, 136, 0.3);
}

.confidence-ring[data-level="mid"] {
  border-color: #ffd700;
  box-shadow: 0 0 8px rgba(255, 215, 0, 0.3);
}

.confidence-ring[data-level="low"] {
  border-color: #ff4444;
  box-shadow: 0 0 8px rgba(255, 68, 68, 0.3);
}
```

### 6.2 Confidence Breakdown Tooltip

```
┌─────────────────────────────────┐
│ Confidence: 0.74 (MEDIUM)       │
│ ═══════════════════════════════  │
│ Certainty:  ████████░░ 0.81     │
│ Relevance:  ███████░░░ 0.72     │
│ Completeness: ██████░░░░ 0.65   │
│ Consistency:  ████████░░ 0.78   │
└─────────────────────────────────┘
```

---

## 7. Escalation Visualization

When an escalation fires, animated indicator shows the tier jump:

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│   fast ──── specialist ──── reasoning ──── heavy ──── cloud  │
│    ○           ●─────────────▶ ●            ○           ○    │
│                [ESCALATE]                                    │
│                                                              │
│   Reason: below_adaptive_threshold (conf: 0.52 < 0.7)       │
└──────────────────────────────────────────────────────────────┘
```

**Animation sequence:**
1. Source tier pulses red
2. Arrow animates from source → target (300ms)
3. Target tier pulses blue (accepting)
4. Reason tooltip fades in below

---

## 8. State Synchronization Design

### 8.1 Server-Side Requirements

The existing `battle-log/server.js` needs these enhancements:

```javascript
// New SSE endpoints
// GET /events           — main event stream (existing, enhanced)
// GET /events?lastId=X  — backfill from event ID (new)
// GET /state            — current snapshot (new, for initial page load)
// GET /dag/:id          — full DAG definition (new)
// GET /metrics/summary  — aggregated metrics (new)
```

### 8.2 Event Buffer (Server-Side)

```javascript
class EventBuffer {
  constructor(maxSize = 10000) {
    this.events = [];
    this.maxSize = maxSize;
    this.idCounter = 0;
  }

  push(event) {
    event.id = ++this.idCounter;
    this.events.push(event);
    if (this.events.length > this.maxSize) {
      this.events.shift();
    }
  }

  // Backfill: return events after a given ID
  since(lastId) {
    const idx = this.events.findIndex(e => e.id > lastId);
    return idx >= 0 ? this.events.slice(idx) : [];
  }

  // Snapshot: return current state derived from all events
  snapshot() {
    const state = new StateStore();
    this.events.forEach(e => state.apply(e));
    return state.getState();
  }
}
```

### 8.3 Client Initialization Flow

```
1. Page loads
2. Fetch GET /state → populate StateStore with current snapshot
3. Connect SSE /events?lastId=<snapshot.lastEventId>
4. Backfill events arrive → apply to StateStore
5. Live events arrive → apply to StateStore → re-render affected components
```

This ensures no missed events even if the page loads mid-execution.

---

## 9. Performance Optimization

### 9.1 Rendering Budget

Target: 60fps for animations, <16ms per frame.

| Optimization | Technique |
|---|---|
| DOM minimization | Only update changed elements (diffing via data attributes) |
| Off-screen detection | Skip rendering for non-visible tabs |
| Canvas batching | Batch sparkline/chart draws into single rAF |
| CSS containment | `contain: layout style paint` on independent sections |
| Event throttling | Throttle metrics.tick processing to 1/sec even if events arrive faster |
| Virtual scrolling | For timeline/history lists with >100 items |
| Web Workers | Offload d3-force calculations for graph layout |
| Object pooling | Reuse particle DOM elements instead of create/destroy |

### 9.2 Memory Management

```javascript
// Cap timeline history in UI (full history lives server-side)
const MAX_TIMELINE_EVENTS = 500;
const MAX_SPARKLINE_POINTS = 100;
const MAX_PARTICLES_CONCURRENT = 50;
const MAX_GRAPH_NODES_RENDERED = 200;

// Garbage collection for old state
function pruneState(state) {
  if (state.timeline.length > MAX_TIMELINE_EVENTS) {
    state.timeline = state.timeline.slice(-MAX_TIMELINE_EVENTS);
  }
}
```

### 9.3 Progressive Enhancement

```
Level 0 (baseline):  Text-only event log (works everywhere)
Level 1 (standard):  DOM-based visualizations, CSS animations
Level 2 (enhanced):  Canvas charts, SVG DAGs, particle effects
Level 3 (full):      Force-directed graphs, Web Workers, sound effects
```

Detect capabilities on load:
```javascript
const capabilities = {
  canvas: !!document.createElement('canvas').getContext,
  webWorker: typeof Worker !== 'undefined',
  webAudio: typeof AudioContext !== 'undefined',
  animationApi: typeof Element.prototype.animate === 'function'
};

const renderLevel = capabilities.webWorker && capabilities.animationApi ? 3
  : capabilities.canvas ? 2
  : 1;
```

---

## 10. Sound Design (Optional Enhancement)

Subtle audio feedback for key events:

| Event | Sound | Volume |
|---|---|---|
| Agent activate | Soft chime (different pitch per agent) | Low |
| DAG complete (success) | Victory fanfare (8-bit) | Medium |
| DAG complete (fail) | Error buzz | Low |
| Escalation | Rising tone | Low |
| Circuit breaker open | Alert klaxon (1 beep) | Medium |
| OBJECTION! (conflict) | Ace Attorney "Objection!" clip | Medium |
| Tournament result | Crowd cheer (pixel) | Low |

All sound is optional, toggleable, and uses the Web Audio API (already partially implemented via TTS proxy in existing `server.js`).

---

## 11. Integration Points

### 11.1 MCP Server → Battle Log

```
MCP Server (mcp-server/server.js)
  │
  │  Emits telemetry events (structured JSON)
  │  via: HTTP POST /api/event (to battle-log server)
  │  or:  JSONL file append (.cline-context/events.jsonl)
  │
  ▼
Battle Log Server (battle-log/server.js)
  │
  │  Receives events, stores in EventBuffer
  │  Broadcasts to all SSE clients
  │
  ▼
UI Clients (browser tabs)
  │
  │  SSE connection → StateStore → View re-render
  │
  ▼
Visualizations
```

### 11.2 Event Emitter Integration (MCP Server Side)

```javascript
// In mcp-server/server.js — add to each tool handler
function emitEvent(type, data) {
  const event = {
    type,
    timestamp: new Date().toISOString(),
    traceId: getCurrentTraceId(),
    data
  };

  // Option A: HTTP push to battle-log
  fetch('http://localhost:3737/api/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event)
  }).catch(() => {}); // Fire and forget, don't block MCP

  // Option B: Append to shared JSONL (file watcher picks up)
  fs.appendFileSync(EVENTS_FILE, JSON.stringify(event) + '\n');
}
```

### 11.3 Cross-View Communication

Views share state via the `StateStore` singleton (same page = same store). If opened in separate tabs, use `BroadcastChannel`:

```javascript
const channel = new BroadcastChannel('war-council-events');

// In SSE client: broadcast received events
sseClient.on('*', event => channel.postMessage(event));

// In any view: listen for events from other tabs
channel.onmessage = (msg) => stateStore.apply(msg.data);
```

---

## 12. Implementation Priority

### Phase 6A — Foundation (Build First)
1. `shared/sse-client.js` — Reconnecting SSE with backfill
2. `shared/state-store.js` — Event-sourced state management
3. `shared/event-bus.js` — Cross-view pub/sub
4. Server enhancements — `/state`, `/events?lastId`, `/api/event`
5. Enhance existing `war-table.html` — Status bar, confidence rings

### Phase 6B — DAG Theater (Core New Feature)
6. `dag-theater.html` — SVG DAG renderer with live updates
7. Node state animations and transitions
8. Click-to-inspect side panel
9. Token/call budget bars

### Phase 6C — Observability Views
10. `metrics-hud.html` — Sparklines, gauges, circuit breaker indicators
11. `memory-archive.html` — Vector space + knowledge graph visualization
12. `arbitration-court.html` — Conflict history browser

### Phase 6D — Polish
13. Particle effects system
14. Sound design integration
15. Timeline scrubber (replay past executions)
16. Progressive enhancement detection

---

*End of Phase 6. The War Table evolves from a spectacle to a command center — every agent decision, every confidence shift, every branch collapse is visible, traceable, and theatrically satisfying.*
