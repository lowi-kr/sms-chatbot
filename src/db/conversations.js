// db/conversations.js - Conversation and message helpers
// Messages are encrypted at rest using AES-256-GCM (src/crypto.js).
// saveMessage and getConversationHistory both require phoneNumber + encryptionKey
// so they can encrypt/decrypt per-phone. Neither function ever stores or returns
// raw plaintext content — callers must always supply the key.

import { encryptMessage, decryptMessage } from '../crypto.js';

export async function getOrCreateActiveConversation(db, phoneNumber) {
  let conv = await db.prepare(
    `SELECT id, name FROM conversations WHERE phone_number = ? AND is_active = 1`
  ).bind(phoneNumber).first();

  if (!conv) {
    const name = `Conversation ${new Date().toLocaleDateString('en-US', {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })}`;
    const result = await db.prepare(
      `INSERT INTO conversations (phone_number, name, is_active) VALUES (?, ?, 1)`
    ).bind(phoneNumber, name).run();
    conv = { id: result.meta.last_row_id, name };
  }

  return conv;
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
