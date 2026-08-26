// admin/numbers.js - Per-number model/fallback/token-limit overrides + usage stats.

import { json, dbTry } from './helpers.js';
import { isValidModelId, isValidPhone } from '../security/validate.js';

export async function handleNumbers(request, env, path) {
  const db = env.DB;

  if (path === '/api/numbers' && request.method === 'GET') {
    return dbTry(async () => {
      const { results } = await db.prepare(`
        SELECT
          c.phone_number,
          ns.model,
          ns.fallback_model,
          ns.token_limit,
          COALESCE(ns.tokens_input_used, 0) AS tokens_input_used,
          COALESCE(ns.tokens_output_used, 0) AS tokens_output_used,
          ns.updated_at
        FROM (SELECT DISTINCT phone_number FROM conversations) c
        LEFT JOIN number_settings ns ON ns.phone_number = c.phone_number
        ORDER BY (COALESCE(ns.tokens_input_used,0) + COALESCE(ns.tokens_output_used,0)) DESC
      `).all();
      return json(results);
    });
  }

  const modelMatch = path.match(/^\/api\/numbers\/(.+)\/model$/);
  if (modelMatch && request.method === 'POST') {
    let phone;
    try {
      phone = decodeURIComponent(modelMatch[1]);
    } catch {
      return json({ error: 'Invalid phone number' }, 400);
    }
    if (!isValidPhone(phone)) return json({ error: 'Invalid phone number' }, 400);
    const body = await request.json().catch(() => ({}));
    const model = body.model === undefined ? null : body.model;
    if (model !== null && !isValidModelId(model)) {
      return json({ error: 'model must be a valid model ID or null' }, 400);
    }
    return dbTry(async () => {
      await db.prepare(
        `INSERT INTO number_settings (phone_number, model, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(phone_number) DO UPDATE SET model = excluded.model, updated_at = CURRENT_TIMESTAMP`
      ).bind(phone, model).run();
      return json({ success: true });
    });
  }

  const fallbackMatch = path.match(/^\/api\/numbers\/(.+)\/fallback$/);
  if (fallbackMatch && request.method === 'POST') {
    let phone;
    try {
      phone = decodeURIComponent(fallbackMatch[1]);
    } catch {
      return json({ error: 'Invalid phone number' }, 400);
    }
    if (!isValidPhone(phone)) return json({ error: 'Invalid phone number' }, 400);
    const body = await request.json().catch(() => ({}));
    const fallbackModel = body.fallback_model === undefined ? null : body.fallback_model;
    if (fallbackModel !== null &&
        fallbackModel !== 'block' &&
        !isValidModelId(fallbackModel)) {
      return json({ error: 'fallback_model must be a valid model ID, "block", or null' }, 400);
    }
    return dbTry(async () => {
      await db.prepare(
        `INSERT INTO number_settings (phone_number, fallback_model, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(phone_number) DO UPDATE SET fallback_model = excluded.fallback_model, updated_at = CURRENT_TIMESTAMP`
      ).bind(phone, fallbackModel).run();
      return json({ success: true });
    });
  }

  const limitMatch = path.match(/^\/api\/numbers\/(.+)\/limit$/);
  if (limitMatch && request.method === 'POST') {
    let phone;
    try {
      phone = decodeURIComponent(limitMatch[1]);
    } catch {
      return json({ error: 'Invalid phone number' }, 400);
    }
    if (!isValidPhone(phone)) return json({ error: 'Invalid phone number' }, 400);
    const body = await request.json().catch(() => ({}));
    const tokenLimit = body.token_limit === null || body.token_limit === '' ? null : parseInt(body.token_limit, 10);
    if (tokenLimit !== null && (!Number.isInteger(tokenLimit) || tokenLimit < 0)) {
      return json({ error: 'token_limit must be a non-negative integer or null' }, 400);
    }
    return dbTry(async () => {
      await db.prepare(
        `INSERT INTO number_settings (phone_number, token_limit, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(phone_number) DO UPDATE SET token_limit = excluded.token_limit, updated_at = CURRENT_TIMESTAMP`
      ).bind(phone, tokenLimit).run();
      return json({ success: true });
    });
  }

  const resetMatch = path.match(/^\/api\/numbers\/(.+)\/reset-usage$/);
  if (resetMatch && request.method === 'POST') {
    let phone;
    try {
      phone = decodeURIComponent(resetMatch[1]);
    } catch {
      return json({ error: 'Invalid phone number' }, 400);
    }
    if (!isValidPhone(phone)) return json({ error: 'Invalid phone number' }, 400);
    return dbTry(async () => {
      await db.prepare(
        `INSERT INTO number_settings (phone_number, tokens_input_used, tokens_output_used, updated_at)
         VALUES (?, 0, 0, CURRENT_TIMESTAMP)
         ON CONFLICT(phone_number) DO UPDATE SET
           tokens_input_used = 0, tokens_output_used = 0, updated_at = CURRENT_TIMESTAMP`
      ).bind(phone).run();
      return json({ success: true });
    });
  }

  return null;
}
