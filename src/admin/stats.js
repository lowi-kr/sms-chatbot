// admin/stats.js - Top-level dashboard stat cards.

import { json, dbTry } from './helpers.js';

export async function handleStats(request, env, path) {
  if (path !== '/api/stats' || request.method !== 'GET') return null;

  const db = env.DB;
  return dbTry(async () => {
    const [totals, todayMsgs, activeConvs, blacklistCount, whitelistCount, openTickets] = await Promise.all([
      db.prepare(`SELECT COUNT(*) as total_messages, COUNT(DISTINCT conversation_id) as total_conversations FROM messages`).first(),
      db.prepare(`SELECT COUNT(*) as count FROM messages WHERE created_at >= datetime('now', '-1 day')`).first(),
      db.prepare(`SELECT COUNT(*) as count FROM conversations WHERE is_active = 1`).first(),
      db.prepare(`SELECT COUNT(*) as count FROM blacklist`).first(),
      db.prepare(`SELECT COUNT(*) as count FROM whitelist`).first(),
      db.prepare(`SELECT COUNT(*) as count FROM support_tickets WHERE status = 'open'`).first(),
    ]);
    return json({
      total_messages: totals.total_messages,
      total_conversations: totals.total_conversations,
      messages_today: todayMsgs.count,
      active_conversations: activeConvs.count,
      blacklisted: blacklistCount.count,
      whitelisted: whitelistCount.count,
      open_support_tickets: openTickets.count,
    });
  });
}
