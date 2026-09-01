// db/conversations.js - Conversation and message helpers
// Messages are encrypted at rest using AES-256-GCM (src/crypto.js).
// saveMessage and getConversationHistory both require phoneNumber + encryptionKey
// so they can encrypt/decrypt per-phone. Neither function ever stores or returns
// raw plaintext content — callers must always supply the key.

import { encryptMessage, decryptMessage } from '../security/crypto.js';

// Name given to a conversation nobody has named yet, e.g. "Conversation Mar 4, 09:15 AM".
export function defaultConversationName(date = new Date()) {
  return `Conversation ${date.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })}`;
}

export async function getActiveConversation(db, phoneNumber) {
  const conv = await db.prepare(
    `SELECT id, name FROM conversations WHERE phone_number = ? AND is_active = 1`
  ).bind(phoneNumber).first();
  return conv || null;
}

// Returns { id, name } for the newly created (active) conversation.
export async function createActiveConversation(db, phoneNumber, name = defaultConversationName()) {
  const result = await db.prepare(
    `INSERT INTO conversations (phone_number, name, is_active) VALUES (?, ?, 1)`
  ).bind(phoneNumber, name).run();
  return { id: result.meta.last_row_id, name };
}

export async function deactivateConversations(db, phoneNumber) {
  await db.prepare(
    `UPDATE conversations SET is_active = 0, updated_at = CURRENT_TIMESTAMP
     WHERE phone_number = ? AND is_active = 1`
  ).bind(phoneNumber).run();
}

// Deactivates whatever was active and creates a fresh conversation (the /new command).
export async function startNewConversation(db, phoneNumber) {
  await deactivateConversations(db, phoneNumber);
  return createActiveConversation(db, phoneNumber);
}

// Makes `conversationId` the active one for this number (the /load command).
export async function switchActiveConversation(db, phoneNumber, conversationId) {
  await deactivateConversations(db, phoneNumber);
  await db.prepare(
    `UPDATE conversations SET is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(conversationId).run();
}

export async function getOrCreateActiveConversation(db, phoneNumber) {
  const conv = await getActiveConversation(db, phoneNumber);
  return conv || await createActiveConversation(db, phoneNumber);
}

// Returns the conversation only if it belongs to `phoneNumber`, so callers can't
// read or mutate someone else's thread by guessing an id.
export async function getOwnedConversation(db, conversationId, phoneNumber) {
  const conv = await db.prepare(
    `SELECT id, name, is_active FROM conversations WHERE id = ? AND phone_number = ?`
  ).bind(conversationId, phoneNumber).first();
  return conv || null;
}

export async function listConversations(db, phoneNumber, limit = 10) {
  const { results } = await db.prepare(
    `SELECT id, name, is_active, updated_at,
     (SELECT COUNT(*) FROM messages WHERE conversation_id = conversations.id) as msg_count
     FROM conversations
     WHERE phone_number = ?
     ORDER BY updated_at DESC
     LIMIT ?`
  ).bind(phoneNumber, limit).all();
  return results || [];
}

export async function countConversationMessages(db, conversationId) {
  const row = await db.prepare(
    `SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?`
  ).bind(conversationId).first();
  return row?.count || 0;
}

export async function deleteConversation(db, conversationId) {
  await db.prepare(`DELETE FROM messages WHERE conversation_id = ?`).bind(conversationId).run();
  await db.prepare(`DELETE FROM conversations WHERE id = ?`).bind(conversationId).run();
}

// Encrypts content before inserting. Throws if encryption fails — silently
// falling back to plaintext storage would be a silent privacy breach.
export async function saveMessage(db, conversationId, role, content, phoneNumber, encryptionKey) {
  const encrypted = await encryptMessage(phoneNumber, content, encryptionKey);

  await db.prepare(
    `INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)`
  ).bind(conversationId, role, encrypted).run();

  await db.prepare(
    `UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(conversationId).run();
}

// Decrypts each message row before returning. Rows that fail decryption are
// substituted with a placeholder rather than skipped (skipping would silently
// shorten context and confuse the AI) or aborting (one bad row shouldn't break
// the whole conversation).
export async function getConversationHistory(db, conversationId, phoneNumber, encryptionKey) {
  const { results } = await db.prepare(
    `SELECT role, content FROM messages
     WHERE conversation_id = ?
     ORDER BY created_at ASC`
  ).bind(conversationId).all();

  if (!results || results.length === 0) return [];

  return Promise.all(results.map(async (msg) => {
    const decrypted = await decryptMessage(phoneNumber, msg.content, encryptionKey);
    if (decrypted === null) {
      console.error(`Failed to decrypt message in conversation ${conversationId} — substituting placeholder`);
      return { role: msg.role, content: '[message unavailable]' };
    }
    return { role: msg.role, content: decrypted };
  }));
}

export async function getConversationMeta(db, conversationId) {
  return await db.prepare(
    `SELECT id, name, is_named FROM conversations WHERE id = ?`
  ).bind(conversationId).first();
}

export async function markConversationNamed(db, conversationId, name) {
  await db.prepare(
    `UPDATE conversations SET name = ?, is_named = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(name, conversationId).run();
}

// Both rename helpers below return the number of rows changed, so callers can
// tell "renamed" from "no such conversation" without a second query.
export async function renameActiveConversation(db, phoneNumber, name) {
  const result = await db.prepare(
    `UPDATE conversations SET name = ?, is_named = 1, updated_at = CURRENT_TIMESTAMP
     WHERE phone_number = ? AND is_active = 1`
  ).bind(name, phoneNumber).run();
  return result.meta.changes;
}

export async function renameOwnedConversation(db, conversationId, phoneNumber, name) {
  const result = await db.prepare(
    `UPDATE conversations SET name = ?, is_named = 1, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND phone_number = ?`
  ).bind(name, conversationId, phoneNumber).run();
  return result.meta.changes;
}
