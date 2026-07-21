// db/numbers.js - Per-number model, fallback, token limit and usage tracking

import { getSetting } from './settings.js';

export async function getNumberSettings(db, phoneNumber) {
  const row = await db.prepare(
    `SELECT * FROM number_settings WHERE phone_number = ?`
  ).bind(phoneNumber).first();
  return row || null;
}

// Resolves effective model/fallback/limit for a number, applying global
// defaults wherever a per-number override is NULL.
export async function getEffectiveConfig(db, phoneNumber) {
  const [numberRow, globalModel, globalFallback, globalLimitRaw] = await Promise.all([
    getNumberSettings(db, phoneNumber),
    getSetting(db, 'ai_model', 'openrouter/free'),
    getSetting(db, 'default_fallback_model', 'block'),
    getSetting(db, 'default_token_limit', ''),
  ]);

  const globalLimit = globalLimitRaw === '' || globalLimitRaw === null
    ? null
    : parseInt(globalLimitRaw, 10);

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
    fallbackModel,
    tokenLimit,
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
