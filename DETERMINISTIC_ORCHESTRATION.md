# Phase 5 — Deterministic Orchestration

**Purpose:** Replace fragile prompt-only coordination with heuristic-driven, state-driven, metrics-driven execution.  
**Principle:** The orchestrator is a compiler, not a chatbot. Deterministic where possible, LLM-assisted only where necessary.

---

## 1. Orchestrator Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     DETERMINISTIC ORCHESTRATOR                                │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                    DECISION LAYER (zero LLM calls)                    │   │
│  │                                                                      │   │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌─────────────┐   │   │
│  │  │ Router     │  │ Budget     │  │ Escalation │  │ Termination │   │   │
│  │  │ Heuristics │  │ Enforcer   │  │ Policy     │  │ Judge       │   │   │
│  │  └────────────┘  └────────────┘  └────────────┘  └─────────────┘   │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                    EXECUTION LAYER (DAG runner)                        │   │
│  │                                                                      │   │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌─────────────┐   │   │
│  │  │ DAG        │  │ Dependency │  │ Retry      │  │ Checkpoint  │   │   │
│  │  │ Scheduler  │  │ Resolver   │  │ Engine     │  │ Manager     │   │   │
│  │  └────────────┘  └────────────┘  └────────────┘  └─────────────┘   │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                    ADAPTATION LAYER (metrics-driven)                   │   │
│  │                                                                      │   │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌─────────────┐   │   │
│  │  │ Metrics    │  │ Adaptive   │  │ Circuit    │  │ Cost        │   │   │
│  │  │ Window     │  │ Thresholds │  │ Breakers   │  │ Optimizer   │   │   │
│  │  └────────────┘  └────────────┘  └────────────┘  └─────────────┘   │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Design Principle: LLM-Free Decision Making

The orchestrator itself **never calls an LLM** for routing/scheduling/termination decisions. It uses:
- Pre-computed heuristics (keyword matching, regex patterns, token counting)
- Historical metrics (rolling averages from telemetry)
- Deterministic state machines (finite states, explicit transitions)
- Threshold-based gates (confidence scores, token budgets, latency caps)

LLMs are only invoked as **workers** executing tasks — never as **controllers** deciding what to execute next.

---

## 2. Execution DAG System

### 2.1 DAG Node Types

```jsonc
// DAGNode — atomic unit of execution in a workflow
{
  "id": "string",
  "type": "task|gate|branch|merge|checkpoint",
  "config": {
    // For task nodes:
    "tool": "string",
    "args": {},
    "tier": "fast|specialist|reasoning|heavy|cloud",
    "budget": { "maxTokensIn": 4096, "maxTokensOut": 2048, "timeoutMs": 30000 },
    
    // For gate nodes:
    "condition": "expression",    // e.g., "confidence >= 0.7"
    "onPass": "node-id",
    "onFail": "node-id",
    
    // For branch nodes:
    "strategy": "parallel|conditional|race",
    "branches": ["node-id"],
    
    // For merge nodes:
    "strategy": "all|any|best",   // Wait for all, first, or highest confidence
    "inputs": ["node-id"],
    
    // For checkpoint nodes:
    "save": ["result", "context"],
    "resume": true               // Can resume from here on failure
  },
  "dependencies": ["node-id"],   // Must complete before this node runs
  "timeout": 60000,
  "retryPolicy": "default|aggressive|none"
}
```

### 2.2 DAG Definition

