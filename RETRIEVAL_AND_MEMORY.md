# Phase 4 — Retrieval and Memory Refactor

**Purpose:** Transform retrieval into a unified cognition layer. Beyond basic RAG — into persistent, aware, continuously stateful AI.
**Principle:** The AI should never say "I don't remember" about something that happened in this workspace.

---

## 1. Unified Memory Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        SOVEREIGN MEMORY ENGINE                                   │
│                                                                                 │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │                          RETRIEVAL LAYER                                   │  │
│  │                                                                           │  │
│  │  Query → [Semantic Search] + [Symbolic Search] + [Graph Traversal]        │  │
│  │            ↓                    ↓                     ↓                   │  │
│  │        vector cosine        keyword/regex         relationship walk       │  │
│  │            ↓                    ↓                     ↓                   │  │
│  │        ┌─────────────────────────────────────────────────────┐            │  │
│  │        │              FUSION RANKER                           │            │  │
│  │        │  (reciprocal rank fusion + temporal decay + type     │            │  │
│  │        │   priority + recency boost + access frequency)       │            │  │
│  │        └────────────────────────┬────────────────────────────┘            │  │
│  │                                 ↓                                         │  │
│  │                    [Budget-Aware Truncation]                               │  │
│  │                                 ↓                                         │  │
│  │                    Augmented Context Prompt                                │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
│                                                                                 │
│  ┌────────────────────────────────────────────────────────────────────────────┐ │
│  │                          STORAGE LAYER                                      │ │
│  │                                                                            │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │ │
│  │  │ Vector   │  │ Document │  │ Graph    │  │ Temporal │  │ Summary  │   │ │
│  │  │ Store    │  │ Store    │  │ Store    │  │ Index    │  │ Cache    │   │ │
│  │  │(Qdrant)  │  │(SQLite)  │  │(SQLite)  │  │(SQLite)  │  │(JSON)    │   │ │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │ │
│  └────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                 │
│  ┌────────────────────────────────────────────────────────────────────────────┐ │
│  │                          INGESTION LAYER                                    │ │
│  │                                                                            │ │
│  │  [File Watcher] [Git Hooks] [Chat Listener] [Terminal Tap] [Manual Index]  │ │
│  │        ↓             ↓            ↓              ↓              ↓         │ │
│  │                     CHUNKER → EMBEDDER → CLASSIFIER → STORE               │ │
│  └────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                 │
│  ┌────────────────────────────────────────────────────────────────────────────┐ │
│  │                          LIFECYCLE LAYER                                    │ │
│  │                                                                            │ │
│  │  [Compression] [Summarization] [Decay] [Promotion] [Archival] [Garbage]    │ │
│  └────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Memory Types (Cognitive Model)

Inspired by human cognition — different memory systems for different purposes:

### 2.1 Memory Type Taxonomy

| Memory Type | Human Analog | Content | Retention | Access Pattern |
|---|---|---|---|---|
| **Working Memory** | Short-term | Current task context, scratchpad | Session only | Always in context |
| **Episodic Memory** | Autobiographical | Past conversations, decisions, events | 90 days active, then compressed | Retrieval by topic/time |
| **Semantic Memory** | Facts & Knowledge | Code patterns, API shapes, conventions | Permanent | Retrieval by similarity |
| **Procedural Memory** | Muscle memory | Task chains, workflow patterns, tool sequences | Permanent | Pattern matching |
| **Prospective Memory** | Reminders | TODOs, deferred tasks, follow-ups | Until completed | Time-triggered |

### 2.2 Memory Type Schemas

