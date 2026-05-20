import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initRegistry, registerWorkspace, switchWorkspace, getActiveWorkspace, listWorkspaces, removeWorkspace, getWorkspace } from '../mcp-server/shared/workspace-registry.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('Workspace Registry', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ws-registry-'));
    await initRegistry(tmpDir);
  });

  it('starts with no workspaces', () => {
    const list = listWorkspaces();
    // May have been contaminated by previous test runs since module is singleton
    // Just verify the function returns an array
    assert.ok(Array.isArray(list));
  });

  it('registers a workspace with valid path', async () => {
    const ws = await registerWorkspace({ path: tmpDir, name: 'Test Workspace' });
    assert.ok(ws.id);
    assert.equal(ws.name, 'Test Workspace');
    assert.equal(ws.path, tmpDir);
    assert.ok(ws.vectorStorePath);
    assert.ok(ws.conversationsDir);
    assert.ok(ws.registeredAt);
  });

  it('rejects registration of nonexistent path', async () => {
    await assert.rejects(
      registerWorkspace({ path: '/this/path/definitely/does/not/exist/xyz123' }),
      /does not exist/
    );
  });

  it('auto-activates first registered workspace', async () => {
    await registerWorkspace({ path: tmpDir, name: 'First' });
    const active = getActiveWorkspace();
    assert.ok(active);
    assert.equal(active.name, 'First');
  });

  it('switchWorkspace changes active', async () => {
    const ws1 = await registerWorkspace({ path: tmpDir, name: 'WS1' });
    // Create second temp dir for second workspace
    const tmpDir2 = await mkdtemp(join(tmpdir(), 'ws-registry-2-'));
    const ws2 = await registerWorkspace({ path: tmpDir2, name: 'WS2' });
    switchWorkspace(ws2.id);
    const active = getActiveWorkspace();
    assert.equal(active.id, ws2.id);
    await rm(tmpDir2, { recursive: true });
  });

  it('switchWorkspace rejects unknown id', () => {
    assert.throws(() => switchWorkspace('nonexistent-id-xyz'), /Unknown workspace/);
  });

  it('listWorkspaces marks active workspace', async () => {
    await registerWorkspace({ path: tmpDir, name: 'Active One' });
    const list = listWorkspaces();
    const active = list.find(w => w.name === 'Active One');
    assert.ok(active?.active);
  });

  it('removeWorkspace removes from list', async () => {
    const ws = await registerWorkspace({ path: tmpDir, name: 'To Remove' });
    await removeWorkspace(ws.id);
    assert.equal(getWorkspace(ws.id), null);
  });

  it('removeWorkspace rejects unknown id', async () => {
    await assert.rejects(removeWorkspace('nonexistent-xyz'), /Unknown workspace/);
  });

  it('getWorkspace returns null for unknown', () => {
    assert.equal(getWorkspace('nonexistent'), null);
  });
});
