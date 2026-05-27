/**
 * Repo Graph AST Indexer
 *
 * Regex-based "AST-lite" indexer that extracts:
 *   - Symbol index: function/class/variable → { file, line, type, exported }
 *   - Dependency graph: file → Set<imported files>
 *   - Chunk registry: AST-aware code chunks with boundaries
 *   - Impact analysis: "what breaks if I change X?"
 *
 * Designed for speed (no real parser dependency) with incremental re-indexing.
 */
import { readFile, readdir } from "node:fs/promises";
import { resolve, relative, extname, basename, dirname } from "node:path";

let symbolIndex = new Map();   // symbolName → [{ file, line, type, exported }]
let depGraph = new Map();      // filePath → Set<filePath>
let chunkRegistry = [];        // all code chunks
let indexedFiles = new Map();  // filePath → { mtime, hash }
let indexStats = { filesIndexed: 0, symbolsFound: 0, chunksCreated: 0, lastIndexedAt: null };

/**
 * Index the full repository.
 * @param {string} rootDir
 * @param {Object} [opts]
 * @returns {{ stats: Object }}
 */
export async function indexFull(rootDir, opts = {}) {
  const extensions = opts.extensions || [".js", ".mjs", ".ts", ".jsx", ".tsx"];
  const ignore = new Set(opts.ignore || ["node_modules", ".git", ".cline-context", "dist", "build"]);

  symbolIndex.clear();
  depGraph.clear();
  chunkRegistry = [];
  indexedFiles.clear();

  const files = await collectFiles(rootDir, extensions, ignore);

  for (const filePath of files) {
    await indexFile(filePath, rootDir);
  }

  indexStats = {
    filesIndexed: files.length,
    symbolsFound: symbolIndex.size,
    chunksCreated: chunkRegistry.length,
    lastIndexedAt: new Date().toISOString(),
  };

  return { stats: indexStats };
}

/**
 * Index a single file (for incremental updates).
 */
async function indexFile(filePath, rootDir) {
  let content;
  try {
    content = await readFile(filePath, "utf-8");
  } catch { return; }

  const relPath = relative(rootDir, filePath).replace(/\\/g, "/");
  indexedFiles.set(relPath, { indexed: true });

  // Extract symbols
  const symbols = extractSymbols(content, relPath);
  for (const sym of symbols) {
    if (!symbolIndex.has(sym.name)) symbolIndex.set(sym.name, []);
    symbolIndex.get(sym.name).push(sym);
  }

  // Extract dependencies
  const deps = extractDependencies(content, relPath);
  depGraph.set(relPath, new Set(deps));

  // Create chunks
  const chunks = createChunks(content, relPath);
  chunkRegistry.push(...chunks);
}

/**
 * Look up a symbol by name.
 * @param {string} name
 * @returns {Array<{ file, line, type, exported }>}
 */
export function lookupSymbol(name) {
  return symbolIndex.get(name) || [];
}

/**
 * Find all symbols in a file.
 * @param {string} filePath - Relative path
 * @returns {Array}
 */
export function getFileSymbols(filePath) {
  const results = [];
  for (const [name, locs] of symbolIndex) {
    for (const loc of locs) {
      if (loc.file === filePath) results.push({ name, ...loc });
    }
  }
  return results;
}

/**
 * Get direct dependencies of a file.
 * @param {string} filePath
 * @returns {string[]}
 */
export function getDependencies(filePath) {
  return [...(depGraph.get(filePath) || [])];
}

/**
 * Get reverse dependencies — files that import this file.
 * @param {string} filePath
 * @returns {string[]}
 */
export function getDependents(filePath) {
  const dependents = [];
  for (const [file, deps] of depGraph) {
    if (deps.has(filePath)) dependents.push(file);
  }
  return dependents;
}

/**
 * Impact analysis — what could break if this file changes?
 * BFS through reverse dependency graph.
 * @param {string} filePath
 * @param {number} [maxDepth=3]
 * @returns {{ directDependents: string[], transitiveImpact: string[], totalAffected: number }}
 */
export function analyzeImpact(filePath, maxDepth = 3) {
  const direct = getDependents(filePath);
  const visited = new Set([filePath, ...direct]);
  let frontier = [...direct];

  for (let d = 1; d < maxDepth; d++) {
    const next = [];
    for (const f of frontier) {
      for (const dep of getDependents(f)) {
        if (!visited.has(dep)) {
          visited.add(dep);
          next.push(dep);
        }
      }
    }
    frontier = next;
  }

  visited.delete(filePath);
  return {
    directDependents: direct,
    transitiveImpact: [...visited].filter(f => !direct.includes(f)),
    totalAffected: visited.size,
  };
}

/**
 * Search symbols by pattern.
 * @param {string} query - Partial name match
 * @returns {Array<{ name, file, line, type }>}
 */
export function searchSymbols(query) {
  const lower = query.toLowerCase();
  const results = [];
  for (const [name, locs] of symbolIndex) {
    if (name.toLowerCase().includes(lower)) {
      for (const loc of locs) {
        results.push({ name, ...loc });
      }
    }
  }
  return results.slice(0, 50);
}

/**
 * Get chunks for a file.
 * @param {string} filePath
 * @returns {Array}
 */
export function getFileChunks(filePath) {
  return chunkRegistry.filter(c => c.file === filePath);
}

