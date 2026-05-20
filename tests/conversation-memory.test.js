import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildHistoryContext, getHistory, appendToConversation, getTurnCount } from '../mcp-server/shared/conversation-memory.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('Conversation Memory — buildHistoryContext', () => {
  it('returns empty string for no messages', () => {
    assert.equal(buildHistoryContext([], 'hello'), '');
    assert.equal(buildHistoryContext(null, 'hello'), '');
  });

  it('formats messages as User/Assistant turns', () => {
    const messages = [
      { role: 'user', content: 'What is RAG?' },
      { role: 'assistant', content: 'RAG stands for Retrieval Augmented Generation.' },
    ];
    const result = buildHistoryContext(messages, 'Tell me more');
    assert.ok(result.includes('User: What is RAG?'));
    assert.ok(result.includes('Assistant: RAG stands for'));
    assert.ok(result.includes('Previous conversation:'));
    assert.ok(result.endsWith('---\n'));
  });

  it('respects token budget — drops oldest messages first', () => {
    // Create a conversation with many long messages
    const messages = [];
    for (let i = 0; i < 100; i++) {
      messages.push({ role: 'user', content: 'x'.repeat(500) });
      messages.push({ role: 'assistant', content: 'y'.repeat(500) });
    }
    const result = buildHistoryContext(messages, 'new question');
    // Should be under ~16000 chars (4000 tokens * 4 chars/token)
    assert.ok(result.length < 20000);
    assert.ok(result.length > 0);
    // Should include the most recent messages
    assert.ok(result.includes('y'.repeat(500))); // last assistant message included
  });

  it('includes most recent messages when budget is tight', () => {
    const messages = [
      { role: 'user', content: 'old question' },
      { role: 'assistant', content: 'old answer' },
      { role: 'user', content: 'recent question' },
      { role: 'assistant', content: 'recent answer' },
    ];
    const result = buildHistoryContext(messages, 'new');
    assert.ok(result.includes('recent answer'));
    assert.ok(result.includes('old answer'));
  });
});

describe('Conversation Memory — persistence', () => {
  let tmpDir;

  it('getHistory returns empty array for nonexistent conversation', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'convo-test-'));
    const history = await getHistory('nonexistent-id', tmpDir);
    assert.deepEqual(history, []);
  });

  it('appendToConversation creates new conversation', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'convo-test-'));
    await appendToConversation('test-convo-1', tmpDir, 'Hello', 'Hi there!');
    const history = await getHistory('test-convo-1', tmpDir);
    assert.equal(history.length, 2);
    assert.equal(history[0].role, 'user');
    assert.equal(history[0].content, 'Hello');
    assert.equal(history[1].role, 'assistant');
    assert.equal(history[1].content, 'Hi there!');
    await rm(tmpDir, { recursive: true });
  });

  it('appendToConversation adds to existing conversation', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'convo-test-'));
    await appendToConversation('test-convo-2', tmpDir, 'First question', 'First answer');
    await appendToConversation('test-convo-2', tmpDir, 'Second question', 'Second answer');
    const history = await getHistory('test-convo-2', tmpDir);
    assert.equal(history.length, 4);
    assert.equal(history[2].content, 'Second question');
    assert.equal(history[3].content, 'Second answer');
    await rm(tmpDir, { recursive: true });
  });

  it('getTurnCount returns correct number', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'convo-test-'));
    await appendToConversation('test-convo-3', tmpDir, 'Q1', 'A1');
    await appendToConversation('test-convo-3', tmpDir, 'Q2', 'A2');
    const turns = await getTurnCount('test-convo-3', tmpDir);
    assert.equal(turns, 2);
    await rm(tmpDir, { recursive: true });
  });

  it('does nothing when conversationId is null/undefined', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'convo-test-'));
    await appendToConversation(null, tmpDir, 'msg', 'resp');
    await appendToConversation(undefined, tmpDir, 'msg', 'resp');
    // Should not throw, should not create files
    const history = await getHistory(null, tmpDir);
    assert.deepEqual(history, []);
    await rm(tmpDir, { recursive: true });
  });
});