```jsonc
// ExecutionDAG — a complete workflow as a directed acyclic graph
{
  "$schema": "war-council://schemas/execution-dag.v1",
  "id": "dag-fix-bug-v2",
  "name": "fix_bug",
  "version": "2.0",
  "description": "TDD bug fix with deterministic gates",
  "entryNode": "retrieve-context",
  "nodes": {
    "retrieve-context": {
      "type": "task",
      "config": {
        "tool": "memory_query",
        "args": { "query": "{{bug_description}}", "k": 8 },
        "tier": "local",
        "budget": { "timeoutMs": 5000 }
      },
      "dependencies": []
    },
    "assess-complexity": {
      "type": "gate",
      "config": {
        "condition": "input.bug_description.length > 200 AND retrieve-context.chunks > 3",
        "onPass": "strategic-plan",
        "onFail": "generate-test"
      },
      "dependencies": ["retrieve-context"]
    },
    "strategic-plan": {
      "type": "task",
      "config": {
        "tool": "strategic_plan",
        "args": { "task": "{{bug_description}}", "code_context": "{{retrieve-context.output}}" },
        "tier": "cloud",
        "budget": { "maxTokensOut": 2048, "timeoutMs": 15000 }
      },
      "dependencies": ["retrieve-context"]
    },
    "generate-test": {
      "type": "task",
      "config": {
        "tool": "consult_specialist",
        "args": { "prompt": "Write failing test for: {{bug_description}}\nContext: {{retrieve-context.output}}" },
        "tier": "specialist",
        "budget": { "maxTokensOut": 2048, "timeoutMs": 30000 }
      },
      "dependencies": ["assess-complexity"]
    },
    "generate-fix": {
      "type": "task",
      "config": {
        "tool": "consult_specialist",
        "args": { "prompt": "Fix: {{bug_description}}\nTest: {{generate-test.output}}" },
        "tier": "specialist",
        "budget": { "maxTokensOut": 2048, "timeoutMs": 30000 }
      },
      "dependencies": ["generate-test"]
    },
    "quality-gate": {
      "type": "gate",
      "config": {
        "condition": "generate-fix.confidence >= 0.7",
        "onPass": "self-eval",
        "onFail": "escalate-to-reasoning"
      },
      "dependencies": ["generate-fix"]
    },
    "escalate-to-reasoning": {
      "type": "task",
      "config": {
        "tool": "consult_reasoning",
        "args": { "prompt": "Review and improve this fix:\n{{generate-fix.output}}\nBug: {{bug_description}}" },
        "tier": "reasoning",
        "budget": { "maxTokensOut": 2048, "timeoutMs": 45000 }
      },
      "dependencies": ["quality-gate"]
    },
    "self-eval": {
      "type": "task",
      "config": {
        "tool": "self_eval",
        "args": { "code": "{{generate-fix.output}}", "context": "{{bug_description}}" },
        "tier": "cloud"
      },
      "dependencies": ["quality-gate"]
    },
    "final-gate": {
      "type": "gate",
      "config": {
        "condition": "self-eval.verdict == 'PASS'",
        "onPass": "complete",
        "onFail": "terminate-low-value"
      },
      "dependencies": ["self-eval"]
    },
    "complete": {
      "type": "checkpoint",
      "config": { "save": ["generate-fix.output", "generate-test.output"] },
      "dependencies": ["final-gate"]
    },
    "terminate-low-value": {
      "type": "checkpoint",
      "config": {
        "save": ["generate-fix.output"],
        "resume": false
      },
      "dependencies": ["final-gate"]
    }
  }
}
```

### 2.3 DAG Scheduler Pseudocode

```
function executeDAG(dag, inputs):
  state = new DAGState(dag)
  state.setInputs(inputs)
  readyQueue = findNodesWithNoDependencies(dag)
  
  while readyQueue is not empty:
    node = readyQueue.dequeue()
    
    if node.type == "task":
      result = executeTask(node, state)
      state.setResult(node.id, result)
      
    elif node.type == "gate":
      passed = evaluateCondition(node.config.condition, state)
      nextNode = passed ? node.config.onPass : node.config.onFail
      state.setGateResult(node.id, { passed, nextNode })
      readyQueue.enqueue(dag.nodes[nextNode])
      continue  // Skip normal dependency resolution
      
    elif node.type == "branch":
      if node.config.strategy == "parallel":
        results = await Promise.all(node.config.branches.map(b => executeNode(b, state)))
      elif node.config.strategy == "race":
        result = await Promise.race(node.config.branches.map(b => executeNode(b, state)))
        // Cancel losers
        
    elif node.type == "merge":
      if node.config.strategy == "best":
        result = pickHighestConfidence(state.getResults(node.config.inputs))
      elif node.config.strategy == "all":
        result = concatenateResults(state.getResults(node.config.inputs))
        
    elif node.type == "checkpoint":
      saveCheckpoint(state, node.config.save)
    
    // Resolve next ready nodes
    for candidate in dag.nodes:
      if all(dep in state.completed for dep in candidate.dependencies):
        if candidate.id not in state.completed:
          readyQueue.enqueue(candidate)
  
  return state.getFinalResult()
```

