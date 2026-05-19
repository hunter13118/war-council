# Phase 7 — VSCode & Developer Workflow

**Purpose:** Design a local-first AI coding workflow that surpasses traditional Copilot-style tools through orchestration quality — repo-aware retrieval, selective escalation, autonomous debugging, and verification-before-commit.

**Principle:** The developer never waits for the AI. The AI never wastes tokens on context it doesn't need.

---

## 1. Workflow Architecture

### 1.1 System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        DEVELOPER WORKSTATION                                 │
│                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                          VSCODE                                        │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────────────┐  │ │
│  │  │ Editor   │  │ Terminal  │  │ Problems │  │ War Council Panel     │  │ │
│  │  │ (active  │  │ (test    │  │ (lint/   │  │ (status, confidence,  │  │ │
│  │  │  file)   │  │  runner) │  │  errors) │  │  escalation feed)     │  │ │
│  │  └──────────┘  └──────────┘  └──────────┘  └───────────────────────┘  │ │
│  └──────────────────────────────────┬─────────────────────────────────────┘ │
│                                     │                                       │
│                          MCP Protocol (stdio)                                │
│                                     │                                       │
│  ┌──────────────────────────────────▼─────────────────────────────────────┐ │
│  │                      WAR COUNCIL ORCHESTRATOR                           │ │
│  │                                                                        │ │
│  │  ┌────────────┐  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐  │ │
│  │  │ Context    │  │ Routing     │  │ Execution   │  │ Verification │  │ │
│  │  │ Assembler  │  │ Engine      │  │ DAG Runner  │  │ Gate         │  │ │
│  │  └─────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬───────┘  │ │
│  │        │                 │                │                │          │ │
│  │  ┌─────▼──────────────────▼────────────────▼────────────────▼───────┐  │ │
│  │  │                    MODEL LAYER                                   │  │ │
│  │  │  ┌──────┐  ┌──────────┐  ┌──────────┐  ┌──────┐  ┌──────────┐  │  │ │
│  │  │  │ 7b   │  │ 14b      │  │ deepseek │  │ 32b  │  │ Cloud    │  │  │ │
│  │  │  │ fast │  │ specialist│  │ reasoning│  │ heavy│  │ (escape) │  │  │ │
│  │  │  └──────┘  └──────────┘  └──────────┘  └──────┘  └──────────┘  │  │ │
│  │  └──────────────────────────────────────────────────────────────────┘  │ │
│  │                                                                        │ │
│  │  ┌─────────────────────────────────────────────────────────────────┐   │ │
│  │  │                   MEMORY / RETRIEVAL                             │   │ │
│  │  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │   │ │
│  │  │  │ Qdrant   │  │ SQLite   │  │ Repo     │  │ AST          │   │   │ │
│  │  │  │ vectors  │  │ graph+FTS│  │ Index    │  │ Cache        │   │   │ │
│  │  │  └──────────┘  └──────────┘  └──────────┘  └──────────────┘   │   │ │
│  │  └─────────────────────────────────────────────────────────────────┘   │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Core Workflow: Request → Response

```
Developer types request in Cline/Copilot Chat
  │
  ▼
[1] CONTEXT ASSEMBLY (local, <50ms)
  ├── Active file + cursor position
  ├── Open tabs (file paths + language IDs)
  ├── Recent edits (last 5 diffs)
  ├── Problems panel (lint errors)
  ├── Repo graph query (related files)
  └── Memory retrieval (if relevant prior work)
  │
  ▼
[2] ROUTING (deterministic, <1ms)
  ├── Estimate token budget
  ├── Classify task complexity
  ├── Check circuit breakers
  └── Select tier + tool
  │
  ▼
[3] EXECUTION (model call, variable latency)
  ├── Fast (7b): ~200ms for short completions
  ├── Specialist (14b): ~2-5s for code generation
  ├── Reasoning (deepseek): ~5-15s for debugging
  ├── Heavy (32b): ~10-30s for architecture
  └── Cloud: ~1-3s (network latency)
  │
  ▼
[4] VERIFICATION (conditional, <5s)
  ├── Self-eval (does output match request?)
  ├── Lint check (any new errors introduced?)
  ├── Test run (if tests exist for modified code)
  └── Diff review (is change minimal and focused?)
  │
  ▼
[5] DELIVERY
  ├── Apply diff to editor
  ├── Show confidence badge
  ├── Log to telemetry
  └── Update memory (if successful)
```

---

## 2. VSCode Integration Strategy

### 2.1 Cline as Primary Interface

The system integrates via Cline's MCP client support:

```jsonc
// .vscode/mcp.json (already partially configured)
{
  "servers": {
    "war-council": {
      "type": "stdio",
      "command": "node",
      "args": ["mcp-server/server.js"],
      "env": {
        "OLLAMA_HOST": "http://localhost:11434",
        "BATTLE_LOG_URL": "http://localhost:3737",
        "QDRANT_URL": "http://localhost:6333"
      }
    }
  }
}
```

### 2.2 Context Signals from VSCode

