// db/providers.js - Read-only access to the data-driven `providers` table.
// This table is seeded by schema.sql and is not expected to change often, but
// keeping it in D1 (rather than a hardcoded JS object) means adding a new
// provider is a data change: INSERT a row + write one adapter module, no code
// touching existing providers needs to change.
//
// This module never touches ENCRYPTION_KEY and is safe to import from
// src/admin/* — it only ever returns provider metadata (id, name, base_url,
// auth_style, adapter), never key material.

export async function getProvider(db, providerId) {
  const row = await db.prepare(
    `SELECT id, name, base_url, auth_style, adapter FROM providers WHERE id = ?`
  ).bind(providerId).first();
  return row || null;
}

export async function getAllProviders(db) {
  const { results } = await db.prepare(
    `SELECT id, name, base_url, auth_style, adapter FROM providers ORDER BY name ASC`
  ).all();
  return results || [];
}