---

## 3. Routing Heuristics (Zero-LLM)

### 3.1 Tier Selection Matrix

All routing is deterministic — no LLM call needed:

```javascript
function selectTier(task, context) {
  const tokenEstimate = estimateTokens(task + context);
  const complexity = measureComplexity(task);
  
  // Rule 1: Context too large for local → cloud
  if (tokenEstimate > 28000) return "cloud";
  
  // Rule 2: Simple lookups and transforms → fast
  if (complexity.score < 0.3 && tokenEstimate < 2000) return "fast";
  
  // Rule 3: Debugging/reasoning keywords → reasoning
  if (complexity.requiresReasoning) return "reasoning";
  
  // Rule 4: Code generation → specialist
  if (complexity.requiresCodeGen) return "specialist";
  
  // Rule 5: Architecture/planning → heavy or cloud
  if (complexity.isArchitectural) {
    return tokenEstimate > 16000 ? "cloud" : "heavy";
  }
  
  // Default: specialist (best balance)
  return "specialist";
}
```

### 3.2 Complexity Measurement (Heuristic)

```javascript
function measureComplexity(task) {
  const lower = task.toLowerCase();
  const wordCount = task.split(/\s+/).length;
  
  return {
    score: computeScore(task),  // 0.0 – 1.0
    
    requiresReasoning: hasAny(lower, [
      "why", "debug", "trace", "root cause", "investigate",
      "race condition", "deadlock", "memory leak", "explain"
    ]),
    
    requiresCodeGen: hasAny(lower, [
      "implement", "write", "create", "build", "generate",
      "function", "class", "component", "endpoint"
    ]),
    
    isArchitectural: hasAny(lower, [
      "architect", "design", "plan", "system", "infrastructure",
      "migrate", "scale", "restructure"
    ]),
    
    isSimple: wordCount < 20 && !hasAny(lower, [
      "complex", "multiple", "several", "across", "integrate"
    ])
  };
}

function computeScore(task) {
  let score = 0;
  const words = task.split(/\s+/).length;
  
  // Length contributes to complexity
  score += Math.min(words / 100, 0.3);
  
  // Code references increase complexity
  const codeRefs = (task.match(/`[^`]+`/g) || []).length;
  score += Math.min(codeRefs * 0.05, 0.2);
  
  // Multiple files = more complex
  const fileRefs = (task.match(/\.(js|ts|py|md|json|html|css)\b/g) || []).length;
  score += Math.min(fileRefs * 0.1, 0.3);
  
  // Question marks suggest investigation
  const questions = (task.match(/\?/g) || []).length;
  score += Math.min(questions * 0.05, 0.1);
  
  // Logical conjunctions increase scope
  const conjunctions = (task.match(/\b(and|also|additionally|plus|then)\b/gi) || []).length;
  score += Math.min(conjunctions * 0.05, 0.1);
  
  return Math.min(score, 1.0);
}
```

### 3.3 Local vs. Cloud Routing Decision Tree

```
                    ┌─────────────────┐
                    │ Estimate tokens │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
              ┌─NO─┤ tokens > 28K?   ├─YES─┐
              │     └─────────────────┘     │
              │                             │
     ┌────────▼────────┐          ┌────────▼────────┐
     │ Check metrics:  │          │ CLOUD (Gemini)  │
     │ is model warm?  │          │ 1M context      │
     └────────┬────────┘          └─────────────────┘
              │
     ┌────────▼────────┐
     │ Model available │
     │ in VRAM?        │
     └───┬─────────┬───┘
      YES│         │NO
         │         │
    ┌────▼───┐  ┌──▼──────────┐
    │ LOCAL  │  │ Load delay  │
    │ (warm) │  │ acceptable? │
    └────────┘  └──┬──────┬───┘
              YES  │      │ NO
                   │      │
           ┌───────▼┐  ┌──▼──────────────┐
           │ LOCAL  │  │ CLOUD (Groq)    │
           │ (cold) │  │ Fast, no load   │
           └────────┘  └─────────────────┘
