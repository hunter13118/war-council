import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateDAG, executeDAG, getExecution, listExecutions } from '../mcp-server/shared/dag-engine.js';

describe('DAG Engine — validation', () => {
  it('rejects DAG with no id', () => {
    const { valid, errors } = validateDAG({ nodes: { a: { type: 'task', dependencies: [] } }, entryNode: 'a' });
    assert.equal(valid, false);
    assert.ok(errors.some(e => e.includes('id')));
  });

  it('rejects DAG with missing entryNode', () => {
    const { valid } = validateDAG({ id: 'test', nodes: { a: { type: 'task', dependencies: [] } }, entryNode: 'missing' });
    assert.equal(valid, false);
  });

  it('detects cycles', () => {
    const { valid, errors } = validateDAG({
      id: 'cyclic', entryNode: 'a',
      nodes: {
        a: { type: 'task', dependencies: ['b'] },
        b: { type: 'task', dependencies: ['a'] },
      }
    });
    assert.equal(valid, false);
    assert.ok(errors.some(e => e.includes('Cycle')));
  });

  it('validates correct DAG', () => {
    const { valid } = validateDAG({
      id: 'linear', entryNode: 'start',
      nodes: {
        start: { type: 'task', dependencies: [], config: {} },
        middle: { type: 'task', dependencies: ['start'], config: {} },
        end: { type: 'task', dependencies: ['middle'], config: {} },
      }
    });
    assert.equal(valid, true);
  });
});

describe('DAG Engine — execution', () => {
  it('executes a linear DAG in order', async () => {
    const order = [];
    const dag = {
      id: 'linear-test', name: 'Linear', entryNode: 'a',
      nodes: {
        a: { type: 'task', dependencies: [], config: { args: { prompt: 'step-a' } } },
        b: { type: 'task', dependencies: ['a'], config: { args: { prompt: 'step-b' } } },
        c: { type: 'task', dependencies: ['b'], config: { args: { prompt: 'step-c' } } },
      }
    };

    const executor = async (node) => {
      order.push(node.config.args.prompt);
      return { text: `result-${node.config.args.prompt}` };
    };

    const { promise } = executeDAG(dag, {}, executor);
    const trace = await promise;

    assert.equal(trace.status, 'completed');
    assert.deepEqual(order, ['step-a', 'step-b', 'step-c']);
    assert.equal(trace.nodeResults.a.text, 'result-step-a');
    assert.equal(trace.nodeResults.c.text, 'result-step-c');
  });

  it('executes parallel branches simultaneously', async () => {
    const dag = {
      id: 'parallel-test', name: 'Parallel', entryNode: 'start',
      nodes: {
        start: { type: 'task', dependencies: [], config: { args: { prompt: 'init' } } },
        branch1: { type: 'task', dependencies: ['start'], config: { args: { prompt: 'b1' } } },
        branch2: { type: 'task', dependencies: ['start'], config: { args: { prompt: 'b2' } } },
        merge: { type: 'task', dependencies: ['branch1', 'branch2'], config: { args: { prompt: 'final' } } },
      }
    };

    const started = [];
    const executor = async (node) => {
      started.push(node.config.args.prompt);
      await new Promise(r => setTimeout(r, 10));
      return { text: 'ok' };
    };

    const { promise } = executeDAG(dag, {}, executor);
    const trace = await promise;

    assert.equal(trace.status, 'completed');
    assert.equal(Object.values(trace.nodeStates).filter(s => s === 'completed').length, 4);
  });

  it('gate node skips branches based on condition', async () => {
    const dag = {
      id: 'gate-test', name: 'Gated', entryNode: 'assess',
      nodes: {
        assess: { type: 'task', dependencies: [], config: { args: { prompt: 'assess' } } },
        gate: {
          type: 'gate', dependencies: ['assess'],
          config: { condition: 'assess.score >= 0.7', onPass: 'simple', onFail: 'complex' }
        },
        simple: { type: 'task', dependencies: ['gate'], config: { args: { prompt: 'simple-path' } } },
        complex: { type: 'task', dependencies: ['gate'], config: { args: { prompt: 'complex-path' } } },
      }
    };

    const executor = async (node) => {
      if (node.config.args.prompt === 'assess') return { score: 0.9, text: 'high confidence' };
      return { text: `executed ${node.config.args.prompt}` };
    };

    const { promise } = executeDAG(dag, {}, executor);
    const trace = await promise;

    assert.equal(trace.status, 'completed');
    assert.equal(trace.nodeStates.simple, 'completed'); // gate passed → simple runs
    assert.equal(trace.nodeStates.complex, 'skipped');  // gate passed → complex skipped
  });

  it('handles task failure gracefully', async () => {
    const dag = {
      id: 'fail-test', name: 'Failing', entryNode: 'a',
      nodes: {
        a: { type: 'task', dependencies: [], config: { args: {} } },
        b: { type: 'task', dependencies: ['a'], config: { args: {} } },
      }
    };

    const executor = async (node) => {
      throw new Error('intentional failure');
    };

    const { promise } = executeDAG(dag, {}, executor);
    const trace = await promise;

    assert.equal(trace.status, 'failed');
    assert.ok(trace.errors.length > 0);
    assert.equal(trace.nodeStates.a, 'failed');
  });

  it('respects node timeout', async () => {
    const dag = {
      id: 'timeout-test', name: 'Timeout', entryNode: 'slow',
      nodes: {
        slow: { type: 'task', dependencies: [], config: { args: {} }, timeout: 50 },
      }
    };

    const executor = async () => {
      await new Promise(r => setTimeout(r, 200));
      return { text: 'should not reach' };
    };

    const { promise } = executeDAG(dag, {}, executor);
    const trace = await promise;

    assert.equal(trace.status, 'failed');
    assert.ok(trace.errors.some(e => e.includes('Timeout')));
  });

  it('getExecution returns running/completed executions', async () => {
    const dag = {
      id: 'get-test', name: 'Get', entryNode: 'a',
      nodes: { a: { type: 'task', dependencies: [], config: { args: {} } } }
    };

    const { id, promise } = executeDAG(dag, {}, async () => ({ text: 'ok' }));

    // Should be findable immediately
    const running = getExecution(id);
    assert.ok(running);
    assert.equal(running.dagId, 'get-test');

    await promise;
    const completed = getExecution(id);
    assert.equal(completed.status, 'completed');
  });

  it('listExecutions returns recent history', async () => {
    const before = listExecutions().length;
    const dag = {
      id: 'list-test', name: 'List', entryNode: 'a',
      nodes: { a: { type: 'task', dependencies: [], config: { args: {} } } }
    };
    const { promise } = executeDAG(dag, {}, async () => ({ text: 'ok' }));
    await promise;
    const after = listExecutions();
    assert.ok(after.length > before);
  });
});
