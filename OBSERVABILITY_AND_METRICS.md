# Phase 3 — Observability and Metrics

**Purpose:** Instrument the entire system for measurable optimization. Replace intuition with telemetry.  
**Principle:** If you can't measure it, you can't improve it. Every decision path must be traceable.

---

## 1. Observability Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            TELEMETRY PIPELINE                                │
│                                                                             │
│  ┌──────────┐    ┌──────────────┐    ┌─────────────┐    ┌──────────────┐  │
│  │ MCP      │───▶│ Event        │───▶│ Metrics     │───▶│ Storage      │  │
│  │ Server   │    │ Collector    │    │ Aggregator  │    │ (JSONL +     │  │
│  │ (emit)   │    │              │    │             │    │  SQLite)     │  │
│  └──────────┘    └──────────────┘    └─────────────┘    └──────────────┘  │
│       │                                      │                   │         │
│       │                                      │                   │         │
│  ┌────▼─────┐                          ┌─────▼─────┐     ┌──────▼──────┐  │
│  │ Battle   │                          │ Dashboard │     │ Replay      │  │
│  │ Log      │                          │ Widgets   │     │ Engine      │  │
│  │ (SSE)    │                          │ (charts)  │     │             │  │
│  └──────────┘                          └───────────┘     └─────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Storage Layer

| Store | Format | Purpose | Retention |
|---|---|---|---|
| `telemetry/events.jsonl` | Append-only JSONL | Raw event stream | 30 days |
| `telemetry/metrics.db` | SQLite | Aggregated metrics, time-series | Permanent |
| `telemetry/traces/` | JSONL per trace | Distributed traces (span trees) | 7 days |
| `telemetry/benchmarks.json` | JSON | Baseline performance snapshots | Permanent |

### Collection Points

Every subsystem emits telemetry at these instrumentation points:

| System | Events Emitted |
|---|---|
| MCP Tool Dispatch | `tool.start`, `tool.complete`, `tool.error` |
| Ollama Generate | `model.inference.start`, `model.inference.complete`, `model.load` |
| Cloud API | `cloud.request`, `cloud.response`, `cloud.error` |
| Memory/RAG | `memory.query`, `memory.index`, `memory.hit`, `memory.miss` |
| Task Chain | `chain.start`, `chain.step`, `chain.complete`, `chain.failed` |
| Escalation | `escalation.triggered`, `escalation.resolved` |
| Verification | `verification.start`, `verification.pass`, `verification.fail` |
| Tournament | `tournament.start`, `tournament.vote`, `tournament.verdict` |
| Deliberation | `deliberation.round`, `deliberation.synthesis` |

---

## 2. Telemetry Event Schema

```jsonc
// TelemetryEvent — base schema for all instrumentation events
{
  "$schema": "war-council://schemas/telemetry-event.v1",
  "id": "uuid-v4",
  "timestamp": "ISO-8601",
  "traceId": "string",           // Groups related events into a trace
  "spanId": "string",            // Unique ID for this span within the trace
  "parentSpanId": "string|null", // For nested spans (chain steps, retries)
  
  "category": "tool|model|memory|chain|escalation|verification|tournament|system",
  "event": "string",             // Specific event name (e.g., "tool.complete")
  "level": "info|warn|error|debug",
  
  "data": {
    // Tool events
    "tool": "string|null",
    "args": {},
    
    // Model events
    "model": "string|null",
    "tier": "string|null",
    "provider": "ollama|gemini|groq|null",
    
    // Timing
    "durationMs": 0,
    "queuedMs": 0,
    
    // Tokens
    "tokensIn": 0,
    "tokensOut": 0,
    "tokensPerSec": 0,
    
    // Confidence
    "confidence": 0.0,
    
    // Memory
    "chunksReturned": 0,
    "relevanceAvg": 0.0,
    "hitRate": 0.0,
    
    // Chain
    "chainName": "string|null",
    "stepIndex": 0,
    "stepsTotal": 0,
    
    // Error
    "error": "string|null",
    "retryable": false,
    "retryCount": 0
  },
  
  "context": {
    "taskId": "string|null",
    "sessionId": "string",       // Persists across a work session
    "userId": "string"           // Always "local" for local-first
  }
}
```

---

## 3. Metrics Catalog

### 3.1 Orchestration Metrics