```

### 3.4 Verifier Invocation Rules (Deterministic)

```javascript
function shouldVerify(result, context) {
  // Always verify if:
  if (context.isProductionCode) return true;
  if (context.modifiesTests) return true;
  if (context.touchesSecurity) return true;
  
  // Verify based on confidence:
  if (result.confidence < 0.7) return true;
  
  // Verify based on tier (less capable = more verification):
  if (result.tier === "fast" && result.confidence < 0.85) return true;
  
  // Skip verification for:
  if (result.confidence >= 0.9 && result.tier !== "fast") return false;
  if (context.isReadOnly) return false;  // Queries don't need verification
  if (context.isExplanation) return false;
  
  // Default: verify
  return true;
}
```

---

## 4. Confidence Thresholds & Escalation Policy

### 4.1 Dynamic Thresholds (Metrics-Driven)

Instead of static thresholds, adapt based on rolling performance:

```javascript
class AdaptiveThreshold {
  constructor(baseThreshold, windowSize = 50) {
    this.base = baseThreshold;
    this.window = [];
    this.windowSize = windowSize;
  }
  
  record(confidence, wasCorrect) {
    this.window.push({ confidence, wasCorrect });
    if (this.window.length > this.windowSize) this.window.shift();
  }
  
  getThreshold() {
    if (this.window.length < 10) return this.base;  // Not enough data
    
    // Find the confidence level where accuracy drops below 80%
    const sorted = [...this.window].sort((a, b) => b.confidence - a.confidence);
    let correct = 0, total = 0;
    
    for (const entry of sorted) {
      total++;
      if (entry.wasCorrect) correct++;
      const accuracy = correct / total;
      
      if (accuracy < 0.8 && total >= 5) {
        // This confidence level is the boundary
        return entry.confidence + 0.05;  // Add margin
      }
    }
    
    return this.base;  // Data suggests base is fine
  }
}
```

### 4.2 Escalation Policy Engine

```javascript
function shouldEscalate(result, context, metrics) {
  const threshold = context.adaptiveThreshold.getThreshold();
  
  // Hard rules (always escalate):
  if (result.confidence < 0.3) return { escalate: true, reason: "critically_low_confidence" };
  if (result.error && !result.error.retryable) return { escalate: true, reason: "permanent_error" };
  if (context.tokenBudgetExceeded) return { escalate: true, reason: "context_overflow", target: "cloud" };
  
  // Metrics-driven rules:
  if (result.confidence < threshold) {
    // Check if escalation actually helps (from historical data)
    const escalationSuccessRate = metrics.getEscalationSuccessRate(result.tier);
    if (escalationSuccessRate > 0.6) {
      return { escalate: true, reason: "below_adaptive_threshold" };
    } else {
      // Escalation historically doesn't help — try retry instead
      return { escalate: false, retry: true, reason: "escalation_low_roi" };
    }
  }
  
  // Soft rules (maybe escalate):
  if (result.durationMs > context.expectedLatency * 3) {
    return { escalate: true, reason: "excessive_latency", target: "cloud" };
  }
  
  return { escalate: false };
}
```

---

## 5. Branch Termination System

### 5.1 Early Termination Rules

Kill low-value execution branches before they waste tokens:

```javascript
class BranchTerminator {
  shouldTerminate(branch, state) {
    // Rule 1: Budget exhausted
    if (branch.tokensConsumed > branch.budget.maxTokens) {
      return { terminate: true, reason: "budget_exhausted" };
    }
    
    // Rule 2: Diminishing returns (confidence not improving)
    if (branch.retryCount >= 2) {
      const improvements = branch.confidenceHistory;
      const improving = improvements[improvements.length - 1] > improvements[0] + 0.05;
      if (!improving) {
        return { terminate: true, reason: "diminishing_returns" };
      }
    }
    
    // Rule 3: Sibling already succeeded (in parallel branches)
    if (state.hasSiblingCompleted(branch, minConfidence: 0.8)) {
      return { terminate: true, reason: "sibling_succeeded" };
    }
    
    // Rule 4: Recursive depth exceeded
    if (branch.escalationDepth > 3) {
      return { terminate: true, reason: "max_escalation_depth" };
    }
    
    // Rule 5: Wall-clock timeout
    if (Date.now() - branch.startTime > branch.timeout) {
      return { terminate: true, reason: "timeout" };
    }
    
    // Rule 6: Circular reasoning detected
    if (detectCircularReasoning(branch.outputs)) {
      return { terminate: true, reason: "circular_reasoning" };
    }
    
    return { terminate: false };
  }
}

