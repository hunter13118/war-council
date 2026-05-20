/**
 * DAG Execution Engine — Multi-step task orchestration.
 * 
 * Executes directed acyclic graphs of tasks with:
 * - Topological ordering (respects dependencies)
 * - Parallel execution of independent nodes
 * - Gate nodes for conditional branching
 * - Per-node timeout and retry
 * - Full execution trace for observability
 * 
 * The orchestrator never calls an LLM for decisions — only workers do.
 */

import { randomUUID } from 'node:crypto';

/** Active DAG executions */
const executions = new Map();

/**
 * @typedef {Object} DAGNode
 * @property {string} id
 * @property {'task'|'gate'|'merge'} type
 * @property {Object} config
 * @property {string[]} dependencies
 * @property {number} [timeout]
 */

/**
 * @typedef {Object} DAGDefinition
 * @property {string} id
 * @property {string} name
 * @property {string} [description]
 * @property {string} entryNode
 * @property {Object.<string, DAGNode>} nodes
 */

/**
 * Validate a DAG definition.
 * @param {DAGDefinition} dag
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateDAG(dag) {
  const errors = [];
  if (!dag.id) errors.push('Missing id');
  if (!dag.nodes || typeof dag.nodes !== 'object') errors.push('Missing nodes');
  if (!dag.entryNode) errors.push('Missing entryNode');
  if (dag.nodes && !dag.nodes[dag.entryNode]) errors.push(`entryNode '${dag.entryNode}' not found in nodes`);

  // Check for cycles via topological sort attempt
  if (dag.nodes) {
    const visited = new Set();
    const visiting = new Set();
    const hasCycle = (nodeId) => {
      if (visiting.has(nodeId)) return true;
      if (visited.has(nodeId)) return false;
      visiting.add(nodeId);
      const node = dag.nodes[nodeId];
      if (node?.dependencies) {
        for (const dep of node.dependencies) {
          if (!dag.nodes[dep]) { errors.push(`Node '${nodeId}' depends on unknown node '${dep}'`); continue; }
          if (hasCycle(dep)) return true;
        }
      }
      visiting.delete(nodeId);
      visited.add(nodeId);
      return false;
    };
    for (const nodeId of Object.keys(dag.nodes)) {
      if (hasCycle(nodeId)) { errors.push('Cycle detected in DAG'); break; }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Execute a DAG.
 * @param {DAGDefinition} dag - The DAG to execute
 * @param {Object} context - Initial context/variables
 * @param {Function} taskExecutor - Async function(node, context) → result for task nodes
 * @returns {Object} Execution handle with id and promise
 */
export function executeDAG(dag, context = {}, taskExecutor) {
  const validation = validateDAG(dag);
  if (!validation.valid) {
    throw new Error(`Invalid DAG: ${validation.errors.join(', ')}`);
  }

  const executionId = randomUUID();
  const trace = {
    id: executionId,
    dagId: dag.id,
    dagName: dag.name,
    status: 'running',
    startedAt: Date.now(),
    completedAt: null,
    context: { ...context },
    nodeResults: {},
    nodeStates: {},
    errors: [],
  };

  // Initialize all node states
  for (const nodeId of Object.keys(dag.nodes)) {
    trace.nodeStates[nodeId] = 'pending';
  }

  executions.set(executionId, trace);

  // Execute the DAG asynchronously
  const promise = runDAG(dag, trace, taskExecutor).then(result => {
    trace.status = trace.errors.length > 0 ? 'failed' : 'completed';
    trace.completedAt = Date.now();
    return trace;
  }).catch(err => {
    trace.status = 'failed';
    trace.completedAt = Date.now();
    trace.errors.push(err.message);
    return trace;
  });

  return { id: executionId, promise, trace };
}

/**
 * Internal DAG runner — processes nodes in topological order.
 */
