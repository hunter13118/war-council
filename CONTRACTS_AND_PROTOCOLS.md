# Phase 2 — Contracts and Protocols

**Purpose:** Transform prompt-driven swarm into structured distributed cognition infrastructure.
**Principle:** Deterministic orchestration, minimal token waste, subsystem isolation, modular extensibility.

---

## 1. Agent Communication Schema

Every agent interaction follows this envelope:

```jsonc
// AgentMessage — the universal wire format between any two components
{
  "$schema": "war-council://schemas/agent-message.v1",
  "id": "uuid-v4",
  "timestamp": "ISO-8601",
  "source": {
    "agent": "string",       // Agent name (e.g., "CodeReviewer", "consult_fast")
    "tier": "fast|specialist|reasoning|heavy|cloud",
    "model": "string"       // Actual model name (e.g., "qwen2.5-coder:14b")
  },
  "target": {
    "agent": "string",       // Intended recipient (or "conductor" for responses)
    "tier": "string"
  },
  "type": "request|response|escalation|arbitration|notification",
  "payload": {
    "task": "string",        // What to do (for requests)
    "context": "string",     // Relevant context (truncated to budget)
    "constraints": {         // Hard limits for this interaction
      "maxTokensIn": 4096,
      "maxTokensOut": 2048,
      "timeoutMs": 60000,
      "temperature": 0.2
    },
    "result": "string|null",      // Response content (for responses)
    "confidence": {},             // ConfidenceScore object (see §4)
    "artifacts": []               // File paths, code blocks, etc.
  },
  "meta": {
    "chainId": "string|null",     // If part of a task chain
    "stepIndex": "number|null",   // Step within chain
    "retryCount": 0,
    "parentMessageId": "string|null"
  }
}
```

---

## 2. Agent Role Contract

Every agent (whether Copilot-native or Ollama-invoked) is bound by:

```jsonc
// AgentContract — defines what an agent CAN and CANNOT do
{
  "$schema": "war-council://schemas/agent-contract.v1",
  "name": "string",
  "version": "semver",
  "role": "string",              // One-sentence description
  "tier": "fast|specialist|reasoning|heavy",
  "domain": ["string"],          // Allowed domains (e.g., ["react", "testing", "css"])

  "boundaries": {
    "allowedActions": [
      "generate_code",
      "review_code",
      "write_tests",
      "analyze_error",
      "suggest_refactor"
    ],
    "forbiddenActions": [
      "delete_files",
      "push_to_remote",
      "modify_config",
      "access_secrets",
      "communicate_externally"
    ],
    "contextLimits": {
      "maxInputTokens": 8192,    // Max tokens this agent should receive
      "maxOutputTokens": 4096,   // Max tokens this agent should produce
      "maxContextFiles": 10      // Max files in context window
    }
  },

  "outputSchema": {
    "format": "structured|freeform|code-only",
    "requiredFields": ["result", "confidence", "reasoning"],
    "codeBlockLanguage": "string|null"
  },

  "escalation": {
    "escalatesTo": "string|null",      // Agent to escalate to
    "escalationThreshold": 0.4,        // Confidence below this triggers escalation
    "maxRetries": 2
  },

  "qualityGates": {
    "selfEvalRequired": false,
    "peerReviewRequired": false,
    "testsMustPass": false
  }
}
```

### Concrete Agent Contracts

| Agent | Tier | Allowed Actions | Forbidden | Escalates To | Confidence Threshold |
|---|---|---|---|---|---|
| consult_fast | fast | generate_code, analyze_error | delete_files, push | consult_specialist | 0.5 |
| consult_specialist | specialist | generate_code, review_code, write_tests, suggest_refactor | push, secrets | consult_reasoning | 0.4 |
| consult_reasoning | reasoning | analyze_error, review_code, architectural_decision | delete_files, push | strategic_plan (cloud) | 0.3 |
| CodeReviewer | specialist | review_code, suggest_refactor | generate_code, delete | council_deliberate | 0.4 |
| TestWriter | specialist | write_tests, generate_code | delete_files, deploy | consult_reasoning | 0.5 |
| TestRunner | fast | run_tests, analyze_error | modify_code, push | Conductor | 0.6 |
| Conductor | heavy | delegate, coordinate, arbitrate | write_code (except trivial) | strategic_plan | 0.3 |
| RepoScout | fast | search, analyze_error | modify_code | consult_specialist | 0.5 |

---

## 3. Task Lifecycle States