function detectCircularReasoning(outputs) {
  // Check if recent outputs are semantically repeating
  if (outputs.length < 3) return false;
  
  const last3 = outputs.slice(-3);
  // Simple heuristic: if last 3 outputs share >70% of keywords, it's circular
  const keywords = last3.map(o => new Set(o.split(/\s+/).filter(w => w.length > 4)));
  
  const intersection01 = [...keywords[0]].filter(w => keywords[1].has(w));
  const intersection12 = [...keywords[1]].filter(w => keywords[2].has(w));
  
  const overlap01 = intersection01.length / Math.max(keywords[0].size, 1);
  const overlap12 = intersection12.length / Math.max(keywords[1].size, 1);
  
  return overlap01 > 0.7 && overlap12 > 0.7;
}
```

### 5.2 Termination Actions

| Reason | Action | Fallback |
|---|---|---|
| budget_exhausted | Return partial result with warning | Escalate to cloud |
| diminishing_returns | Return best attempt, flag for human | Log as low-confidence |
| sibling_succeeded | Cancel, use sibling's result | N/A |
| max_escalation_depth | Return to human with full trace | Queue as TODO |
| timeout | Return partial, log | Retry in next session |
| circular_reasoning | Hard terminate, log pattern | Different approach needed |

---

## 6. Retry Engine

### 6.1 Retry Strategy Selection

```javascript
function selectRetryStrategy(error, context, metrics) {
  // Transient network errors → immediate retry with backoff
  if (error.type === "network" || error.type === "timeout") {
    return {
      strategy: "exponential_backoff",
      maxRetries: 3,
      baseDelay: 1000,
      sameModel: true
    };
  }
  
  // Model busy (VRAM contention) → wait longer
  if (error.type === "ollama_busy") {
    return {
      strategy: "fixed_delay",
      maxRetries: 2,
      delay: 5000,
      sameModel: true
    };
  }
  
  // Low confidence (not an error, but unsatisfactory) → try different approach
  if (error.type === "low_confidence") {
    return {
      strategy: "escalate_tier",
      maxRetries: 1,
      sameModel: false,
      newTier: getNextTier(context.currentTier)
    };
  }
  
  // Rate limited (cloud) → switch provider
  if (error.type === "rate_limited") {
    return {
      strategy: "provider_failover",
      maxRetries: 1,
      sameModel: false,
      failoverMap: { "gemini": "groq", "groq": "gemini" }
    };
  }
  
  // Context overflow → compress and retry
  if (error.type === "context_overflow") {
    return {
      strategy: "compress_retry",
      maxRetries: 1,
      sameModel: true,
      preRetryAction: "compress_context"
    };
  }
  
  // Unknown → no retry
  return { strategy: "none", maxRetries: 0 };
}
```

### 6.2 Retry State Machine

```
┌───────────┐     ┌──────────┐     ┌───────────┐
│ EXECUTING │────▶│  FAILED  │────▶│ EVALUATING│
└───────────┘     └──────────┘     └─────┬─────┘
                                         │
                           ┌─────────────┼─────────────┐
                           │             │             │
                    ┌──────▼───┐  ┌──────▼───┐  ┌─────▼──────┐
                    │ RETRY    │  │ ESCALATE │  │ TERMINATE  │
                    │ (same)   │  │ (higher) │  │ (give up)  │
                    └──────┬───┘  └──────┬───┘  └────────────┘
                           │             │
                    ┌──────▼─────────────▼───┐
                    │      EXECUTING          │
                    └────────────────────────┘
