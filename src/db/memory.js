// db/memory.js - Per-number encrypted memory (durable facts) storage
// This module never sees ENCRYPTION_KEY and never encrypts/decrypts anything —
// that boundary lives entirely in src/security/crypto.js and its callers
// (processMessage.js, memoryExtraction.js, commands.js). Keeping db/memory.js
// crypto-free means the admin API can safely reuse getMemoryMeta without ever
// gaining a path to plaintext facts.

// Returns { phone_number, encrypted_facts, last_extracted_message_count, incognito } or null.
// incognito is a plain 0/1 flag (not fact content) — safe to read without decryption.
export async function getMemoryRow(db, phoneNumber) {
  const row = await db.prepare(
    `SELECT phone_number, encrypted_facts, last_extracted_message_count, incognito
     FROM memory WHERE phone_number = ?`
  ).bind(phoneNumber).first();
  return row || null;
}

export async function saveMemoryRow(db, phoneNumber, encryptedFacts, lastExtractedMessageCount) {
  await db.prepare(
    `INSERT INTO memory (phone_number, encrypted_facts, last_extracted_message_count, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(phone_number) DO UPDATE SET
       encrypted_facts = excluded.encrypted_facts,
       last_extracted_message_count = excluded.last_extracted_message_count,
       updated_at = CURRENT_TIMESTAMP`
  ).bind(phoneNumber, encryptedFacts, lastExtractedMessageCount).run();
}

// Sets the incognito flag without disturbing existing facts/extraction-count if a
// row already exists. placeholderEncryptedFacts is only used when INSERTing a brand
// new row (encrypted_facts is NOT NULL) — callers pass an encrypted empty-array blob
// for numbers with no prior memory. On conflict (row already exists), only incognito
// and updated_at change; encrypted_facts and last_extracted_message_count are untouched.
export async function setMemoryIncognitoFlag(db, phoneNumber, incognito, placeholderEncryptedFacts) {
  await db.prepare(
    `INSERT INTO memory (phone_number, encrypted_facts, incognito, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(phone_number) DO UPDATE SET
       incognito = excluded.incognito,
       updated_at = CURRENT_TIMESTAMP`
  ).bind(phoneNumber, placeholderEncryptedFacts, incognito ? 1 : 0).run();
}

// Admin-facing: metadata only (counts/timestamps/incognito flag), never decrypted
// fact content. Safe to expose via admin-api, which never holds ENCRYPTION_KEY.
export async function getMemoryMeta(db, phoneNumber) {
  const row = await db.prepare(
    `SELECT last_extracted_message_count, incognito, updated_at FROM memory WHERE phone_number = ?`
  ).bind(phoneNumber).first();
  return row || null;
}

export async function deleteMemory(db, phoneNumber) {
  await db.prepare(`DELETE FROM memory WHERE phone_number = ?`).bind(phoneNumber).run();
}