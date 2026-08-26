// admin/lists.js - Blacklist and whitelist CRUD.

import { json, dbTry } from './helpers.js';
import { decodePhoneParam, isValidPhone, normalizePhone } from '../security/validate.js';

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
    const body = await request.json().catch(() => ({}));
    if (!isValidPhone(body.phone_number)) {
      return json({ error: 'phone_number must be a valid E.164 phone number' }, 400);
    }
    const phoneNumber = normalizePhone(body.phone_number);
    const reason = typeof body.reason === 'string' ? body.reason.slice(0, 200) : '';
    return dbTry(async () => {
      await db.prepare(
        `INSERT OR IGNORE INTO blacklist (phone_number, reason) VALUES (?, ?)`
      ).bind(phoneNumber, reason).run();
      return json({ success: true });
    });
  }

  const blMatch = path.match(/^\/api\/blacklist\/(.+)$/);
  if (blMatch && request.method === 'DELETE') {
    const phone = decodePhoneParam(blMatch[1]);
    if (!phone) return json({ error: 'Invalid phone number' }, 400);
    return dbTry(async () => {
      await db.prepare(
        `DELETE FROM blacklist WHERE phone_number = ?`
      ).bind(phone).run();
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
    const body = await request.json().catch(() => ({}));
    if (!isValidPhone(body.phone_number)) {
      return json({ error: 'phone_number must be a valid E.164 phone number' }, 400);
    }
    const phoneNumber = normalizePhone(body.phone_number);
    const label = typeof body.label === 'string' ? body.label.slice(0, 200) : '';
    return dbTry(async () => {
      await db.prepare(
        `INSERT OR IGNORE INTO whitelist (phone_number, label) VALUES (?, ?)`
      ).bind(phoneNumber, label).run();
      return json({ success: true });
    });
  }

  const wlMatch = path.match(/^\/api\/whitelist\/(.+)$/);
  if (wlMatch && request.method === 'DELETE') {
    const phone = decodePhoneParam(wlMatch[1]);
    if (!phone) return json({ error: 'Invalid phone number' }, 400);
    return dbTry(async () => {
      await db.prepare(
        `DELETE FROM whitelist WHERE phone_number = ?`
      ).bind(phone).run();
      return json({ success: true });
    });
  }

  return null;
}