| Metric | Formula | Target | Alert Threshold |
|---|---|---|---|
| **Tool Success Rate** | `tool.complete / (tool.complete + tool.error)` | > 95% | < 85% |
| **Avg Tool Latency** | `mean(tool.complete.durationMs)` | < 5000ms | > 15000ms |
| **P95 Tool Latency** | `percentile(95, tool.complete.durationMs)` | < 15000ms | > 30000ms |
| **Chain Completion Rate** | `chain.complete / chain.start` | > 90% | < 70% |
| **Chain Avg Duration** | `mean(chain.complete.durationMs)` | < 60000ms | > 120000ms |
| **Escalation Rate** | `escalation.triggered / tool.start` | < 15% | > 30% |
| **Retry Rate** | `sum(retryCount > 0) / tool.start` | < 10% | > 25% |

### 3.2 Model Routing Metrics

| Metric | Formula | Target | Alert |
|---|---|---|---|
| **Tokens/Second (per tier)** | `mean(tokensPerSec) grouped by tier` | fast:>150, spec:>60, reason:>30 | < 50% of target |
| **Model Load Time** | `mean(model.load.durationMs)` | < 5000ms (warm) | > 30000ms |
| **Cloud Escalation Rate** | `cloud.request / tool.start` | < 5% | > 15% |
| **Cloud Latency** | `mean(cloud.response.durationMs)` | < 3000ms | > 10000ms |
| **VRAM Utilization** | polled from `nvidia-smi` | 60-90% | > 95% |
| **Model Switch Frequency** | `count(model.load) per 10min window` | < 5 | > 10 |

### 3.3 Agent Behavior Metrics

| Metric | Formula | Target | Alert |
|---|---|---|---|
| **Agent Utility Score** | `(tasks_completed × avg_confidence) / tokens_consumed` | Higher = better | Bottom 20% flagged |
| **Agent Token Efficiency** | `useful_output_tokens / total_tokens_consumed` | > 0.4 | < 0.2 |
| **Confidence Distribution** | histogram of `confidence.overall` per agent | Bell curve 0.6-0.9 | Bimodal (unreliable) |
| **Forbidden Action Attempts** | `count(agent violates contract)` | 0 | > 0 |
| **Domain Mismatch Rate** | `out_of_scope_responses / total_responses` | < 5% | > 15% |
| **Hallucination Proxy** | `verification.fail(category=correctness) / verification.start` | < 10% | > 25% |

### 3.4 Memory/Retrieval Metrics

| Metric | Formula | Target | Alert |
|---|---|---|---|
| **Memory Hit Rate** | `queries_with_relevant_chunks / total_queries` | > 70% | < 40% |
| **Avg Relevance Score** | `mean(top_chunk.score)` | > 0.55 | < 0.35 |
| **Retrieval Latency** | `mean(memory.query.totalMs)` | < 300ms | > 1000ms |
| **Embedding Latency** | `mean(memory.query.embedMs)` | < 100ms | > 500ms |
| **Store Size** | `total_chunks in store` | Monitored | > 50K (perf degrades) |
| **Stale Chunk Ratio** | `chunks_older_than_30d / total_chunks` | < 30% | > 60% |
| **Context Injection Efficiency** | `chunks_actually_used_in_output / chunks_injected` | > 0.5 | < 0.2 |

### 3.5 Verification & Quality Metrics

| Metric | Formula | Target | Alert |
|---|---|---|---|
| **Self-Eval Pass Rate** | `verification.pass / verification.start` | > 80% | < 60% |
| **Verification Overhead** | `verification.durationMs / tool.durationMs` | < 30% | > 50% |
| **Coding Success Rate** | `code_applied_without_regression / code_generated` | > 85% | < 70% |
| **Test Pass Rate (post-change)** | `test_green / test_run_after_change` | > 95% | < 85% |
| **Disagreement Frequency** | `arbitration_requests / tournament.start` | < 20% | > 40% |

### 3.6 Token Usage & Efficiency Metrics

| Metric | Formula | Target | Alert |
|---|---|---|---|
| **Total Tokens/Session** | `sum(tokensIn + tokensOut)` | Monitored | > 500K/hour |
| **Token Waste Ratio** | `tokens_in_failed_attempts / total_tokens` | < 15% | > 30% |
| **Context Utilization** | `actual_context_used / model_context_window` | 40-80% | < 20% or > 95% |
| **Compression Savings** | `1 - (compressed_size / original_size)` | > 50% | < 20% |
| **Cloud Token Spend** | `sum(cloud tokens)` per day | < 100K/day | > 500K/day |

---

## 4. Tracing System

### 4.1 Trace Structure

A **trace** is a tree of **spans** representing a single end-to-end operation:

```jsonc
// Trace — a complete operation from request to response
{
  "traceId": "uuid",
  "rootSpanId": "uuid",
  "startTime": "ISO-8601",
  "endTime": "ISO-8601",
  "durationMs": 0,
  "status": "ok|error|timeout",
  
  "spans": [
    {
      "spanId": "uuid",
      "parentSpanId": "null",    // Root span
      "operation": "run_chain:fix_bug",
      "startTime": "ISO-8601",
      "endTime": "ISO-8601",
      "durationMs": 45000,
      "status": "ok",
      "attributes": {
        "chain": "fix_bug",
        "stepsTotal": 5
      },
      "children": ["span-2", "span-3", "span-4", "span-5", "span-6"]
    },
    {
      "spanId": "span-2",
      "parentSpanId": "root",
      "operation": "memory_query",
      "durationMs": 250,
      "attributes": {
        "chunksReturned": 5,
        "relevanceAvg": 0.67
      }
    },
    {
      "spanId": "span-3",
      "parentSpanId": "root",
      "operation": "strategic_plan",
      "durationMs": 3200,
      "attributes": {
        "provider": "gemini",
        "tokensIn": 8500,
        "tokensOut": 1200
      }
    }
    // ... more spans
  ],
  
  "summary": {
    "totalTokens": { "in": 15000, "out": 8000 },
    "modelsUsed": ["specialist", "reasoning", "gemini"],
    "escalations": 0,
    "retries": 1
  }
}
```

### 4.2 Trace Propagation

```
Tool Call → traceId assigned (or inherited from chain)
  → spanId generated for this operation
  → Sub-calls inherit traceId + set parentSpanId
  → On completion: span closed, duration recorded
  → Full trace persisted to telemetry/traces/
```

### 4.3 Replay System

The replay system allows re-execution of any traced operation:

```jsonc
// ReplayRequest
{
  "traceId": "string",          // Trace to replay
  "mode": "full|step|dry_run",
  "overrides": {
    "model": "string|null",     // Force different model
    "temperature": 0.0,         // Force temperature
    "skipSteps": [0]            // Skip specific chain steps
  }
}

// ReplayResult
{
  "originalTraceId": "string",
  "replayTraceId": "string",    // New trace for the replay
  "comparison": {
    "durationDelta": "+500ms",
    "tokenDelta": "-200",
    "confidenceDelta": "+0.05",
    "outputDiff": "string"      // Semantic diff of outputs
  }
}
```

**Use cases:**
- Compare model A vs model B on identical inputs
- Identify non-determinism in reasoning chains
- Benchmark after config changes
- Debug failed chains by replaying with verbose logging

---

## 5. Logging Standards

### 5.1 Log Levels

| Level | When | Example |
|---|---|---|
| `error` | Operation failed, needs attention | Model inference timeout, API 500 |
| `warn` | Degraded but recovered | Retry succeeded, low confidence accepted |
| `info` | Normal operation milestones | Tool complete, chain step done |
| `debug` | Detailed internals (disabled in prod) | Prompt text, raw model output, embedding vectors |

### 5.2 Structured Log Format

All logs are structured JSON (no free-text `console.log`):

```jsonc
{
  "level": "info",
  "timestamp": "ISO-8601",
  "traceId": "string",
  "spanId": "string",
  "component": "mcp-server|battle-log|memory-engine",
  "event": "tool.complete",
  "message": "consult_specialist completed in 3200ms",
  "data": {
    "tool": "consult_specialist",
    "model": "qwen2.5-coder:14b",
    "durationMs": 3200,
    "tokensOut": 450
  }
}
```

### 5.3 Logging Pipeline

```
Component → Structured Log → telemetry/events.jsonl (append)
                           → stderr (for MCP server — doesn't pollute stdio)
                           → SSE push (if dashboard connected)
```

---

## 6. Dashboard Visualizations

### 6.1 Recommended Widgets

| Widget | Type | Data Source | Purpose |
|---|---|---|---|
| **Live Timeline** | Scrolling feed | SSE events | Real-time activity |
| **Tool Latency Heatmap** | Grid (tool × time) | metrics.db | Spot slow tools |
| **Token Burn Rate** | Line chart | Aggregated per minute | Budget monitoring |
| **Confidence Histogram** | Bar chart | Per-agent grouping | Quality distribution |
| **Escalation Waterfall** | Sankey diagram | escalation events | Where tasks flow |
| **Agent Leaderboard** | Table | utility scores | Who's pulling weight |
| **Memory Hit/Miss** | Donut chart | memory events | RAG effectiveness |
| **Chain Success Funnel** | Funnel chart | chain steps | Where chains break |
| **Model Throughput** | Gauge per model | inference events | tok/s monitoring |
| **Session Summary** | Card | session aggregates | Quick health check |

