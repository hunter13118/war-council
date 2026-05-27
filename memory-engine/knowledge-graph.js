/**
 * Knowledge Graph Extraction Engine
 *
 * Parses JavaScript/TypeScript source files to extract a relationship graph:
 *   - Nodes: File, Function, Class, Export, Agent
 *   - Edges: imports, defines, exports, calls
 *
 * Uses regex-based extraction (no AST parser dependency) for speed.
 * Stores the graph in-memory with JSON persistence.
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, relative, extname, basename } from "node:path";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";

const GRAPH_PATH_DEFAULT = ".cline-context/knowledge-graph.json";

let graph = { nodes: [], edges: [], extractedAt: null };

/**
 * Extract knowledge graph from a workspace directory.
 * @param {string} rootDir - Workspace root
 * @param {Object} [opts]
 * @param {string[]} [opts.extensions] - File extensions to scan
 * @param {string[]} [opts.ignore] - Directories to skip
 * @returns {Object} The extracted graph
 */
export async function extractGraph(rootDir, opts = {}) {
  const extensions = opts.extensions || [".js", ".mjs", ".ts", ".jsx", ".tsx"];
  const ignore = new Set(opts.ignore || ["node_modules", ".git", ".cline-context", "dist", "build"]);

  graph = { nodes: [], edges: [], extractedAt: new Date().toISOString() };
  const nodeMap = new Map(); // path → nodeId

  // Collect all source files
  const files = await collectFiles(rootDir, extensions, ignore);

  // Phase 1: Create file nodes
  for (const filePath of files) {
    const relPath = relative(rootDir, filePath).replace(/\\/g, "/");
    const id = `file:${relPath}`;
    nodeMap.set(relPath, id);
    graph.nodes.push({
      id,
      type: "file",
      name: basename(filePath),
      path: relPath,
      language: extToLang(extname(filePath)),
    });
  }

  // Phase 2: Parse each file for imports, exports, functions, classes
  for (const filePath of files) {
    const relPath = relative(rootDir, filePath).replace(/\\/g, "/");
    const fileId = nodeMap.get(relPath);
    let content;
    try {
      content = await readFile(filePath, "utf-8");
    } catch { continue; }

    // Extract imports
    const imports = extractImports(content);
    for (const imp of imports) {
      const resolved = resolveImportPath(relPath, imp.source);
      const targetId = nodeMap.get(resolved) || nodeMap.get(resolved + ".js") || nodeMap.get(resolved + "/index.js");
      if (targetId) {
        graph.edges.push({
          id: `edge:${randomUUID().slice(0, 8)}`,
          source: fileId,
          target: targetId,
          type: "imports",
          specifiers: imp.specifiers,
        });
      }
    }

    // Extract function declarations
    const functions = extractFunctions(content);
    for (const fn of functions) {
      const fnId = `fn:${relPath}:${fn.name}`;
      graph.nodes.push({
        id: fnId,
        type: "function",
        name: fn.name,
        file: relPath,
        exported: fn.exported,
        async: fn.async,
        line: fn.line,
      });
      graph.edges.push({
        id: `edge:${randomUUID().slice(0, 8)}`,
        source: fileId,
        target: fnId,
        type: "defines",
      });
    }

    // Extract classes
    const classes = extractClasses(content);
    for (const cls of classes) {
      const clsId = `class:${relPath}:${cls.name}`;
      graph.nodes.push({
        id: clsId,
        type: "class",
        name: cls.name,
        file: relPath,
        exported: cls.exported,
        extends: cls.extends,
        line: cls.line,
      });
      graph.edges.push({
        id: `edge:${randomUUID().slice(0, 8)}`,
        source: fileId,
        target: clsId,
        type: "defines",
      });
    }
  }

  // Phase 3: Extract inter-function calls (heuristic)
  const allFnNames = new Map();
  for (const node of graph.nodes) {
    if (node.type === "function") allFnNames.set(node.name, node.id);
  }
  for (const filePath of files) {
    const relPath = relative(rootDir, filePath).replace(/\\/g, "/");
    const fileId = nodeMap.get(relPath);
    let content;
    try { content = await readFile(filePath, "utf-8"); } catch { continue; }

    // Find function calls that match known function names
    const callPattern = /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g;
    let match;
    const seen = new Set();
    while ((match = callPattern.exec(content)) !== null) {
      const name = match[1];
      if (seen.has(name)) continue;
      seen.add(name);
      const targetFnId = allFnNames.get(name);
      if (targetFnId && !targetFnId.startsWith(`fn:${relPath}`)) {
        // Cross-file call
        graph.edges.push({
          id: `edge:${randomUUID().slice(0, 8)}`,
          source: fileId,
          target: targetFnId,
          type: "calls",
        });
      }
    }
  }

  return graph;
}

/**
 * Get the current in-memory graph.
 */
export function getGraph() {
  return graph;
}

/**
 * Get graph statistics.
 */
