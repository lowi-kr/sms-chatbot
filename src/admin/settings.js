// admin/settings.js - Global default model / fallback / token limit / naming
// model / memory model / memory extraction threshold.
// memory_model and memory_extraction_threshold were added as part of the
// admin-api merge — they already existed in the settings table (seeded by
// schema.sql) but were never exposed via the API before this.

import { json, dbTry } from './helpers.js';

const SETTINGS_KEYS = [
  'ai_model',
  'default_fallback_model',
  'default_token_limit',
  'naming_model',
  'memory_model',
  'memory_extraction_threshold',
];

export async function handleSettings(request, env, path) {
  const db = env.DB;

  if (path === '/api/settings' && request.method === 'GET') {
    return dbTry(async () => {
      const placeholders = SETTINGS_KEYS.map(() => '?').join(', ');
      const rows = await db.prepare(
        `SELECT key, value FROM settings WHERE key IN (${placeholders})`
      ).bind(...SETTINGS_KEYS).all();

      const map = {};
      for (const r of rows.results) map[r.key] = r.value;

      return json({
        ai_model: map.ai_model || 'openrouter/free',
        default_fallback_model: map.default_fallback_model || 'block',
        default_token_limit: map.default_token_limit ?? '',
        naming_model: map.naming_model || 'meta-llama/llama-3.1-8b-instruct:free',
        memory_model: map.memory_model || 'meta-llama/llama-3.1-8b-instruct:free',
        memory_extraction_threshold: map.memory_extraction_threshold ?? '10',
      });
    });
  }

  if (path === '/api/settings' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const updates = Object.entries(body).filter(([k]) => SETTINGS_KEYS.includes(k));
    if (!updates.length) return json({ error: 'No valid settings provided' }, 400);

    return dbTry(async () => {
      for (const [key, value] of updates) {
        await db.prepare(
          `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
        ).bind(key, String(value)).run();
      }
      return json({ success: true });
    });
  }

  return null;
}