```
┌─────────┐     ┌──────────┐     ┌─────────────┐     ┌──────────┐
│ PENDING │────▶│ ROUTING  │────▶│ IN_PROGRESS │────▶│ REVIEW   │
└─────────┘     └──────────┘     └─────────────┘     └──────────┘
                     │                   │                   │
                     │              ┌────▼────┐        ┌────▼────┐
                     │              │ESCALATED│        │APPROVED │
                     │              └────┬────┘        └────┬────┘
                     │                   │                   │
                     │              ┌────▼────┐        ┌────▼────┐
                     │              │RETRYING │        │COMPLETE │
                     │              └────┬────┘        └─────────┘
                     │                   │
                     │              ┌────▼────┐
                     └─────────────▶│ FAILED  │
                                    └─────────┘
```

```jsonc
// TaskState — tracks where a task is in its lifecycle
{
  "$schema": "war-council://schemas/task-state.v1",
  "taskId": "uuid-v4",
  "state": "pending|routing|in_progress|escalated|retrying|review|approved|complete|failed",
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601",
  "description": "string",

  "routing": {
    "method": "smart_route|explicit|chain",
    "selectedTool": "string",
    "selectedChain": "string|null",
    "confidence": 0.0
  },

  "execution": {
    "assignedAgent": "string",
    "tier": "string",
    "startedAt": "ISO-8601|null",
    "completedAt": "ISO-8601|null",
    "durationMs": 0,
    "retryCount": 0,
    "maxRetries": 3
  },

  "result": {
    "output": "string|null",
    "confidence": {},          // ConfidenceScore
    "artifacts": [],
    "tokensUsed": { "in": 0, "out": 0 }
  },

  "history": [
    {
      "timestamp": "ISO-8601",
      "fromState": "string",
      "toState": "string",
      "reason": "string",
      "agent": "string"
    }
  ]
}
```

### State Transition Rules

| From | To | Trigger | Condition |
|---|---|---|---|
| PENDING | ROUTING | Task submitted | Always |
| ROUTING | IN_PROGRESS | Route determined | smart_route confidence > 0.5 OR explicit tool |
| ROUTING | FAILED | No viable route | All routes below threshold |
| IN_PROGRESS | REVIEW | Agent completes | confidence >= escalation threshold |
| IN_PROGRESS | ESCALATED | Low confidence | confidence < agent's escalation threshold |
| IN_PROGRESS | FAILED | Error after max retries | retryCount >= maxRetries |
| ESCALATED | IN_PROGRESS | Higher-tier agent accepts | Escalation target available |
| ESCALATED | FAILED | No escalation path | All tiers exhausted |
| RETRYING | IN_PROGRESS | Retry initiated | retryCount < maxRetries |
| REVIEW | APPROVED | Self-eval passes OR human approves | PASS verdict |
| REVIEW | IN_PROGRESS | Review finds issues | Fixable issues identified |
| REVIEW | FAILED | Unfixable issues | FAIL verdict, no retry path |
| APPROVED | COMPLETE | Final commit/output | Always |

---

## 4. Confidence Scoring Format

Every agent response includes a confidence assessment:

```jsonc
// ConfidenceScore — how sure the agent is about its output
{
  "$schema": "war-council://schemas/confidence.v1",
  "overall": 0.85,          // 0.0–1.0 composite score
  "dimensions": {
    "correctness": 0.9,     // Is the code/answer logically correct?
    "completeness": 0.8,    // Does it fully address the task?
    "relevance": 0.95,      // Is it on-topic?
    "safety": 1.0           // Any security/safety concerns? (1.0 = safe)
  },
  "reasoning": "string",    // 1-2 sentence justification
  "uncertainties": [         // What the agent is unsure about
    "string"
  ],
  "suggestedVerification": "test|review|manual|none"
}
```

### Confidence Thresholds (System-Wide)

| Threshold | Value | Meaning |
|---|---|---|
| AUTO_APPROVE | >= 0.9 | Apply without review |
| STANDARD | 0.6–0.89 | Apply with self-eval gate |
| LOW_CONFIDENCE | 0.4–0.59 | Escalate to higher tier |
| REJECT | < 0.4 | Do not apply, escalate or fail |

### Scoring Guidelines by Tier