Information the MCP server can receive (via Cline's MCP protocol or file system):

| Signal | Source | Use |
|---|---|---|
| Active file path | MCP request context | Scope retrieval to relevant module |
| Cursor position | MCP request context | Focus on surrounding code |
| Open tabs | Workspace state file | Identify working set |
| Git status | `git status --porcelain` | Know what's modified |
| Problems list | `.vscode/problems.json` or CLI | Know current errors |
| Recent commands | Terminal history | Understand recent actions |
| Test results | Test runner output | Know what's passing/failing |
| File dependencies | Import graph | Know related files |

### 2.3 Sub-Agent Integration Points

| Agent | VSCode Integration |
|---|---|
| RepoScout | Triggered on file open — indexes dependencies |
| TestWriter | Triggered on new function — suggests tests |
| TestRunner | Triggered on save — runs relevant tests |
| CodeReviewer | Triggered before commit — audits diff |
| CommitShipper | Triggered on approval — formats + pushes |
| QualityGatekeeper | Always active — enforces coverage gate |

### 2.4 War Council Status Panel

A lightweight webview panel in VSCode sidebar showing:
- Current task status (idle/routing/executing/verifying)
- Active model + tier
- Confidence level (color-coded)
- Token budget consumption
- Recent escalations
- Circuit breaker status

```jsonc
// .vscode/settings.json addition
{
  "warCouncil.panel.enabled": true,
  "warCouncil.panel.position": "secondary-sidebar",
  "warCouncil.notifications.escalation": true,
  "warCouncil.notifications.circuitBreaker": true
}
```

---

## 3. Repo Graph Indexing

### 3.1 Index Structure

```
┌─────────────────────────────────────────────────────────────┐
│                    REPO INDEX                                 │
│                                                             │
│  ┌─────────────┐     ┌─────────────┐     ┌──────────────┐  │
│  │ AST Cache   │     │ Dependency  │     │ Symbol       │  │
│  │ (per-file)  │────▶│ Graph       │────▶│ Index        │  │
│  └─────────────┘     └─────────────┘     └──────────────┘  │
│         │                   │                    │           │
│         ▼                   ▼                    ▼           │
│  ┌─────────────┐     ┌─────────────┐     ┌──────────────┐  │
│  │ Chunk       │     │ Module      │     │ Vector       │  │
│  │ Registry    │     │ Boundaries  │     │ Embeddings   │  │
│  └─────────────┘     └─────────────┘     └──────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Indexing Pipeline

```javascript
class RepoIndexer {
  constructor(repoRoot) {
    this.root = repoRoot;
    this.astCache = new Map();      // filePath → parsed AST
    this.depGraph = new Map();      // filePath → Set<filePath>
    this.symbolIndex = new Map();   // symbolName → { file, line, type }
    this.chunkRegistry = [];        // All code chunks with metadata
    this.dirty = new Set();         // Files needing re-index
  }

  // Full index (on first load or after major changes)
  async indexFull() {
    const files = await this.discoverFiles();

    for (const file of files) {
      await this.indexFile(file);
    }

    await this.buildDependencyGraph();
    await this.embedChunks();
  }

  // Incremental index (on file save)
  async indexIncremental(changedFiles) {
    for (const file of changedFiles) {
      // Re-parse AST
      const ast = await this.parseAST(file);
      this.astCache.set(file, ast);

      // Re-extract symbols
      this.updateSymbols(file, ast);

      // Re-chunk (AST-aware boundaries)
      const chunks = this.chunkFile(file, ast);
      this.updateChunks(file, chunks);

      // Re-embed changed chunks only
      await this.embedChunks(chunks.filter(c => c.dirty));

      // Update dependency edges
      this.updateDependencies(file, ast);
    }
  }

  // File discovery (respects .gitignore)
  async discoverFiles() {
    // Use git ls-files for accurate file list
    const { stdout } = await exec('git ls-files --cached --others --exclude-standard');
    return stdout.split('\n')
      .filter(f => f.match(/\.(js|ts|py|jsx|tsx|json|md|html|css)$/))
      .map(f => path.join(this.root, f));
  }
}
```

### 3.3 AST-Aware Chunking (Recap from Phase 4, Implemented)

```javascript
function chunkFile(filePath, ast) {
  const chunks = [];
  const source = fs.readFileSync(filePath, 'utf-8');
  const lines = source.split('\n');

  // Walk AST: each function/class/method = one chunk
  for (const node of ast.body) {
    if (isChunkBoundary(node)) {
      chunks.push({
        id: `${filePath}:${node.loc.start.line}-${node.loc.end.line}`,
        file: filePath,
        startLine: node.loc.start.line,
        endLine: node.loc.end.line,
        content: lines.slice(node.loc.start.line - 1, node.loc.end.line).join('\n'),
        type: node.type,  // FunctionDeclaration, ClassDeclaration, etc.
        name: node.id?.name || node.key?.name || 'anonymous',
        symbols: extractSymbols(node),
        imports: extractImports(node),
        exports: extractExports(node)
      });
    }
  }

  return chunks;
}

function isChunkBoundary(node) {
  return [
    'FunctionDeclaration', 'ClassDeclaration', 'MethodDefinition',
    'ArrowFunctionExpression', 'ExportDefaultDeclaration'
  ].includes(node.type);
}
```

### 3.4 Dependency Graph

```javascript
// Graph stored in SQLite (adjacency list)
// Enables: "what files are affected if I change X?"

CREATE TABLE dependencies (
  source TEXT NOT NULL,      -- file path
  target TEXT NOT NULL,      -- file path it imports from
  symbol TEXT,               -- specific imported symbol (optional)
  type TEXT DEFAULT 'import' -- import|require|dynamic
);

CREATE INDEX idx_dep_source ON dependencies(source);
CREATE INDEX idx_dep_target ON dependencies(target);

// Query: "What depends on memory-engine/retriever.js?"
SELECT source FROM dependencies WHERE target LIKE '%memory-engine/retriever%';

// Query: "What does server.js need?"
SELECT target, symbol FROM dependencies WHERE source LIKE '%mcp-server/server.js';
```

### 3.5 Incremental Re-Index Trigger

```javascript
// File watcher (in MCP server or standalone indexer)
const watcher = fs.watch(repoRoot, { recursive: true }, async (eventType, filename) => {
  if (!filename || filename.includes('node_modules')) return;
  if (!filename.match(/\.(js|ts|py|jsx|tsx|json|md|html|css)$/)) return;

  const fullPath = path.join(repoRoot, filename);

  // Debounce: wait 500ms for rapid saves
  clearTimeout(debounceTimers.get(fullPath));
  debounceTimers.set(fullPath, setTimeout(async () => {
    await indexer.indexIncremental([fullPath]);

    // Notify Battle Log of index update
    emitEvent('index.updated', { file: filename, timestamp: Date.now() });
  }, 500));
});
```

---

## 4. Selective File Retrieval

### 4.1 Context Assembly Strategy

The key insight: **never send the whole repo.** Only retrieve what's relevant to the current task.

```javascript
class ContextAssembler {
  constructor(indexer, retriever) {
    this.indexer = indexer;
    this.retriever = retriever;
    this.maxContextTokens = 12000;  // Leave room for output in 32K window
  }

  async assemble(task, activeFile, cursorLine) {
    const budget = new TokenBudget(this.maxContextTokens);
    const context = [];

    // Priority 1: Active file region (always included)
    const activeRegion = this.getActiveRegion(activeFile, cursorLine);
    context.push({ source: 'active_file', content: activeRegion, priority: 1 });
    budget.consume(estimateTokens(activeRegion));

    // Priority 2: Direct dependencies of active file
    const deps = this.indexer.depGraph.get(activeFile) || new Set();
    for (const dep of deps) {
      if (budget.remaining < 500) break;
      const relevant = await this.getRelevantChunks(dep, task);
      if (relevant) {
        context.push({ source: 'dependency', file: dep, content: relevant, priority: 2 });
        budget.consume(estimateTokens(relevant));
      }
    }

    // Priority 3: Semantic retrieval (vectors)
    if (budget.remaining > 1000) {
      const vectorResults = await this.retriever.query(task, {
        k: 5,
        maxTokens: budget.remaining * 0.5
      });
      for (const result of vectorResults) {
        if (budget.remaining < 200) break;
        context.push({ source: 'semantic', content: result.content, priority: 3 });
        budget.consume(estimateTokens(result.content));
      }
    }

    // Priority 4: Symbol definitions (if task references specific symbols)
    const mentionedSymbols = extractSymbolReferences(task);
    for (const sym of mentionedSymbols) {
      if (budget.remaining < 200) break;
      const def = this.indexer.symbolIndex.get(sym);
      if (def) {
        context.push({ source: 'symbol_def', content: def.chunk, priority: 4 });
        budget.consume(estimateTokens(def.chunk));
      }
    }

    // Priority 5: Recent errors (if debugging)
    if (isDebuggingTask(task)) {
      const errors = await this.getRecentErrors();
      if (errors && budget.remaining > 200) {
        context.push({ source: 'errors', content: errors, priority: 5 });
        budget.consume(estimateTokens(errors));
      }
    }

    return context;
  }

  getActiveRegion(file, cursorLine) {
    const source = fs.readFileSync(file, 'utf-8');
    const lines = source.split('\n');

    // Get the enclosing function/class
    const ast = this.indexer.astCache.get(file);
    if (ast) {
      const enclosing = findEnclosingScope(ast, cursorLine);
      if (enclosing) {
        return lines.slice(enclosing.start - 1, enclosing.end).join('\n');
      }
    }

    // Fallback: ±50 lines around cursor
    const start = Math.max(0, cursorLine - 50);
    const end = Math.min(lines.length, cursorLine + 50);
    return lines.slice(start, end).join('\n');
  }
}
```

### 4.2 Token Budget Allocation

```
Total context window: 32,768 tokens (qwen2.5-coder:32b)
═══════════════════════════════════════════════════════
System prompt + tool definitions:  ~2,000 tokens
Task description + user input:     ~1,000 tokens
Retrieved context:                 ~12,000 tokens (managed)
Reserved for output:               ~8,000 tokens
Safety margin:                     ~2,000 tokens
═══════════════════════════════════════════════════════
Usable retrieval budget:           12,000 tokens

Allocation within retrieval budget:
  Active file region:    4,000 (33%) — always first
  Dependencies:          3,000 (25%) — import graph
  Semantic retrieval:    3,000 (25%) — vector search
  Symbol definitions:    1,000 (8%)  — specific lookups
  Error context:         1,000 (8%)  — if debugging
```

### 4.3 Context Compression for Cloud Escalation

When escalating to cloud (1M context Gemini), we can send more — but still compress:

```javascript
function compressForCloud(context) {
  // Cloud has 1M tokens but we still optimize for latency
  return {
    // Send full active file (not just region)
    activeFile: fs.readFileSync(context.activeFile, 'utf-8'),

    // Send full dependency files (summaries only for large ones)
    dependencies: context.deps.map(dep => {
      const content = fs.readFileSync(dep, 'utf-8');
      return estimateTokens(content) > 5000
        ? { file: dep, content: summarizeFile(content) }  // Hierarchical summary
        : { file: dep, content };
    }),

    // Send more vector results
    semanticResults: context.vectorResults.slice(0, 20),

    // Include git diff for recent changes
    recentDiff: execSync('git diff HEAD~3 --stat').toString()
  };
}
```

---

## 5. Targeted Diff Generation

### 5.1 Diff Strategy

The AI should generate **minimal, focused diffs** — not rewrite entire files:

```javascript
class DiffGenerator {
  // Generate a targeted edit from AI output
  generateDiff(originalFile, aiOutput, task) {
    // Strategy 1: If AI outputs a complete function replacement
    if (this.isCompleteFunctionRewrite(aiOutput)) {
      return this.functionLevelDiff(originalFile, aiOutput);
    }

    // Strategy 2: If AI outputs line-level instructions
    if (this.isLineInstructions(aiOutput)) {
      return this.lineEditDiff(originalFile, aiOutput);
    }

    // Strategy 3: If AI outputs full file
    // Use diff algorithm to extract minimal changes
    return this.computeMinimalDiff(originalFile, aiOutput);
  }

  functionLevelDiff(original, replacement) {
    // Find the function being replaced in the original
    const ast = parse(original);
    const targetFn = findMatchingFunction(ast, replacement);

    return {
      type: 'replace',
      file: original.path,
      startLine: targetFn.loc.start.line,
      endLine: targetFn.loc.end.line,
      newContent: replacement
    };
  }

  // Validate diff before applying
  validateDiff(diff, originalFile) {
    const patched = applyDiff(originalFile, diff);

    // Parse check: does the result parse cleanly?
    try {
      parse(patched);
    } catch (e) {
      return { valid: false, reason: 'syntax_error', error: e.message };
    }

    // Import check: are all imports still resolvable?
    const imports = extractImports(parse(patched));
    for (const imp of imports) {
      if (!resolveImport(imp, originalFile.path)) {
        return { valid: false, reason: 'broken_import', import: imp };
      }
    }

    return { valid: true };
  }
}
```

### 5.2 Diff Application Flow

```
AI generates code
  │
  ├──▶ Extract diff (minimal changes only)
  │
  ├──▶ Validate diff
  │      ├── Syntax check (parse attempt)
  │      ├── Import resolution check
  │      └── Scope analysis (no dangling references)
  │
  ├──▶ Apply diff to editor buffer (preview mode)
  │
  ├──▶ Run lint on modified file
  │      ├── Pass → proceed to test
  │      └── Fail → attempt auto-fix or flag for human
  │
  ├──▶ Run relevant tests
  │      ├── All pass → auto-accept
  │      └── Any fail → show failure, suggest fix
  │
  └──▶ Update git staging (if auto-commit enabled)
```

---

## 6. Verification-Before-Commit Pipeline

### 6.1 Multi-Stage Verification

```
┌───────────────────────────────────────────────────────────────────┐
│                    VERIFICATION PIPELINE                           │
│                                                                   │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌──────────────┐  │
│  │ Syntax  │───▶│ Lint    │───▶│ Test    │───▶│ Review       │  │
│  │ Check   │    │ Check   │    │ Run     │    │ (CodeReviewer)│  │
│  └────┬────┘    └────┬────┘    └────┬────┘    └──────┬───────┘  │
│       │              │              │                │           │
│    pass/fail      pass/fail      pass/fail       approve/reject  │
│                                                                   │
│  Gate Policy:                                                     │
│  - ALL must pass for auto-commit                                  │
│  - Any single failure → halt pipeline, show diagnostics           │
│  - Retry allowed (max 2) for test failures with fix attempt       │
└───────────────────────────────────────────────────────────────────┘
```

### 6.2 Verification Implementation

```javascript
class VerificationPipeline {
  async verify(diff, context) {
    const results = { stages: [], overall: 'pending' };

    // Stage 1: Syntax
    const syntaxResult = this.checkSyntax(diff.patchedContent);
    results.stages.push({ name: 'syntax', ...syntaxResult });
    if (!syntaxResult.pass) {
      results.overall = 'failed';
      return results;
    }

    // Stage 2: Lint
    const lintResult = await this.runLint(diff.file);
    results.stages.push({ name: 'lint', ...lintResult });
    if (!lintResult.pass) {
      // Attempt auto-fix
      const fixed = await this.autoFixLint(diff.file);
      if (!fixed) {
        results.overall = 'failed';
        return results;
      }
      results.stages.push({ name: 'lint_autofix', pass: true });
    }

    // Stage 3: Tests
    const testResult = await this.runTests(diff.file, context);
    results.stages.push({ name: 'tests', ...testResult });
    if (!testResult.pass) {
      results.overall = 'failed';
      results.failedTests = testResult.failures;
      return results;
    }

    // Stage 4: Code review (lightweight, fast model)
    const reviewResult = await this.codeReview(diff, context);
    results.stages.push({ name: 'review', ...reviewResult });
    if (reviewResult.issues.length > 0 && reviewResult.severity === 'blocking') {
      results.overall = 'failed';
      return results;
    }

    results.overall = 'passed';
    return results;
  }

  async runTests(file, context) {
    // Find relevant test files
    const testFile = this.findTestFile(file);
    if (!testFile) return { pass: true, reason: 'no_tests_found', skipped: true };

    // Run only affected tests (not full suite)
    const { exitCode, stdout, stderr } = await exec(`npm test -- --testPathPattern="${testFile}"`);

    return {
      pass: exitCode === 0,
      failures: exitCode !== 0 ? this.parseTestFailures(stderr) : [],
      duration: this.extractDuration(stdout)
    };
  }

  async codeReview(diff, context) {
    // Use fast model for quick review (no deep analysis needed)
    const review = await consultFast({
      prompt: `Review this diff for obvious issues:\n${diff.patch}\n\nCheck for: missing error handling, broken imports, security issues, logic errors. Be brief.`
    });

    return {
      pass: review.confidence > 0.7 && !review.output.includes('BLOCKER'),
      issues: this.parseReviewIssues(review.output),
      severity: review.output.includes('BLOCKER') ? 'blocking' : 'advisory'
    };
  }
}
```

### 6.3 Auto-Commit Flow

```javascript
async function commitIfGreen(verification, diff, context) {
  if (verification.overall !== 'passed') return false;

  // Stage the specific files (never git add -A)
  await exec(`git add ${diff.files.join(' ')}`);

  // Generate commit message from task context
  const prefix = inferCommitPrefix(context.task);  // fix:|feat:|refactor: etc.
  const message = `${prefix} ${context.task.summary}`;

  await exec(`git commit -m "${escapeShell(message)}"`);

  // Push if configured
  if (context.autoPush) {
    await exec('git push');
  }

  // Emit event
  emitEvent('commit.created', {
    message,
    files: diff.files,
    confidence: verification.averageConfidence
  });

  return true;
}
```

---

## 7. Autonomous Debugging Loop

### 7.1 Debug Loop DAG

```
┌─────────────────────────────────────────────────────────────────┐
│                   AUTONOMOUS DEBUG LOOP                           │
│                                                                 │
│    ┌──────────────┐                                             │
│    │ Detect Error │ ← from test failure, lint, runtime crash    │
│    └──────┬───────┘                                             │
│           │                                                     │
│    ┌──────▼───────┐                                             │
│    │ Classify     │                                             │
│    │ Error Type   │                                             │
│    └──────┬───────┘                                             │
│           │                                                     │
│    ┌──────▼───────────────┐                                     │
│    │ Gather Evidence       │                                     │
│    │ • Stack trace         │                                     │
│    │ • Related code        │                                     │
│    │ • Recent changes      │                                     │
│    │ • Similar past fixes  │                                     │
│    └──────┬───────────────┘                                     │
│           │                                                     │
│    ┌──────▼───────┐                                             │
│    │ Hypothesize  │ ← reasoning model                           │
│    └──────┬───────┘                                             │
│           │                                                     │
│    ┌──────▼───────┐        ┌─────────────────┐                  │
│    │ Generate Fix │───────▶│ Run Tests       │                  │
│    └──────────────┘        └────────┬────────┘                  │
│                                     │                           │
│                            ┌────────▼────────┐                  │
│                         ┌──┤ Tests pass?     ├──┐               │
│                        YES └─────────────────┘  NO              │
│                         │                       │               │
│                  ┌──────▼──────┐         ┌──────▼──────┐        │
│                  │ DONE ✅     │         │ Retry       │        │
│                  │ (commit)    │         │ (max 3)     │        │
│                  └─────────────┘         └──────┬──────┘        │
│                                                 │               │
│                                          ┌──────▼──────┐        │
│                                          │ Escalate    │        │
│                                          │ (if stuck)  │        │
│                                          └─────────────┘        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 7.2 Error Classification

```javascript
function classifyError(error) {
  const message = error.message || error.toString();

  // Type errors (usually quick fix with fast model)
  if (message.match(/TypeError|is not a function|undefined is not/)) {
    return { type: 'type_error', tier: 'fast', maxRetries: 2 };
  }

  // Import/module errors (check dependency graph)
  if (message.match(/Cannot find module|Module not found|ImportError/)) {
    return { type: 'import_error', tier: 'fast', maxRetries: 1 };
  }

  // Logic errors (need reasoning)
  if (message.match(/assertion|expected.*but got|AssertionError/)) {
    return { type: 'logic_error', tier: 'reasoning', maxRetries: 3 };
  }

  // Async/timing issues (need deep analysis)
  if (message.match(/timeout|ECONNREFUSED|race condition|deadlock/)) {
    return { type: 'async_error', tier: 'reasoning', maxRetries: 2 };
  }

  // Syntax errors (trivial)
  if (message.match(/SyntaxError|Unexpected token/)) {
    return { type: 'syntax_error', tier: 'fast', maxRetries: 1 };
  }

  // Unknown → specialist
  return { type: 'unknown', tier: 'specialist', maxRetries: 2 };
}
```

### 7.3 Evidence Gathering

```javascript
async function gatherEvidence(error, file, indexer) {
  const evidence = {};

  // 1. Stack trace (already in error)
  evidence.stackTrace = error.stack;

  // 2. Failing code region
  if (error.line) {
    const source = fs.readFileSync(file, 'utf-8').split('\n');
    evidence.codeRegion = source.slice(
      Math.max(0, error.line - 10),
      Math.min(source.length, error.line + 10)
    ).join('\n');
  }

  // 3. Recent changes to this file (last 3 commits)
  evidence.recentChanges = execSync(
    `git log -3 --oneline -p -- "${file}"`
  ).toString().slice(0, 2000);

  // 4. Related code (imports, callers)
  const deps = indexer.depGraph.get(file);
  evidence.relatedFiles = [...(deps || [])].slice(0, 3);

  // 5. Similar past fixes (from episodic memory)
  evidence.similarFixes = await memoryQuery(
    `fix ${error.type}: ${error.message}`,
    { type: 'episodic', k: 3 }
  );

  return evidence;
}
```

### 7.4 Fix-and-Verify Loop

```javascript
async function debugLoop(error, file, context) {
  const classification = classifyError(error);
  const evidence = await gatherEvidence(error, file, context.indexer);

  for (let attempt = 0; attempt < classification.maxRetries; attempt++) {
    // Generate hypothesis + fix
    const fix = await generateFix(error, evidence, classification, attempt);

    // Apply fix
    const diff = applyFix(file, fix);

    // Run tests
    const testResult = await runTests(file);

    if (testResult.pass) {
      // SUCCESS — commit and learn
      await commitIfGreen({ overall: 'passed' }, diff, context);
      await memoryWrite({
        type: 'episodic',
        content: `Fixed ${error.type}: ${error.message}\nSolution: ${fix.description}`,
        metadata: { file, errorType: classification.type }
      });
      return { success: true, attempts: attempt + 1 };
    }

    // FAILED — add test failure to evidence for next attempt
    evidence.previousAttempts = evidence.previousAttempts || [];
    evidence.previousAttempts.push({
      fix: fix.description,
      result: testResult.failures[0]?.message
    });

    // Escalate tier if not improving
    if (attempt === 1 && classification.tier !== 'reasoning') {
      classification.tier = 'reasoning';
    }
  }

  // Exhausted retries → escalate to human
  return { success: false, reason: 'max_retries_exhausted', evidence };
}
```

---

## 8. Architectural Consistency Checks

### 8.1 Consistency Rules (Declarative)

```javascript
const ARCHITECTURE_RULES = [
  {
    name: 'no_direct_ollama_calls',
    description: 'All Ollama calls must go through the MCP server, never direct',
    check: (diff) => !diff.content.match(/fetch.*11434|ollama\.generate|ollama\.chat/),
    severity: 'error'
  },
  {
    name: 'confidence_required',
    description: 'All agent outputs must include confidence scores',
    check: (diff) => {
      if (!diff.content.match(/return.*result/)) return true;  // Not a result-returning function
      return diff.content.includes('confidence');
    },
    severity: 'warning'
  },
  {
    name: 'no_hardcoded_models',
    description: 'Model names must come from arsenal config, never hardcoded',
    check: (diff) => !diff.content.match(/(qwen2\.5|deepseek|llama).*["']/),
    severity: 'error'
  },
  {
    name: 'error_handling_at_boundaries',
    description: 'All external calls (network, file, exec) must have error handling',
    check: (diff) => {
      const calls = diff.content.match(/(fetch|readFile|exec|spawn)\(/g) || [];
      const tryCatch = diff.content.match(/try\s*{/g) || [];
      return calls.length === 0 || tryCatch.length > 0;
    },
    severity: 'warning'
  },
  {
    name: 'no_god_functions',
    description: 'Functions should be <100 lines',
    check: (diff) => {
      const functions = diff.content.match(/function[^{]*{/g) || [];
      // Simplified: just check if any added function is huge
      return !diff.content.split('\n').length > 100;
    },
    severity: 'advisory'
  },
  {
    name: 'test_coverage_for_new_exports',
    description: 'New exported functions must have corresponding tests',
    check: (diff, context) => {
      const newExports = diff.content.match(/module\.exports|export (function|const|class)/g);
      if (!newExports) return true;
      return context.hasTests(diff.file);
    },
    severity: 'warning'
  }
];
```

### 8.2 Consistency Check Runner

```javascript
async function checkArchitecturalConsistency(diff, context) {
  const violations = [];

  for (const rule of ARCHITECTURE_RULES) {
    const passes = rule.check(diff, context);
    if (!passes) {
      violations.push({
        rule: rule.name,
        description: rule.description,
        severity: rule.severity,
        file: diff.file,
        suggestion: rule.suggestion
      });
    }
  }

  return {
    pass: violations.filter(v => v.severity === 'error').length === 0,
    violations,
    errors: violations.filter(v => v.severity === 'error'),
    warnings: violations.filter(v => v.severity === 'warning'),
    advisories: violations.filter(v => v.severity === 'advisory')
  };
}
```

---

## 9. Latency Optimization

### 9.1 Response Time Targets

| Operation | Target | Strategy |
|---|---|---|
| Context assembly | <50ms | Pre-indexed repo, cached ASTs |
| Routing decision | <1ms | Pure heuristics, no I/O |
| Fast model (7b) | <500ms | Always-warm, 180 tok/s |
| Specialist (14b) | <3s | Warm if recently used |
| Reasoning (deepseek) | <10s | Cold start acceptable |
| Heavy (32b) | <20s | On-demand only |
| Cloud (Gemini/Groq) | <2s | Network latency dominated |
| Verification (lint+test) | <5s | Parallel lint + targeted tests |
| Total (fast path) | <1s | Simple tasks, warm model |
| Total (standard path) | <8s | Code generation, specialist |
| Total (complex path) | <30s | Multi-step with reasoning |

### 9.2 Optimization Techniques

```
1. MODEL PREWARMING
   - Keep fast model (7b) always loaded
   - Load specialist on first use, keep warm for 5min idle
   - Reasoning/heavy: load on demand, unload after 2min idle
   - RTX 5090 VRAM budget: 7b (5GB) + 14b (10GB) + 14b-r1 (10GB) = 25GB / 32GB

2. SPECULATIVE EXECUTION
   - While user types, pre-fetch likely context (active file imports, recent errors)
   - Pre-embed recent file changes (batch every 30s)
   - Pre-warm specialist when task queue is >0

3. STREAMING RESPONSES
   - Stream model output token-by-token to editor
   - User sees response building in real-time
   - Can cancel early if wrong direction (saves remaining tokens)

4. PARALLEL VERIFICATION
   - Run lint and type-check simultaneously (different processes)
   - Start test discovery while code is still generating
   - Pipeline: generate tokens → lint first N lines → flag issues early

5. CACHE STRATEGY
   - Prompt cache: identical prompts within 5min TTL (LRU, 100 entries)
   - Embedding cache: per-chunk, invalidate on file change
   - AST cache: per-file, invalidate on save
   - Test result cache: per-file-hash (skip re-run if file unchanged)
```

### 9.3 VRAM Management

```javascript
class VRAMManager {
  constructor(totalVRAM = 32768) {  // 32GB in MB
    this.total = totalVRAM;
    this.loaded = new Map();  // modelId → { sizeGB, lastUsed, tier }
    this.reserved = 2048;    // 2GB for system overhead
  }

  available() {
    const used = [...this.loaded.values()].reduce((sum, m) => sum + m.sizeMB, 0);
    return this.total - used - this.reserved;
  }

  canLoad(model) {
    return this.available() >= model.sizeMB;
  }

  evictIfNeeded(model) {
    while (!this.canLoad(model)) {
      // Evict least-recently-used model (not the fast model)
      const candidates = [...this.loaded.entries()]
        .filter(([id]) => id !== 'fast')
        .sort((a, b) => a[1].lastUsed - b[1].lastUsed);

      if (candidates.length === 0) return false;  // Can't evict anything

      const [evictId] = candidates[0];
      this.unload(evictId);
    }
    return true;
  }

  getLoadoutRecommendation(taskQueue) {
    // Based on upcoming tasks, recommend which models to preload
    const tiers = taskQueue.map(t => t.estimatedTier);
    const needsReasoning = tiers.includes('reasoning');
    const needsHeavy = tiers.includes('heavy');

    // Default loadout: fast + specialist (15GB)
    // Extended: fast + specialist + reasoning (25GB)
    // Maximum: fast + specialist + reasoning (25GB) — heavy won't fit alongside

    return {
      required: ['fast'],  // Always loaded
      recommended: needsReasoning ? ['specialist', 'reasoning'] : ['specialist'],
      onDemand: needsHeavy ? ['heavy'] : []  // Must evict specialist to load
    };
  }
}
```

---

## 10. Anti-Token-Waste Strategies

### 10.1 Over-Tokenization Prevention

```javascript
const ANTI_WASTE_RULES = {
  // Don't send entire files when only one function matters
  maxFileContext: 200,  // lines

  // Don't repeat context that's already in the prompt
  deduplicateContext: true,

  // Don't send comments/blank lines in context (compress)
  stripComments: true,
  stripBlankLines: true,

  // Don't send test fixtures in production code context
  excludeTestData: true,

  // Don't send node_modules type definitions
  excludeNodeModules: true,

  // Don't re-send output from previous turn
  deduplicateHistory: true,

  // Truncate very long error messages
  maxErrorLength: 500,  // chars

  // Don't embed the same chunk twice in one session
  embeddingDedup: true
};

function compressContext(context) {
  let compressed = context;

  // Remove comments (preserving JSDoc for public APIs only)
  if (ANTI_WASTE_RULES.stripComments) {
    compressed = compressed.replace(/\/\/.*$/gm, '');
    compressed = compressed.replace(/\/\*[\s\S]*?\*\//g, '');
  }

  // Collapse blank lines
  if (ANTI_WASTE_RULES.stripBlankLines) {
    compressed = compressed.replace(/\n{3,}/g, '\n\n');
  }

  // Truncate
  const lines = compressed.split('\n');
  if (lines.length > ANTI_WASTE_RULES.maxFileContext) {
    compressed = lines.slice(0, ANTI_WASTE_RULES.maxFileContext).join('\n')
      + '\n// ... truncated ...';
  }

  return compressed;
}
```

### 10.2 Runaway Context Detection

```javascript
function detectRunawayContext(taskState) {
  const warnings = [];

  // Warning: too many retrieval results included
  if (taskState.retrievalChunks > 10) {
    warnings.push('excessive_retrieval: ' + taskState.retrievalChunks + ' chunks');
  }

  // Warning: context growing across retries (not converging)
  if (taskState.retryCount > 0) {
    const growth = taskState.contextTokens / taskState.initialContextTokens;
    if (growth > 1.5) {
      warnings.push('context_growth: ' + growth.toFixed(1) + 'x initial');
    }
  }

  // Warning: repeated token patterns in output (model looping)
  if (taskState.lastOutput) {
    const repeated = detectRepetition(taskState.lastOutput);
    if (repeated > 0.3) {
      warnings.push('output_repetition: ' + (repeated * 100).toFixed(0) + '%');
    }
  }

  return warnings;
}
```

---

## 11. Benchmarking & Testing System

### 11.1 Workflow Benchmarks

```javascript
const WORKFLOW_BENCHMARKS = [
  {
    name: 'simple_completion',
    description: 'Complete a function body given signature + docstring',
    input: { task: 'Implement this function', file: 'test-fixtures/simple.js', line: 5 },
    expectedLatency: 1000,  // ms
    expectedTier: 'fast',
    successCriteria: 'output_parses AND test_passes'
  },
  {
    name: 'bug_fix_type_error',
    description: 'Fix a TypeError given stack trace',
    input: { task: 'Fix this error', error: 'TypeError: x is not a function', file: 'test-fixtures/buggy.js' },
    expectedLatency: 5000,
    expectedTier: 'specialist',
    successCriteria: 'test_passes AND no_new_errors'
  },
  {
    name: 'multi_file_refactor',
    description: 'Rename a function across 3 files',
    input: { task: 'Rename processData to transformPayload across the codebase', files: ['a.js', 'b.js', 'c.js'] },
    expectedLatency: 15000,
    expectedTier: 'specialist',
    successCriteria: 'all_references_updated AND tests_pass'
  },
  {
    name: 'context_retrieval_accuracy',
    description: 'Given a task, measure retrieval precision@5',
    input: { task: 'Fix the SSE reconnection bug', expectedFiles: ['battle-log/server.js', 'shared/sse-client.js'] },
    metric: 'precision_at_5',
    threshold: 0.6
  },
  {
    name: 'escalation_correctness',
    description: 'Verify routing decisions match expected tiers',
    inputs: [
      { task: 'what does this function do?', expected: 'fast' },
      { task: 'implement a binary search tree with AVL balancing', expected: 'specialist' },
      { task: 'why is this race condition happening?', expected: 'reasoning' },
      { task: 'design the authentication system architecture', expected: 'heavy' }
    ],
    threshold: 0.9  // 90% of routing decisions correct
  }
];
```

### 11.2 Regression Detection

```javascript
class RegressionDetector {
  constructor(baselineFile) {
    this.baseline = JSON.parse(fs.readFileSync(baselineFile));
  }

  compare(currentResults) {
    const regressions = [];

    for (const [name, current] of Object.entries(currentResults)) {
      const baseline = this.baseline[name];
      if (!baseline) continue;

      // Latency regression: >20% slower
      if (current.latency > baseline.latency * 1.2) {
        regressions.push({
          benchmark: name,
          metric: 'latency',
          baseline: baseline.latency,
          current: current.latency,
          degradation: ((current.latency / baseline.latency) - 1) * 100
        });
      }

      // Accuracy regression: any drop
      if (current.accuracy < baseline.accuracy) {
        regressions.push({
          benchmark: name,
          metric: 'accuracy',
          baseline: baseline.accuracy,
          current: current.accuracy,
          degradation: (baseline.accuracy - current.accuracy) * 100
        });
      }

      // Token waste regression: >10% more tokens
      if (current.tokensUsed > baseline.tokensUsed * 1.1) {
        regressions.push({
          benchmark: name,
          metric: 'tokens',
          baseline: baseline.tokensUsed,
          current: current.tokensUsed,
          degradation: ((current.tokensUsed / baseline.tokensUsed) - 1) * 100
        });
      }
    }

    return regressions;
  }
}
```

---

## 12. Complete Workflow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    FULL DEVELOPER WORKFLOW                                    │
│                                                                             │
│  DEVELOPER                                                                  │
│  ┌─────────────┐                                                            │
│  │ Types in    │                                                            │
│  │ Cline/Chat  │                                                            │
│  └──────┬──────┘                                                            │
│         │                                                                   │
│         ▼                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐            │
│  │ CONTEXT ASSEMBLY (<50ms)                                    │            │
│  │ • Active file region (AST-scoped)                           │            │
│  │ • Import graph (direct deps)                                │            │
│  │ • Semantic retrieval (Qdrant top-5)                         │            │
│  │ • Symbol lookups (if referenced)                            │            │
│  │ • Error context (if debugging)                              │            │
│  │ • Budget: fits in 12K tokens                                │            │
│  └──────────────────────────┬──────────────────────────────────┘            │
│                             │                                               │
│                             ▼                                               │
│  ┌─────────────────────────────────────────────────────────────┐            │
│  │ ROUTING (<1ms, deterministic)                               │            │
│  │ • Complexity score: 0.6                                     │            │
│  │ • Token estimate: 4,200                                     │            │
│  │ • Selected tier: specialist                                 │            │
│  │ • Selected DAG: fix_bug (if matches chain)                  │            │
│  └──────────────────────────┬──────────────────────────────────┘            │
│                             │                                               │
│                             ▼                                               │
│  ┌─────────────────────────────────────────────────────────────┐            │
│  │ EXECUTION (variable: 500ms – 30s)                           │            │
│  │ • DAG scheduler runs nodes                                  │            │
│  │ • Gates evaluate (confidence checks)                        │            │
│  │ • Escalation if needed (specialist → reasoning)             │            │
│  │ • Branch termination if wasteful                            │            │
│  │ • Streaming output to editor                                │            │
│  └──────────────────────────┬──────────────────────────────────┘            │
│                             │                                               │
│                             ▼                                               │
│  ┌─────────────────────────────────────────────────────────────┐            │
│  │ VERIFICATION (<5s)                                          │            │
│  │ • Syntax check (parse attempt)                              │            │
│  │ • Lint (eslint/prettier)                                    │            │
│  │ • Tests (targeted, not full suite)                          │            │
│  │ • Code review (fast model, optional)                        │            │
│  │ • Architecture rules check                                  │            │
│  └──────────────────────────┬──────────────────────────────────┘            │
│                             │                                               │
│                    ┌────────▼────────┐                                      │
│                    │ ALL GREEN?      │                                      │
│                    └───┬─────────┬───┘                                      │
│                    YES │         │ NO                                        │
│                        │         │                                           │
│  ┌─────────────────────▼──┐  ┌──▼─────────────────────────────┐            │
│  │ AUTO-COMMIT + PUSH     │  │ SHOW DIAGNOSTICS               │            │
│  │ • git add <files>      │  │ • What failed                  │            │
│  │ • git commit -m "..."  │  │ • Why (confidence, test output)│            │
│  │ • git push             │  │ • Suggested fix                │            │
│  │ • Update memory        │  │ • Retry option                 │            │
│  └────────────────────────┘  └────────────────────────────────┘            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 13. Cloud Reintegration Flow

When a task escalates to cloud (Gemini 1M context), the response needs compression before returning to the local loop:

```javascript
async function cloudEscalateAndReintegrate(task, context) {
  // 1. Prepare rich context for cloud (can send much more)
  const cloudContext = compressForCloud(context);

  // 2. Send to cloud
  const cloudResponse = await callGemini({
    task,
    context: cloudContext,
    instructions: 'Be concise. Output only the code/answer, no explanation unless asked.'
  });

  // 3. Compress cloud response for local context
  const compressed = compressCloudResponse(cloudResponse);

  // 4. Verify locally (don't trust cloud blindly)
  const verification = await verifyLocally(compressed, context);

  // 5. Reintegrate
  return {
    output: compressed.code || compressed.answer,
    confidence: Math.min(cloudResponse.confidence, verification.confidence),
    source: 'cloud_escalation',
    verified: verification.pass
  };
}

function compressCloudResponse(response) {
  // Extract only actionable content
  return {
    code: extractCodeBlocks(response.output),
    summary: response.output.split('\n').slice(0, 5).join('\n'),  // First 5 lines as summary
    tokens: estimateTokens(response.output),
    // Don't keep the full verbose explanation — just the code
  };
}
```

---

## 14. Implementation Roadmap

### Phase 7A — Repo Indexing Foundation
1. AST parser setup (acorn/espree for JS, tree-sitter for multi-lang)
2. Dependency graph builder (import/require resolution)
3. Symbol index (function/class/variable registry)
4. Incremental re-index on file save
5. Integration with existing memory-engine retriever

### Phase 7B — Context Assembly
6. Context assembler with budget enforcement
7. Active-region extraction (AST-scoped)
8. Selective retrieval (deps → vectors → symbols → errors)
9. Context compression pipeline
10. Token estimation (tiktoken-compatible)

### Phase 7C — Verification Pipeline
11. Syntax checker integration
12. Lint runner (auto-fix support)
13. Targeted test discovery + execution
14. Code review agent (fast model)
15. Architecture rule engine

### Phase 7D — Autonomous Debugging
16. Error classifier (type → tier mapping)
17. Evidence gatherer (stack trace + related code + git blame)
18. Fix-and-verify loop
19. Memory write on successful fix (episodic learning)
20. Escalation on repeated failure

### Phase 7E — Optimization
21. VRAM manager (load/evict/preload)
22. Prompt cache (LRU with TTL)
23. Speculative context pre-fetch
24. Streaming response support
25. Regression benchmark suite

---

*End of Phase 7. The workflow is now a precision instrument — local-first, retrieval-aware, self-verifying, autonomously debugging, and token-efficient. Traditional Copilot autocomplete is outclassed by orchestration quality.*