```jsonc
// WorkingMemory — volatile, session-scoped
{
  "type": "working",
  "sessionId": "string",
  "entries": [
    {
      "key": "current_task",
      "value": "string",
      "updatedAt": "ISO-8601"
    }
  ],
  "maxEntries": 20,
  "maxTokens": 4096
}

// EpisodicMemory — what happened, when, in what context
{
  "type": "episodic",
  "id": "uuid",
  "timestamp": "ISO-8601",
  "source": "conversation|decision|event|terminal|browser",
  "summary": "string",          // Compressed version
  "fullText": "string|null",    // Original (may be GC'd after compression)
  "participants": ["agent1", "user"],
  "outcome": "string|null",
  "emotion": "neutral|positive|negative",  // Was this a success or failure?
  "tags": ["string"],
  "connections": ["episode-id"]  // Related episodes
}

// SemanticMemory — facts extracted from experience
{
  "type": "semantic",
  "id": "uuid",
  "fact": "string",             // The knowledge itself
  "source": "string",           // Where this was learned
  "confidence": 0.0,            // How confident we are in this fact
  "lastVerified": "ISO-8601",
  "citationCount": 0,           // How often this fact is retrieved
  "domain": "string"            // "react", "flask", "infra", etc.
}

// ProceduralMemory — how to do things
{
  "type": "procedural",
  "id": "uuid",
  "pattern": "string",          // When to apply (trigger condition)
  "procedure": "string",        // What to do (step sequence)
  "successRate": 0.0,           // Historical success rate
  "lastUsed": "ISO-8601",
  "domain": "string"
}

// ProspectiveMemory — things to remember to do
{
  "type": "prospective",
  "id": "uuid",
  "task": "string",
  "triggerCondition": "time|event|query",
  "triggerValue": "string",     // ISO-8601 for time, event name, or keyword
  "status": "pending|triggered|completed|expired",
  "createdAt": "ISO-8601",
  "expiresAt": "ISO-8601|null"
}
```

---

## 3. Data Sources (What Gets Indexed)

| Source | Type | Ingestion Method | Chunk Strategy | Update Frequency |
|---|---|---|---|---|
| **Codebase** | Semantic | `git ls-files` walk | AST-aware + overlap | On save / git hook |
| **Conversations (Copilot)** | Episodic | Session log parse | Turn-boundary aware | End of session |
| **Conversations (Cline/Roo)** | Episodic | Task file parse | Task-boundary aware | End of task |
| **Git History** | Episodic | `git log --diff` | Commit-boundary | On commit |
| **Agent Outputs** | Episodic + Semantic | Battle log events | Per tool-call | Real-time |
| **Decisions** | Semantic | `decisions.jsonl` | Per entry | On write |
| **Terminal Sessions** | Episodic | Capture stdout/stderr | Command-boundary | Real-time |
| **Documentation** | Semantic | File walk (*.md, *.txt) | Section-header aware | On save |
| **Browser Research** | Episodic | Manual paste or extension | Page-boundary | On capture |
| **Project State** | Working | package.json, config scan | Whole-file | On change |
| **User Preferences** | Semantic | Explicit declarations | Atomic facts | On declaration |

---

## 4. Indexing Strategies

### 4.1 Code Chunking (AST-Aware)

```
Source File
    ↓
[Language Detection]
    ↓
[AST Parse] ─── (fallback: line-count chunking if AST fails)
    ↓
[Function/Class/Module boundaries]
    ↓
[Chunk with overlap at natural boundaries]
    ↓
[Embed each chunk → nomic-embed-text → 768-dim vector]
    ↓
[Store with metadata: file, lines, language, exports, dependencies]
```

**Chunk sizes by type:**
- Function body: up to 1500 chars (one chunk per function)
- Class: header + method signatures as one chunk, each method body as separate
- Config/JSON: whole file if < 2000 chars, else split at top-level keys
- Markdown: split at ## headers

### 4.2 Conversation Chunking (Turn-Aware)

```
Conversation Transcript
    ↓
[Split at turn boundaries (user → assistant alternations)]
    ↓
[Group consecutive turns into episodes (2-4 turns each)]
    ↓
[Extract: topic, decision, code_generated, outcome]
    ↓
[Generate episode summary (fast model)]
    ↓
[Embed both summary and full text]
    ↓
[Store with: sessionId, timestamp, participants, tags]
```

### 4.3 Hierarchical Summaries

Every N chunks, generate a summary chunk that covers the batch:

```
Level 0: Raw chunks (500 chars each)
Level 1: Section summaries (covers 5-10 raw chunks)
Level 2: File summaries (covers entire file)
Level 3: Module summaries (covers directory)
Level 4: Project summary (covers entire codebase)
```

