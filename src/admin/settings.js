// admin/settings.js - Global default model / fallback / token limit / naming
// model / memory model / memory extraction threshold / web search default.
// memory_model and memory_extraction_threshold were added as part of the
// admin-api merge — they already existed in the settings table (seeded by
// schema.sql) but were never exposed via the API before this.
//
// web_search_enabled added as part of feature-byok's web-search quick win —
// see src/integrations/ai-provider.js for how this is applied to a request.

import { json, dbTry, readJsonBody } from './helpers.js';

const SETTINGS_KEYS = [
  'ai_model',
  'default_fallback_model',
  'default_token_limit',
  'naming_model',
  'memory_model',
  'memory_extraction_threshold',
  'web_search_enabled',
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
        web_search_enabled: map.web_search_enabled === '1',
      });
    });
  }

  if (path === '/api/settings' && request.method === 'POST') {
    const { body, error } = await readJsonBody(request);
    if (error) return error;

    // web_search_enabled arrives as a JS boolean from the dashboard toggle;
    // normalize to the same '0'/'1' string convention every other settings
    // value uses in this table, rather than introducing a second value type.
    const normalizedBody = { ...body };
    if ('web_search_enabled' in normalizedBody) {
      normalizedBody.web_search_enabled = normalizedBody.web_search_enabled ? '1' : '0';
    }

    const updates = Object.entries(normalizedBody).filter(([k]) => SETTINGS_KEYS.includes(k));
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