```

---

## 7. Conflict Arbitration Engine

### 7.1 Deterministic Resolution (No LLM Needed)

```javascript
function arbitrate(positions) {
  // Level 1: Confidence gap (fastest, most common)
  const sorted = positions.sort((a, b) => b.confidence - a.confidence);
  const gap = sorted[0].confidence - sorted[1].confidence;
  
  if (gap > 0.2) {
    return {
      winner: sorted[0],
      method: "confidence_gap",
      reason: `${sorted[0].agent} confidence ${sorted[0].confidence} vs ${sorted[1].confidence} (gap: ${gap})`
    };
  }
  
  // Level 2: Tier hierarchy (free, deterministic)
  const tierRank = { heavy: 4, cloud: 4, reasoning: 3, specialist: 2, fast: 1 };
  const byTier = positions.sort((a, b) => tierRank[b.tier] - tierRank[a.tier]);
  
  if (tierRank[byTier[0].tier] > tierRank[byTier[1].tier]) {
    return {
      winner: byTier[0],
      method: "tier_hierarchy",
      reason: `${byTier[0].agent} (${byTier[0].tier}) outranks ${byTier[1].agent} (${byTier[1].tier})`
    };
  }
  
  // Level 3: Historical accuracy (metrics-driven)
  const accuracies = positions.map(p => ({
    ...p,
    historicalAccuracy: metrics.getAccuracy(p.agent, p.domain)
  }));
  const byAccuracy = accuracies.sort((a, b) => b.historicalAccuracy - a.historicalAccuracy);
  
  if (byAccuracy[0].historicalAccuracy - byAccuracy[1].historicalAccuracy > 0.1) {
    return {
      winner: byAccuracy[0],
      method: "historical_accuracy",
      reason: `${byAccuracy[0].agent} has ${(byAccuracy[0].historicalAccuracy * 100).toFixed(0)}% accuracy in this domain`
    };
  }
  
  // Level 4: Recency bias (more recent training data wins for factual disputes)
  // Level 5: Only if all else fails → LLM judge (tournament_vote)
  return { winner: null, method: "needs_judge", reason: "All deterministic methods inconclusive" };
}
```

### 7.2 Arbitration Cascade

```
Conflict detected
    │
    ├─▶ [Confidence Gap > 0.2?] ──YES──▶ Winner by confidence
    │           │
    │          NO
    │           │
    ├─▶ [Different tiers?] ──YES──▶ Winner by tier rank
    │           │
    │          NO
    │           │
    ├─▶ [Historical accuracy gap > 10%?] ──YES──▶ Winner by track record
    │           │
    │          NO
    │           │
    ├─▶ [Domain specialist among positions?] ──YES──▶ Winner by domain expertise
    │           │
    │          NO
    │           │
    └─▶ [LLM Judge] ──▶ Tournament vote (ONLY as last resort)
              │
              └── Costs tokens, only ~5% of conflicts should reach here
