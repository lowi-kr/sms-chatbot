// db/providerKeys.js - CRUD + encryption boundary for BYOK provider keys.
//
// PRIVACY BOUNDARY: this is the ONLY module that ever decrypts a stored
// provider API key. It uses the same HKDF-derived-key pattern as
// src/security/crypto.js's message/memory encryption, with purpose
// 'provider-key' for cryptographic separation from those other two domains.
//
// - encryptAndStoreKey() is called from src/admin/providerKeys.js on the
//   ADD-KEY path only (an admin typing in a new plaintext key that must be
//   encrypted before it touches disk). That route needs env.ENCRYPTION_KEY
//   for this one write path — see the comment in that file for why this is a
//   narrow, explicit exception to "admin never touches ENCRYPTION_KEY", not a
//   reopening of the message/memory boundary.
// - getDecryptedKeyForUse() is called ONLY from the main worker's provider
//   layer (src/integrations/providers/keyResolution.js) at the moment a live
//   API call is about to be made. It must never be called from src/admin/*.
// - Every other function here (list, delete, scope) works with metadata only
//   (id, label, masked last4, tiers, flags) and never touches the encrypted
//   column's plaintext — these ARE safe to call from admin routes.

import { encryptMessage, decryptMessage } from '../security/crypto.js';

const KEY_PURPOSE = 'provider-key';

// HKDF in crypto.js derives a key from (identifier + purpose + pepper). For
// provider keys there's no phone number to key off of, so we use a stable
// per-row identifier instead: `provider-key:<row id>`. This means the row
// must exist (with a placeholder) before we can encrypt into it — see
// encryptAndStoreKey() below.
function keyIdentifier(rowId) {
  return `provider-key:${rowId}`;
}

// Stores a new BYOK key. Takes the PLAINTEXT api key, encrypts it, and never
// returns it back out. Returns metadata only (id, last4, etc).
export async function encryptAndStoreKey(db, encryptionKey, {
  providerId, label, plaintextApiKey, priorityTier = 'prioritized', sortOrder = 0, alwaysUse = false,
}) {
  if (!plaintextApiKey || typeof plaintextApiKey !== 'string') {
    throw new Error('plaintextApiKey is required to store a provider key');
  }
  const last4 = plaintextApiKey.slice(-4);

  // Insert a placeholder row first so we have a stable row id to derive the
  // per-key encryption identifier from. api_key_encrypted is NOT NULL, so we
  // seed it with an empty-string encryption of the identifier itself — this
  // row is invisible to any read path until the UPDATE below completes.
  const insertResult = await db.prepare(
    `INSERT INTO admin_provider_keys
       (provider_id, label, api_key_encrypted, key_last4, priority_tier, sort_order, always_use, is_active)
     VALUES (?, ?, '', ?, ?, ?, ?, 1)`
  ).bind(providerId, label || null, last4, priorityTier, sortOrder, alwaysUse ? 1 : 0).run();

  const rowId = insertResult.meta.last_row_id;
  const encrypted = await encryptMessage(keyIdentifier(rowId), plaintextApiKey, encryptionKey, KEY_PURPOSE);

  await db.prepare(
    `UPDATE admin_provider_keys SET api_key_encrypted = ? WHERE id = ?`
  ).bind(encrypted, rowId).run();

  return { id: rowId, providerId, label, key_last4: last4, priorityTier, sortOrder, alwaysUse };
}

// Called ONLY from the main worker's provider layer at the point of an actual
// outbound API call. Returns the plaintext key, or null if decryption fails
// (e.g. ENCRYPTION_KEY was rotated after this key was stored) — callers
// should treat a null return the same as "this key is unusable" and fall
// through the resolution cascade rather than crashing the request.
export async function getDecryptedKeyForUse(db, encryptionKey, keyId) {
  const row = await db.prepare(
    `SELECT id, api_key_encrypted FROM admin_provider_keys WHERE id = ? AND is_active = 1`
  ).bind(keyId).first();
  if (!row) return null;

  const plaintext = await decryptMessage(keyIdentifier(row.id), row.api_key_encrypted, encryptionKey, KEY_PURPOSE);
  if (plaintext === null) {
    console.error(`Failed to decrypt provider key id=${keyId} — treating as unusable`);
  }
  return plaintext;
}

// ---- Metadata-only functions — safe for admin routes ----

export async function listKeys(db, providerId = null) {
  const query = providerId
    ? db.prepare(
        `SELECT id, provider_id, label, key_last4, priority_tier, sort_order, always_use, is_active, created_at
         FROM admin_provider_keys WHERE provider_id = ? ORDER BY priority_tier ASC, sort_order ASC`
      ).bind(providerId)
    : db.prepare(
        `SELECT id, provider_id, label, key_last4, priority_tier, sort_order, always_use, is_active, created_at
         FROM admin_provider_keys ORDER BY provider_id ASC, priority_tier ASC, sort_order ASC`
      );
  const { results } = await query.all();
  return results || [];
}

export async function deleteKey(db, keyId) {
  await db.prepare(`DELETE FROM admin_provider_keys WHERE id = ?`).bind(keyId).run();
}

export async function setKeyActive(db, keyId, isActive) {
  await db.prepare(
    `UPDATE admin_provider_keys SET is_active = ? WHERE id = ?`
  ).bind(isActive ? 1 : 0, keyId).run();
}

export async function updateKeyOrder(db, keyId, { priorityTier, sortOrder, alwaysUse }) {
  await db.prepare(
    `UPDATE admin_provider_keys SET priority_tier = ?, sort_order = ?, always_use = ? WHERE id = ?`
  ).bind(priorityTier, sortOrder, alwaysUse ? 1 : 0, keyId).run();
}

// ---- Model scoping ----

// Replaces the full scope list for a key. Empty array = unrestricted (usable
// for any model on this provider).
export async function setKeyModelScope(db, keyId, modelIds) {
  await db.prepare(`DELETE FROM provider_key_model_scope WHERE provider_key_id = ?`).bind(keyId).run();
  if (!modelIds || !modelIds.length) return;

  const stmt = db.prepare(
    `INSERT OR IGNORE INTO provider_key_model_scope (provider_key_id, model_id) VALUES (?, ?)`
  );
  await db.batch(modelIds.map(modelId => stmt.bind(keyId, modelId)));
}

export async function getKeyModelScope(db, keyId) {
  const { results } = await db.prepare(
    `SELECT model_id FROM provider_key_model_scope WHERE provider_key_id = ?`
  ).bind(keyId).all();
  return (results || []).map(r => r.model_id);
}

// Resolution helper: returns active keys for a provider that are either
// unrestricted or explicitly scoped to modelId, ordered prioritized-first
// then by sort_order. Used by keyResolution.js — metadata only, no decryption
// happens here (the caller decrypts the specific key it decides to try).
export async function getCandidateKeysForModel(db, providerId, modelId) {
  const { results } = await db.prepare(`
    SELECT k.id, k.label, k.priority_tier, k.sort_order, k.always_use
    FROM admin_provider_keys k
    WHERE k.provider_id = ? AND k.is_active = 1
      AND (
        NOT EXISTS (SELECT 1 FROM provider_key_model_scope s WHERE s.provider_key_id = k.id)
        OR EXISTS (SELECT 1 FROM provider_key_model_scope s WHERE s.provider_key_id = k.id AND s.model_id = ?)
      )
    ORDER BY CASE k.priority_tier WHEN 'prioritized' THEN 0 ELSE 1 END, k.sort_order ASC
  `).bind(providerId, modelId).all();
  return results || [];
}
