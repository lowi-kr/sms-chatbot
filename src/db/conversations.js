// db/conversations.js - Conversation and message helpers

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

  await db.prepare(
    `UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(conversationId).run();
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