Retrieval can start at any level depending on query specificity.

---

## 5. Retrieval Ranking System

### 5.1 Hybrid Retrieval (Three-Way Fusion)

```jsonc
// RetrievalPipeline
{
  "stages": [
    {
      "name": "semantic",
      "method": "vector_cosine",
      "store": "qdrant",
      "topK": 20,              // Over-fetch for fusion
      "weight": 0.5            // Contribution to final score
    },
    {
      "name": "symbolic",
      "method": "bm25_keyword",
      "store": "sqlite_fts5",
      "topK": 20,
      "weight": 0.3
    },
    {
      "name": "graph",
      "method": "relationship_walk",
      "store": "sqlite_graph",
      "topK": 10,
      "weight": 0.2
    }
  ],
  "fusion": "reciprocal_rank_fusion",
  "reranking": "temporal_decay + type_priority + recency_boost",
  "finalK": 5
}
```

### 5.2 Reciprocal Rank Fusion (RRF)

Combines rankings from multiple retrieval methods:

```
RRF_score(doc) = Σ(1 / (k + rank_i(doc)))
where k = 60 (standard constant), rank_i = rank in retrieval method i
```

### 5.3 Temporal Relevance Decay

Recent memories are more relevant than old ones (exponential decay):

```
temporal_score = base_score × decay_factor^(days_since_indexed)

decay_factor per memory type:
  - working: 0.5   (half-life: 1 day)
  - episodic: 0.95  (half-life: 14 days)
  - semantic: 0.99  (half-life: 69 days — nearly permanent)
  - procedural: 0.995 (half-life: 139 days — very stable)
```

### 5.4 Type Priority Scoring

Different queries prefer different memory types:

```jsonc
// TypePriorityMatrix
{
  "code_question": { "semantic": 1.0, "procedural": 0.8, "episodic": 0.3 },
  "what_happened": { "episodic": 1.0, "semantic": 0.3, "procedural": 0.1 },
  "how_to": { "procedural": 1.0, "semantic": 0.7, "episodic": 0.4 },
  "decision_recall": { "episodic": 1.0, "semantic": 0.5, "procedural": 0.2 },
  "bug_context": { "semantic": 0.8, "episodic": 0.7, "procedural": 0.5 }
}
```

### 5.5 Access Frequency Boost

Frequently-retrieved chunks get a relevance boost (citation count):

```
access_boost = 1 + log2(1 + citation_count) × 0.05
```

---

## 6. Graph Memory System

### 6.1 Knowledge Graph Schema

```
Nodes:
  - File(path, language, type)
  - Function(name, file, signature)
  - Class(name, file)
  - Agent(name, tier)
  - Decision(title, date, rationale)
  - Concept(name, domain)
  - Session(id, date)
  - Episode(id, summary)

Edges:
  - imports(File → File)
  - defines(File → Function|Class)
  - calls(Function → Function)
  - inherits(Class → Class)
  - decided_by(Decision → Agent)
  - relates_to(Decision → Concept)
  - occurred_in(Episode → Session)
  - references(Episode → File)
  - produced_by(Function → Agent)
  - similar_to(Concept → Concept, weight)
```

### 6.2 Graph Traversal Queries

```sql
-- "What do I know about the authentication system?"
SELECT n.*, e.type, related.*
FROM nodes n
JOIN edges e ON n.id = e.source
JOIN nodes related ON e.target = related.id
WHERE n.name LIKE '%auth%' OR related.name LIKE '%auth%'
ORDER BY e.weight DESC
LIMIT 20;

-- "What did we decide about database choice?"
SELECT d.title, d.rationale, a.name as decided_by, s.date
FROM decisions d
JOIN edges e1 ON d.id = e1.source AND e1.type = 'decided_by'
JOIN agents a ON e1.target = a.id
JOIN edges e2 ON d.id = e2.source AND e2.type = 'occurred_in'
JOIN sessions s ON e2.target = s.id
WHERE d.title LIKE '%database%'
ORDER BY s.date DESC;
```

