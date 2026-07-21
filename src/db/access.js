// db/access.js - Blacklist and whitelist helpers

export async function isBlacklisted(db, phoneNumber) {
  const result = await db.prepare(
    `SELECT id FROM blacklist WHERE phone_number = ?`
  ).bind(phoneNumber).first();
  return !!result;
}

export async function isWhitelisted(db, phoneNumber) {
  const result = await db.prepare(
    `SELECT id FROM whitelist WHERE phone_number = ?`
  ).bind(phoneNumber).first();
  return !!result;
}

export async function hasWhitelistEntries(db) {
  const result = await db.prepare(
    `SELECT COUNT(*) as count FROM whitelist`
  ).first();
  return result.count > 0;
}

export async function addToWhitelist(db, phoneNumber, label = '') {
  await db.prepare(
    `INSERT OR IGNORE INTO whitelist (phone_number, label) VALUES (?, ?)`
  ).bind(phoneNumber, label).run();
}

export async function addToBlacklist(db, phoneNumber, reason = '') {
  await db.prepare(
    `INSERT OR IGNORE INTO blacklist (phone_number, reason) VALUES (?, ?)`
  ).bind(phoneNumber, reason).run();
}

export async function removeFromWhitelist(db, phoneNumber) {
  await db.prepare(
    `DELETE FROM whitelist WHERE phone_number = ?`
  ).bind(phoneNumber).run();
}

export async function removeFromBlacklist(db, phoneNumber) {
  await db.prepare(
    `DELETE FROM blacklist WHERE phone_number = ?`
  ).bind(phoneNumber).run();
}