### 6.2 Execution Graph

Visual representation of a chain or trace:

```
[memory_query] ─── 250ms ──▶ [strategic_plan] ─── 3200ms ──▶ [consult_specialist] ─── 4100ms
     │                              │                              │
     └─ 5 chunks, avg 0.67         └─ gemini, 1200 tok out       └─ 14b, 450 tok out
                                                                        │
                                                                   [self_eval] ─── 1800ms
                                                                        │
                                                                   ✅ PASS (conf: 0.82)
```

---

## 7. Benchmark Framework

### 7.1 Benchmark Suite Design

```jsonc
// BenchmarkSuite — defines a set of repeatable performance tests
{
  "name": "war-council-bench-v1",
  "version": "1.0.0",
  "benchmarks": [
    {
      "id": "latency-fast-simple",
      "description": "Simple prompt to fast model (7b), measure cold + warm latency",
      "tool": "consult_fast",
      "args": { "prompt": "What is 2+2? One word answer.", "maxTokens": 32 },
      "iterations": 10,
      "warmup": 2,
      "metrics": ["durationMs", "tokensPerSec", "tokensOut"],
      "baseline": { "durationMs": 500, "tokensPerSec": 180 }
    },
    {
      "id": "latency-specialist-code",
      "description": "Code generation from specialist (14b)",
      "tool": "consult_specialist",
      "args": { "prompt": "Write a function that reverses a linked list in JavaScript.", "maxTokens": 512 },
      "iterations": 5,
      "warmup": 1,
      "metrics": ["durationMs", "tokensPerSec", "tokensOut"],
      "baseline": { "durationMs": 8000, "tokensPerSec": 65 }
    },
    {
      "id": "latency-reasoning-debug",
      "description": "Chain-of-thought debugging from reasoning model",
      "tool": "consult_reasoning",
      "args": { "prompt": "Find the bug: function sum(arr) { let total; for(let i=0; i<=arr.length; i++) total += arr[i]; return total; }", "maxTokens": 512 },
      "iterations": 5,
      "warmup": 1,
      "metrics": ["durationMs", "tokensPerSec"],
      "baseline": { "durationMs": 15000, "tokensPerSec": 35 }
    },
    {
      "id": "memory-query-latency",
      "description": "RAG retrieval latency (requires indexed store)",
      "tool": "memory_query",
      "args": { "query": "How does the tournament voting system work?", "k": 5 },
      "iterations": 10,
      "warmup": 2,
      "metrics": ["totalMs", "embedMs", "searchMs", "chunksReturned"],
      "baseline": { "totalMs": 300, "embedMs": 80 }
    },
    {
      "id": "tournament-parallel",
      "description": "3-voter tournament wall time",
      "tool": "tournament_vote",
      "args": { "prompt": "Should we use Redis or SQLite for session storage?", "voters": ["fast", "specialist", "reasoning"] },
      "iterations": 3,
      "warmup": 1,
      "metrics": ["durationMs"],
      "baseline": { "durationMs": 20000 }
    },
    {
      "id": "chain-fix-bug",
      "description": "Full fix_bug chain end-to-end",
      "tool": "run_chain",
      "args": { "chain": "fix_bug", "inputs": { "bug_description": "Off-by-one error in pagination: page 2 shows first item from page 1" } },
      "iterations": 2,
      "warmup": 0,
      "metrics": ["durationMs", "stepsCompleted", "totalTokens"],
      "baseline": { "durationMs": 60000 }
    },
    {
      "id": "cloud-gemini-plan",
      "description": "Strategic plan via Gemini (cloud latency)",
      "tool": "strategic_plan",
      "args": { "task": "Add dark mode toggle to the dashboard", "code_context": "// existing CSS vars..." },
      "iterations": 3,
      "warmup": 0,
      "metrics": ["durationMs", "tokensIn", "tokensOut"],
      "baseline": { "durationMs": 4000 },
      "requiresKey": "GEMINI_API_KEY"
    },
    {
      "id": "cloud-groq-fanout",
      "description": "3-prompt parallel fan-out via Groq",
      "tool": "rapid_fan_out",
      "args": { "prompts": ["Review this code for security", "Review for performance", "Review for style"], "maxTokens": 512 },
      "iterations": 3,
      "warmup": 0,
      "metrics": ["totalElapsedMs", "count"],
      "baseline": { "totalElapsedMs": 3000 },
      "requiresKey": "GROQ_API_KEY"
    }
  ]
}
```

### 7.2 Benchmark Execution