### 6.3 SQLite Implementation

```sql
CREATE TABLE nodes (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,  -- file|function|class|agent|decision|concept|session|episode
  name TEXT NOT NULL,
  properties TEXT,     -- JSON blob
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE edges (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL REFERENCES nodes(id),
  target TEXT NOT NULL REFERENCES nodes(id),
  type TEXT NOT NULL,  -- imports|defines|calls|inherits|decided_by|relates_to|etc
  weight REAL DEFAULT 1.0,
  properties TEXT,     -- JSON blob
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_edges_source ON edges(source);
CREATE INDEX idx_edges_target ON edges(target);
CREATE INDEX idx_edges_type ON edges(type);
CREATE INDEX idx_nodes_type ON nodes(type);
CREATE INDEX idx_nodes_name ON nodes(name);

-- FTS5 for symbolic search across node names and properties
CREATE VIRTUAL TABLE nodes_fts USING fts5(name, properties, content=nodes, content_rowid=rowid);
```

---

## 7. Store Evaluation

### 7.1 Qdrant (Recommended Vector Store)

| Factor | Assessment |
|---|---|
| **Performance** | Sub-10ms for 100K vectors, HNSW index |
| **Local deployment** | Docker or standalone binary, ~50MB RAM base |
| **API** | REST + gRPC, excellent JS/Node client |
| **Filtering** | Payload-based filtering during search (no post-filter) |
| **Scalability** | Handles millions of vectors on single node |
| **Persistence** | WAL-based, crash-safe |
| **Cost** | Free, open-source, Apache-2.0 |
| **VRAM** | Zero — CPU-only (doesn't compete with Ollama for GPU) |

**vs. Alternatives:**
- **ChromaDB** — Simpler but slower at scale, Python-first (not ideal for Node)
- **Weaviate** — Overkill for local-first, heavier resource usage
- **Milvus** — Distributed-first, too complex for single-node
- **FAISS** — Library not server, no persistence, no filtering
- **SQLite-vss** — Good for embedded, but limited to ~50K vectors efficiently
- **JSON linear scan (current plan)** — O(n), unacceptable past 10K chunks

**Decision:** Qdrant for vectors. SQLite for metadata/graph/FTS. Hybrid approach.

### 7.2 Architecture Decision

```
Qdrant (Docker/binary on localhost:6333)
  └── Vector storage + HNSW search + payload filtering

SQLite (single file: memory-engine/sovereign.db)
  └── Metadata, graph edges, FTS5 keyword search, temporal index, summaries

JSON (memory-engine/working-memory.json)
  └── Session-scoped working memory (volatile, small)
```

---

## 8. Memory Lifecycle System

### 8.1 Lifecycle States

```
┌─────────┐     ┌──────────┐     ┌─────────┐     ┌──────────────┐
│ INGESTED│────▶│  ACTIVE  │────▶│ DECAYED │────▶│ COMPRESSED   │
└─────────┘     └──────────┘     └─────────┘     └──────────────┘
                     │                                    │
                     │                               ┌────▼────┐
                     │                               │ARCHIVED │
                     │                               └────┬────┘
                     │                                    │
                     └─────────────────────────────▶ ┌────▼────┐
                         (if never accessed)          │ GARBAGE │
                                                     └─────────┘
```

### 8.2 Lifecycle Transitions

| Transition | Trigger | Action |
|---|---|---|
| INGESTED → ACTIVE | Indexed successfully | Available for retrieval |
| ACTIVE → DECAYED | `days_since_last_access > decay_threshold` | Reduce ranking priority |
| DECAYED → COMPRESSED | `days_since_last_access > compress_threshold` | Summarize, delete full text |
| COMPRESSED → ARCHIVED | `days_since_last_access > archive_threshold` | Move to cold storage |
| ACTIVE → GARBAGE | Never accessed + older than 60 days + low importance | Delete entirely |
| Any → ACTIVE | Accessed during retrieval | Reset decay timer |

### 8.3 Thresholds by Memory Type

| Memory Type | Decay After | Compress After | Archive After | GC After |
|---|---|---|---|---|
| Working | 1 day | N/A (session-scoped) | N/A | End of session |
| Episodic | 14 days | 30 days | 90 days | 180 days |
| Semantic | 60 days | Never (facts are permanent) | Never | Never (if confidence > 0.5) |
| Procedural | 30 days | 90 days | Never | 365 days (if success_rate < 0.3) |
| Prospective | N/A | N/A | N/A | On completion or expiry |

---

## 9. Context Compression Pipeline

### 9.1 Multi-Stage Compression

```
Stage 1: Token-Level Truncation
  - Cut at sentence boundary nearest to budget
  - Preserve first and last sentences (most informative)

Stage 2: Extractive Summarization (fast model)
  - Extract key sentences using TF-IDF scoring
  - Keep sentences with code references, decisions, file paths

Stage 3: Abstractive Summarization (specialist model)
  - Generate concise summary preserving all actionable info
  - Output ≤ 25% of original token count

Stage 4: Fact Extraction (for semantic memory promotion)
  - Extract atomic facts from episodes
  - Store as SemanticMemory entries
  - Original episode can then be compressed further
```

### 9.2 Compression Triggers

```jsonc
// CompressionPolicy
{
  "triggers": [
    {
      "condition": "chunk_age > 30 days AND access_count < 3",
      "action": "stage_2_extractive",
      "targetReduction": 0.5
    },
    {
      "condition": "chunk_age > 60 days AND access_count < 5",
      "action": "stage_3_abstractive",
      "targetReduction": 0.75
    },
    {
      "condition": "context_budget_exceeded",
      "action": "stage_1_truncation",
      "targetReduction": 0.3
    }
  ]
}
```

### 9.3 Hierarchical Summary Maintenance

```
On new chunk ingestion:
  1. Add to Level 0 (raw)
  2. If section now has 10+ raw chunks → regenerate Level 1 summary
  3. If file now has 3+ section summaries → regenerate Level 2
  4. If module has changed → regenerate Level 3
  5. Weekly: regenerate Level 4 (project overview)
```

---

## 10. Retrieval Architecture Diagram

```
            ┌─────────────────┐
            │  USER QUERY     │
            │  (natural lang) │
            └────────┬────────┘
                     │
            ┌────────▼────────┐
            │  QUERY ANALYZER │
            │                 │
            │  • Classify type│  → code_question | what_happened | how_to | etc.
            │  • Extract kw   │  → keywords for symbolic search
            │  • Detect time  │  → "last week", "yesterday", temporal constraints
            │  • Infer domain │  → "react", "flask", "testing"
            └───┬───────┬───────┬───┘
                │       │       │
     ┌──────────▼┐  ┌───▼────┐  ┌▼──────────┐
     │ SEMANTIC  │  │SYMBOLIC│  │  GRAPH    │
     │ (Qdrant)  │  │(FTS5)  │  │(SQLite)  │
     │           │  │        │  │          │
     │ embed(q)  │  │ BM25   │  │ traverse │
     │ → top 20  │  │ → top20│  │ → top 10 │
     └──────┬────┘  └───┬────┘  └──┬───────┘
            │            │          │
            └────────────┼──────────┘
                         │
              ┌──────────▼──────────┐
              │   FUSION RANKER     │
              │                     │
              │  1. RRF combine     │
              │  2. Temporal decay  │
              │  3. Type priority   │
              │  4. Access boost    │
              │  5. Domain filter   │
              │                     │
              │  → Final top K      │
              └──────────┬──────────┘
                         │
              ┌──────────▼──────────┐
              │  BUDGET ENFORCER    │
              │                     │
              │  Total tokens < B   │
              │  Truncate if over   │
              │  Compress if needed │
              └──────────┬──────────┘
                         │
              ┌──────────▼──────────┐
              │  CONTEXT ASSEMBLER  │
              │                     │
              │  Format as prompt:  │
              │  [retrieved chunks] │
              │  [summaries]        │
              │  [graph context]    │
              └─────────────────────┘
```

---

## 11. Implementation Plan

### 11.1 Module Structure

```
memory-engine/
├── index.js              # Main entry point, exports public API
├── config.js             # Memory engine configuration
├── retriever.js          # Hybrid retrieval (semantic + symbolic + graph)
├── indexer.js            # Code indexing (AST-aware chunking)
├── conversation-indexer.js  # Conversation/episode indexing
├── embedder.js           # Ollama embedding wrapper
├── store.js              # Qdrant vector store client
├── graph.js              # SQLite graph operations
├── fts.js                # SQLite FTS5 keyword search
├── ranker.js             # Fusion ranking + decay + priority
├── compressor.js         # Multi-stage compression pipeline
├── lifecycle.js          # Memory lifecycle management (decay, GC)
├── working-memory.js     # Session-scoped volatile store
├── schemas/              # Internal schemas
│   ├── chunk.js
│   ├── episode.js
│   └── fact.js
└── tests/
    ├── retriever.test.js
    ├── indexer.test.js
    ├── ranker.test.js
    └── lifecycle.test.js
```

### 11.2 Public API

```javascript
// memory-engine/index.js — Public interface

export { retrieve } from './retriever.js';
export { indexRepo } from './indexer.js';
export { indexConversations } from './conversation-indexer.js';
export { VectorStore } from './store.js';

// Extended API
export { queryGraph } from './graph.js';
export { searchKeywords } from './fts.js';
export { compress } from './compressor.js';
export { getWorkingMemory, setWorkingMemory } from './working-memory.js';
export { runLifecycle } from './lifecycle.js';
```

### 11.3 Dependencies

```jsonc
{
  "dependencies": {
    "@qdrant/js-client-rest": "^1.8.0",    // Qdrant vector operations
    "better-sqlite3": "^11.0.0",            // Graph + FTS5 + metadata
    "glob": "^10.0.0"                       // File discovery
  },
  "devDependencies": {
    "vitest": "^1.0.0"                      // Testing
  }
}
```

### 11.4 Qdrant Setup (Local)

```powershell
# Option A: Docker (recommended)
docker run -p 6333:6333 -p 6334:6334 -v D:\qdrant_storage:/qdrant/storage qdrant/qdrant

# Option B: Binary (no Docker required)
# Download from https://github.com/qdrant/qdrant/releases
# Place in D:\tools\qdrant\qdrant.exe
D:\tools\qdrant\qdrant.exe --storage-path D:\qdrant_storage
```

Collection config:
```jsonc
{
  "collection_name": "war-council-memory",
  "vectors": {
    "size": 768,                 // nomic-embed-text dimension
    "distance": "Cosine"
  },
  "payload_schema": {
    "file": { "type": "keyword" },
    "type": { "type": "keyword" },     // code|conversation|decision|etc
    "domain": { "type": "keyword" },
    "language": { "type": "keyword" },
    "importance": { "type": "keyword" },
    "indexed_at": { "type": "datetime" },
    "last_accessed": { "type": "datetime" },
    "access_count": { "type": "integer" }
  }
}
```

---

## 12. Context Assembly Protocol

The final step before handing context to a model:

```jsonc
// ContextAssemblyRequest
{
  "query": "string",
  "budget": {
    "totalTokens": 8192,
    "reservedForTask": 1024,
    "reservedForOutput": 2048
  },
  "preferences": {
    "preferRecent": true,
    "includeSummaries": true,
    "includeGraph": true,
    "maxChunks": 10,
    "maxSummaryLevel": 2
  }
}

// ContextAssemblyResult
{
  "prompt": "string",           // The assembled context block
  "tokensUsed": 5200,
  "sources": [
    { "type": "semantic", "file": "src/server.js", "score": 0.87 },
    { "type": "graph", "node": "Decision:use-qdrant", "score": 0.72 },
    { "type": "summary", "level": 2, "scope": "mcp-server/", "score": 0.65 }
  ],
  "truncated": false,
  "compressionApplied": false
}
```

---

*End of Phase 4. The memory system is now designed as a unified cognition layer — persistent, hierarchical, temporally-aware, and budget-conscious.*
