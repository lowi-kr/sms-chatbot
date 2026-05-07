// db.js - Database helper functions

import { encryptMessage, decryptMessage } from './crypto.js';

export async function isBlacklisted(db, phoneNumber) {
  const result = await db.prepare(
    `SELECT id FROM blacklist WHERE phone_number = ?`
  ).bind(phoneNumber).first();
  return !!result;
}

export async function isWhitelisted(db, phoneNumber) {
  const result = await db.prepare(
    `SELECT id FROM whitelist WHERE phone_number = ?`
  ).bind(phoneNumber).first();
  return !!result;
}

export async function hasWhitelistEntries(db) {
  const result = await db.prepare(
    `SELECT COUNT(*) as count FROM whitelist`
  ).first();
  return result.count > 0;
}

export async function getOrCreateActiveConversation(db, phoneNumber) {
  let conv = await db.prepare(
    `SELECT id, name FROM conversations WHERE phone_number = ? AND is_active = 1`
  ).bind(phoneNumber).first();

  if (!conv) {
    const name = `Conversation ${new Date().toLocaleDateString('en-US', {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    })}`;
    const result = await db.prepare(
      `INSERT INTO conversations (phone_number, name, is_active) VALUES (?, ?, 1)`
    ).bind(phoneNumber, name).run();

    conv = { id: result.meta.last_row_id, name };
  }

  return conv;
}

/**
 * Get conversation history, decrypting each message.
 * Messages that fail to decrypt are skipped with a warning.
 * encryptionKey is env.ENCRYPTION_KEY
 */
export async function getConversationHistory(db, conversationId, phoneNumber, encryptionKey) {
  const { results } = await db.prepare(
    `SELECT role, content FROM messages 
     WHERE conversation_id = ? 
     ORDER BY created_at ASC`
  ).bind(conversationId).all();

  if (!results || results.length === 0) return [];

  // Decrypt all messages in parallel
  const decrypted = await Promise.all(
    results.map(async (msg) => {
      const plaintext = await decryptMessage(phoneNumber, msg.content, encryptionKey);
      if (plaintext === null) {
        // Skip messages that can't be decrypted (shouldn't happen in normal flow)
        console.warn(`Failed to decrypt message in conversation ${conversationId}`);
        return null;
      }
      return { role: msg.role, content: plaintext };
    })
  );

  return decrypted.filter(Boolean);
}

/**
 * Save a message, encrypting the content before storing.
 * encryptionKey is env.ENCRYPTION_KEY
 */
export async function saveMessage(db, conversationId, role, content, phoneNumber, encryptionKey) {
  const encrypted = await encryptMessage(phoneNumber, content, encryptionKey);

  await db.prepare(
    `INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)`
  ).bind(conversationId, role, encrypted).run();

  await db.prepare(
    `UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(conversationId).run();
}

export async function addToWhitelist(db, phoneNumber, label = '') {
  await db.prepare(
    `INSERT OR IGNORE INTO whitelist (phone_number, label) VALUES (?, ?)`
  ).bind(phoneNumber, label).run();
}

export async function addToBlacklist(db, phoneNumber, reason = '') {
  await db.prepare(
    `INSERT OR IGNORE INTO blacklist (phone_number, reason) VALUES (?, ?)`
  ).bind(phoneNumber, reason).run();
}

export async function removeFromWhitelist(db, phoneNumber) {
  await db.prepare(
    `DELETE FROM whitelist WHERE phone_number = ?`
  ).bind(phoneNumber).run();
}

export async function removeFromBlacklist(db, phoneNumber) {
  await db.prepare(
    `DELETE FROM blacklist WHERE phone_number = ?`
  ).bind(phoneNumber).run();
}