async function runDAG(dag, trace, taskExecutor) {
  const completed = new Set();
  const nodes = dag.nodes;
  const totalNodes = Object.keys(nodes).length;

  while (completed.size < totalNodes) {
    // Find ready nodes (all deps completed, not yet started)
    const ready = Object.entries(nodes).filter(([id, node]) => {
      if (completed.has(id)) return false;
      if (trace.nodeStates[id] === 'skipped') { completed.add(id); return false; }
      const deps = node.dependencies || [];
      return deps.every(d => completed.has(d) || trace.nodeStates[d] === 'skipped');
    });

    if (ready.length === 0 && completed.size < totalNodes) {
      // Deadlock — some nodes can never run
      const stuck = Object.keys(nodes).filter(id => !completed.has(id) && trace.nodeStates[id] !== 'skipped');
      trace.errors.push(`Deadlock: nodes [${stuck.join(', ')}] can never complete`);
      break;
    }

    // Execute all ready nodes in parallel
    await Promise.all(ready.map(async ([nodeId, node]) => {
      trace.nodeStates[nodeId] = 'running';
      try {
        const result = await executeNode(nodeId, node, trace, taskExecutor);
        trace.nodeResults[nodeId] = result;
        trace.nodeStates[nodeId] = 'completed';
        completed.add(nodeId);

        // Handle gate nodes — skip branches that aren't taken
        if (node.type === 'gate' && result.skipNodes) {
          for (const skipId of result.skipNodes) {
            trace.nodeStates[skipId] = 'skipped';
            completed.add(skipId);
          }
        }
      } catch (err) {
        trace.nodeResults[nodeId] = { error: err.message };
        trace.nodeStates[nodeId] = 'failed';
        trace.errors.push(`Node '${nodeId}' failed: ${err.message}`);
        completed.add(nodeId);
      }
    }));
  }

  return trace;
}

/**
 * Execute a single node based on its type.
 */
async function executeNode(nodeId, node, trace, taskExecutor) {
  const timeout = node.timeout || 60000;

  switch (node.type) {
    case 'task': {
      const result = await Promise.race([
        taskExecutor(node, trace.context, trace.nodeResults),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout after ${timeout}ms`)), timeout))
      ]);
      return result;
    }

    case 'gate': {
      const { condition, onPass, onFail } = node.config;
      const passed = evaluateCondition(condition, trace.nodeResults, trace.context);
      const skipNodes = [];
      if (passed && onFail) skipNodes.push(onFail);
      if (!passed && onPass) skipNodes.push(onPass);
      return { passed, skipNodes };
    }

    case 'merge': {
      const { inputs, strategy } = node.config;
      const results = (inputs || []).map(id => trace.nodeResults[id]).filter(Boolean);
      if (strategy === 'best') {
        // Pick result with highest confidence
        return results.reduce((best, r) => (r?.confidence?.composite || 0) > (best?.confidence?.composite || 0) ? r : best, results[0]);
      }
      return { merged: results };
    }

    default:
      return { type: node.type, status: 'unknown_type' };
  }
}

/**
 * Simple condition evaluator for gate nodes.
 * Supports: "nodeId.field op value" expressions.
 */
function evaluateCondition(condition, nodeResults, context) {
  if (!condition) return true;

  // Pattern: "nodeId.field >= value" or "context.field == value"
  const match = condition.match(/^(\w+)\.(\w+)\s*(>=|<=|>|<|==|!=)\s*(.+)$/);
  if (!match) return !!condition; // truthy check

  const [, source, field, op, rawValue] = match;
  const sourceObj = source === 'context' ? context : nodeResults[source];
  if (!sourceObj) return false;

  const actual = sourceObj[field];
  const expected = isNaN(rawValue) ? rawValue.replace(/['"]/g, '') : parseFloat(rawValue);

  switch (op) {
    case '>=': return actual >= expected;
    case '<=': return actual <= expected;
    case '>': return actual > expected;
    case '<': return actual < expected;
    case '==': return actual == expected;
    case '!=': return actual != expected;
    default: return false;
  }
}

/**
 * Get execution status by ID.
 * @param {string} executionId
 * @returns {Object|null}
 */
export function getExecution(executionId) {
  return executions.get(executionId) || null;
}

/**
 * List recent executions.
 * @param {number} [count=20]
 * @returns {Array}
 */
export function listExecutions(count = 20) {
  return [...executions.values()]
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, count)
    .map(e => ({
      id: e.id,
      dagId: e.dagId,
      dagName: e.dagName,
      status: e.status,
      startedAt: e.startedAt,
      completedAt: e.completedAt,
      nodeCount: Object.keys(e.nodeStates).length,
      completedNodes: Object.values(e.nodeStates).filter(s => s === 'completed').length,
      failedNodes: Object.values(e.nodeStates).filter(s => s === 'failed').length,
    }));
}