```
run_benchmark(suite) →
  for each benchmark:
    run warmup iterations (discard)
    for each iteration:
      record start time
      execute tool
      record all metrics
    compute: mean, p50, p95, stddev
    compare against baseline
    flag regressions (> 20% worse than baseline)
  output: benchmark report JSON
```

### 7.3 Regression Detection

```jsonc
// BenchmarkResult
{
  "benchmarkId": "latency-fast-simple",
  "runDate": "ISO-8601",
  "iterations": 10,
  "results": {
    "durationMs": { "mean": 480, "p50": 450, "p95": 650, "stddev": 85 },
    "tokensPerSec": { "mean": 195, "p50": 200, "p95": 210, "stddev": 12 }
  },
  "baseline": { "durationMs": 500, "tokensPerSec": 180 },
  "verdict": "pass",           // pass|regressed|improved
  "delta": {
    "durationMs": "-4%",       // negative = improvement
    "tokensPerSec": "+8%"
  }
}
```

---

## 8. Identifying Waste & Inefficiency

### 8.1 Waste Detection Rules

| Pattern | Detection Method | Action |
|---|---|---|
| **Wasteful Agent** | utility_score in bottom 20% for 7+ days | Flag for review/reoptimize |
| **Redundant Reasoning** | Same query sent to same model within 60s | Cache or deduplicate |
| **Bottleneck Workflow** | Chain step consuming > 60% of chain duration | Profile and optimize |
| **Runaway Recursion** | Escalation depth > 3 in single trace | Circuit-break |
| **Excessive Context Injection** | Context utilization < 20% (injected but unused) | Reduce k or budget |
| **Token Burn on Failures** | token_waste_ratio > 30% in any session | Audit failing patterns |
| **Stale Memory** | > 60% of retrieved chunks older than 30 days | Re-index or prune |
| **Cold Model Thrashing** | model.load > 5x in 10 minutes | Stabilize loadout |

### 8.2 Automated Alerts

```jsonc
// AlertRule — triggers notification when threshold breached
{
  "id": "alert-high-escalation",
  "metric": "escalation_rate",
  "condition": "> 0.30",
  "window": "1h",
  "severity": "warning",
  "action": "emit_battle_event",
  "message": "Escalation rate exceeds 30% — check model health or task complexity"
}
```

---

## 9. Session Analytics

### 9.1 Session Summary (emitted on session close)

```jsonc
{
  "sessionId": "string",
  "startTime": "ISO-8601",
  "endTime": "ISO-8601",
  "durationMinutes": 0,
  
  "totals": {
    "toolCalls": 0,
    "chainRuns": 0,
    "tournaments": 0,
    "escalations": 0,
    "errors": 0,
    "tokensIn": 0,
    "tokensOut": 0,
    "cloudCalls": 0
  },
  
  "performance": {
    "avgToolLatencyMs": 0,
    "p95ToolLatencyMs": 0,
    "toolSuccessRate": 0.0,
    "chainCompletionRate": 0.0,
    "selfEvalPassRate": 0.0
  },
  
  "efficiency": {
    "tokenWasteRatio": 0.0,
    "contextUtilization": 0.0,
    "memoryHitRate": 0.0
  },
  
  "topAgents": [
    { "agent": "string", "calls": 0, "avgConfidence": 0.0, "utilityScore": 0.0 }
  ],
  
  "issues": [
    { "type": "string", "count": 0, "description": "string" }
  ]
}
```

---

## 10. Implementation Priorities

### Phase 3A — Foundation (must-have for observability)

1. **TelemetryCollector class** — Centralized event emitter with trace propagation
2. **Structured logger** — Replace all `process.stderr.write` with structured JSON
3. **Trace context propagation** — traceId/spanId threading through tool calls
4. **JSONL event writer** — Append to `telemetry/events.jsonl` with rotation

### Phase 3B — Metrics (enables optimization)

5. **MetricsAggregator** — SQLite-backed, computes rolling metrics per window
6. **Session tracker** — Accumulates session-level stats, emits summary on close
7. **Benchmark runner** — Executes suite, compares against baselines

### Phase 3C — Visualization (makes it human-usable)

8. **Dashboard widgets** — Latency heatmap, token burn chart, confidence histogram
9. **Execution graph renderer** — Trace → visual flow in the War Table
10. **Alert system** — Rule-based thresholds → battle log events

### Phase 3D — Intelligence (self-optimization)

11. **Waste detector** — Automated pattern matching on metrics
12. **Replay engine** — Re-run traces for A/B comparison
13. **Agent utility scoring** — Rank agents, identify underperformers

---

*End of Phase 3. The system is now designed to be fully measurable, debuggable, and self-aware of its own performance characteristics.*
