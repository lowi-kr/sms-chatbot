// admin/lists.js - Blacklist and whitelist CRUD.

import { json, dbTry, readJsonBody } from './helpers.js';

export async function handleLists(request, env, path) {
  const db = env.DB;

  // ---- Blacklist ----

  if (path === '/api/blacklist' && request.method === 'GET') {
    return dbTry(async () => {
      const { results } = await db.prepare(
        `SELECT phone_number, reason, created_at FROM blacklist ORDER BY created_at DESC`
      ).all();
      return json(results);
    });
  }

  if (path === '/api/blacklist' && request.method === 'POST') {
    const { body, error } = await readJsonBody(request);
    if (error) return error;
    if (!body.phone_number) return json({ error: 'Missing phone_number' }, 400);
    return dbTry(async () => {
      await db.prepare(
        `INSERT OR IGNORE INTO blacklist (phone_number, reason) VALUES (?, ?)`
      ).bind(body.phone_number, body.reason || '').run();
      return json({ success: true });
    });
  }

  const blMatch = path.match(/^\/api\/blacklist\/(.+)$/);
  if (blMatch && request.method === 'DELETE') {
    return dbTry(async () => {
      await db.prepare(
        `DELETE FROM blacklist WHERE phone_number = ?`
      ).bind(decodeURIComponent(blMatch[1])).run();
      return json({ success: true });
    });
  }

  // ---- Whitelist ----

  if (path === '/api/whitelist' && request.method === 'GET') {
    return dbTry(async () => {
      const { results } = await db.prepare(
        `SELECT phone_number, label, created_at FROM whitelist ORDER BY created_at DESC`
      ).all();
      return json(results);
    });
  }

  if (path === '/api/whitelist' && request.method === 'POST') {
    const { body, error } = await readJsonBody(request);
    if (error) return error;
    if (!body.phone_number) return json({ error: 'Missing phone_number' }, 400);
    return dbTry(async () => {
      await db.prepare(
        `INSERT OR IGNORE INTO whitelist (phone_number, label) VALUES (?, ?)`
      ).bind(body.phone_number, body.label || '').run();
      return json({ success: true });
    });
  }

  const wlMatch = path.match(/^\/api\/whitelist\/(.+)$/);
  if (wlMatch && request.method === 'DELETE') {
    return dbTry(async () => {
      await db.prepare(
        `DELETE FROM whitelist WHERE phone_number = ?`
      ).bind(decodeURIComponent(wlMatch[1])).run();
      return json({ success: true });
    });
  }

  return null;
}