/**
 * Get index stats.
 */
export function getIndexStats() {
  return {
    ...indexStats,
    depGraphSize: depGraph.size,
    totalChunks: chunkRegistry.length,
    totalSymbols: symbolIndex.size,
    uniqueFiles: indexedFiles.size,
  };
}

/**
 * Get the full dependency graph for visualization.
 * @returns {{ nodes: string[], edges: Array<{ from: string, to: string }> }}
 */
export function getDepGraphData() {
  const nodes = [...depGraph.keys()];
  const edges = [];
  for (const [from, deps] of depGraph) {
    for (const to of deps) {
      edges.push({ from, to });
    }
  }
  return { nodes, edges };
}

/**
 * Reset (for testing).
 */
export function resetIndex() {
  symbolIndex.clear();
  depGraph.clear();
  chunkRegistry = [];
  indexedFiles.clear();
  indexStats = { filesIndexed: 0, symbolsFound: 0, chunksCreated: 0, lastIndexedAt: null };
}

// === Internal ===

async function collectFiles(dir, extensions, ignore, result = []) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch { return result; }
  for (const entry of entries) {
    if (ignore.has(entry.name)) continue;
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(full, extensions, ignore, result);
    } else if (extensions.includes(extname(entry.name))) {
      result.push(full);
    }
  }
  return result;
}

function extractSymbols(content, filePath) {
  const symbols = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Function declarations
    const fnMatch = line.match(/^(export\s+)?(async\s+)?function\s+(\w+)/);
    if (fnMatch) {
      symbols.push({ name: fnMatch[3], file: filePath, line: i + 1, type: 'function', exported: !!fnMatch[1] });
      continue;
    }

    // Arrow functions / const assignments
    const arrowMatch = line.match(/^(export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(async\s+)?/);
    if (arrowMatch && (line.includes('=>') || line.includes('function'))) {
      symbols.push({ name: arrowMatch[2], file: filePath, line: i + 1, type: 'function', exported: !!arrowMatch[1] });
      continue;
    }

    // Class declarations
    const classMatch = line.match(/^(export\s+)?class\s+(\w+)/);
    if (classMatch) {
      symbols.push({ name: classMatch[2], file: filePath, line: i + 1, type: 'class', exported: !!classMatch[1] });
      continue;
    }

    // Method definitions inside classes
    const methodMatch = line.match(/^\s+(async\s+)?(\w+)\s*\([^)]*\)\s*\{/);
    if (methodMatch && !['if', 'for', 'while', 'switch', 'catch'].includes(methodMatch[2])) {
      symbols.push({ name: methodMatch[2], file: filePath, line: i + 1, type: 'method', exported: false });
    }
  }

  return symbols;
}

function extractDependencies(content, fromFile) {
  const deps = [];
  const fromDir = dirname(fromFile);

  // ES imports
  const importPattern = /import\s+.*from\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = importPattern.exec(content)) !== null) {
    const resolved = resolveImport(fromDir, m[1]);
    if (resolved) deps.push(resolved);
  }

  // Dynamic imports
  const dynPattern = /import\(['"]([^'"]+)['"]\)/g;
  while ((m = dynPattern.exec(content)) !== null) {
    const resolved = resolveImport(fromDir, m[1]);
    if (resolved) deps.push(resolved);
  }

  return deps;
}

function resolveImport(fromDir, importPath) {
  if (!importPath.startsWith('.')) return null; // skip external packages
  const parts = importPath.split('/');
  const base = fromDir.split('/').filter(Boolean);

  for (const p of parts) {
    if (p === '..') base.pop();
    else if (p !== '.') base.push(p);
  }

  let resolved = base.join('/');
  if (!resolved.match(/\.\w+$/)) resolved += '.js';
  return resolved;
}

function createChunks(content, filePath) {
  const chunks = [];
  const lines = content.split('\n');
  let currentChunk = { startLine: 1, lines: [], name: 'module-level', type: 'module' };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for chunk boundaries
    const isBoundary = /^(export\s+)?(async\s+)?function\s+\w+|^(export\s+)?class\s+\w+|^(export\s+)?(?:const|let)\s+\w+\s*=\s*(async\s+)?\(/.test(line);

    if (isBoundary && currentChunk.lines.length > 0) {
      // Save previous chunk
      chunks.push({
        file: filePath,
        startLine: currentChunk.startLine,
        endLine: i,
        name: currentChunk.name,
        type: currentChunk.type,
        content: currentChunk.lines.join('\n').slice(0, 500),
        lineCount: currentChunk.lines.length,
      });
      // Start new chunk
      const fnName = (line.match(/(?:function|class|const|let|var)\s+(\w+)/) || [])[1] || 'anonymous';
      const chunkType = line.includes('class') ? 'class' : 'function';
      currentChunk = { startLine: i + 1, lines: [line], name: fnName, type: chunkType };
    } else {
      currentChunk.lines.push(line);
    }
  }

  // Final chunk
  if (currentChunk.lines.length > 0) {
    chunks.push({
      file: filePath,
      startLine: currentChunk.startLine,
      endLine: lines.length,
      name: currentChunk.name,
      type: currentChunk.type,
      content: currentChunk.lines.join('\n').slice(0, 500),
      lineCount: currentChunk.lines.length,
    });
  }

  return chunks;
}