export function getGraphStats() {
  const byType = {};
  for (const n of graph.nodes) {
    byType[n.type] = (byType[n.type] || 0) + 1;
  }
  const edgesByType = {};
  for (const e of graph.edges) {
    edgesByType[e.type] = (edgesByType[e.type] || 0) + 1;
  }
  return {
    totalNodes: graph.nodes.length,
    totalEdges: graph.edges.length,
    nodesByType: byType,
    edgesByType,
    extractedAt: graph.extractedAt,
  };
}

/**
 * Persist graph to disk.
 */
export async function saveGraph(rootDir) {
  const outPath = resolve(rootDir, GRAPH_PATH_DEFAULT);
  await writeFile(outPath, JSON.stringify(graph, null, 2));
  return outPath;
}

/**
 * Load graph from disk.
 */
export async function loadGraph(rootDir) {
  const p = resolve(rootDir, GRAPH_PATH_DEFAULT);
  if (!existsSync(p)) return null;
  graph = JSON.parse(await readFile(p, "utf-8"));
  return graph;
}

/**
 * Query the graph — find nodes by name pattern and their connections.
 * @param {string} query - Text to search for in node names
 * @param {number} [depth=1] - How many hops to traverse
 * @returns {{ matches: Object[], connections: Object[] }}
 */
export function queryGraph(query, depth = 1) {
  const lower = query.toLowerCase();
  const matches = graph.nodes.filter(n => n.name.toLowerCase().includes(lower));
  const matchIds = new Set(matches.map(n => n.id));

  const connections = [];
  const visited = new Set(matchIds);

  // BFS from matched nodes
  let frontier = [...matchIds];
  for (let d = 0; d < depth; d++) {
    const nextFrontier = [];
    for (const nodeId of frontier) {
      const relatedEdges = graph.edges.filter(e => e.source === nodeId || e.target === nodeId);
      for (const edge of relatedEdges) {
        const otherId = edge.source === nodeId ? edge.target : edge.source;
        if (!visited.has(otherId)) {
          visited.add(otherId);
          nextFrontier.push(otherId);
          connections.push(edge);
        }
      }
    }
    frontier = nextFrontier;
  }

  const connectedNodes = graph.nodes.filter(n => visited.has(n.id) && !matchIds.has(n.id));
  return { matches, connections, connectedNodes };
}

// === Internal helpers ===

async function collectFiles(dir, extensions, ignore, result = []) {
  const entries = await readdir(dir, { withFileTypes: true });
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

function extToLang(ext) {
  const map = { ".js": "javascript", ".mjs": "javascript", ".ts": "typescript", ".jsx": "react", ".tsx": "react-ts" };
  return map[ext] || "unknown";
}

function extractImports(content) {
  const imports = [];
  // ES module imports
  const esPattern = /import\s+(?:(\{[^}]*\})|(\w+)(?:\s*,\s*\{([^}]*)\})?)\s+from\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = esPattern.exec(content)) !== null) {
    const specifiers = (m[1] || m[3] || m[2] || "").replace(/[{}]/g, "").split(",").map(s => s.trim()).filter(Boolean);
    imports.push({ source: m[4], specifiers });
  }
  // Dynamic imports
  const dynPattern = /(?:await\s+)?import\(['"]([^'"]+)['"]\)/g;
  while ((m = dynPattern.exec(content)) !== null) {
    imports.push({ source: m[1], specifiers: ["*"] });
  }
  return imports;
}

function extractFunctions(content) {
  const fns = [];
  const lines = content.split("\n");
  // export function name, export async function name, function name, const name = (async) =>
  const patterns = [
    /^(export\s+)?(async\s+)?function\s+(\w+)/,
    /^(export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(async\s+)?\(?/,
  ];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m1 = line.match(patterns[0]);
    if (m1) {
      fns.push({ name: m1[3], exported: !!m1[1], async: !!m1[2], line: i + 1 });
      continue;
    }
    const m2 = line.match(patterns[1]);
    if (m2 && (line.includes("=>") || line.includes("function"))) {
      fns.push({ name: m2[2], exported: !!m2[1], async: !!m2[3], line: i + 1 });
    }
  }
  return fns;
}

function extractClasses(content) {
  const classes = [];
  const lines = content.split("\n");
  const pattern = /^(export\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?/;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(pattern);
    if (m) {
      classes.push({ name: m[2], exported: !!m[1], extends: m[3] || null, line: i + 1 });
    }
  }
  return classes;
}

function resolveImportPath(fromFile, importPath) {
  if (importPath.startsWith(".")) {
    const fromDir = fromFile.split("/").slice(0, -1).join("/");
    const parts = importPath.split("/");
    const base = fromDir.split("/");
    for (const p of parts) {
      if (p === "..") base.pop();
      else if (p !== ".") base.push(p);
    }
    let resolved = base.join("/");
    // Strip extension if present, we'll try matches with/without
    if (resolved.endsWith(".js") || resolved.endsWith(".ts")) {
      return resolved;
    }
    return resolved;
  }
  return importPath; // external package — won't match internal files
}
