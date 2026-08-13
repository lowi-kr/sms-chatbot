// admin/numbers.js - Per-number model/fallback/token-limit overrides + usage stats.

import { json, dbTry } from './helpers.js';

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
    const phone = decodeURIComponent(modelMatch[1]);
    const body = await request.json().catch(() => ({}));
    const model = body.model || null;
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
    const phone = decodeURIComponent(fallbackMatch[1]);
    const body = await request.json().catch(() => ({}));
    const fallbackModel = body.fallback_model || null;
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
    const phone = decodeURIComponent(limitMatch[1]);
    const body = await request.json().catch(() => ({}));
    const tokenLimit = body.token_limit === null || body.token_limit === '' ? null : parseInt(body.token_limit, 10);
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
    const phone = decodeURIComponent(resetMatch[1]);
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
