// admin/contacts.js - Contact list + per-contact conversation/support metadata.
// NOTE: /api/contacts/:phone/messages (a "conversationMessages" endpoint) is
// intentionally NOT implemented here and must never be added. Message content
// is AES-256-GCM encrypted per-phone using ENCRYPTION_KEY, which admin routes
// never hold — this is a hard privacy boundary, not an oversight.

import { json, dbTry } from './helpers.js';

export async function handleContacts(request, env, path) {
  const db = env.DB;

  if (path === '/api/contacts' && request.method === 'GET') {
    return dbTry(async () => {
      const { results } = await db.prepare(`
        SELECT
          c.phone_number,
          COUNT(DISTINCT c.id) AS conversation_count,
          COUNT(m.id) AS total_messages,
          SUM(CASE WHEN m.created_at >= datetime('now', '-1 day') THEN 1 ELSE 0 END) AS messages_today,
          SUM(CASE WHEN m.created_at >= datetime('now', '-30 days') THEN 1 ELSE 0 END) AS messages_month,
          MAX(m.created_at) AS last_seen,
          CASE WHEN bl.phone_number IS NOT NULL THEN 1 ELSE 0 END AS is_blacklisted,
          CASE WHEN wl.phone_number IS NOT NULL THEN 1 ELSE 0 END AS is_whitelisted
        FROM conversations c
        LEFT JOIN messages m ON m.conversation_id = c.id
        LEFT JOIN blacklist bl ON bl.phone_number = c.phone_number
        LEFT JOIN whitelist wl ON wl.phone_number = c.phone_number
        GROUP BY c.phone_number
        ORDER BY last_seen DESC
      `).all();
      return json(results);
    });
  }

  const convMatch = path.match(/^\/api\/contacts\/(.+)\/conversations$/);
  if (convMatch && request.method === 'GET') {
    const phone = decodeURIComponent(convMatch[1]);
    return dbTry(async () => {
      const { results } = await db.prepare(`
        SELECT c.id, c.name, c.is_active, c.created_at, c.updated_at,
          COUNT(m.id) AS message_count
        FROM conversations c
        LEFT JOIN messages m ON m.conversation_id = c.id
        WHERE c.phone_number = ?
        GROUP BY c.id
        ORDER BY c.updated_at DESC
      `).bind(phone).all();
      return json(results);
    });
  }

  const supportMatch = path.match(/^\/api\/contacts\/(.+)\/support$/);
  if (supportMatch && request.method === 'GET') {
    const phone = decodeURIComponent(supportMatch[1]);
    return dbTry(async () => {
      const { results } = await db.prepare(`
        SELECT id, message, status, created_at, closed_at
        FROM support_tickets
        WHERE phone_number = ?
        ORDER BY created_at DESC
        LIMIT 20
      `).bind(phone).all();
      return json(results);
    });
  }

  return null; // not a contacts route — let the router try the next handler
}
