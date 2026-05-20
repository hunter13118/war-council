/**
 * Conversation Memory — Multi-turn context management.
 * 
 * Maintains conversation history and builds context-windowed prompts.
 * - In-memory LRU cache of active conversations
 * - Disk persistence via JSON files
 * - Token-budgeted history (last N turns that fit within budget)
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const MAX_HISTORY_TOKENS = 4000; // ~4000 tokens reserved for conversation history
const CHARS_PER_TOKEN = 4; // rough approximation
const MAX_CACHED = 20; // LRU cache size

/** In-memory cache: conversationId → { messages, title, updatedAt } */
const cache = new Map();

/**
 * Load a conversation from disk into cache.
 * @param {string} id - Conversation ID
 * @param {string} convosDir - Directory containing conversation files
 * @returns {Object|null}
 */
async function loadConversation(id, convosDir) {
  if (cache.has(id)) return cache.get(id);
  try {
    const data = JSON.parse(await readFile(resolve(convosDir, `${id}.json`), 'utf-8'));
    cache.set(id, data);
    evictOldest();
    return data;
  } catch {
    return null;
  }
}

/**
 * Save a conversation to disk and cache.
 * @param {Object} convo - Full conversation object
 * @param {string} convosDir - Directory path
 */
async function saveConversation(convo, convosDir) {
  cache.set(convo.id, convo);
  evictOldest();
  await mkdir(convosDir, { recursive: true });
  await writeFile(resolve(convosDir, `${convo.id}.json`), JSON.stringify(convo, null, 2));
}

function evictOldest() {
  while (cache.size > MAX_CACHED) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
}

/**
 * Build a multi-turn prompt with conversation history.
 * Includes the last N messages that fit within the token budget.
 * 
 * @param {Array} messages - Array of { role: 'user'|'assistant', content: string }
 * @param {string} currentMessage - The new user message
 * @returns {string} Formatted conversation context
 */
export function buildHistoryContext(messages, currentMessage) {
  if (!messages || messages.length === 0) return '';

  // Work backwards from most recent, accumulate until budget exhausted
  const budget = MAX_HISTORY_TOKENS * CHARS_PER_TOKEN;
  let totalChars = 0;
  const included = [];

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const formatted = `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`;
    if (totalChars + formatted.length > budget) break;
    totalChars += formatted.length;
    included.unshift(formatted);
  }

  if (included.length === 0) return '';
  return `Previous conversation:\n${included.join('\n\n')}\n\n---\n`;
}

/**
 * Get conversation history for a given ID, inject into prompt building.
 * @param {string} conversationId
 * @param {string} convosDir
 * @returns {Array} messages array (may be empty)
 */
export async function getHistory(conversationId, convosDir) {
  if (!conversationId) return [];
  const convo = await loadConversation(conversationId, convosDir);
  return convo?.messages || [];
}

/**
 * Append a user message and assistant response to conversation.
 * Creates the conversation if it doesn't exist.
 * @param {string} conversationId
 * @param {string} convosDir
 * @param {string} userMessage
 * @param {string} assistantResponse
 */
export async function appendToConversation(conversationId, convosDir, userMessage, assistantResponse) {
  if (!conversationId) return;
  let convo = await loadConversation(conversationId, convosDir);
  if (!convo) {
    convo = {
      id: conversationId,
      title: userMessage.slice(0, 60),
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
  convo.messages.push({ role: 'user', content: userMessage });
  convo.messages.push({ role: 'assistant', content: assistantResponse });
  convo.updatedAt = new Date().toISOString();
  await saveConversation(convo, convosDir);
}

/**
 * Get conversation turn count.
 * @param {string} conversationId
 * @param {string} convosDir
 * @returns {number}
 */
export async function getTurnCount(conversationId, convosDir) {
  const msgs = await getHistory(conversationId, convosDir);
  return Math.floor(msgs.length / 2);
}
