// db/support.js - Support tickets (plaintext by design, see the /support command).

export async function createSupportTicket(db, phoneNumber, message) {
  await db.prepare(
    `INSERT INTO support_tickets (phone_number, message, status) VALUES (?, ?, 'open')`
  ).bind(phoneNumber, message).run();
}

export async function countOpenSupportTickets(db) {
  const row = await db.prepare(
    `SELECT COUNT(*) as count FROM support_tickets WHERE status = 'open'`
  ).first();
  return row?.count || 0;
}