```

---

## 8. Dependency Tracking

### 8.1 Dependency Types

```jsonc
{
  "hard": "Must complete before dependent can start. Failure = dependent fails.",
  "soft": "Preferred to complete first, but dependent can proceed with default/empty input.",
  "optional": "Nice-to-have context. Skip if timed out.",
  "gate": "Boolean check — dependent only runs if gate passes."
}
```

### 8.2 Dependency Resolution Algorithm

```javascript
function resolveDependencies(dag) {
  const resolved = new Set();
  const executing = new Set();
  const ready = new Set();
  
  // Topological sort to find execution order
  const order = topologicalSort(dag.nodes);
  
  for (const nodeId of order) {
    const node = dag.nodes[nodeId];
    const deps = node.dependencies || [];
    
    const hardDeps = deps.filter(d => d.type === "hard");
    const softDeps = deps.filter(d => d.type === "soft");
    const optDeps = deps.filter(d => d.type === "optional");
    
    // Can execute when: all hard deps resolved + optionally some soft deps
    const canExecute = hardDeps.every(d => resolved.has(d.id));
    
    if (canExecute) {
      ready.add(nodeId);
    }
  }
  
  return { ready, blocked: order.filter(n => !ready.has(n)) };
}
```

---

## 9. Cost Optimizer

### 9.1 Token Cost Model

```javascript
const COST_MODEL = {
  // Local models: cost = time (VRAM is fixed cost)
  fast:       { tokensPerSec: 180, costPerToken: 0 },
  specialist: { tokensPerSec: 65,  costPerToken: 0 },
  reasoning:  { tokensPerSec: 35,  costPerToken: 0 },
  heavy:      { tokensPerSec: 25,  costPerToken: 0 },
  
  // Cloud models: cost = API usage (free tier has limits)
  gemini:     { tokensPerSec: 200, costPerToken: 0, dailyBudget: 1500 },
  groq:       { tokensPerSec: 500, costPerToken: 0, dailyBudget: 14400 }
};

function estimateCost(task, tier) {
  const tokens = estimateTokens(task);
  const model = COST_MODEL[tier];
  
  return {
    estimatedDurationMs: (tokens / model.tokensPerSec) * 1000,
    tokenCost: tokens * model.costPerToken,
    remainingBudget: model.dailyBudget ? getRemainingBudget(tier) : Infinity,
    recommendation: model.dailyBudget && getRemainingBudget(tier) < tokens
      ? "switch_provider"
      : "proceed"
  };
}
```

### 9.2 Optimization Rules

```
1. Prefer local over cloud (zero marginal cost)
2. Prefer fast over specialist (3x throughput) when confidence allows
3. Batch parallel requests to same model (reduces context switching)
4. Cache repeated prompts (TTL: 5 minutes)
5. Compress context before sending to expensive tier
6. Abort early if sibling branch already succeeded
7. Skip verification for high-confidence + high-tier results
```

---

## 10. Circuit Breakers

### 10.1 Per-Model Circuit Breaker

```javascript
class CircuitBreaker {
  constructor(failureThreshold = 5, resetTimeMs = 60000) {
    this.state = "closed";  // closed | open | half-open
    this.failures = 0;
    this.threshold = failureThreshold;
    this.resetTime = resetTimeMs;
    this.lastFailure = 0;
  }
  
  canExecute() {
    if (this.state === "closed") return true;
    if (this.state === "open") {
      if (Date.now() - this.lastFailure > this.resetTime) {
        this.state = "half-open";
        return true;  // Allow one test request
      }
      return false;
    }
    return true;  // half-open: allow test
  }
  
  recordSuccess() {
    this.failures = 0;
    this.state = "closed";
  }
  
  recordFailure() {
    this.failures++;
    this.lastFailure = Date.now();
    if (this.failures >= this.threshold) {
      this.state = "open";
    }
  }
}

// One breaker per model
const breakers = {
  fast: new CircuitBreaker(5, 30000),
  specialist: new CircuitBreaker(3, 60000),
  reasoning: new CircuitBreaker(3, 60000),
  heavy: new CircuitBreaker(2, 120000),
  gemini: new CircuitBreaker(3, 300000),  // Longer reset for rate limits
  groq: new CircuitBreaker(3, 300000)
};
```

### 10.2 Circuit Breaker State Machine

```
     CLOSED                    OPEN                    HALF-OPEN
  ┌──────────┐           ┌──────────┐            ┌──────────────┐
  │ Normal   │──fail×N──▶│ Blocked  │──timeout──▶│ Test request │
  │ operation│           │ (reject  │            │ allowed      │
  │          │◀──────────│  all)    │◀───fail────│              │
  │          │  success  └──────────┘            │              │──success──▶ CLOSED
  └──────────┘                                   └──────────────┘
