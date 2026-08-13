// admin/support.js - Support ticket queue (plaintext by design, see /support command).

import { json, dbTry } from './helpers.js';

export async function handleSupport(request, env, path) {
  const db = env.DB;

  if (path === '/api/support' && request.method === 'GET') {
    return dbTry(async () => {
      const { results } = await db.prepare(`
        SELECT id, phone_number, message, status, created_at, closed_at
        FROM support_tickets
        ORDER BY CASE WHEN status = 'open' THEN 0 ELSE 1 END, created_at DESC
      `).all();
      return json(results);
    });
  }

  const closeMatch = path.match(/^\/api\/support\/(\d+)\/close$/);
  if (closeMatch && request.method === 'POST') {
    const id = closeMatch[1];
    return dbTry(async () => {
      const result = await db.prepare(`
        UPDATE support_tickets SET status = 'closed', closed_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'open'
      `).bind(id).run();
      if (result.meta.changes === 0) return json({ error: 'Ticket not found or already closed' }, 404);
      return json({ success: true });
    });
  }

  if (path === '/api/support/open-count' && request.method === 'GET') {
    return dbTry(async () => {
      const result = await db.prepare(
        `SELECT COUNT(*) as count FROM support_tickets WHERE status = 'open'`
      ).first();
      return json({ count: result.count });
    });
  }

  return null;
}
