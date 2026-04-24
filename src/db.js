// db.js - Database helper functions

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
  // Try to get existing active conversation
  let conv = await db.prepare(
    `SELECT id, name FROM conversations WHERE phone_number = ? AND is_active = 1`
  ).bind(phoneNumber).first();

  // Create one if none exists
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

export async function getConversationHistory(db, conversationId) {
  const { results } = await db.prepare(
    `SELECT role, content FROM messages 
     WHERE conversation_id = ? 
     ORDER BY created_at ASC`
  ).bind(conversationId).all();
  return results || [];
}

export async function saveMessage(db, conversationId, role, content) {
  await db.prepare(
    `INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)`
  ).bind(conversationId, role, content).run();

  // Update conversation timestamp
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