| Tier | Expected Range | Self-Eval Required |
|---|---|---|
| fast (7b) | 0.5–0.7 typical | Yes, always |
| specialist (14b) | 0.6–0.85 typical | If < 0.8 |
| reasoning (14b) | 0.7–0.9 typical | If < 0.85 |
| heavy (32b) | 0.75–0.95 typical | Only if < 0.8 |
| cloud (Gemini/Groq) | 0.8–0.95 typical | No (trusted) |

---

## 5. Memory Write Contract

### 5.1 Index Write Interface

```jsonc
// MemoryWriteRequest
{
  "$schema": "war-council://schemas/memory-write.v1",
  "operation": "index_file|index_chunk|index_conversation|delete",
  "source": {
    "type": "code|conversation|decision|artifact",
    "filePath": "string",       // e.g., "src/server.js" or "conv://copilot/abc123"
    "startLine": 0,
    "endLine": 0
  },
  "content": "string",          // Raw text to embed
  "metadata": {
    "language": "string|null",
    "tags": ["string"],
    "importance": "high|medium|low",
    "expiresAt": "ISO-8601|null"   // TTL for transient context
  },
  "embedding": {
    "model": "nomic-embed-text",
    "dimensions": 768,
    "vector": [0.0]             // Populated by indexer
  }
}
```

### 5.2 Chunk Schema

```jsonc
// MemoryChunk — unit of storage in the vector store
{
  "id": "uuid-v4",
  "file": "string",
  "startLine": 0,
  "endLine": 0,
  "text": "string",
  "embedding": [0.0],
  "metadata": {
    "source": "code|conversation|decision",
    "language": "string|null",
    "tags": [],
    "indexedAt": "ISO-8601",
    "importance": "high|medium|low"
  }
}
```

---

## 6. Retrieval Interface Contract

```jsonc
// RetrievalRequest
{
  "$schema": "war-council://schemas/retrieval-request.v1",
  "query": "string",
  "options": {
    "k": 5,                        // Top-K results
    "minRelevance": 0.30,          // Cosine threshold
    "source": "code|conversation|all",
    "maxAge": "30d|null",          // Only chunks indexed within this window
    "tags": ["string"]|null,       // Filter by metadata tags
    "budgetTokens": 4000           // Max total tokens across all returned chunks
  }
}

// RetrievalResponse
{
  "$schema": "war-council://schemas/retrieval-response.v1",
  "query": "string",
  "chunks": [
    {
      "id": "string",
      "file": "string",
      "startLine": 0,
      "text": "string",
      "score": 0.85,
      "metadata": {}
    }
  ],
  "stats": {
    "totalChunks": 0,
    "scanned": 0,
    "returned": 0,
    "tokensUsed": 0
  },
  "latency": {
    "embedMs": 0,
    "searchMs": 0,
    "totalMs": 0
  },
  "augmentedPrompt": "string"    // Pre-built context block ready for injection
}
```

---

## 7. Escalation Contract

```jsonc
// EscalationRequest — when an agent needs to hand off to a higher tier
{
  "$schema": "war-council://schemas/escalation.v1",
  "type": "confidence_low|timeout|error|complexity|domain_mismatch",
  "source": {
    "agent": "string",
    "tier": "string",
    "taskId": "string"
  },
  "target": {
    "agent": "string|null",      // null = let router decide
    "tier": "string",
    "reason": "string"
  },
  "context": {
    "originalTask": "string",
    "partialResult": "string|null",
    "confidence": {},
    "errorMessage": "string|null",
    "attemptCount": 1
  },
  "policy": {
    "maxEscalations": 3,         // Total escalation depth allowed
    "currentDepth": 1,
    "fallbackAction": "fail|return_partial|queue_for_human"
  }
}
```

### Escalation Chain

```
fast (7b) → specialist (14b) → reasoning (14b) → heavy (32b) → cloud (Gemini/Groq) → HUMAN
```

### Escalation Triggers

| Trigger | Condition | Action |
|---|---|---|
| Low confidence | `confidence.overall < agent.escalationThreshold` | Escalate up one tier |
| Timeout | `durationMs > constraints.timeoutMs` | Cancel + escalate |
| Error (transient) | Network/Ollama error | Retry (up to maxRetries) |
| Error (permanent) | Model not found, invalid input | Fail immediately |
| Complexity | Token budget exceeded | Escalate to larger context (cloud) |
| Domain mismatch | Agent reports "outside my scope" | Re-route via smart_route |

---

## 8. Verification Interface