```

---

## 11. Orchestrator State Machine

```
┌──────────────────────────────────────────────────────────────┐
│                    ORCHESTRATOR STATES                         │
│                                                              │
│  ┌─────┐    ┌───────┐    ┌──────────┐    ┌───────────────┐  │
│  │IDLE │───▶│ROUTING│───▶│SCHEDULING│───▶│EXECUTING      │  │
│  └─────┘    └───────┘    └──────────┘    │               │  │
│     ▲                                     │ ┌───────────┐ │  │
│     │                                     │ │node_start │ │  │
│     │                                     │ │node_done  │ │  │
│     │                                     │ │gate_eval  │ │  │
│     │                                     │ │retry      │ │  │
│     │                                     │ │escalate   │ │  │
│     │                                     │ │terminate  │ │  │
│     │                                     │ └───────────┘ │  │
│     │                                     └───────┬───────┘  │
│     │                                             │          │
│     │         ┌────────────┐              ┌───────▼───────┐  │
│     │         │ FAILED     │◀─────────────│ FINALIZING    │  │
│     │         └────────────┘              └───────┬───────┘  │
│     │                                             │          │
│     └─────────────────────────────────────────────┘          │
│                        COMPLETE                               │
└──────────────────────────────────────────────────────────────┘
```

### State Descriptions

| State | What Happens | LLM Calls |
|---|---|---|
| IDLE | Awaiting task input | None |
| ROUTING | Heuristic tier/tool selection + DAG lookup | None |
| SCHEDULING | Resolve dependencies, build execution plan | None |
| EXECUTING | Run DAG nodes, evaluate gates, handle retries | Workers only |
| FINALIZING | Assemble output, run verification if needed | Possibly self_eval |
| COMPLETE | Emit result, update metrics, checkpoint | None |
| FAILED | Log failure, return partial, emit alert | None |

**Key insight:** Only EXECUTING and FINALIZING may invoke LLMs — and only as workers. All orchestration decisions are deterministic.

---

## 12. Failure Recovery Flows

### 12.1 Checkpoint-Based Recovery

```
Task executing... 
  Step 1 ✅ → checkpoint saved
  Step 2 ✅ → checkpoint saved
  Step 3 ❌ → FAILURE
  
Recovery:
  Load checkpoint from Step 2
  Modify Step 3 (different tier, different approach)
  Resume from Step 3
```

### 12.2 Graceful Degradation Ladder

```
Level 0: Normal execution (full DAG)
Level 1: Skip optional steps (reduce scope)
Level 2: Use faster tier (less quality, more speed)
Level 3: Return partial result with confidence warning
Level 4: Escalate to cloud (if local is failing)
Level 5: Queue for human with full trace + partial work
```

### 12.3 Anti-Recursion Guard

```javascript
const MAX_TOTAL_TOKENS_PER_TASK = 100000;
const MAX_WALL_CLOCK_PER_TASK = 300000;  // 5 minutes
const MAX_TOOL_CALLS_PER_TASK = 20;

function globalGuard(taskState) {
  if (taskState.totalTokens > MAX_TOTAL_TOKENS_PER_TASK) {
    return { abort: true, reason: "token_budget_exceeded" };
  }
  if (Date.now() - taskState.startTime > MAX_WALL_CLOCK_PER_TASK) {
    return { abort: true, reason: "wall_clock_exceeded" };
  }
  if (taskState.toolCalls > MAX_TOOL_CALLS_PER_TASK) {
    return { abort: true, reason: "tool_call_limit" };
  }
  return { abort: false };
}
```

---

*End of Phase 5. The orchestrator is now a deterministic engine — heuristic-driven routing, DAG-based execution, metrics-adaptive thresholds, automatic termination of wasteful branches, and LLM-free decision making throughout.*
