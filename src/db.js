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

export async function getSetting(db, key, defaultValue = null) {
  const result = await db.prepare(
    `SELECT value FROM settings WHERE key = ?`
  ).bind(key).first();
  return result ? result.value : defaultValue;
}

export async function setSetting(db, key, value) {
  await db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
  ).bind(key, value).run();
}

// ---------------------------------------------------------------
// Per-number model/fallback/limit settings + token usage
// ---------------------------------------------------------------

export async function getNumberSettings(db, phoneNumber) {
  const row = await db.prepare(
    `SELECT * FROM number_settings WHERE phone_number = ?`
  ).bind(phoneNumber).first();
  return row || null;
}

// Resolves the effective model/fallback/limit for a number, applying
// global defaults wherever a per-number override is NULL.
export async function getEffectiveConfig(db, phoneNumber) {
  const [numberRow, globalModel, globalFallback, globalLimitRaw] = await Promise.all([
    getNumberSettings(db, phoneNumber),
    getSetting(db, 'ai_model', 'openrouter/free'),
    getSetting(db, 'default_fallback_model', 'block'),
    getSetting(db, 'default_token_limit', ''),
  ]);

  const globalLimit = globalLimitRaw === '' || globalLimitRaw === null ? null : parseInt(globalLimitRaw, 10);

  const model = numberRow?.model || globalModel;
  const fallbackModel = numberRow?.fallback_model || globalFallback;

  // token_limit: per-number 0 means "unlimited for this number" (overrides global).
  // per-number NULL means "use global". Global null/'' means unlimited.
  let tokenLimit;
  if (numberRow && numberRow.token_limit !== null && numberRow.token_limit !== undefined) {
    tokenLimit = numberRow.token_limit === 0 ? null : numberRow.token_limit;
  } else {
    tokenLimit = globalLimit;
  }

  const tokensUsed = (numberRow?.tokens_input_used || 0) + (numberRow?.tokens_output_used || 0);

  return {
    model,
    fallbackModel,      // 'block' or a model slug
    tokenLimit,         // null = unlimited
    tokensUsed,
    isOverLimit: tokenLimit !== null && tokensUsed >= tokenLimit,
  };
}

export async function recordTokenUsage(db, phoneNumber, inputTokens, outputTokens) {
  await db.prepare(
    `INSERT INTO number_settings (phone_number, tokens_input_used, tokens_output_used, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(phone_number) DO UPDATE SET
       tokens_input_used = tokens_input_used + excluded.tokens_input_used,
       tokens_output_used = tokens_output_used + excluded.tokens_output_used,
       updated_at = CURRENT_TIMESTAMP`
  ).bind(phoneNumber, inputTokens || 0, outputTokens || 0).run();
}

export async function setNumberModel(db, phoneNumber, model) {
  await db.prepare(
    `INSERT INTO number_settings (phone_number, model, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(phone_number) DO UPDATE SET model = excluded.model, updated_at = CURRENT_TIMESTAMP`
  ).bind(phoneNumber, model || null).run();
}

export async function setNumberFallback(db, phoneNumber, fallbackModel) {
  await db.prepare(
    `INSERT INTO number_settings (phone_number, fallback_model, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(phone_number) DO UPDATE SET fallback_model = excluded.fallback_model, updated_at = CURRENT_TIMESTAMP`
  ).bind(phoneNumber, fallbackModel || null).run();
}

export async function setNumberTokenLimit(db, phoneNumber, tokenLimit) {
  await db.prepare(
    `INSERT INTO number_settings (phone_number, token_limit, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(phone_number) DO UPDATE SET token_limit = excluded.token_limit, updated_at = CURRENT_TIMESTAMP`
  ).bind(phoneNumber, tokenLimit === null || tokenLimit === undefined ? null : tokenLimit).run();
}

export async function resetNumberUsage(db, phoneNumber) {
  await db.prepare(
    `INSERT INTO number_settings (phone_number, tokens_input_used, tokens_output_used, updated_at)
     VALUES (?, 0, 0, CURRENT_TIMESTAMP)
     ON CONFLICT(phone_number) DO UPDATE SET
       tokens_input_used = 0, tokens_output_used = 0, updated_at = CURRENT_TIMESTAMP`
  ).bind(phoneNumber).run();
}

export async function getAllNumberSettings(db) {
  const { results } = await db.prepare(
    `SELECT * FROM number_settings ORDER BY updated_at DESC`
  ).all();
  return results || [];
}