```jsonc
// VerificationRequest — self-eval or peer review gate
{
  "$schema": "war-council://schemas/verification.v1",
  "type": "self_eval|peer_review|test_gate|human_approval",
  "taskId": "string",
  "code": "string",
  "context": "string",           // What the code should accomplish
  "criteria": [
    "correctness",
    "security",
    "style",
    "test_coverage"
  ]
}

// VerificationResponse
{
  "$schema": "war-council://schemas/verification-response.v1",
  "verdict": "PASS|FAIL|CONDITIONAL",
  "confidence": 0.85,
  "issues": [
    {
      "severity": "critical|warning|nit",
      "category": "correctness|security|style|performance|coverage",
      "description": "string",
      "location": "string|null",     // file:line if applicable
      "suggestion": "string|null"
    }
  ],
  "summary": "string",
  "passConditions": ["string"]       // If CONDITIONAL, what must be done
}
```

---

## 9. Execution Result Schema

Every tool call produces a standardized result:

```jsonc
// ExecutionResult — universal output format from any tool
{
  "$schema": "war-council://schemas/execution-result.v1",
  "toolName": "string",
  "taskId": "string|null",
  "success": true,
  "timing": {
    "startedAt": "ISO-8601",
    "completedAt": "ISO-8601",
    "durationMs": 0,
    "queuedMs": 0            // Time waiting for model/resource
  },
  "model": {
    "name": "string",
    "tier": "string",
    "provider": "ollama|gemini|groq"
  },
  "tokens": {
    "in": 0,
    "out": 0,
    "perSecond": 0
  },
  "output": {
    "text": "string",
    "format": "text|json|code|markdown",
    "truncated": false,
    "originalLength": 0
  },
  "confidence": {},           // ConfidenceScore
  "sideEffects": [            // What this execution changed
    {
      "type": "file_written|event_emitted|model_loaded|test_run",
      "detail": "string"
    }
  ],
  "error": {
    "code": "string|null",
    "message": "string|null",
    "retryable": false
  }
}
```

---

## 10. Retry Policy

```jsonc
// RetryPolicy — governs automatic retry behavior
{
  "$schema": "war-council://schemas/retry-policy.v1",
  "maxRetries": 3,
  "backoff": {
    "type": "exponential",
    "baseDelayMs": 1000,
    "maxDelayMs": 30000,
    "jitter": true
  },
  "retryOn": [
    "network_error",
    "timeout",
    "ollama_busy",
    "rate_limited"
  ],
  "noRetryOn": [
    "invalid_input",
    "model_not_found",
    "authentication_error",
    "context_overflow"
  ],
  "circuitBreaker": {
    "enabled": true,
    "failureThreshold": 5,      // Consecutive failures to trip
    "resetTimeMs": 60000        // Time before trying again
  }
}
```

---

## 11. Orchestration Sequence Diagrams

### 11.1 Standard Tool Call

```
Consumer          MCP Server        Ollama         Dashboard
   │                  │                │               │
   │──CallTool───────▶│                │               │
   │                  │─emit(start)───────────────────▶│
   │                  │──generate────▶│               │
   │                  │               │──inference──▶  │
   │                  │◀──response────│               │
   │                  │─emit(complete)────────────────▶│
   │◀──Result─────────│                │               │
```

### 11.2 Escalation Flow

```
Consumer    MCP Server     Fast(7b)    Specialist(14b)   Dashboard
   │            │              │              │              │
   │─CallTool──▶│              │              │              │
   │            │─generate────▶│              │              │
   │            │◀─low conf────│              │              │
   │            │─emit(escalation)───────────────────────────▶│
   │            │─generate────────────────────▶│              │
   │            │◀─────────result──────────────│              │
   │            │─emit(complete)─────────────────────────────▶│
   │◀──Result───│              │              │              │
```

### 11.3 Task Chain Execution

```
Consumer    MCP Server     Memory     Specialist    Reasoning    Cloud
   │            │             │            │            │          │
   │─run_chain─▶│             │            │            │          │
   │            │─query──────▶│            │            │          │
   │            │◀─chunks─────│            │            │          │
   │            │─plan─────────────────────────────────────────────▶│
   │            │◀─steps──────────────────────────────────────────│
   │            │─implement──────────────▶│            │          │
   │            │◀─code──────────────────│            │          │
   │            │─review─────────────────────────────▶│          │
   │            │◀─verdict───────────────────────────│          │
   │◀──Result───│             │            │            │          │
```

### 11.4 Tournament Vote

```
Consumer    MCP Server    Voter1    Voter2    Voter3    Judge     Dashboard
   │            │           │         │         │        │          │
   │─tournament▶│           │         │         │        │          │
   │            │─prompt───▶│         │         │        │          │
   │            │─prompt────────────▶│         │        │          │
   │            │─prompt───────────────────────▶│        │          │
   │            │◀─resp1────│         │         │        │          │
   │            │◀─resp2──────────────│         │        │          │
   │            │◀─resp3────────────────────────│        │          │
   │            │─judge─────────────────────────────────▶│          │
   │            │◀─verdict──────────────────────────────│          │
   │            │─emit(tournament_result)─────────────────────────▶│
   │◀──Result───│           │         │         │        │          │
```

### 11.5 Council Deliberation

```
Consumer    MCP Server    Panelist1   Panelist2   Panelist3   Synthesizer
   │            │             │           │           │           │
   │─deliberate▶│             │           │           │           │
   │            │─prompt(1)──▶│           │           │           │
   │            │◀─response1──│           │           │           │
   │            │─prompt(1+2)───────────▶│           │           │
   │            │◀─response2─────────────│           │           │
   │            │─prompt(1+2+3)────────────────────▶│           │
   │            │◀─response3───────────────────────│           │
   │            │─all responses────────────────────────────────▶│
   │            │◀─synthesis───────────────────────────────────│
   │◀──Result───│             │           │           │           │
```

---

## 12. Disagreement Resolution Protocol

When agents produce conflicting results:

```jsonc
// ArbitrationRequest
{
  "$schema": "war-council://schemas/arbitration.v1",
  "type": "conflict|tie|ambiguous",
  "positions": [
    {
      "agent": "string",
      "tier": "string",
      "position": "string",
      "confidence": 0.0,
      "reasoning": "string"
    }
  ],
  "resolution_method": "judge|vote|escalate|human",
  "judge": {
    "agent": "consult_reasoning",
    "tier": "reasoning"
  }
}
```

### Resolution Hierarchy

1. **Confidence-based** — If one position has confidence > 0.8 and others < 0.6, highest wins
2. **Tier-based** — Higher-tier agent wins ties (reasoning > specialist > fast)
3. **Judge arbitration** — Reasoning model evaluates both positions (tournament_vote pattern)
4. **Council deliberation** — Sequential panel weighs in (for architectural decisions)
5. **Human escalation** — `request_user_feedback` with both positions presented

---

## 13. Termination Conditions

A task terminates when ANY of these conditions is met:

| Condition | State → | Action |
|---|---|---|
| Agent returns confidence >= threshold | REVIEW | Proceed to verification |
| Self-eval PASS | COMPLETE | Emit result |
| Self-eval FAIL + fixable | IN_PROGRESS | Re-attempt with feedback |
| Self-eval FAIL + unfixable | FAILED | Report to human |
| Max retries exhausted | FAILED | Report error + partial results |
| Max escalation depth reached | FAILED | Report to human |
| Timeout exceeded | FAILED | Return partial or escalate |
| Human explicitly approves | COMPLETE | Done |
| Human explicitly rejects | FAILED | Record feedback |
| Context budget exhausted | ESCALATED | Move to larger context (cloud) |

---

## 14. Token Budget Protocol

```jsonc
// TokenBudget — enforces context window discipline
{
  "$schema": "war-council://schemas/token-budget.v1",
  "modelContext": 32768,         // Model's total context window
  "allocation": {
    "systemPrompt": 2048,        // Agent persona + instructions
    "taskDescription": 1024,     // The actual task
    "retrievedContext": 8192,    // RAG chunks from memory
    "priorStepResults": 4096,    // Results from chain steps
    "scratchpad": 1024,          // Shared state
    "reserved": 2048,            // Safety margin
    "outputBudget": 4096         // Expected generation length
  },
  "overflow": {
    "strategy": "truncate_oldest|compress|escalate_to_cloud",
    "compressionTool": "compress_context",
    "cloudFallback": "strategic_plan"
  }
}
```

### Budget Enforcement Rules

1. Before injecting context, compute total tokens (estimate: chars / 3.5)
2. If total > `modelContext - outputBudget - reserved`: truncate lowest-priority sections
3. Priority order (highest → lowest): taskDescription > systemPrompt > retrievedContext > priorStepResults > scratchpad
4. If truncation insufficient: call `compress_context` on the largest section
5. If still over: escalate to cloud (Gemini 1M context)

---

*End of Phase 2 contracts. These schemas define the target architecture — implementation follows in subsequent phases.*
